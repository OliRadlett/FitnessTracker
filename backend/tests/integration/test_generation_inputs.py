"""Integration tests for C2 — generated plans anchored on current physiology.

`POST /training-plans/generate` should not hand back a template with blank
targets: cycle days take power/zone from the profile FTP, and strength days take
weights solved from the athlete's current e1RM (with a %1RM basis so
`refresh-targets` can re-solve them).

Run with:  pytest tests/integration/test_generation_inputs.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.models.lifting import PersonalRecord

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


def _next_monday(from_date: date) -> date:
    delta = (7 - from_date.weekday()) % 7
    return from_date + timedelta(days=delta if delta else 7)


class TestGenerationInputs:
    async def test_cycle_days_are_ftp_anchored(self, client, test_cycling_profile):
        """With an FTP set, generated cycle days carry power + zone targets."""
        start = _next_monday(date.today())
        resp = await client.post(
            "/api/v1/training-plans/generate",
            json={
                "name": "C2 Base",
                "template_type": "base",
                "weeks": 2,
                "start_date": start.isoformat(),
                "base_tss": 300,
            },
        )
        assert resp.status_code == 201
        days = resp.json()["days"]
        cycle = [d for d in days if d["sport"] == "cycle" and d["planned_type"] != "rest"]
        assert cycle, "expected cycle days in a base plan"
        for d in cycle:
            assert d["planned_power_watts"], f"no power on {d['day_date']}"
            assert d["planned_zone"], f"no zone on {d['day_date']}"

    async def test_strength_days_are_e1rm_anchored(self, client, test_user, db_session):
        """With a PR for a template exercise, generated strength weights solve."""
        db_session.add(
            PersonalRecord(
                user_id=test_user.id,
                exercise_name="squat",
                record_type="1rm",
                weight_kg=150.0,
                reps=1,
                estimated_1rm=150.0,
            )
        )
        await db_session.flush()

        start = _next_monday(date.today())
        resp = await client.post(
            "/api/v1/training-plans/generate",
            json={
                "name": "C2 Strength",
                "template_type": "build",
                "weeks": 2,
                "start_date": start.isoformat(),
                "base_tss": 300,
            },
        )
        assert resp.status_code == 201
        days = resp.json()["days"]
        strength = [d for d in days if d["sport"] == "strength"]
        assert strength, "expected strength days in a build plan"

        solved = [
            ex
            for d in strength
            for ex in (d.get("planned_exercises") or [])
            if ex.get("weight_kg") is not None
        ]
        assert solved, "expected at least one strength weight solved from a PR"
        assert all(ex.get("pct_1rm") is not None for ex in solved)
        assert all(ex.get("weight_source") == "suggested" for ex in solved)
