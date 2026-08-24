"""Unit tests for conformity service pure functions (Phase 5C).

No database required — builders take lightweight stand-in objects.
"""

from types import SimpleNamespace

import pytest

from app.services.conformity import (
    build_cycle_conformity,
    build_strength_conformity,
    classify_conformity,
    missed_conformity,
    score_component,
)


def fake_activity(
    *,
    duration_seconds=3600,
    normalized_power=None,
    average_power=None,
    tss=None,
    route_id=None,
):
    return SimpleNamespace(
        duration_seconds=duration_seconds,
        normalized_power=normalized_power,
        average_power=average_power,
        tss=tss,
        route_id=route_id,
    )


def fake_session(
    *,
    total_volume_kg=None,
    duration_seconds=None,
    rpe_session=None,
    focus=None,
):
    return SimpleNamespace(
        total_volume_kg=total_volume_kg,
        duration_seconds=duration_seconds,
        rpe_session=rpe_session,
        focus=focus,
    )


# ── score_component ─────────────────────────────────────────────────────────


class TestScoreComponent:
    def test_missing_planned_is_none(self):
        assert score_component(None, 100) is None

    def test_missing_actual_is_none(self):
        assert score_component(100, None) is None

    def test_zero_planned_guard(self):
        assert score_component(0, 100) is None

    def test_zero_actual_guard(self):
        assert score_component(100, 0) is None

    def test_negative_planned_guard(self):
        assert score_component(-10, 5) is None

    def test_perfect_match(self):
        assert score_component(100, 100) == pytest.approx(1.0)

    def test_half_deviation(self):
        assert score_component(100, 150) == pytest.approx(0.5)

    def test_clamped_at_zero(self):
        assert score_component(100, 400) == 0.0


# ── classification ──────────────────────────────────────────────────────────


class TestClassifyConformity:
    @pytest.mark.parametrize(
        ("pct", "expected"),
        [
            (100, "Excellent"),
            (90, "Excellent"),
            (89.9, "Good"),
            (70, "Good"),
            (69.9, "Partial deviation"),
            (50, "Partial deviation"),
            (49.9, "Significant deviation"),
            (0, "Significant deviation"),
            (None, None),
        ],
    )
    def test_boundaries(self, pct, expected):
        assert classify_conformity(pct) == expected


# ── cycle conformity ────────────────────────────────────────────────────────


class TestCycleConformity:
    def test_none_without_activity(self):
        assert build_cycle_conformity({"planned_tss": 100}, None) is None

    def test_extra_status_when_nothing_planned(self):
        result = build_cycle_conformity({}, fake_activity(tss=80))
        assert result is not None
        assert result["status"] == "extra"
        assert result["conformity_pct"] is None
        assert all(c["component_score"] is None for c in result["components"])

    def test_weights_renormalise_to_one(self):
        # Only duration + TSS comparable → their raw weights renormalise.
        result = build_cycle_conformity(
            {"planned_duration_min": 60, "planned_tss": 80},
            fake_activity(duration_seconds=3600, tss=80),
        )
        used = [c["weight_used"] for c in result["components"]]
        scored_used = [w for w in used if w is not None]
        assert len(scored_used) == 2
        assert sum(scored_used) == pytest.approx(1.0)

    def test_perfect_plan_scores_100(self):
        planned = {
            "planned_duration_min": 60,
            "planned_power_watts": 200,
            "planned_tss": 80,
            "planned_route_id": "r1",
        }
        result = build_cycle_conformity(
            planned,
            fake_activity(
                duration_seconds=3600,
                normalized_power=200,
                tss=80,
                route_id="r1",
            ),
        )
        assert result["conformity_pct"] == pytest.approx(100.0)
        assert result["status"] == "done"
        assert result["classification"] == "Excellent"

    def test_route_match_scores(self):
        base = {"planned_route_id": "r1"}
        same = build_cycle_conformity(base, fake_activity(route_id="r1"))
        other = build_cycle_conformity(base, fake_activity(route_id="r2"))
        by_metric = lambda res: {c["metric"]: c for c in res["components"]}
        assert by_metric(same)["route"]["component_score"] == 1.0
        assert by_metric(other)["route"]["component_score"] == 0.5

    def test_route_dropped_when_activity_has_no_route(self):
        result = build_cycle_conformity(
            {"planned_route_id": "r1", "planned_tss": 80},
            fake_activity(tss=80, route_id=None),
        )
        metrics = {c["metric"]: c for c in result["components"]}
        # Route is never scored when the ride has no route.
        assert all(c["metric"] != "route" for c in result["components"])
        # Only TSS remains scored — its weight renormalises to 1.0.
        assert metrics["tss"]["weight_used"] == pytest.approx(1.0)

    def test_no_route_planned_drops_component(self):
        result = build_cycle_conformity(
            {"planned_tss": 80}, fake_activity(tss=80, route_id="r9")
        )
        assert all(c["metric"] != "route" for c in result["components"])

    def test_prefers_normalized_power(self):
        result = build_cycle_conformity(
            {"planned_power_watts": 210},
            fake_activity(normalized_power=210, average_power=100),
        )
        power = next(c for c in result["components"] if c["metric"] == "power")
        assert power["actual"] == 210
        assert power["component_score"] == pytest.approx(1.0)

    def test_partial_status_below_50(self):
        # Duration way off only comparable component → score < 50%.
        result = build_cycle_conformity(
            {"planned_duration_min": 60},
            fake_activity(duration_seconds=60),  # 1 min vs 60 planned
        )
        assert result["conformity_pct"] < 50
        assert result["status"] == "partial"

    def test_power_deviation_text(self):
        result = build_cycle_conformity(
            {"planned_power_watts": 200},
            fake_activity(normalized_power=230),
        )
        assert (
            "You rode 15% harder than planned (230W vs 200W target)"
            in result["deviations"]
        )

    def test_small_deviations_produce_no_text(self):
        result = build_cycle_conformity(
            {"planned_power_watts": 200},
            fake_activity(normalized_power=205),  # 2.5%
        )
        assert result["deviations"] == []


# ── strength conformity ─────────────────────────────────────────────────────


class TestStrengthConformity:
    def test_none_without_session(self):
        assert build_strength_conformity({"planned_volume_kg": 5000}, None, []) is None

    def test_volume_over_performance_capped_at_120pct(self):
        result = build_strength_conformity(
            {"planned_volume_kg": 100},
            fake_session(total_volume_kg=200),
            [],
        )
        volume = next(c for c in result["components"] if c["metric"] == "volume")
        assert volume["component_score"] == pytest.approx(1.2)
        # Overall still capped at 100 even though a component scored 1.2.
        assert result["conformity_pct"] <= 100

    def test_volume_shortfall(self):
        result = build_strength_conformity(
            {"planned_volume_kg": 100},
            fake_session(total_volume_kg=82),
            [],
        )
        volume = next(c for c in result["components"] if c["metric"] == "volume")
        assert volume["component_score"] == pytest.approx(0.82)
        assert any("82% of planned volume" in d for d in result["deviations"])

    def test_exercises_completed_fraction_case_insensitive(self):
        planned = {
            "planned_exercises": [
                {"exercise": "Back Squat", "sets": 5, "reps": 5},
                {"exercise": "Leg Press", "sets": 3, "reps": 10},
            ],
        }
        result = build_strength_conformity(
            planned,
            fake_session(),
            ["back squat", "Bench Press"],
        )
        exercises = next(c for c in result["components"] if c["metric"] == "exercises")
        assert exercises["actual"] == 1.0
        assert exercises["planned"] == 2.0
        assert exercises["component_score"] == pytest.approx(0.5)

    def test_rpe_scoring_curve(self):
        planned = {"planned_rpe": 8}

        within = build_strength_conformity(planned, fake_session(rpe_session=7), [])
        rpe_within = next(
            c for c in within["components"] if c["metric"] == "rpe"
        )
        assert rpe_within["component_score"] == pytest.approx(1.0)

        two_off = build_strength_conformity(planned, fake_session(rpe_session=6), [])
        rpe_two = next(c for c in two_off["components"] if c["metric"] == "rpe")
        assert rpe_two["component_score"] == pytest.approx(0.5)

        three_off = build_strength_conformity(planned, fake_session(rpe_session=5), [])
        rpe_three = next(c for c in three_off["components"] if c["metric"] == "rpe")
        assert rpe_three["component_score"] == pytest.approx(0.0)

        four_off = build_strength_conformity(planned, fake_session(rpe_session=4), [])
        rpe_four = next(c for c in four_off["components"] if c["metric"] == "rpe")
        assert rpe_four["component_score"] == pytest.approx(0.0)

    def test_focus_substring_either_direction(self):
        match = build_strength_conformity(
            {"planned_focus": "squat"}, fake_session(focus="Squat Focus"), []
        )
        focus = next(c for c in match["components"] if c["metric"] == "focus")
        assert focus["component_score"] == 1.0

        mismatch = build_strength_conformity(
            {"planned_focus": "bench"}, fake_session(focus="squat day"), []
        )
        focus_bad = next(
            c for c in mismatch["components"] if c["metric"] == "focus"
        )
        assert focus_bad["component_score"] == 0.0

    def test_full_strength_day_renormalises_to_one(self):
        planned = {
            "planned_volume_kg": 5000,
            "planned_exercises": [{"exercise": "Back Squat", "sets": 5, "reps": 5}],
            "planned_duration_min": 60,
            "planned_rpe": 8,
            "planned_focus": "squat",
        }
        result = build_strength_conformity(
            planned,
            fake_session(
                total_volume_kg=4800,
                duration_seconds=3300,
                rpe_session=8,
                focus="squat",
            ),
            ["Back Squat"],
        )
        used = [
            c["weight_used"] for c in result["components"] if c["weight_used"] is not None
        ]
        assert len(used) == 5
        assert sum(used) == pytest.approx(1.0)
        assert result["conformity_pct"] >= 90
        assert result["classification"] == "Excellent"


# ── static shapes ───────────────────────────────────────────────────────────


class TestShapes:
    def test_missed_shape(self):
        result = missed_conformity()
        assert result["status"] == "missed"
        assert result["conformity_pct"] is None
        assert result["components"] == []
