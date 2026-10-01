"""``GET /activities/timeseries`` — dense, server-bucketed activity aggregates.

The activities stats view used to bucket client-side over a row-capped fetch and
re-zero-fill the gaps, so a truncated window rendered as a training dip that never
happened — under a note claiming the view "does not silently chart a partial
window". With aggregation in SQL there is no row cap in the path, and every
bucket in range is returned, so a zero means "no training" by construction.

The load-bearing property is **density**: a gap must arrive as an explicit
zero-filled bucket, never as a missing one. A client that re-zero-fills is back
to the original defect, so these tests assert the server never leaves a hole.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta

import pytest

from app.models.activity import Activity

pytestmark = pytest.mark.integration


def _activity(user, *, days_ago: int, **overrides) -> Activity:
    """Build a test activity ``days_ago`` days in the past.

    ``days_ago=0`` means *midday today*, not "now": an activity stamped at the
    current time falls on today's UTC date, but the test's ``end`` boundary is
    built from ``date.today()`` and the assertion compares bucket start dates.
    Pinning to noon UTC keeps the bucket unambiguous regardless of when the
    suite runs.
    """
    base = {
        "user_id": user.id,
        "source": "strava",
        "sport_type": "cycling",
        "name": f"Ride -{days_ago}",
        "start_date": datetime.combine(
            date.today() - timedelta(days=days_ago), time(12, 0), tzinfo=UTC
        ),
        "duration_seconds": 3600,
        "distance_meters": 30000.0,
        "elevation_gain_meters": 200.0,
        "tss": 80.0,
    }
    base.update(overrides)
    return Activity(**base)


class TestDensity:
    async def test_rest_days_are_explicit_zero_buckets(
        self, db_session, test_user, client
    ):
        """A rest day must be present with zeros, not absent.

        This is the whole point: the client's zero-fill was the defect, so the
        server has to make a hole unrepresentable.
        """
        end = date.today()
        start = end - timedelta(days=6)
        db_session.add(_activity(test_user, days_ago=1))
        await db_session.flush()

        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={"bucket": "day", "start": start.isoformat(), "end": end.isoformat()},
        )
        assert resp.status_code == 200, resp.text
        buckets = resp.json()["buckets"]

        assert len(buckets) == 7
        assert [b["bucket_start"] for b in buckets] == [
            (start + timedelta(days=i)).isoformat() for i in range(7)
        ]
        # Six rest days, all present and all zero.
        rest = [b for b in buckets if b["count"] == 0]
        assert len(rest) == 6
        assert all(b["distance_meters"] == 0 for b in rest)

    async def test_missing_middle_week_still_filled(
        self, db_session, test_user, client
    ):
        """A gap *between* two active weeks must not collapse the series."""
        end = date.today()
        start = end - timedelta(days=27)
        db_session.add(_activity(test_user, days_ago=1))
        db_session.add(_activity(test_user, days_ago=27))
        await db_session.flush()

        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={"bucket": "week", "start": start.isoformat(), "end": end.isoformat()},
        )
        buckets = resp.json()["buckets"]

        counts = [b["count"] for b in buckets]
        assert 0 in counts, "an empty week must be represented, not skipped"
        assert sum(counts) == 2

    async def test_week_buckets_are_monday_based(
        self, db_session, test_user, client
    ):
        """date_trunc('week') is Monday-based; the frontend assumes ISO weeks."""
        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "week",
                "start": (date.today() - timedelta(days=20)).isoformat(),
                "end": date.today().isoformat(),
            },
        )
        for b in resp.json()["buckets"]:
            assert date.fromisoformat(b["bucket_start"]).weekday() == 0

    async def test_month_buckets_start_on_first(
        self, db_session, test_user, client
    ):
        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "month",
                "start": (date.today() - timedelta(days=200)).isoformat(),
                "end": date.today().isoformat(),
            },
        )
        for b in resp.json()["buckets"]:
            assert date.fromisoformat(b["bucket_start"]).day == 1

    async def test_range_spanning_year_boundary(
        self, db_session, test_user, client
    ):
        """Month arithmetic across a year boundary is the easy thing to get wrong."""
        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "month",
                "start": "2025-11-15",
                "end": "2026-02-03",
            },
        )
        assert resp.status_code == 200, resp.text
        starts = [b["bucket_start"] for b in resp.json()["buckets"]]
        assert starts == ["2025-11-01", "2025-12-01", "2026-01-01", "2026-02-01"]


class TestTotals:
    async def test_totals_match_sum_of_buckets(
        self, db_session, test_user, client
    ):
        """Totals are summed from the dense series, so they cannot disagree."""
        for d in (1, 3, 10):
            db_session.add(_activity(test_user, days_ago=d))
        await db_session.flush()
        end = date.today()
        start = end - timedelta(days=13)

        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={"bucket": "day", "start": start.isoformat(), "end": end.isoformat()},
        )
        body = resp.json()

        assert body["totals"]["count"] == 3
        assert body["totals"]["count"] == sum(b["count"] for b in body["buckets"])
        assert body["totals"]["tss"] == pytest.approx(
            sum(b["tss"] for b in body["buckets"])
        )
        assert body["totals"]["distance_meters"] == pytest.approx(90000.0)

    async def test_no_activities_returns_all_zero(
        self, db_session, test_user, client
    ):
        end = date.today()
        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "day",
                "start": (end - timedelta(days=4)).isoformat(),
                "end": end.isoformat(),
            },
        )
        body = resp.json()
        assert len(body["buckets"]) == 5
        assert body["totals"] == {
            "count": 0,
            "distance_meters": 0,
            "duration_seconds": 0,
            "elevation_gain_meters": 0,
            "tss": 0,
        }
        assert body["sport_breakdown"] == []


class TestFilters:
    async def test_sport_type_filter(self, db_session, test_user, client):
        db_session.add(_activity(test_user, days_ago=0, sport_type="cycling"))
        db_session.add(_activity(test_user, days_ago=1, sport_type="running"))
        await db_session.flush()
        end = date.today()

        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "day",
                "start": (end - timedelta(days=3)).isoformat(),
                "end": end.isoformat(),
                "sport_type": "running",
            },
        )
        body = resp.json()
        assert body["totals"]["count"] == 1
        assert body["sport_breakdown"] == [{"sport_type": "running", "count": 1}]

    async def test_wahoo_activities_excluded(
        self, db_session, test_user, client
    ):
        """Standalone Wahoo rows were merged into their Strava twin.

        Counting them again would double-count, so the same filter
        list_activities uses is applied here. This is the filter that is
        hand-copied in several dashboard queries; asserting it here is what
        stops the copy drifting.
        """
        db_session.add(_activity(test_user, days_ago=1, source="strava"))
        db_session.add(_activity(test_user, days_ago=1, source="wahoo"))
        await db_session.flush()
        end = date.today()

        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "day",
                "start": (end - timedelta(days=1)).isoformat(),
                "end": end.isoformat(),
            },
        )
        body = resp.json()
        assert body["totals"]["count"] == 1
        assert {s["sport_type"] for s in body["sport_breakdown"]} == {"cycling"}

    async def test_activities_without_tss_still_counted(
        self, db_session, test_user, client
    ):
        """A TSS-less activity must not vanish from the series.

        ``weekly_tss`` filters ``Activity.tss.isnot(None)``; copying that here
        would also drop those activities from count, distance and duration,
        which is wrong. The coalesce on the TSS sum is the correct mechanism.
        """
        db_session.add(_activity(test_user, days_ago=1, tss=None))
        await db_session.flush()
        end = date.today()

        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "day",
                "start": (end - timedelta(days=1)).isoformat(),
                "end": end.isoformat(),
            },
        )
        body = resp.json()
        assert body["totals"]["count"] == 1
        assert body["totals"]["distance_meters"] == pytest.approx(30000.0)
        assert body["totals"]["tss"] == 0

    async def test_another_users_activities_invisible(
        self, db_session, test_user, client
    ):
        from app.models.user import User

        other = User(email="other-timeseries@example.com", name="Other")
        db_session.add(other)
        await db_session.flush()
        db_session.add(_activity(other, days_ago=0))
        await db_session.flush()
        end = date.today()

        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "day",
                "start": (end - timedelta(days=1)).isoformat(),
                "end": end.isoformat(),
            },
        )
        assert resp.json()["totals"]["count"] == 0


class TestRangeGuards:
    async def test_complete_true_for_normal_range(self, db_session, test_user, client):
        end = date.today()
        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "day",
                "start": (end - timedelta(days=29)).isoformat(),
                "end": end.isoformat(),
            },
        )
        body = resp.json()
        assert body["complete"] is True
        assert body["clamped_to"] is None

    async def test_oversized_range_is_clamped_not_rejected(
        self, db_session, test_user, client
    ):
        """Clamp and flag rather than error — the invariant the old note faked."""
        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "day",
                "start": "2000-01-01",
                "end": date.today().isoformat(),
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["complete"] is False
        assert body["clamped_to"] is not None
        assert len(body["buckets"]) == 366

    async def test_end_before_start_is_422(self, db_session, test_user, client):
        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "day",
                "start": date.today().isoformat(),
                "end": (date.today() - timedelta(days=5)).isoformat(),
            },
        )
        assert resp.status_code == 422

    async def test_invalid_bucket_is_rejected_by_validation(
        self, db_session, test_user, client
    ):
        resp = await client.get(
            "/api/v1/activities/timeseries",
            params={
                "bucket": "decade",
                "start": date.today().isoformat(),
                "end": date.today().isoformat(),
            },
        )
        assert resp.status_code == 422


class TestRouteOrdering:
    """Pitfall 13: a static path below a ``/{param}`` handler 422s.

    The /orphans incident proved that asserting the handler *exists* catches
    nothing — the endpoint was defined, the docs claimed the order was right, and
    the request still 422'd. So this asserts the decorator *index*, and the
    request test above proves the route actually resolves.
    """

    def test_timeseries_registered_above_dynamic_activity_route(self):
        from app.api.activities import router

        paths = [r.path for r in router.routes]
        ts_index = paths.index("/timeseries")
        dynamic_index = min(
            i for i, p in enumerate(paths) if p.startswith("/{activity_id}")
        )
        assert ts_index < dynamic_index, (
            f"/timeseries at {ts_index} is shadowed by "
            f"{{activity_id}} at {dynamic_index}"
        )
