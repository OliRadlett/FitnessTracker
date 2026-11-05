"""Air quality and pollen as an *explanation*, never an instruction.

The `/today` verdict gained a seventh engine. Its whole job is to answer a
question no other engine can — "why does today feel harder than my numbers say" —
because a high pollen count and a hot, still, polluted afternoon both raise heart
rate at the same power, and nothing else in the app knows they happened.

Three properties are load-bearing, and each has a plausible failure:

* **It can never force a rest day.** Confidence is pinned to "low", and
  ``should_rest`` only counts high/medium. Being told to skip a session because
  the grass pollen is up would be confident nonsense.
* **A silent engine still reports.** No home location, no data, a failed fetch —
  each emits ``available: false`` with the reason, so the consensus keeps a
  constant width instead of quietly reading as unanimous (pitfall 42).
* **The driver is named.** "Air quality is poor" cannot be argued with; "grass
  pollen 46 grains/m³" can.
"""

from __future__ import annotations

import pytest

from app.services.today import (
    STANCE_CUT,
    STANCE_TRAIN,
    _environment_stance,
)


class TestEnvironmentStance:
    def test_clean_air_is_not_a_factor(self):
        stance, confidence, note = _environment_stance(
            aqi=12, pollen={"grass": 4, "birch": 1}
        )

        assert stance == STANCE_TRAIN
        assert confidence == "low"
        assert "not a factor" in note

    def test_high_pollen_names_the_species_and_the_number(self):
        stance, confidence, note = _environment_stance(
            aqi=12, pollen={"grass": 46, "birch": 8}
        )

        assert stance == STANCE_CUT
        assert confidence == "low"
        assert "grass" in note
        assert "46" in note
        # The worst species wins, not the first.
        assert "birch" not in note

    def test_high_aqi_names_the_index(self):
        stance, _, note = _environment_stance(aqi=74, pollen={})

        assert stance == STANCE_CUT
        assert "AQI 74" in note

    def test_both_drivers_are_reported_together(self):
        _, _, note = _environment_stance(aqi=80, pollen={"ragweed": 35})

        assert "AQI 80" in note
        assert "ragweed" in note

    @pytest.mark.parametrize("aqi", [None, 59.9])
    @pytest.mark.parametrize("pollen", [{}, {"grass": 29.9}])
    def test_thresholds_are_inclusive_at_the_band(self, aqi, pollen):
        """Just under the bands stays a train read."""
        assert _environment_stance(aqi, pollen)[0] == STANCE_TRAIN

    def test_distance_below_the_band_is_still_a_cut(self):
        """The band boundary is >=, so exactly 60 is a cut."""
        assert _environment_stance(60, {})[0] == STANCE_CUT

    def test_no_data_at_all_says_so(self):
        stance, confidence, note = _environment_stance(None, {})

        assert stance == STANCE_TRAIN
        assert confidence == "low"
        assert "No air-quality or pollen data" in note

    def test_no_pollen_but_an_aqi_is_not_reported_as_no_data(self):
        """Outside Europe pollen is absent; AQI still answers."""
        _, _, note = _environment_stance(aqi=20, pollen={})

        assert "not a factor" in note
        assert "No air-quality" not in note
