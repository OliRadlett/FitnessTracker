"""Import deduplication and bulk import.

Before this, ``import_fit`` created ``Activity(source='manual', …)`` with no
``provider_activity_id`` and no ``connection_id`` — so there was nothing to
deduplicate on. Uploading the same file twice produced two rows, and every
load-bearing aggregate then counted that ride twice.

Two tiers, because neither alone suffices:

* **Exact** — sha256 of the file bytes, on ``Activity.import_fingerprint``
  (migration 093) under a *partial* unique index.
* **Fuzzy** — same sport, start within ±5 min, duration and distance within
  1%, catching the same ride re-exported by different software. Attaches an
  ``ActivitySource`` rather than creating a second row.

Bulk import exists because a naive loop under ``get_db`` is all-or-nothing:
one malformed file at position 900 of 1000 would erase the 899 that
succeeded. Per-file commit is the whole point of the endpoint.
"""

from __future__ import annotations

import sys
import types
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.activity import Activity, ActivitySource

pytestmark = pytest.mark.integration


def _parsed_fit(**session_overrides) -> dict:
    """A realistic ``parse_fit_file`` return value."""
    session = {
        "name": "Imported Ride",
        "sport_type": "cycling",
        "start_time": datetime.now(UTC) - timedelta(days=4),
        "duration_seconds": 3600,
        "distance_meters": 30000.0,
        "elevation_gain_meters": 250.0,
        "average_heartrate": 140.0,
        "max_heartrate": 165.0,
        "average_power": 200.0,
        "normalized_power": 220.0,
        "average_speed": 8.33,
        "average_cadence": 85.0,
        "calories": 800.0,
        "record_count": 60,
    }
    session.update(session_overrides)
    return {
        "session": session,
        "streams": {
            "heartrate": [140.0] * 60,
            "power": [200.0] * 60,
            "cadence": [85.0] * 60,
        },
    }


def _stub_parser(monkeypatch, payload: dict) -> None:
    """Replace the FIT parser module.

    ``import_fit`` imports the parser lazily and the real module needs
    ``fitparse``, a Cython package that does not build on Windows (CI is Linux
    and has it). Stubbing keeps these tests runnable on every platform.
    """
    stub = types.ModuleType("app.services.fit_parser")
    stub.parse_fit_file = lambda raw: payload
    monkeypatch.setitem(sys.modules, "app.services.fit_parser", stub)


def _multipart(entries: list[tuple[str, bytes]]) -> list:
    """Build a multi-file multipart body for one request.

    httpx wants ``(fieldname, (filename, content, content_type))`` per entry —
    a bare 3-tuple is read as ``(fieldname, ...)`` and blows up. Every file
    goes under the single ``files`` field the endpoint declares.
    """
    return [
        (
            "files",
            (name, content, "application/octet-stream"),
        )
        for name, content in entries
    ]


async def _import_one(client, payload: dict, monkeypatch, content: bytes = b"ride"):
    _stub_parser(monkeypatch, payload)
    return await client.post(
        "/api/v1/activities/import-fit",
        files={"file": ("ride.fit", content, "application/octet-stream")},
    )


class TestExactDuplicate:
    async def test_same_bytes_create_one_row(self, client, db_session, test_user, monkeypatch):
        """The regression: identical bytes used to produce two activities."""
        payload = _parsed_fit()

        first = await _import_one(client, payload, monkeypatch, b"identical-bytes")
        assert first.status_code == 200, first.text

        second = await _import_one(client, payload, monkeypatch, b"identical-bytes")
        assert second.status_code == 200, second.text

        # Same activity returned, and only one row exists.
        assert second.json()["id"] == first.json()["id"]
        rows = list(
            (
                await db_session.execute(
                    select(Activity).where(Activity.user_id == test_user.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1

    async def test_fingerprint_is_stored(self, client, db_session, test_user, monkeypatch):
        from app.services.import_dedup import file_fingerprint

        payload = _parsed_fit()
        await _import_one(client, payload, monkeypatch, b"fingerprint-bytes")

        rows = list(
            (
                await db_session.execute(
                    select(Activity).where(Activity.user_id == test_user.id)
                )
            )
            .scalars()
            .all()
        )
        assert rows[0].import_fingerprint == file_fingerprint(b"fingerprint-bytes")

    async def test_fingerprint_is_exposed_on_read(self, client, monkeypatch):
        body = (await _import_one(client, _parsed_fit(), monkeypatch, b"exposed")).json()
        assert body["import_fingerprint"] is not None

    async def test_different_bytes_are_not_exact_duplicates(
        self, client, db_session, test_user, monkeypatch
    ):
        """Different files for genuinely different rides both land."""
        # Shift the start well outside the fuzzy window so only the exact tier
        # could possibly match.
        base = datetime.now(UTC)
        first = await _import_one(
            client,
            _parsed_fit(start_time=base - timedelta(days=10)),
            monkeypatch,
            b"ride-a",
        )
        second = await _import_one(
            client,
            _parsed_fit(start_time=base - timedelta(days=3)),
            monkeypatch,
            b"ride-b",
        )

        assert first.json()["id"] != second.json()["id"]
        rows = list(
            (
                await db_session.execute(
                    select(Activity).where(Activity.user_id == test_user.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 2

    async def test_provider_rows_have_no_fingerprint(self, client, db_session, test_activity):
        """Only file imports carry one — provider rows stay NULL."""
        assert test_activity.import_fingerprint is None


class TestFuzzyDuplicate:
    async def test_reexported_ride_attaches_instead_of_duplicating(
        self, client, db_session, test_user, monkeypatch
    ):
        """Same ride, different export: bytes differ, so the exact tier misses.

        The result must be a second source on the *same* activity, not a second
        activity — and the original must keep its identity and history.
        """
        base = datetime.now(UTC) - timedelta(days=7)
        first = await _import_one(
            client, _parsed_fit(start_time=base), monkeypatch, b"export-one"
        )
        assert first.status_code == 200, first.text
        original_id = first.json()["id"]

        # Clock drift plus a rounding-level distance difference.
        second = await _import_one(
            client,
            _parsed_fit(start_time=base + timedelta(minutes=2), distance_meters=30060.0),
            monkeypatch,
            b"export-two-different-bytes",
        )

        assert second.json()["id"] == original_id
        activities = list(
            (
                await db_session.execute(
                    select(Activity).where(Activity.user_id == test_user.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(activities) == 1

        # Recorded as provenance, so the import is visible and reversible.
        sources = list(
            (
                await db_session.execute(
                    select(ActivitySource).where(ActivitySource.activity_id == original_id)
                )
            )
            .scalars()
            .all()
        )
        assert [s.provider for s in sources] == ["import"]

    async def test_repeat_reexport_does_not_accumulate_sources(
        self, client, db_session, test_user, monkeypatch
    ):
        """Importing the same re-export twice records one source row."""
        base = datetime.now(UTC) - timedelta(days=9)
        first = await _import_one(
            client, _parsed_fit(start_time=base), monkeypatch, b"orig"
        )
        for _ in range(2):
            await _import_one(
                client,
                _parsed_fit(start_time=base + timedelta(minutes=1)),
                monkeypatch,
                b"reexport",
            )

        sources = list(
            (
                await db_session.execute(
                    select(ActivitySource).where(
                        ActivitySource.activity_id == first.json()["id"]
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(sources) == 1

    async def test_missing_start_date_cannot_fuzzy_match(self, client, monkeypatch):
        """Without a start time there is nothing to compare, so no fuzzy match.

        Guards the `if start_date is None: return None` branch: a file with no
        timestamp must not be folded into an arbitrary existing activity.
        """
        first = await _import_one(
            client,
            _parsed_fit(start_time=None),
            monkeypatch,
            b"no-start",
        )
        assert first.status_code == 200, first.text

        second = await _import_one(
            client,
            _parsed_fit(start_time=None),
            monkeypatch,
            b"no-start-different",
        )
        # Different bytes and no start date: no exact or fuzzy match.
        assert second.json()["id"] != first.json()["id"]

    async def test_different_sport_is_not_a_duplicate(self, client, monkeypatch):
        """Same instant, same measurements, different sport: two activities.

        Uses ``strength`` rather than an arbitrary sport: the sport filter gates
        ingestion to the configured allowlist (pitfall 26), so an unlisted sport
        would 422 at the filter and never reach the dedup comparison.
        """
        base = datetime.now(UTC) - timedelta(days=12)
        ride = await _import_one(
            client, _parsed_fit(start_time=base), monkeypatch, b"ride-x"
        )
        other = await _import_one(
            client,
            _parsed_fit(start_time=base, sport_type="strength"),
            monkeypatch,
            b"strength-x",
        )
        assert other.json()["id"] != ride.json()["id"]

    async def test_distant_start_is_not_a_duplicate(self, client, monkeypatch):
        """Outside the ±5 min window."""
        base = datetime.now(UTC) - timedelta(days=20)
        first = await _import_one(
            client, _parsed_fit(start_time=base), monkeypatch, b"t1"
        )
        second = await _import_one(
            client,
            _parsed_fit(start_time=base + timedelta(hours=2)),
            monkeypatch,
            b"t2",
        )
        assert second.json()["id"] != first.json()["id"]

    async def test_materially_different_distance_is_not_a_duplicate(
        self, client, monkeypatch
    ):
        """Beyond the 1% tolerance."""
        base = datetime.now(UTC) - timedelta(days=22)
        first = await _import_one(
            client, _parsed_fit(start_time=base, distance_meters=30000.0), monkeypatch, b"d1"
        )
        second = await _import_one(
            client,
            _parsed_fit(start_time=base, distance_meters=45000.0),
            monkeypatch,
            b"d2",
        )
        assert second.json()["id"] != first.json()["id"]

    async def test_missing_distance_does_not_block_a_match(
        self, client, monkeypatch
    ):
        """A file with no distance cannot be told apart by distance.

        The other two criteria still have to agree, so this must not become a
        catch-all that folds every nearby ride together.
        """
        base = datetime.now(UTC) - timedelta(days=25)
        first = await _import_one(
            client,
            _parsed_fit(start_time=base, distance_meters=None),
            monkeypatch,
            b"nodist-1",
        )
        second = await _import_one(
            client,
            _parsed_fit(start_time=base + timedelta(minutes=1), distance_meters=None),
            monkeypatch,
            b"nodist-2",
        )
        assert second.json()["id"] == first.json()["id"]


class TestBulkImport:
    async def test_reports_each_file_independently(
        self, client, db_session, test_user, monkeypatch
    ):
        """Three distinct rides, three created — and the shape is per-file."""
        base = datetime.now(UTC) - timedelta(days=40)
        payloads = [
            _parsed_fit(start_time=base - timedelta(days=i * 3)) for i in range(3)
        ]
        # Each file needs its own parse result; route by content.
        mapping = {
            b"content-0": payloads[0],
            b"content-1": payloads[1],
            b"content-2": payloads[2],
        }
        stub = types.ModuleType("app.services.fit_parser")
        stub.parse_fit_file = lambda raw: mapping[raw]
        monkeypatch.setitem(sys.modules, "app.services.fit_parser", stub)

        resp = await client.post(
            "/api/v1/activities/import-bulk",
            files=_multipart(
                [(f"ride_{i}.fit", f"content-{i}".encode()) for i in range(3)]
            ),
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["created"] == 3
        assert body["duplicates"] == 0
        assert body["failed"] == 0
        assert [r["status"] for r in body["results"]] == ["created"] * 3
        # Every result names its file, so a partial batch is actionable.
        assert [r["filename"] for r in body["results"]] == [
            "ride_0.fit",
            "ride_1.fit",
            "ride_2.fit",
        ]

    async def test_one_bad_file_does_not_erase_the_others(
        self, client, db_session, test_user, monkeypatch
    ):
        """The whole point of per-file commit.

        File 2 raises mid-parse. Files 1 and 3 must survive — under ``get_db``'s
        single end-of-request commit, a naive loop would have rolled all three
        back and the user would have lost two real activities.
        """
        base = datetime.now(UTC) - timedelta(days=50)

        def parse(raw: bytes) -> dict:
            if raw == b"content-1":
                raise ValueError("corrupt FIT header")
            return _parsed_fit(start_time=base - timedelta(days=raw[-1] + 0x30))

        stub = types.ModuleType("app.services.fit_parser")
        stub.parse_fit_file = parse
        monkeypatch.setitem(sys.modules, "app.services.fit_parser", stub)

        resp = await client.post(
            "/api/v1/activities/import-bulk",
            files=_multipart(
                [
                    ("a.fit", b"content-0"),
                    ("b.fit", b"content-1"),
                    ("c.fit", b"content-2"),
                ]
            ),
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["created"] == 2
        assert body["failed"] == 1
        assert [r["status"] for r in body["results"]] == [
            "created",
            "failed",
            "created",
        ]
        assert body["results"][1]["filename"] == "b.fit"
        assert body["results"][1]["error"]

        # And both good ones are really in the database.
        rows = list(
            (
                await db_session.execute(
                    select(Activity).where(Activity.user_id == test_user.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 2

    async def test_duplicates_are_counted_separately(
        self, client, monkeypatch
    ):
        """A batch mixing new and already-imported files reports both."""
        base = datetime.now(UTC) - timedelta(days=60)
        mapping = {
            b"content-0": _parsed_fit(start_time=base),
            b"content-1": _parsed_fit(start_time=base - timedelta(days=2)),
        }
        stub = types.ModuleType("app.services.fit_parser")
        stub.parse_fit_file = lambda raw: mapping[raw]
        monkeypatch.setitem(sys.modules, "app.services.fit_parser", stub)

        first = await client.post(
            "/api/v1/activities/import-bulk",
            files=_multipart([("a.fit", b"content-0")]),
        )
        assert first.json()["created"] == 1

        second = await client.post(
            "/api/v1/activities/import-bulk",
            files=_multipart([("a.fit", b"content-0"), ("b.fit", b"content-1")]),
        )
        body = second.json()
        assert body["duplicates"] == 1
        assert body["created"] == 1
        # The duplicate points at the activity that already existed.
        assert body["results"][0]["attached_source"] is True
        assert body["results"][0]["activity_id"] == first.json()["results"][0]["activity_id"]

    async def test_empty_batch_is_rejected(self, client):
        resp = await client.post("/api/v1/activities/import-bulk", files=[])
        assert resp.status_code in (422, 400)

    async def test_oversized_batch_is_rejected(self, client, monkeypatch):
        """Bounded so one request cannot hold a worker open indefinitely."""
        from app.api.activities import MAX_BULK_FILES

        stub = types.ModuleType("app.services.fit_parser")
        stub.parse_fit_file = lambda raw: _parsed_fit()
        monkeypatch.setitem(sys.modules, "app.services.fit_parser", stub)

        resp = await client.post(
            "/api/v1/activities/import-bulk",
            files=_multipart(
                [(f"f{i}.fit", f"c{i}".encode()) for i in range(MAX_BULK_FILES + 1)]
            ),
        )

        assert resp.status_code == 422
        assert "Too many files" in resp.json()["detail"]


class TestNullFingerprintCoexistence:
    """The partial index exists precisely for this.

    A plain ``unique(user_id, import_fingerprint)`` would be a constraint on
    NULLs that does not mean what we want; thousands of provider-synced rows are
    NULL and must coexist freely.
    """

    async def test_many_null_fingerprints_coexist(
        self, client, db_session, test_user, test_activity
    ):
        for _ in range(3):
            db_session.add(
                Activity(
                    user_id=test_user.id,
                    source="strava",
                    sport_type="cycling",
                    name="Synced Ride",
                    start_date=datetime.now(UTC) - timedelta(days=100),
                )
            )
        await db_session.flush()

        rows = list(
            (
                await db_session.execute(
                    select(Activity).where(Activity.user_id == test_user.id)
                )
            )
            .scalars()
            .all()
        )
        nulls = [r for r in rows if r.import_fingerprint is None]
        assert len(nulls) >= 4

    async def test_two_imports_of_identical_bytes_still_conflict(
        self, client, monkeypatch
    ):
        """The index is unique where it matters."""
        resp = await _import_one(
            client, _parsed_fit(), monkeypatch, b"conflicting-bytes"
        )
        assert resp.status_code == 200
        # Second import is caught by the *lookup* before the index would fire,
        # which is the intended path; the index is the backstop for races.
        again = await _import_one(
            client, _parsed_fit(), monkeypatch, b"conflicting-bytes"
        )
        assert again.json()["id"] == resp.json()["id"]


class TestRouteOrdering:
    """Pitfall 13: a static path below ``/{param}`` is shadowed and 422s."""

    def test_import_bulk_registered_above_dynamic_activity_route(self):
        from app.api.activities import router

        paths = [r.path for r in router.routes]
        bulk_index = paths.index("/import-bulk")
        dynamic_index = min(
            i for i, p in enumerate(paths) if p.startswith("/{activity_id}")
        )
        assert bulk_index < dynamic_index, (
            f"/import-bulk at {bulk_index} is shadowed by "
            f"{{activity_id}} at {dynamic_index}"
        )
