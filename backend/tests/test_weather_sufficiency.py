"""Tests for the weather sample-size gate alignment (t1 diagnosis).

Prod sat exactly in a threshold gap: the scheduler dispatched Modal with
>=15 eligible rides, but the worker only persists when ``total >= 20 and
with_weather >= 15`` — so 17-ride users paid for a Modal call every Sunday
whose result was silently discarded, and ``weather_analyzed_at`` stayed NULL
forever (``GET /cycling/weather-analysis`` 404s).

Pure (no DB) — exercises ``app/integrations/weather_analysis.py`` directly,
plus a source-level assertion that the scheduler pre-gate uses the shared
helper instead of a re-typed number.
"""

import random

from app.integrations.weather_analysis import (
    MIN_RIDES_TOTAL,
    MIN_RIDES_WITH_WEATHER,
    analyze_weather_performance,
    is_weather_sample_sufficient,
)


def test_gate_constants_match_documented_thresholds():
    assert MIN_RIDES_TOTAL == 20
    assert MIN_RIDES_WITH_WEATHER == 15


def test_prod_scenario_17_rides_is_insufficient():
    # Prod had exactly 17 eligible rides: old scheduler gate (>=15) let it
    # through, the worker gate rejected it.
    assert is_weather_sample_sufficient(17, 17) is False


def test_gate_boundary():
    assert is_weather_sample_sufficient(20, 15) is True
    assert is_weather_sample_sufficient(20, 20) is True
    assert is_weather_sample_sufficient(25, 14) is False
    assert is_weather_sample_sufficient(19, 19) is False
    assert is_weather_sample_sufficient(0, 0) is False


def _ride(i: int, watts: float = 200.0, temp: float = 15.0) -> dict:
    return {
        "date": f"2026-05-{(i % 28) + 1:02d}",
        "avg_watts": watts,
        "normalized_power": watts,
        "decoupling_pct": None,
        "avg_hr": 140.0,
        "moving_time": 3600,
        "route_heading_degrees": None,
        "weather": {
            "temperature": temp,
            "wind_speed_kmh": 10.0,
            "wind_direction": None,
            "humidity": None,
            "precipitation_mm": 0.0,
            "pressure_hpa": None,
            "conditions": "clear",
        },
    }


def test_worker_marks_17_rides_insufficient():
    rng = random.Random(11)
    rides = [
        _ride(i, watts=180 + rng.gauss(0, 10), temp=8 + (i % 15)) for i in range(17)
    ]
    result = analyze_weather_performance(rides)
    assert result["data_quality"]["total_rides"] == 17
    assert result["data_quality"]["with_weather"] == 17
    assert result["data_quality"]["sufficient"] is False


def test_worker_marks_25_rides_sufficient():
    rng = random.Random(11)
    rides = [
        _ride(i, watts=180 + rng.gauss(0, 10), temp=8 + (i % 15)) for i in range(25)
    ]
    result = analyze_weather_performance(rides)
    assert result["data_quality"]["total_rides"] == 25
    assert result["data_quality"]["sufficient"] is True


def test_scheduler_pregate_uses_shared_gate():
    """The scheduler must not re-type the threshold.

    A separately-typed number is how the 15-vs-20 gap happened: one side
    changes and the other silently disagrees. The pre-gate must call the
    shared helper.
    """
    import pathlib

    import app.tasks.scheduler as sched

    src = pathlib.Path(sched.__file__).read_text(encoding="utf-8")
    start = src.index("def analyze_weather_performance_weekly")
    end = src.index("@celery_app.task", start)
    task_src = src[start:end]
    assert "is_weather_sample_sufficient" in task_src
    assert "len(activities) < 15" not in task_src
