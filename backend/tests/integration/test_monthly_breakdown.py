"""The consolidated monthly breakdown, and the two endpoints that now share it.

``monthly_summary`` (dashboard/weekly.py) and ``yearly_summary``
(dashboard/yearly.py) each held their own five hand-written grouped queries and
their own month-enumeration loop. The two copies had already drifted — the
weekly one bounded its queries only from below, the yearly one from both sides —
which is the ordinary way duplicated code rots. They now both delegate to
``ChartService.monthly_breakdown``.

These tests cover the properties that duplication had made implicit, and
therefore untested:

- the dense fill really does emit months with no training in them
- an absent ``avg_recovery`` is None, not 0.0
- the standalone-Wahoo exclusion actually holds on this path
- PRs sum across *both* the lifting and cycling-power tables
- the yearly summary still returns twelve months mid-year

The last one is a deliberate behaviour-preserving choice: the original filled
all twelve with zeros for months that had not happened yet, and the highlights
plus the frontend depend on that shape.
"""

from __future__ import annotations

import itertools
import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from app.models.activity import Activity
from app.models.cycling import CyclingPowerRecord
from app.models.daily_metric import DailyMetric
from app.models.lifting import LiftingSession, PersonalRecord
from app.models.user import User
from app.services.charts import ChartService

pytestmark = pytest.mark.integration


def _activity(
    user_id: uuid.UUID,
    *,
    day: date,
    tss: float | None = 100.0,
    distance: float = 10_000.0,
    duration: int = 3600,
    source: str = "strava",
) -> Activity:
    # ``Activity.start_date`` is a DateTime, unlike the date-typed columns on
    # LiftingSession / PersonalRecord / DailyMetric. Pass a real datetime so the
    # row lands where the month grouping expects it.
    return Activity(
        user_id=user_id,
        name=f"Ride {day}",
        sport_type="cycling",
        source=source,
        start_date=datetime(day.year, day.month, day.day, 9, 0, tzinfo=UTC),
        distance_meters=distance,
        duration_seconds=duration,
        tss=tss,
    )


async def _seed_month(db_session, test_user, day: date, *, volume: float, tss: float):
    db_session.add(
        LiftingSession(
            user_id=test_user.id,
            session_date=day,
            total_volume_kg=volume,
        )
    )
    db_session.add(_activity(test_user.id, day=day, tss=tss))
    await db_session.flush()


def _power_pr(user_id: uuid.UUID, *, day: date) -> CyclingPowerRecord:
    return CyclingPowerRecord(
        user_id=user_id,
        duration_label="5m",
        duration_seconds=300,
        power_watts=330.0,
        achieved_date=day,
    )


def _lifting_pr(user_id: uuid.UUID, *, day: date) -> PersonalRecord:
    return PersonalRecord(
        user_id=user_id,
        exercise_name="Squat",
        record_type="weight",
        weight_kg=140.0,
        reps=1,
        achieved_date=day,
    )


class TestDenseFill:
    async def test_empty_range_is_still_densely_filled(
        self, db_session, test_user
    ):
        """No training at all must yield zeroed months, not an empty list.

        This is the property that matters most and was most at risk: a caller
        iterating grouped rows would omit empty months entirely, and a chart
        would then draw a straight line across a gap that happened.
        """
        service = ChartService(db_session)
        rows = await service.monthly_breakdown(
            test_user.id, start=date(2026, 1, 1), end=date(2026, 4, 30)
        )
        assert [r["month"] for r in rows] == [
            "2026-01",
            "2026-02",
            "2026-03",
            "2026-04",
        ]
        assert all(r["cardio_sessions"] == 0 for r in rows)
        assert all(r["lifting_sessions"] == 0 for r in rows)
        assert all(r["total_tss"] == 0.0 for r in rows)
        assert all(r["lifting_volume_kg"] == 0.0 for r in rows)

    async def test_a_gap_month_is_present_between_two_trained_months(
        self, db_session, test_user
    ):
        """The specific failure mode: a gap month drawn as continuity."""
        await _seed_month(db_session, test_user, date(2026, 1, 15), volume=1000, tss=50)
        await _seed_month(db_session, test_user, date(2026, 3, 15), volume=1000, tss=50)

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 1, 1), end=date(2026, 3, 31)
        )
        by_month = {r["month"]: r for r in rows}
        assert by_month["2026-02"]["cardio_sessions"] == 0
        assert by_month["2026-02"]["total_tss"] == 0.0
        assert by_month["2026-01"]["total_tss"] == 50.0
        assert by_month["2026-03"]["total_tss"] == 50.0

    async def test_missing_recovery_is_none_not_zero(self, db_session, test_user):
        """0 would be a measurement; None means 'no data'.

        Recovery is the one field where zero-fill would be a lie rather than a
        gap, since a recovery score of zero is a real (if dire) reading.
        """
        await _seed_month(db_session, test_user, date(2026, 2, 10), volume=500, tss=40)

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 2, 1), end=date(2026, 2, 28)
        )
        assert rows[0]["avg_recovery"] is None

    async def test_recovery_is_rounded_to_one_decimal(self, db_session, test_user):
        db_session.add(
            DailyMetric(
                user_id=test_user.id,
                metric_date=date(2026, 2, 10),
                source="whoop",
                recovery_score=63.4567,
            )
        )
        await db_session.flush()

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 2, 1), end=date(2026, 2, 28)
        )
        assert rows[0]["avg_recovery"] == 63.5


class TestStandaloneWahooExclusion:
    async def test_standalone_wahoo_rows_are_not_counted(self, db_session, test_user):
        """A merged Wahoo twin would otherwise be counted twice.

        Standalone Wahoo rows were merged into their Strava twin, so a Wahoo row
        still present in ``activities`` is a duplicate of real training. This
        filter was written out independently at three call sites before being
        given a name.
        """
        db_session.add(
            _activity(test_user.id, day=date(2026, 2, 10), tss=100, source="strava")
        )
        db_session.add(
            _activity(test_user.id, day=date(2026, 2, 10), tss=100, source="wahoo")
        )
        await db_session.flush()

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 2, 1), end=date(2026, 2, 28)
        )
        assert rows[0]["cardio_sessions"] == 1
        assert rows[0]["total_tss"] == 100

    async def test_non_wahoo_sources_are_counted(self, db_session, test_user):
        for source in ("strava", "komoot", "whoop"):
            db_session.add(
                _activity(test_user.id, day=date(2026, 2, 10), tss=10, source=source)
            )
        await db_session.flush()

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 2, 1), end=date(2026, 2, 28)
        )
        assert rows[0]["cardio_sessions"] == 3


class TestPrMerge:
    async def test_lifting_and_cycling_prs_are_summed(
        self, db_session, test_user
    ):
        """PRs live in two tables; one count per month must combine both."""
        db_session.add(_lifting_pr(test_user.id, day=date(2026, 2, 5)))
        db_session.add(_power_pr(test_user.id, day=date(2026, 2, 20)))
        await db_session.flush()

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 2, 1), end=date(2026, 2, 28)
        )
        assert rows[0]["pr_count"] == 2

    async def test_prs_in_different_months_stay_separate(
        self, db_session, test_user
    ):
        db_session.add(_lifting_pr(test_user.id, day=date(2026, 1, 5)))
        db_session.add(_power_pr(test_user.id, day=date(2026, 2, 20)))
        await db_session.flush()

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 1, 1), end=date(2026, 2, 28)
        )
        by_month = {r["month"]: r for r in rows}
        assert by_month["2026-01"]["pr_count"] == 1
        assert by_month["2026-02"]["pr_count"] == 1


class TestRangeBounding:
    @pytest.mark.parametrize("end_day", [1, 2, 15, 28, 30, 31])
    async def test_the_end_month_is_never_truncated(
        self, db_session, test_user, end_day
    ):
        """A regression test for a bug this refactor introduced and a probe caught.

        The fill iterates over month *starts* (2026-06-01, 2026-07-01, ...) while
        the query filters on an inclusive upper bound. Using the month start as
        that upper bound makes ``end=2026-06-15`` filter on ``<= 2026-06-01``,
        which excludes every row in the final month — so a single-month query
        returns an entirely zeroed row. The query needs the month's *last* day.

        Parameterised across the days of the month because the bug only shows up
        when the caller passes anything other than the 1st, and ``end=day 1``
        would have passed while every real call site failed. January, since the
        list includes the 31st.
        """
        await _seed_month(
            db_session, test_user, date(2026, 1, 20), volume=999, tss=999
        )

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 1, 1), end=date(2026, 1, end_day)
        )
        assert len(rows) == 1, "a single-month range must yield exactly one month"
        assert rows[0]["month"] == "2026-01"
        assert rows[0]["lifting_volume_kg"] == 999, (
            f"the final month was truncated for end_day={end_day}"
        )
        assert rows[0]["total_tss"] == 999

    async def test_partial_months_are_included_wholly(self, db_session, test_user):
        """The range is month-granular, not day-granular.

        ``start`` and ``end`` are any dates inside the outer months; both outer
        months must appear in full.
        """
        await _seed_month(db_session, test_user, date(2026, 5, 1), volume=100, tss=10)
        await _seed_month(db_session, test_user, date(2026, 7, 31), volume=100, tss=10)

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 5, 15), end=date(2026, 7, 15)
        )
        assert [r["month"] for r in rows] == ["2026-05", "2026-06", "2026-07"]

    async def test_data_outside_the_range_is_excluded(self, db_session, test_user):
        """Notably a future-dated row, which the old weekly copy did not exclude.

        The weekly queries were bounded only from below, so a future-dated
        activity was summed into a month the fill then discarded. Harmless, but
        it is the drift that motivated consolidating.
        """
        await _seed_month(db_session, test_user, date(2026, 6, 10), volume=999, tss=999)
        await _seed_month(db_session, test_user, date(2026, 12, 10), volume=1, tss=1)

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 1, 1), end=date(2026, 6, 30)
        )
        by_month = {r["month"]: r for r in rows}
        assert by_month["2026-06"]["lifting_volume_kg"] == 999
        assert "2026-12" not in by_month

    async def test_other_users_rows_are_excluded(self, db_session, test_user):
        """The scope must be the given user, not 'everyone'."""
        # A real second user: activities.user_id is a foreign key, so a made-up
        # UUID cannot be used to prove the scoping.
        stranger = User(
            email=f"stranger-{uuid.uuid4().hex[:8]}@example.com",
            name="Stranger",
        )
        db_session.add(stranger)
        await db_session.flush()
        db_session.add(_activity(stranger.id, day=date(2026, 2, 10), tss=500))
        await db_session.flush()

        rows = await ChartService(db_session).monthly_breakdown(
            test_user.id, start=date(2026, 2, 1), end=date(2026, 2, 28)
        )
        assert rows[0]["cardio_sessions"] == 0
        assert rows[0]["total_tss"] == 0.0


class TestYearlyShapeIsPreserved:
    async def test_yearly_summary_returns_twelve_months_mid_year(
        self, client, test_user
    ):
        """The original filled all twelve months, zeros for months not yet lived.

        Bounding the fill by ``today`` would have shortened the response and
        broken both the "best month" highlights and the frontend, which expects
        twelve slots. This test is the reason that was preserved deliberately.
        """
        year = date.today().year
        resp = await client.get(f"/api/v1/dashboard/yearly-summary/{year}")
        assert resp.status_code == 200, resp.text
        months = resp.json()["months"]
        assert len(months) == 12
        assert [m["month"] for m in months] == [f"{year}-{m:02d}" for m in range(1, 13)]


class TestMonthlyEndpointShape:
    async def test_monthly_summary_returns_the_requested_month_count(self, client):
        resp = await client.get("/api/v1/dashboard/monthly-summary?months=3")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body) == 3

    async def test_months_are_contiguous_and_ordered(self, client):
        resp = await client.get("/api/v1/dashboard/monthly-summary?months=6")
        keys = [row["month"] for row in resp.json()]
        assert keys == sorted(keys)
        # Contiguous: each key exactly one month after the previous.
        parsed = [datetime.strptime(k, "%Y-%m").date() for k in keys]
        for earlier, later in itertools.pairwise(parsed):
            expected = (earlier.replace(day=28) + timedelta(days=4)).replace(day=1)
            assert later == expected, f"gap between {earlier} and {later}"

    async def test_monthly_endpoint_reports_empty_months_as_zero(
        self, client, test_user
    ):
        """The user has no data at all, so every month must still be present."""
        resp = await client.get("/api/v1/dashboard/monthly-summary?months=4")
        body = resp.json()
        assert len(body) == 4
        assert all(row["total_tss"] == 0 for row in body)
        assert all(row["lifting_sessions"] == 0 for row in body)
        assert all(row["pr_count"] == 0 for row in body)