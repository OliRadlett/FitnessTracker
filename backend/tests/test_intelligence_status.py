"""Tests for the intelligence status endpoints (t2 marker fix).

``GET /api/v1/cross-domain/status`` and ``GET /api/v1/segments/status`` back
the settings ``IntelligenceStatusCard``: they return 200 with
``analyzed_at=None`` when nothing was ever fitted (instead of the 404 the
list/detail endpoints use), so the card can render "Not yet fitted" without
treating it as an error.

No DB — FastAPI TestClient with the DB/auth dependencies overridden.
"""

import ast
import pathlib
import uuid
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.testclient import TestClient

import app.api.cross_domain as cross_domain_api
import app.api.segments as segments_api
from app.database import get_db
from app.services.auth import get_current_user


def _client(db_row) -> TestClient:
    class _FakeResult:
        def __init__(self, row):
            self._row = row

        def one(self):
            return self._row

    class _FakeDB:
        async def execute(self, _query):
            return _FakeResult(db_row)

    app = FastAPI()
    app.include_router(
        cross_domain_api.router, prefix="/api/v1/cross-domain"
    )
    app.include_router(segments_api.router, prefix="/api/v1/segments")
    app.dependency_overrides[get_current_user] = lambda: type(
        "U", (), {"id": uuid.uuid4()}
    )()
    app.dependency_overrides[get_db] = lambda: _FakeDB()
    return TestClient(app, raise_server_exceptions=False)


def test_cross_domain_status_with_data():
    dt = datetime(2026, 9, 27, 6, 15, tzinfo=UTC)
    r = _client((dt, 3)).get("/api/v1/cross-domain/status")
    assert r.status_code == 200
    assert r.json() == {"analyzed_at": dt.isoformat(), "insight_count": 3}


def test_cross_domain_status_empty_is_200_null_not_404():
    r = _client((None, 0)).get("/api/v1/cross-domain/status")
    assert r.status_code == 200
    assert r.json() == {"analyzed_at": None, "insight_count": 0}


def test_segments_status_with_data():
    dt = datetime(2026, 9, 27, 6, 15, tzinfo=UTC)
    r = _client((dt, 5, 4)).get("/api/v1/segments/status")
    assert r.status_code == 200
    assert r.json() == {
        "analyzed_at": dt.isoformat(),
        "segment_count": 5,
        "analyzed_count": 4,
    }


def test_segments_status_empty_is_200_null_not_404():
    r = _client((None, 0, 0)).get("/api/v1/segments/status")
    assert r.status_code == 200
    assert r.json() == {
        "analyzed_at": None,
        "segment_count": 0,
        "analyzed_count": 0,
    }


def _route_order(module, dynamic: str) -> None:
    """`/status` must be registered before a colliding single-segment dynamic
    route (pitfall 13): ``/{insight_type}`` / ``/{segment_id}`` would
    otherwise swallow `/status` and 404."""
    tree = ast.parse(pathlib.Path(module.__file__).read_text(encoding="utf-8"))
    order = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for dec in node.decorator_list:
                src = ast.unparse(dec)
                if "router.get" in src:
                    order.append((node.name, src))
    status_idx = next(i for i, (_, s) in enumerate(order) if "/status" in s)
    dyn_idx = next(i for i, (_, s) in enumerate(order) if dynamic in s)
    assert status_idx < dyn_idx, f"/status must precede {dynamic}"


def test_cross_domain_status_registered_before_dynamic_route():
    _route_order(cross_domain_api, "/{insight_type}")


def test_segments_status_registered_before_dynamic_route():
    _route_order(segments_api, "/{segment_id}")
