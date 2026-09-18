"""race_day_tsb must be the TSB at the event date, not the window end.

``compute_tsb_projection`` projects ``days_ahead`` days; when the linked
event falls inside that window, ``race_day_tsb`` is the entry at the event
date (previously it was always the last projected day, so the default
``days=14`` API call mislabelled a 14-day TSB as race-day readiness).
Run with: pytest tests/integration/test_tsb_projection_event.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.services.projections import compute_tsb_projection

pytestmark = pytest.mark.integration


async def _link_plan_to_event(db_session, plan, event):
    plan.event_id = event.id
    await db_session.flush()


class TestRaceDayTsb:
    async def test_event_inside_window_uses_event_date(
        self, db_session, test_user, test_training_plan, test_event
    ):
        """Event in 30 d, 60 d projected → race_day_tsb == entry at +30 d."""
        await _link_plan_to_event(db_session, test_training_plan, test_event)
        result = await compute_tsb_projection(
            db_session, test_user.id, test_training_plan.id, days_ahead=60
        )
        assert result["event_date"] == test_event.event_date
        at_event = next(
            e for e in result["projection"] if e["date"] == test_event.event_date
        )
        assert result["race_day_tsb"] == pytest.approx(at_event["tsb"])
        assert result["race_day_tsb"] != pytest.approx(result["projection"][-1]["tsb"])

    async def test_event_beyond_window_uses_last_day(
        self, db_session, test_user, test_training_plan, test_event
    ):
        """Event in 30 d, 14 d projected → race_day_tsb == last entry."""
        await _link_plan_to_event(db_session, test_training_plan, test_event)
        result = await compute_tsb_projection(
            db_session, test_user.id, test_training_plan.id, days_ahead=14
        )
        assert result["race_day_tsb"] == pytest.approx(result["projection"][-1]["tsb"])
        assert result["projection"][-1]["date"] == date.today() + timedelta(days=14)
