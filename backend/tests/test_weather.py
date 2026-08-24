"""Tests for weather service pure functions (no DB, no HTTP)."""

import pytest

from app.services.weather import (
    _wmo_code_to_conditions,
    cache_coords,
    degrees_to_compass,
    is_bad_weather,
)


class TestWmoMapping:
    @pytest.mark.parametrize(
        "code,expected",
        [
            (0, "Clear"),
            (1, "Partly Cloudy"),
            (2, "Partly Cloudy"),
            (3, "Partly Cloudy"),
            (45, "Fog"),
            (48, "Fog"),
            (51, "Drizzle"),
            (53, "Drizzle"),
            (55, "Drizzle"),
            (56, "Freezing Drizzle"),
            (57, "Freezing Drizzle"),
            (61, "Rain"),
            (63, "Rain"),
            (65, "Rain"),
            (66, "Freezing Rain"),
            (67, "Freezing Rain"),
            (71, "Snow"),
            (73, "Snow"),
            (75, "Snow"),
            (77, "Snow Grains"),
            (80, "Rain Showers"),
            (81, "Rain Showers"),
            (82, "Rain Showers"),
            (85, "Snow Showers"),
            (86, "Snow Showers"),
            (95, "Thunderstorm"),
            (96, "Thunderstorm w/ Hail"),
            (99, "Thunderstorm w/ Hail"),
        ],
    )
    def test_known_codes(self, code, expected):
        assert _wmo_code_to_conditions(code) == expected

    @pytest.mark.parametrize("code", [-1, 4, 42, 90, 100, 1000])
    def test_unknown_codes(self, code):
        assert _wmo_code_to_conditions(code) == "Unknown"


class TestCompass:
    @pytest.mark.parametrize(
        "degrees,expected",
        [
            (0, "N"),
            (10, "N"),
            (30, "NE"),
            (45, "NE"),
            (90, "E"),
            (135, "SE"),
            (180, "S"),
            (225, "SW"),
            (270, "W"),
            (315, "NW"),
            (360, "N"),  # wraps
            (359, "N"),
        ],
    )
    def test_directions(self, degrees, expected):
        assert degrees_to_compass(degrees) == expected

    def test_none(self):
        assert degrees_to_compass(None) is None


class TestIsBadWeather:
    def _good_day(self):
        return {
            "temp_min": 12,
            "temp_max": 22,
            "wind_speed_max": 25,
            "precipitation_probability_max": 10,
            "precipitation_sum": 0,
            "conditions": "Clear",
        }

    def test_good_weather_returns_none(self):
        assert is_bad_weather(self._good_day()) is None

    def test_cold_min(self):
        day = self._good_day() | {"temp_min": 4}
        assert is_bad_weather(day) == {
            "reason": "extreme temperature",
            "level": "warning",
        }

    def test_boundary_temp_min_5_is_ok(self):
        assert is_bad_weather(self._good_day() | {"temp_min": 5}) is None

    def test_hot_max(self):
        day = self._good_day() | {"temp_max": 33}
        result = is_bad_weather(day)
        assert result == {"reason": "extreme temperature", "level": "warning"}

    def test_strong_wind_warning(self):
        day = self._good_day() | {"wind_speed_max": 41}
        assert is_bad_weather(day) == {"reason": "strong wind", "level": "warning"}

    def test_strong_wind_danger_over_60(self):
        day = self._good_day() | {"wind_speed_max": 61}
        assert is_bad_weather(day) == {"reason": "strong wind", "level": "danger"}

    def test_rain_probability(self):
        day = self._good_day() | {"precipitation_probability_max": 51}
        assert is_bad_weather(day) == {"reason": "rain likely", "level": "warning"}

    def test_rain_sum(self):
        day = self._good_day() | {"precipitation_sum": 2.5}
        assert is_bad_weather(day) == {"reason": "rain likely", "level": "warning"}

    def test_wet_conditions(self):
        for cond in ("Rain", "Snow", "Thunderstorm", "Drizzle"):
            day = self._good_day() | {"conditions": cond}
            result = is_bad_weather(day)
            assert result is not None and result["level"] == "warning"


class TestCacheCoords:
    def test_rounds_to_two_decimals(self):
        assert cache_coords(51.5074123, -0.1278901) == (51.51, -0.13)

    def test_same_grid_key(self):
        assert cache_coords(51.5001, -0.1001) == cache_coords(51.5049, -0.1049)

    def test_different_grid_keys(self):
        assert cache_coords(51.50, 0.00) != cache_coords(51.51, 0.00)


def test_normalize_daily_shapes_days():
    """Sanity-check the daily normalizer against a raw Open-Meteo payload."""
    from app.services.weather import _normalize_daily

    payload = {
        "daily": {
            "time": ["2026-08-20", "2026-08-21"],
            "weather_code": [61, 0],
            "temperature_2m_max": [18.2, 21.0],
            "temperature_2m_min": [9.1, 11.5],
            "precipitation_sum": [3.4, 0.0],
            "precipitation_probability_max": [80, 5],
            "wind_speed_10m_max": [22.7, 15.0],
        }
    }
    result = _normalize_daily(payload, 51.5, -0.12)
    assert result["latitude"] == 51.5
    assert len(result["days"]) == 2
    assert result["days"][0] == {
        "date": "2026-08-20",
        "weather_code": 61,
        "conditions": "Rain",
        "temp_max": 18.2,
        "temp_min": 9.1,
        "precipitation_probability": 80,
        "precipitation_sum": 3.4,
        "wind_speed_max": 22.7,
    }


def test_resolve_activity_coords_from_raw_data():
    from types import SimpleNamespace

    from app.services.weather import resolve_activity_coords

    activity = SimpleNamespace(route=None, raw_data={"start_latlng": [51.5, -0.12]})
    assert resolve_activity_coords(activity) == (51.5, -0.12)

    activity_no_raw = SimpleNamespace(route=None, raw_data=None)
    assert resolve_activity_coords(activity_no_raw) is None

    activity_route = SimpleNamespace(
        route=SimpleNamespace(start_lat=48.85, start_lng=2.35), raw_data=None
    )
    assert resolve_activity_coords(activity_route) == (48.85, 2.35)
