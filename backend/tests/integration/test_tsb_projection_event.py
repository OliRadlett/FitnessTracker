"""race_day_tsb must be the TSB at the event date, not the window end — and a
plan with no event must still project.

``compute_tsb_projection`` projects ``days_ahead`` days; when the linked
event falls inside that window, ``race_day_tsb`` is the entry at the event
date (previously it was always the last projected day, so the default
``days=14`` API call mislabelled a 14-day TSB as race-day readiness).

Event linkage was originally mandatory, which confined this to race plans.
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

    async def test_projection_excludes_today(
        self, db_session, test_user, test_training_plan, test_event
    ):
        """Today is excluded — current CTL/ATL already include it, so
        re-applying today's planned TSS would double-count."""
        await _link_plan_to_event(db_session, test_training_plan, test_event)
        result = await compute_tsb_projection(
            db_session, test_user.id, test_training_plan.id, days_ahead=5
        )
        dates = [e["date"] for e in result["projection"]]
        assert date.today() not in dates
        assert dates[0] == date.today() + timedelta(days=1)
        assert dates[-1] == date.today() + timedelta(days=5)


class TestUnlinkedPlan:
    """A plan with no event must still project.

    Event linkage used to be mandatory, so TSB projection was only reachable for
    race plans. The general question — "how will my next two weeks of planned
    load leave me?" — had no answer for every other plan. Nothing in the
    projection needed the event.
    """

    async def test_unlinked_plan_projects(self, db_session, test_user, test_training_plan):
        assert test_training_plan.event_id is None
        result = await compute_tsb_projection(
            db_session, test_user.id, test_training_plan.id, days_ahead=14
        )
        assert result["event_date"] is None
        assert len(result["projection"]) == 14
        assert result["projection"][0]["date"] == date.today() + timedelta(days=1)

    async def test_unlinked_race_day_is_last_projected_day(
        self, db_session, test_user, test_training_plan
    ):
        """No event date to aim at, so the window end is the honest reading."""
        result = await compute_tsb_projection(
            db_session, test_user.id, test_training_plan.id, days_ahead=7
        )
        assert result["race_day_tsb"] == pytest.approx(result["projection"][-1]["tsb"])
        assert result["projection"][-1]["date"] == date.today() + timedelta(days=7)

    async def test_unlinked_still_reports_freshness(
        self, db_session, test_user, test_training_plan
    ):
        """freshness_assessment is derived from race_day_tsb, so it survives."""
        result = await compute_tsb_projection(
            db_session, test_user.id, test_training_plan.id, days_ahead=14
        )
        assert result["freshness_assessment"] in {
            "Optimal freshness",
            "Neutral",
            "Slightly fatigued",
            "Fatigued",
        }

    async def test_days_ahead_is_honoured(self, db_session, test_user, test_training_plan):
        """The service default stays 14; callers choose their own horizon.

        ``/today`` will pass 7 to match its own window.
        """
        for days in (1, 7, 14, 30):
            result = await compute_tsb_projection(
                db_session, test_user.id, test_training_plan.id, days_ahead=days
            )
            assert len(result["projection"]) == days
            assert result["projection"][-1]["date"] == date.today() + timedelta(days=days)

    async def test_unlinked_plan_via_api_returns_200(self, client, test_training_plan):
        """The user-visible change: this used to be a 400."""
        resp = await client.get(f"/api/v1/projections/tsb/{test_training_plan.id}")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["event_date"] is None
        assert len(body["projection"]) == 14
