"""Tests for weather-analysis fixes (audit issues C + D).

Pure (no DB) — exercises ``app/integrations/weather_analysis.py`` directly.

C: ``_multiple_linear_regression`` must be least squares (normal equations),
   not an elimination subset-solve; zero-variance placeholder columns
   (humidity/pressure, never stored) are dropped and reported.
D: personalized insights are gated on fit quality and sample size — no
   "optimal temperature" from noise, no headwind claim from 2 windy rides,
   no stale ">30 km/h" threshold text.
"""

import random

import pytest

from app.integrations.weather_analysis import (
    _multiple_linear_regression,
    analyze_weather_performance,
)


def _noisy_plane(seed: int = 7, n: int = 40):
    rng = random.Random(seed)
    xs = [
        [
            float(i % 25) + rng.random(),
            float((i * 3) % 11) + rng.random(),
            50.0,  # humidity placeholder: constant
            float(i % 3),
            1013.0,  # pressure placeholder: constant
        ]
        for i in range(n)
    ]
    ys = [2 * x[0] - 3 * x[1] + 5 + rng.gauss(0, 2) for x in xs]
    return xs, ys


NAMES = ["temperature", "wind_speed", "humidity", "precipitation", "pressure"]


def test_ols_matches_least_squares_and_drops_constants():
    xs, ys = _noisy_plane()
    r = _multiple_linear_regression(xs, ys, NAMES)
    # numpy lstsq reference: [1.9836, -3.0435, *, 0.2433, *], R² 0.9862
    assert r["coefficients"][0] == pytest.approx(1.9836, abs=0.01)
    assert r["coefficients"][1] == pytest.approx(-3.0435, abs=0.01)
    assert r["coefficients"][3] == pytest.approx(0.2433, abs=0.01)
    assert r["r_squared"] == pytest.approx(0.9862, abs=0.005)
    assert r["dropped_features"] == ["humidity", "pressure"]


def test_ols_exact_plane_recovery():
    xs = [[float(i), float(i % 7)] for i in range(20)]
    ys = [2 * x[0] - 3 * x[1] + 5 for x in xs]
    r = _multiple_linear_regression(xs, ys, ["a", "b"])
    assert r["coefficients"] == pytest.approx([2.0, -3.0], abs=1e-6)
    assert r["intercept"] == pytest.approx(5.0, abs=1e-6)
    assert r["r_squared"] == pytest.approx(1.0, abs=1e-9)
    assert r["dropped_features"] == []


def test_ols_underdetermined_returns_zeros():
    xs = [[float(i + j) for j in range(5)] for i in range(6)]
    r = _multiple_linear_regression(xs, [1.0] * 6, NAMES)
    assert r["r_squared"] == 0.0
    assert r["coefficients"] == [0.0] * 5


def _ride(date: str, watts: float, temp: float, wind: float = 5.0, **kw):
    return {
        "date": date,
        "avg_watts": watts,
        "normalized_power": watts,
        "decoupling_pct": kw.get("decoupling_pct"),
        "avg_hr": kw.get("avg_hr", 140.0),
        "moving_time": 3600,
        "route_heading_degrees": kw.get("route_heading_degrees"),
        "weather": {
            "temperature": temp,
            "wind_speed_kmh": wind,
            "wind_direction": kw.get("wind_direction"),
            "humidity": None,
            "precipitation_mm": 0.0,
            "pressure_hpa": None,
            "conditions": "clear",
        },
    }


def test_no_optimal_temp_insight_from_noise():
    rng = random.Random(42)
    rides = [
        _ride(f"2026-03-{i + 1:02d}", 150 + rng.gauss(0, 30), 5 + (i % 20))
        for i in range(25)
    ]
    result = analyze_weather_performance(rides)
    assert result["power_vs_temp"] is not None  # section still computed
    assert not any(
        "Optimal riding temperature" in s for s in result["personalized_insights"]
    )


def test_headwind_insight_needs_samples_and_no_speed_claim():
    # Two very windy rides with low power: penalty exists but n=2 headwind
    # rides must not produce an insight.
    rides = [
        _ride(f"2026-04-{i + 1:02d}", 200.0, 15.0, wind=5.0) for i in range(12)
    ] + [_ride(f"2026-04-{i + 13:02d}", 120.0, 15.0, wind=40.0) for i in range(2)]
    result = analyze_weather_performance(rides)
    assert not any("Headwind" in s for s in result["personalized_insights"])

    # With 6 genuine headwind rides the insight fires — but must never claim
    # the ">30 km/h" threshold the math never applied.
    rides = [
        _ride(f"2026-05-{i + 1:02d}", 200.0, 15.0, wind=5.0) for i in range(12)
    ] + [
        _ride(
            f"2026-05-{i + 13:02d}",
            120.0,
            15.0,
            wind=25.0,
            route_heading_degrees=0.0,
            wind_direction=0.0,
        )
        for i in range(6)
    ]
    result = analyze_weather_performance(rides)
    headwind_insights = [s for s in result["personalized_insights"] if "Headwind" in s]
    assert headwind_insights == ["Headwinds reduce power by ~40.0%"]


def test_decoupling_threshold_needs_data():
    rides = [
        _ride(
            f"2026-06-{i + 1:02d}",
            200.0,
            10 + i,
            decoupling_pct=2.0 + i * 0.8,
        )
        for i in range(12)
    ]
    result = analyze_weather_performance(rides)
    assert result["decoupling_vs_temp"] is not None
    assert result["decoupling_vs_temp"]["threshold_c"] is not None
    # …but 12 points are below the insight gate.
    assert not any("Decoupling increases" in s for s in result["personalized_insights"])
