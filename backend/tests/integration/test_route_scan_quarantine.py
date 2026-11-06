"""The scan must not score routes the user quarantined.

Quarantine means "set aside"; on the production copy 61 of 102 routes were
quarantined, so including them made the scan spend ~47 minutes and cache pairs
that the suggestion query then filtered out.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.route import Route
from app.models.user import User

pytestmark = pytest.mark.integration

ENCODED = "o}~mH~}xMz@z@z@z@z@z@"


async def test_scan_passes_only_active_routes_to_the_graph(test_engine, monkeypatch):
    from app.integrations import route_intelligence
    from app.services.route_similarity import recompute_user_similarity

    async with AsyncSession(test_engine, expire_on_commit=False) as db:
        user = User(
            id=uuid.uuid4(),
            email=f"scan-{uuid.uuid4().hex[:8]}@example.com",
            name="Scan",
        )
        db.add(user)
        await db.flush()

        def make_route(name: str, quarantined: bool = False) -> Route:
            return Route(
                user_id=user.id,
                name=name,
                sport_type="cycling",
                distance_meters=10_000,
                encoded_polyline=ENCODED,
                start_lat=51.0,
                start_lng=-1.0,
                end_lat=51.0,
                end_lng=-1.0,
                is_loop=True,
                quarantined_at=datetime.now(UTC) if quarantined else None,
            )

        a = make_route("Active A")
        b = make_route("Active B")
        hidden = make_route("Quarantined", quarantined=True)
        db.add_all([a, b, hidden])
        await db.commit()

        seen: dict[str, set[str]] = {}

        def fake_graph(routes_data, pairs, **kwargs):
            seen["ids"] = {item["id"] for item in routes_data}
            return {"pairs": []}

        monkeypatch.setattr(
            route_intelligence, "compute_route_similarity_on_modal", fake_graph
        )

        result = await recompute_user_similarity(db, user.id)
        assert result["status"] == "ready"
        assert str(hidden.id) not in seen["ids"]
        assert seen["ids"] == {str(a.id), str(b.id)}

        await db.execute(delete(User).where(User.id == user.id))
        await db.commit()
