"""Integration tests for the S1 strength-progression engine.

Covers the contract in ``plans/training-strength-programming.md`` §4–§6 and §11:
the resolver's RPE/load modes, deload scaling, training max, the ≥95% safety
warning, the recency window on the e1RM anchor, manual-override semantics
(suggest / apply / refresh all skip ``weight_source='manual'``), materialise
fill-empty vs replace, and the three HTTP endpoints.

Run with: pytest tests/integration/test_s1_strength_progression.py -m integration
"""

from __future__ import annotations

from datetime import date, timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── Helpers ────────────────────────────────────────────────────────────────


def _monday() -> date:
    """Monday of the current week — week 1 of every plan built here."""
    return date.today() - timedelta(days=date.today().weekday())


def _week_date(week: int) -> date:
    """A Monday-based date inside plan week ``week`` (1-indexed)."""
    return _monday() + timedelta(weeks=week - 1)


def _tomorrow() -> date:
    return date.today() + timedelta(days=1)


async def _make_plan(db_session, test_user, days: list[dict], rules=None, weeks=8):
    from app.models.training_plan import TrainingPlan, TrainingPlanDay

    monday = _monday()
    plan = TrainingPlan(
        user_id=test_user.id,
        name="S1 Plan",
        start_date=monday,
        end_date=monday + timedelta(weeks=weeks) - timedelta(days=1),
        plan_type="custom",
        status="active",
        strength_progression=rules,
    )
    db_session.add(plan)
    await db_session.flush()
    for d in days:
        db_session.add(TrainingPlanDay(plan_id=plan.id, **d))
    await db_session.flush()
    await db_session.refresh(plan, ["days"])
    return plan


async def _seed_pr(
    db_session, test_user, name="Back Squat", e1rm=180.0, days_ago=7
):
    from app.models.lifting import PersonalRecord

    pr = PersonalRecord(
        user_id=test_user.id,
        exercise_name=name,
        record_type="1rm",
        weight_kg=e1rm,
        reps=1,
        estimated_1rm=e1rm,
        achieved_date=date.today() - timedelta(days=days_ago),
    )
    db_session.add(pr)
    await db_session.flush()
    return pr


def _strength_day(day_date: date, exercises: list[dict], **extra) -> dict:
    payload = {
        "day_date": day_date,
        "sport": "strength",
        "planned_type": "hard",
        "planned_focus": "squat",
        "planned_exercises": exercises,
    }
    payload.update(extra)
    return payload


def _squat_entry(reps=5, rpe=8.0, **extra) -> dict:
    entry = {"exercise": "Back Squat", "sets": 5, "reps": reps, "rpe": rpe}
    entry.update(extra)
    return entry


async def _plan_days(client, plan_id) -> list[dict]:
    resp = await client.get(f"/api/v1/training-plans/{plan_id}")
    assert resp.status_code == 200, resp.text
    return resp.json()["days"]


async def _day_entry(client, plan_id, day_id, index=0) -> dict:
    for day in await _plan_days(client, plan_id):
        if day["id"] == str(day_id):
            return day["planned_exercises"][index]
    raise AssertionError(f"day {day_id} not in plan {plan_id}")


async def _suggest(client, plan_id, **body):
    payload = {"scope": "plan", **body}
    return await client.post(
        f"/api/v1/training-plans/{plan_id}/strength-progression/suggest", json=payload
    )


async def _materialise(client, plan_id, **body):
    return await client.post(
        f"/api/v1/training-plans/{plan_id}/strength-progression/materialise", json=body
    )


# ── suggest: the resolver ─────────────────────────────────────────────────


class TestSuggestResolver:
    async def test_rpe_mode_anchors_on_history_and_explains_itself(
        self, client, test_user, db_session
    ):
        """5 reps @ RPE 8 off a 180 kg e1RM → 150 kg, with full provenance."""
        await _seed_pr(db_session, test_user, e1rm=180.0, days_ago=7)
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_week_date(1), [_squat_entry()])]
        )

        resp = await _suggest(client, plan.id)
        assert resp.status_code == 200, resp.text
        target = resp.json()["targets"][0]

        # 30/36 = 0.8333 → 180 × 0.8333 = 150.0
        assert target["weight_kg"] == pytest.approx(150.0)
        assert target["pct_1rm"] == pytest.approx(0.8333, abs=0.0001)
        assert target["basis_1rm_kg"] == pytest.approx(180.0)
        assert target["basis_source"] == "pr"
        assert target["basis_date"] == (date.today() - timedelta(days=7)).isoformat()
        assert target["mode"] == "rpe"
        assert target["is_deload"] is False
        assert target["prev_week_kg"] is None
        assert target["delta_kg"] is None
        assert target["safety_warning"] is None
        assert target["skipped_reason"] is None

    async def test_suggest_writes_nothing(self, client, test_user, db_session):
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_week_date(1), [_squat_entry()])]
        )
        await _suggest(client, plan.id)
        entry = await _day_entry(client, plan.id, plan.days[0].id)
        assert entry.get("weight_kg") is None
        assert entry.get("weight_source") is None

    async def test_manual_entry_is_skipped_unless_forced(
        self, client, test_user, db_session
    ):
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(
                    _week_date(1),
                    [_squat_entry(weight_kg=100.0, weight_source="manual")],
                )
            ],
        )

        resp = await _suggest(client, plan.id)
        target = resp.json()["targets"][0]
        assert target["skipped_reason"] == "manual"
        assert target["weight_kg"] is None

        forced = await _suggest(client, plan.id, force=True)
        assert forced.json()["targets"][0]["weight_kg"] == pytest.approx(150.0)
        assert forced.json()["targets"][0]["skipped_reason"] is None

    async def test_no_history_reports_no_basis(self, client, test_user, db_session):
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_week_date(1), [_squat_entry()])]
        )
        resp = await _suggest(client, plan.id)
        target = resp.json()["targets"][0]
        assert target["skipped_reason"] == "no_basis"
        assert target["basis_source"] is None

    async def test_reps_beyond_the_pr_range_are_flagged(
        self, client, test_user, db_session
    ):
        """Brzycki degrades past 12 reps — flagged, never silently suggested."""
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [_strength_day(_week_date(1), [_squat_entry(reps=15)])],
        )
        resp = await _suggest(client, plan.id)
        assert resp.json()["targets"][0]["skipped_reason"] == "reps_too_high"

    async def test_entry_without_rpe_or_pct_has_no_target(
        self, client, test_user, db_session
    ):
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [_strength_day(_week_date(1), [_squat_entry(rpe=None)])],
        )
        resp = await _suggest(client, plan.id)
        assert resp.json()["targets"][0]["skipped_reason"] == "no_target"

    async def test_stale_history_outside_the_window_is_not_an_anchor(
        self, client, test_user, db_session
    ):
        """A PR from 200 days ago describes an athlete who no longer exists."""
        await _seed_pr(db_session, test_user, e1rm=180.0, days_ago=200)
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_week_date(1), [_squat_entry()])]
        )
        resp = await _suggest(client, plan.id)
        assert resp.json()["targets"][0]["skipped_reason"] == "no_basis"

    async def test_training_max_scales_the_prescription_not_the_safety_check(
        self, client, test_user, db_session
    ):
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [_strength_day(_week_date(1), [_squat_entry()])],
            rules=[{"exercise": "Back Squat", "mode": "rpe", "training_max_pct": 0.9}],
        )
        resp = await _suggest(client, plan.id)
        target = resp.json()["targets"][0]
        # 180 × 0.9 × 0.8333 = 135.0, reported as 135/180 of the *true* e1RM.
        assert target["weight_kg"] == pytest.approx(135.0)
        assert target["training_max_pct"] == pytest.approx(0.9)
        assert target["pct_1rm"] == pytest.approx(0.75, abs=0.001)
        assert target["basis_1rm_kg"] == pytest.approx(180.0)
        assert target["safety_warning"] is None

    async def test_near_maximal_load_carries_a_spotter_warning(
        self, client, test_user, db_session
    ):
        await _seed_pr(db_session, test_user, e1rm=100.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [_strength_day(_week_date(1), [_squat_entry(reps=1, rpe=10.0)])],
        )
        resp = await _suggest(client, plan.id)
        target = resp.json()["targets"][0]
        assert target["weight_kg"] == pytest.approx(100.0)
        assert target["safety_warning"] is not None
        assert "spotter" in target["safety_warning"]

    async def test_per_arm_weight_is_not_halved(
        self, client, test_user, db_session
    ):
        """Dumbbell work is logged per hand (pitfall 19) — never halved ad hoc."""
        from app.services.exercise_db import is_per_arm_exercise

        assert is_per_arm_exercise("Dumbbell Bench Press")
        await _seed_pr(db_session, test_user, name="Dumbbell Bench Press", e1rm=50.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(
                    _week_date(1),
                    [
                        {
                            "exercise": "Dumbbell Bench Press",
                            "sets": 3,
                            "reps": 5,
                            "rpe": 8.0,
                        }
                    ],
                )
            ],
        )
        resp = await _suggest(client, plan.id)
        target = resp.json()["targets"][0]
        # 50 × 0.8333 = 41.67 → 41.5 kg, not 20.75.
        assert target["weight_kg"] == pytest.approx(41.5)
        assert target["weight_kg"] > 30.0

    async def test_deprecated_target_rpe_still_resolves(
        self, client, test_user, db_session
    ):
        """``target_rpe`` is deprecated, not removed: old payloads keep working."""
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(
                    _week_date(1),
                    [
                        {
                            "exercise": "Back Squat",
                            "sets": 5,
                            "reps": 5,
                            "target_rpe": 8.0,
                        }
                    ],
                )
            ],
        )
        resp = await _suggest(client, plan.id)
        assert resp.json()["targets"][0]["weight_kg"] == pytest.approx(150.0)


class TestLoadMode:
    async def test_chains_off_the_previous_week(self, client, test_user, db_session):
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(
                    _week_date(1), [_squat_entry(weight_kg=100.0, weight_source="suggested")]
                ),
                _strength_day(_week_date(2), [_squat_entry()]),
            ],
            rules=[
                {
                    "exercise": "Back Squat",
                    "mode": "load",
                    "weekly": {"load_delta_kg": 2.5},
                }
            ],
        )
        resp = await _suggest(client, plan.id)
        by_week = {t["week"]: t for t in resp.json()["targets"]}

        # Week 1 has nothing to chain from → seeded from history.
        assert by_week[1]["prev_week_kg"] is None
        assert by_week[1]["weight_kg"] == pytest.approx(150.0)

        # Week 2 chains: 100 + 2.5.
        assert by_week[2]["mode"] == "load"
        assert by_week[2]["prev_week_kg"] == pytest.approx(100.0)
        assert by_week[2]["weight_kg"] == pytest.approx(102.5)
        assert by_week[2]["delta_kg"] == pytest.approx(2.5)

    async def test_load_delta_pct(self, client, test_user, db_session):
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(_week_date(1), [_squat_entry(weight_kg=100.0)]),
                _strength_day(_week_date(2), [_squat_entry()]),
            ],
            rules=[
                {
                    "exercise": "Back Squat",
                    "mode": "load",
                    "weekly": {"load_delta_pct": 0.05},
                }
            ],
        )
        resp = await _suggest(client, plan.id)
        by_week = {t["week"]: t for t in resp.json()["targets"]}
        assert by_week[2]["weight_kg"] == pytest.approx(105.0)

    async def test_deload_week_scales_the_chained_load(
        self, client, test_user, db_session
    ):
        """Every 4th week: 100 + 2 = 102, then × 0.9 → 91.8 → 92.0 kg."""
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(_week_date(1), [_squat_entry(weight_kg=96.0)]),
                _strength_day(_week_date(2), [_squat_entry(weight_kg=98.0)]),
                _strength_day(_week_date(3), [_squat_entry(weight_kg=100.0)]),
                _strength_day(_week_date(4), [_squat_entry()]),
            ],
            rules=[
                {
                    "exercise": "Back Squat",
                    "mode": "load",
                    "weekly": {"load_delta_kg": 2.0},
                    "deload_every": 4,
                    "deload_factor": 0.9,
                }
            ],
        )
        resp = await _suggest(client, plan.id)
        by_week = {t["week"]: t for t in resp.json()["targets"]}
        assert by_week[3]["is_deload"] is False
        assert by_week[3]["prev_week_kg"] == pytest.approx(98.0)
        assert by_week[3]["weight_kg"] == pytest.approx(100.0)
        assert by_week[4]["is_deload"] is True
        assert by_week[4]["prev_week_kg"] == pytest.approx(100.0)
        assert by_week[4]["weight_kg"] == pytest.approx(92.0)


class TestSuggestScope:
    async def test_scope_plan_week_and_day(self, client, test_user, db_session):
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(_week_date(1), [_squat_entry()]),
                _strength_day(_week_date(2), [_squat_entry()]),
            ],
        )
        week1_day = plan.days[0].id

        whole = await _suggest(client, plan.id)
        assert len(whole.json()["targets"]) == 2

        one_week = await _suggest(client, plan.id, scope="week", week=2)
        assert [t["week"] for t in one_week.json()["targets"]] == [2]

        one_day = await _suggest(client, plan.id, scope="day", day_id=str(week1_day))
        assert len(one_day.json()["targets"]) == 1
        assert one_day.json()["targets"][0]["day_id"] == str(week1_day)

    async def test_unknown_day_is_a_404(self, client, test_user, db_session):
        import uuid

        plan = await _make_plan(
            db_session, test_user, [_strength_day(_week_date(1), [_squat_entry()])]
        )
        resp = await _suggest(client, plan.id, scope="day", day_id=str(uuid.uuid4()))
        assert resp.status_code == 404

    async def test_unknown_plan_is_a_404(self, client, test_user):
        import uuid

        resp = await _suggest(client, uuid.uuid4())
        assert resp.status_code == 404

    async def test_missing_scope_argument_is_a_400(self, client, test_user, db_session):
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_week_date(1), [_squat_entry()])]
        )
        resp = await _suggest(client, plan.id, scope="day")
        assert resp.status_code == 400


# ── apply ─────────────────────────────────────────────────────────────────


class TestApply:
    async def test_writes_weight_basis_and_provenance(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session,
            test_user,
            [_strength_day(_tomorrow(), [_squat_entry()])],
        )
        day_id = plan.days[0].id

        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/strength-progression/apply",
            json={
                "targets": [
                    {
                        "day_id": str(day_id),
                        "exercise_index": 0,
                        "weight_kg": 150.0,
                        "pct_1rm": 0.8333,
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert len(body["applied"]) == 1
        assert body["skipped"] == []
        assert body["applied"][0]["applied"] is True

        entry = await _day_entry(client, plan.id, day_id)
        assert entry["weight_kg"] == pytest.approx(150.0)
        assert entry["pct_1rm"] == pytest.approx(0.8333)
        assert entry["weight_source"] == "suggested"
        # 150 × 5 sets × 5 reps
        for day in await _plan_days(client, plan.id):
            if day["id"] == str(day_id):
                assert day["planned_volume_kg"] == pytest.approx(3750.0)

    async def test_manual_entry_is_skipped_unless_forced(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(
                    _tomorrow(), [_squat_entry(weight_kg=100.0, weight_source="manual")]
                )
            ],
        )
        day_id = plan.days[0].id
        payload = {
            "targets": [
                {
                    "day_id": str(day_id),
                    "exercise_index": 0,
                    "weight_kg": 150.0,
                    "pct_1rm": 0.8333,
                }
            ]
        }

        blocked = await client.post(
            f"/api/v1/training-plans/{plan.id}/strength-progression/apply",
            json=payload,
        )
        assert blocked.status_code == 200
        assert blocked.json()["applied"] == []
        assert blocked.json()["skipped"][0]["skipped_reason"] == "manual"
        assert (await _day_entry(client, plan.id, day_id))["weight_kg"] == pytest.approx(
            100.0
        )

        forced = await client.post(
            f"/api/v1/training-plans/{plan.id}/strength-progression/apply",
            json={**payload, "force": True},
        )
        assert forced.status_code == 200
        assert len(forced.json()["applied"]) == 1
        entry = await _day_entry(client, plan.id, day_id)
        assert entry["weight_kg"] == pytest.approx(150.0)
        assert entry["weight_source"] == "suggested"

    async def test_out_of_range_index_is_reported_not_raised(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_tomorrow(), [_squat_entry()])]
        )
        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/strength-progression/apply",
            json={
                "targets": [
                    {
                        "day_id": str(plan.days[0].id),
                        "exercise_index": 7,
                        "weight_kg": 150.0,
                    }
                ]
            },
        )
        assert resp.status_code == 200
        assert resp.json()["skipped"][0]["skipped_reason"] == "index_out_of_range"

    async def test_empty_target_list_is_rejected(self, client, test_user, db_session):
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_tomorrow(), [_squat_entry()])]
        )
        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/strength-progression/apply",
            json={"targets": []},
        )
        assert resp.status_code == 422


# ── refresh-targets × manual ──────────────────────────────────────────────


class TestRefreshTargetsGuard:
    async def test_manual_entry_is_never_re_solved(
        self, client, test_user, db_session
    ):
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(
                    _tomorrow(),
                    [
                        _squat_entry(
                            weight_kg=100.0, pct_1rm=0.8, weight_source="manual"
                        )
                    ],
                )
            ],
        )
        resp = await client.post(f"/api/v1/training-plans/{plan.id}/refresh-targets")
        assert resp.status_code == 200, resp.text
        assert resp.json()["strength_refreshed"] == []
        assert (await _day_entry(client, plan.id, plan.days[0].id))[
            "weight_kg"
        ] == pytest.approx(100.0)

    async def test_suggested_entry_is_re_solved(self, client, test_user, db_session):
        """The contrast case: the same entry, not marked manual, does refresh."""
        await _seed_pr(db_session, test_user, e1rm=180.0)
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(
                    _tomorrow(),
                    [
                        _squat_entry(
                            weight_kg=100.0, pct_1rm=0.8, weight_source="suggested"
                        )
                    ],
                )
            ],
        )
        resp = await client.post(f"/api/v1/training-plans/{plan.id}/refresh-targets")
        assert resp.status_code == 200, resp.text
        refreshed = resp.json()["strength_refreshed"]
        assert len(refreshed) == 1
        assert refreshed[0]["new_weight_kg"] == pytest.approx(144.0)
        assert (await _day_entry(client, plan.id, plan.days[0].id))[
            "weight_kg"
        ] == pytest.approx(144.0)


# ── materialise ───────────────────────────────────────────────────────────


class TestMaterialise:
    def _rule(self) -> dict:
        return {
            "exercise": "Back Squat",
            "mode": "rpe",
            "start": {"sets": 3, "reps": 3, "rpe": 7},
            "weekly": {"rpe_delta": 0.5},
            "deload_every": 4,
        }

    async def test_fill_empty_leaves_existing_targets_alone(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(_week_date(1), [_squat_entry(rpe=None)]),
                _strength_day(_week_date(2), [_squat_entry(rpe=9.0)]),
            ],
        )
        resp = await _materialise(
            client, plan.id, rules=[self._rule()], mode="fill-empty"
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["rules_saved"] == 1

        week1 = await _day_entry(client, plan.id, plan.days[0].id)
        # Empty rpe is filled; the existing 5×5 is left alone.
        assert week1["rpe"] == pytest.approx(7.0)
        assert week1["sets"] == 5
        assert week1["reps"] == 5

        # An existing rpe is *not* overwritten in fill-empty mode.
        week2 = await _day_entry(client, plan.id, plan.days[1].id)
        assert week2["rpe"] == pytest.approx(9.0)

    async def test_replace_overwrites_targets_and_applies_the_ramp(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(_week_date(1), [_squat_entry(rpe=None)]),
                _strength_day(_week_date(2), [_squat_entry(rpe=9.0)]),
                _strength_day(_week_date(4), [_squat_entry(rpe=9.0)]),
            ],
        )
        resp = await _materialise(client, plan.id, rules=[self._rule()], mode="replace")
        assert resp.status_code == 200, resp.text

        week1 = await _day_entry(client, plan.id, plan.days[0].id)
        assert (week1["sets"], week1["reps"]) == (3, 3)
        assert week1["rpe"] == pytest.approx(7.0)

        week2 = await _day_entry(client, plan.id, plan.days[1].id)
        assert week2["rpe"] == pytest.approx(7.5)

        # Week 4 is a deload: the ramp does not advance (8.0 at week 3) and the
        # RPE drops by one.
        week4 = await _day_entry(client, plan.id, plan.days[2].id)
        assert week4["rpe"] == pytest.approx(7.0)

    async def test_weights_are_never_written_by_materialise(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(
                    _week_date(1),
                    [_squat_entry(rpe=None, weight_kg=100.0, weight_source="manual")],
                )
            ],
        )
        await _materialise(client, plan.id, rules=[self._rule()], mode="replace")
        entry = await _day_entry(client, plan.id, plan.days[0].id)
        assert entry["weight_kg"] == pytest.approx(100.0)
        assert entry["weight_source"] == "manual"

    async def test_rules_are_persisted_on_the_plan(self, client, test_user, db_session):
        plan = await _make_plan(
            db_session,
            test_user,
            [_strength_day(_week_date(1), [_squat_entry(rpe=None)])],
        )
        await _materialise(client, plan.id, rules=[self._rule()])
        resp = await client.get(f"/api/v1/training-plans/{plan.id}")
        stored = resp.json()["strength_progression"]
        assert stored and stored[0]["exercise"] == "Back Squat"
        assert stored[0]["deload_every"] == 4

    async def test_exercise_absent_from_the_week_is_reported(
        self, client, test_user, db_session
    ):
        """Materialise edits the program; it does not add lifts to days."""
        plan = await _make_plan(
            db_session,
            test_user,
            [_strength_day(_week_date(1), [_squat_entry(rpe=None)])],
        )
        resp = await _materialise(
            client,
            plan.id,
            rules=[{**self._rule(), "exercise": "Deadlift"}],
            weeks=[1],
        )
        assert resp.status_code == 200
        assert resp.json()["entries_updated"] == []
        assert resp.json()["skipped"][0]["reason"] == "no_matching_entry"

    async def test_weeks_filter_limits_the_pass(self, client, test_user, db_session):
        plan = await _make_plan(
            db_session,
            test_user,
            [
                _strength_day(_week_date(1), [_squat_entry(rpe=None)]),
                _strength_day(_week_date(2), [_squat_entry(rpe=None)]),
            ],
        )
        resp = await _materialise(
            client, plan.id, rules=[self._rule()], weeks=[2], mode="replace"
        )
        assert resp.status_code == 200
        assert {e["week"] for e in resp.json()["entries_updated"]} == {2}

    async def test_bad_mode_is_rejected(self, client, test_user, db_session):
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_week_date(1), [_squat_entry()])]
        )
        resp = await _materialise(client, plan.id, mode="bogus")
        assert resp.status_code == 422


# ── the entry shape (JSONB, no migration) ─────────────────────────────────


class TestEntryShape:
    async def test_rpe_and_provenance_round_trip(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_tomorrow(), [_squat_entry()])]
        )
        day_id = plan.days[0].id
        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{day_id}",
            json={
                "planned_exercises": [
                    {
                        "exercise": "Back Squat",
                        "sets": 5,
                        "reps": 5,
                        "rpe": 8.0,
                        "weight_kg": 150.0,
                        "weight_source": "manual",
                        "note": "pause on chest",
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        entry = (await _day_entry(client, plan.id, day_id))
        assert entry["rpe"] == pytest.approx(8.0)
        assert entry["weight_source"] == "manual"
        assert entry["note"] == "pause on chest"

    async def test_rpe_out_of_range_is_rejected(self, client, test_user, db_session):
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_tomorrow(), [_squat_entry()])]
        )
        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{plan.days[0].id}",
            json={
                "planned_exercises": [
                    {"exercise": "Back Squat", "sets": 5, "reps": 5, "rpe": 11}
                ]
            },
        )
        assert resp.status_code == 422

    async def test_unknown_weight_source_is_rejected(
        self, client, test_user, db_session
    ):
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_tomorrow(), [_squat_entry()])]
        )
        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{plan.days[0].id}",
            json={
                "planned_exercises": [
                    {
                        "exercise": "Back Squat",
                        "sets": 5,
                        "reps": 5,
                        "weight_source": "guessed",
                    }
                ]
            },
        )
        assert resp.status_code == 422

    async def test_deload_level_pct_basis_is_storable(
        self, client, test_user, db_session
    ):
        """0.30 × 0.9 deload = 0.27, which the old 0.3 floor rejected."""
        plan = await _make_plan(
            db_session, test_user, [_strength_day(_tomorrow(), [_squat_entry()])]
        )
        resp = await client.patch(
            f"/api/v1/training-plans/{plan.id}/days/{plan.days[0].id}",
            json={
                "planned_exercises": [
                    {
                        "exercise": "Back Squat",
                        "sets": 5,
                        "reps": 5,
                        "rpe": 6.0,
                        "weight_kg": 48.5,
                        "pct_1rm": 0.27,
                        "weight_source": "suggested",
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        entry = await _day_entry(client, plan.id, plan.days[0].id)
        assert entry["pct_1rm"] == pytest.approx(0.27)
