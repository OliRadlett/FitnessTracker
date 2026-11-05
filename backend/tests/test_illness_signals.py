"""The two recovery-only illness signals, and the composite that weights them.

Whoop's bulk recovery payload carries ``spo2_percentage`` and
``skin_temp_celsius`` alongside the four fields the sync used to read. Both now
land on ``DailyMetric`` (migration 109) and vote in the illness composite.

Three properties are worth pinning, because each has a plausible failure mode
that no type checker sees:

* a single low SpO2 reading is an artefact as often as it is physiology, so the
  signal requires two recent readings;
* skin temperature is only meaningful as a deviation from the user's own
  baseline (absolute values differ by person, bedding and room), and only an
  *elevated* one is the illness marker;
* a missing signal must be unknown rather than zero — and adding these two
  weights must leave a user who has no SpO2/skin-temperature data with exactly
  the score they had before.
"""

from __future__ import annotations

import pytest

from app.integrations.whoop_client import whoop_client
from app.services.health_analysis import (
    _illness_composite,
    _skin_temp_signal,
    _spo2_signal,
)
from app.services.whoop import _recovery_fields


class TestSpo2Signal:
    def test_single_low_reading_is_not_enough(self):
        """One desaturated night is usually the strap, not the athlete."""
        assert _spo2_signal([97, 88]) == 0.0
        assert _spo2_signal([97, 88, 96]) == 0.0

    def test_two_low_readings_score_on_the_worst(self):
        assert _spo2_signal([88, 96, 89]) == 100.0

    @pytest.mark.parametrize(
        ("values", "expected"),
        [
            ([89, 92], 100.0),  # worst < 90
            ([92, 93], 70.0),  # worst < 93
            ([94, 94], 40.0),  # worst < 95
            ([96, 95, 97], 0.0),  # normal
        ],
    )
    def test_bands(self, values, expected):
        assert _spo2_signal(values) == expected

    def test_only_the_last_three_count(self):
        """A bad week decays: the composite is about what is happening now."""
        assert _spo2_signal([85, 85, 97, 98, 99]) == 0.0

    def test_none_values_are_ignored(self):
        assert _spo2_signal([None, 92, None]) == 0.0  # one reading, not two
        assert _spo2_signal([None, 92, 91]) == 70.0


class TestSkinTempSignal:
    def test_no_baseline_scores_nothing(self):
        assert _skin_temp_signal(35.0, None) == 0.0
        assert _skin_temp_signal(None, 33.0) == 0.0

    @pytest.mark.parametrize(
        ("current", "expected"),
        [
            (33.1, 0.0),  # +0.1
            (33.3, 40.0),  # +0.3
            (33.5, 70.0),  # +0.5
            (33.7, 100.0),  # +0.7
        ],
    )
    def test_bands(self, current, expected):
        assert _skin_temp_signal(current, 33.0) == expected

    def test_below_baseline_is_not_a_signal(self):
        """A cold bedroom is not an illness. The signal is one-sided."""
        assert _skin_temp_signal(32.2, 33.0) == 0.0


class TestIllnessComposite:
    # 90*0.25 + 70*0.20 + 80*0.25 + 60*0.15 + 50*0.15 = 73.0
    _BASELINE_ARGS = (90.0, 70.0, 80.0, 60.0, 50.0, True, True)

    def test_unchanged_when_the_new_signals_are_absent(self):
        """A user without SpO2/skin-temp data must score exactly as before.

        This is the regression that matters: the columns are new, and most
        historical rows are NULL.
        """
        assert _illness_composite(*self._BASELINE_ARGS) == pytest.approx(73.0)

    def test_new_signals_are_gated_by_presence_not_by_value(self):
        """A score without its `has_*` flag must not vote.

        Passing a signal value with presence False is exactly the shape of a
        bug where a caller computes a score from an empty list (0.0) and the
        weight still applies.
        """
        assert _illness_composite(
            *self._BASELINE_ARGS, spo2_s=100.0, has_spo2_data=False
        ) == pytest.approx(73.0)

    def test_elevated_signals_raise_the_composite(self):
        with_spo2 = _illness_composite(
            *self._BASELINE_ARGS, spo2_s=100.0, has_spo2_data=True
        )
        # (73.0 + 100*0.10) / 1.10
        assert with_spo2 == pytest.approx(75.45, abs=0.01)
        assert with_spo2 > 73.0

    def test_both_signals_dilute_rather_than_sum(self):
        """Adding two votes renormalises; it cannot push the score past 100."""
        both = _illness_composite(
            *self._BASELINE_ARGS,
            spo2_s=100.0,
            has_spo2_data=True,
            skin_temp_s=100.0,
            has_skin_temp_data=True,
        )
        # (73.0 + 10 + 10) / 1.20
        assert both == pytest.approx(77.5, abs=0.01)
        assert both <= 100.0


class TestRecoveryProjection:
    """One projector, because three copies of this drifted apart."""

    def test_projects_every_scored_field(self):
        rec = _recovery_fields(
            {
                "score_state": "SCORED",
                "score": {
                    "recovery_score": 62,
                    "hrv_rmssd_milli": 48.5,
                    "resting_heart_rate": 47,
                    "spo2_percentage": 96.0,
                    "skin_temp_celsius": 33.4,
                },
            }
        )

        assert rec == {
            "recovery_score": 62.0,
            "hrv_ms": 48.5,
            "resting_hr": 47.0,
            "spo2_percentage": 96.0,
            "skin_temp_celsius": 33.4,
        }

    def test_drops_nulls_so_a_merge_can_never_erase(self):
        rec = _recovery_fields(
            {
                "score_state": "SCORED",
                "score": {"recovery_score": 40, "spo2_percentage": None},
            }
        )

        assert rec == {"recovery_score": 40.0}
        assert "spo2_percentage" not in rec

    @pytest.mark.parametrize(
        "recovery",
        [None, {}, {"score_state": "UNSCORED", "score": {"recovery_score": 50}}],
    )
    def test_unscored_or_missing_recovery_projects_nothing(self, recovery):
        assert _recovery_fields(recovery) == {}


class TestBulkRecoveryEndpoint:
    @pytest.mark.asyncio
    async def test_uses_the_collection_endpoint(self, monkeypatch):
        """One paginated walk, not one request per cycle."""
        seen: dict = {}

        async def fake_paginated(access_token, endpoint, **kwargs):
            seen["token"] = access_token
            seen["endpoint"] = endpoint
            seen["kwargs"] = kwargs
            return [{"cycle_id": 7, "score_state": "SCORED", "score": {}}]

        monkeypatch.setattr(whoop_client, "_paginated_get", fake_paginated)

        records = await whoop_client.get_all_recovery("token", max_records=25)

        assert seen["endpoint"] == "/developer/v2/recovery"
        assert seen["kwargs"]["max_records"] == 25
        assert records == [{"cycle_id": 7, "score_state": "SCORED", "score": {}}]
