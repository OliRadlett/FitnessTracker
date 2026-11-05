"""The quality composite measures fit, not usage or paved preference.

The 2026-11 audit measured the old weights (60% metadata, 15% popularity, 20%
surface preference): Komoot imports scored 70.6 vs 45.4 for ridden Strava
routes, and an unridden route was capped at ~85. These tests pin the redesign.
"""

from app.services.route_quality_service import WEIGHTS, compute_overall_score


def test_weights_sum_to_one():
    assert abs(sum(WEIGHTS.values()) - 1.0) < 1e-9


def test_popularity_and_surface_are_context_only():
    base = {"completeness": 80.0, "effort_match": 70.0, "terrain_quality": 60.0}
    quiet = compute_overall_score({**base, "popularity": 0.0, "surface_quality": 0.0})
    loud = compute_overall_score({**base, "popularity": 100.0, "surface_quality": 100.0})

    assert quiet == loud


def test_effort_and_terrain_dominate_the_score():
    dull = compute_overall_score(
        {"completeness": 100.0, "effort_match": 20.0, "terrain_quality": 20.0}
    )
    engaging = compute_overall_score(
        {"completeness": 100.0, "effort_match": 90.0, "terrain_quality": 90.0}
    )

    assert engaging - dull > 30


def test_renormalises_when_terrain_is_missing():
    score = compute_overall_score(
        {"completeness": 50.0, "effort_match": 50.0, "terrain_quality": None}
    )

    assert score == 50.0


def test_a_route_with_no_signals_scores_zero():
    assert compute_overall_score({}) is None
    assert (
        compute_overall_score(
            {"completeness": 0.0, "effort_match": 0.0, "terrain_quality": 0.0}
        )
        == 0.0
    )
