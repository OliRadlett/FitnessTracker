"""1RM-family metric trends are rebuilt from session sets, not PR rows.

``PersonalRecord`` is updated in place (one row per exercise), so PR queries
yield at most one point. ``compute_metric_trend`` instead reconstructs
per-session best Brzycki estimates from working sets.
Run with: pytest tests/integration/test_metric_trend_history.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.models.lifting import LiftingSession, LiftingSet
from app.models.weight import WeightLog
from app.services.projections import compute_metric_trend

pytestmark = pytest.mark.integration


async def _session(db_session, user_id, days_ago: int, lifts) -> None:
    session = LiftingSession(
        user_id=user_id,
        session_date=date.today() - timedelta(days=days_ago),
        focus="legs",
    )
    db_session.add(session)
    await db_session.flush()
    for i, (name, w, r) in enumerate(lifts):
        db_session.add(
            LiftingSet(
                session_id=session.id,
                exercise_name=name,
                set_number=i + 1,
                weight_kg=w,
                reps=r,
            )
        )
    await db_session.flush()


class TestEstimated1RmTrend:
    async def test_trend_from_session_sets(self, db_session, test_user):
        """100×5 → 105×5 → 110×5 across 3 sessions → 3 points, rising."""
        await _session(db_session, test_user.id, 21, [("Back Squat", 100.0, 5)])
        await _session(db_session, test_user.id, 14, [("Back Squat", 105.0, 5)])
        await _session(db_session, test_user.id, 7, [("Back Squat", 110.0, 5)])

        result = await compute_metric_trend(
            db_session, test_user.id, "estimated_1rm", {"exercise": "Back Squat"}
        )

        assert result["trend"] is not None
        assert result["trend"]["data_points"] == 3
        assert result["trend"]["slope_per_day"] > 0
        assert result["classification"] == "increasing"

    async def test_high_rep_sets_excluded(self, db_session, test_user):
        """A 60×20 back-off session must not enter the 1RM trend."""
        await _session(db_session, test_user.id, 14, [("Back Squat", 100.0, 5)])
        await _session(db_session, test_user.id, 7, [("Back Squat", 60.0, 20)])

        result = await compute_metric_trend(
            db_session, test_user.id, "estimated_1rm", {"exercise": "Back Squat"}
        )

        assert result["trend"] is None  # single point → no regression


class TestBwRatioAndBig3Trends:
    async def test_bw_ratio_trend(self, db_session, test_user):
        db_session.add(
            WeightLog(
                user_id=test_user.id,
                date=date.today() - timedelta(days=30),
                weight_kilogram=100.0,
                source="manual",
            )
        )
        await db_session.flush()
        await _session(db_session, test_user.id, 21, [("Back Squat", 100.0, 5)])
        await _session(db_session, test_user.id, 7, [("Back Squat", 110.0, 5)])

        result = await compute_metric_trend(
            db_session, test_user.id, "squat_bw_ratio", None
        )

        assert result["trend"] is not None
        assert result["trend"]["data_points"] == 2
        # 112.5/100 → 123.75/100
        assert result["trend"]["slope_per_day"] > 0

    async def test_big3_total_accumulates(self, db_session, test_user):
        await _session(
            db_session,
            test_user.id,
            21,
            [("Back Squat", 100.0, 5), ("Bench Press", 80.0, 5)],
        )
        await _session(db_session, test_user.id, 7, [("Deadlift", 140.0, 5)])

        result = await compute_metric_trend(
            db_session, test_user.id, "big3_total", None
        )

        assert result["trend"] is not None
        assert result["trend"]["data_points"] == 2
