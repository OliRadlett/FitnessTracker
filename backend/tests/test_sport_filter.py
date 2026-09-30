"""Sport-type allowlist: only configured sports are ingested.

Every provider maps its own vocabulary into ``Activity.sport_type`` --
Strava maps ``"Walk"`` to ``"walking"``, Wahoo maps workout_type_id 6/7/8/56
to ``"walking"``, Whoop maps its own names. The set of sports FitTrack
accepts is therefore a policy decision, not a per-provider detail, so it
lives in one place and every ingestion path consults it.

Two behaviours are load-bearing and easy to get wrong:

* An **empty** allowlist must mean "allow everything", not "allow nothing".
  A blank ``ALLOWED_SPORT_TYPES=`` in a ``.env`` would otherwise silently
  stop all activity syncing, and the symptom (an empty dashboard) gives no
  hint that a config value is responsible.
* A ``None`` sport_type must be rejected when an allowlist is configured.
  Providers do occasionally send an unrecognised type, and letting it
  through would let unknown sports accumulate unfiltered.
"""

from __future__ import annotations

import pytest

from app.config import get_settings
from app.services.sport_filter import allowed_sport_types, is_allowed_sport


@pytest.fixture
def allowlist(monkeypatch):
    """Set ALLOWED_SPORT_TYPES for the duration of one test.

    ``get_settings`` is ``@lru_cache``d, so mutating the environment is not
    enough on its own -- without the cache_clear the first test to read
    settings would freeze its value for the whole session and the rest
    would silently assert against it. monkeypatch undoes both.
    """

    def _set(raw: str) -> None:
        monkeypatch.setenv("ALLOWED_SPORT_TYPES", raw)
        get_settings.cache_clear()

    yield _set
    get_settings.cache_clear()


class TestAllowedSportTypesParsing:
    def test_parses_comma_separated_list(self, allowlist):
        allowlist("cycling,strength")
        assert allowed_sport_types() == frozenset({"cycling", "strength"})

    def test_strips_surrounding_whitespace(self, allowlist):
        """Hand-edited .env values routinely carry spaces after commas."""
        allowlist(" cycling , strength ")
        assert allowed_sport_types() == frozenset({"cycling", "strength"})

    def test_ignores_empty_entries_from_trailing_comma(self, allowlist):
        allowlist("cycling,strength,")
        assert allowed_sport_types() == frozenset({"cycling", "strength"})

    def test_empty_value_allows_everything(self, allowlist):
        """A blank setting must not be read as "block all sports"."""
        allowlist("")
        assert allowed_sport_types() == frozenset()

    def test_whitespace_only_value_allows_everything(self, allowlist):
        allowlist("   ")
        assert allowed_sport_types() == frozenset()


class TestIsAllowedSport:
    def test_allows_configured_sport(self, allowlist):
        allowlist("cycling,strength")
        assert is_allowed_sport("cycling") is True

    def test_allows_second_configured_sport(self, allowlist):
        allowlist("cycling,strength")
        assert is_allowed_sport("strength") is True

    def test_rejects_walking(self, allowlist):
        allowlist("cycling,strength")
        assert is_allowed_sport("walking") is False

    def test_rejects_hiking(self, allowlist):
        allowlist("cycling,strength")
        assert is_allowed_sport("hiking") is False

    def test_rejects_golf(self, allowlist):
        allowlist("cycling,strength")
        assert is_allowed_sport("golf") is False

    def test_rejects_none_when_allowlist_configured(self, allowlist):
        """An unmapped provider type must not slip past the filter."""
        allowlist("cycling,strength")
        assert is_allowed_sport(None) is False

    def test_allows_anything_when_allowlist_empty(self, allowlist):
        allowlist("")
        assert is_allowed_sport("walking") is True

    def test_allows_none_when_allowlist_empty(self, allowlist):
        allowlist("")
        assert is_allowed_sport(None) is True

    def test_case_insensitive(self, allowlist):
        """Strava's sport_type strings are capitalised; the mapping is not
        applied uniformly across providers, so normalise defensively."""
        allowlist("cycling,strength")
        assert is_allowed_sport("Cycling") is True

    def test_empty_string_rejected_when_allowlist_configured(self, allowlist):
        allowlist("cycling")
        assert is_allowed_sport("") is False


class TestDefaultConfiguration:
    def test_default_is_cycling_and_strength(self):
        """Guards the shipped default against an accidental edit.

        The default is what production runs on until an operator changes
        ALLOWED_SPORT_TYPES, so it is a policy value worth pinning.
        """
        settings = get_settings()
        assert settings.allowed_sport_types == "cycling,strength"
