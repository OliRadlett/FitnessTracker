"""Gear classification and wear arithmetic.

Two judgment calls are pinned here because both could quietly become wrong:

* A missing ``frame_type`` does **not** mean shoes. Strava omits it for shoes *and*
  for a bike whose owner never set the type, so "no frame" is "cannot tell", not
  "shoes" — and guessing shoes on the bike that carries 10,000 km is the worst
  possible error to make confidently.
* Wear is not clamped at 100%. A gear past its interval should read 140%, so the
  overrun is visible instead of flattening at "fully worn".
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from app.models.gear import Gear
from app.services.gear import (
    GEAR_DISTANCE_TTL,
    GEAR_KIND_BIKE,
    GEAR_KIND_OTHER,
    _is_stale,
    kind_from_payload,
    remaining_meters,
    wear_percent,
)


class TestKind:
    @pytest.mark.parametrize("frame_type", [1, 2, 3, 4])
    def test_a_frame_type_means_a_bike(self, frame_type):
        assert kind_from_payload({"frame_type": frame_type, "name": "Roadie"}) == (
            GEAR_KIND_BIKE
        )

    @pytest.mark.parametrize("frame_type", [None, 0, 5, "3"])
    def test_no_usable_frame_type_is_other_not_shoes(self, frame_type):
        """The bike with no type set must not be labelled shoes."""
        assert (
            kind_from_payload({"frame_type": frame_type, "name": "Roadie"})
            == GEAR_KIND_OTHER
        )

    def test_a_shoes_payload_is_other(self):
        assert kind_from_payload({"id": "g1", "name": "Shoes"}) == GEAR_KIND_OTHER


class TestWear:
    def test_half_way_through_the_interval(self):
        assert wear_percent(500_000, 1_000_000) == 50.0

    def test_beyond_the_interval_is_not_clamped(self):
        """140% is information; 100% is a lie."""
        assert wear_percent(1_400_000, 1_000_000) == 140.0

    @pytest.mark.parametrize(
        ("distance", "threshold"),
        [
            (None, 1_000_000),
            (500_000, None),
            (500_000, 0),
            (0, 1_000_000),
        ],
    )
    def test_unknowns_produce_no_percentage(self, distance, threshold):
        """A missing distance or an unset interval means "no opinion"."""
        assert wear_percent(distance, threshold) is None

    def test_remaining_goes_negative_once_exceeded(self):
        assert remaining_meters(900_000, 1_000_000) == 100_000
        assert remaining_meters(1_250_000, 1_000_000) == -250_000
        assert remaining_meters(None, 1_000_000) is None


class TestStaleness:
    def _gear(self, synced_at):
        return Gear(
            user_id=None,  # not persisted; type-check only
            provider="strava",
            provider_gear_id="b1",
            name="Bike",
            kind=GEAR_KIND_BIKE,
            distance_synced_at=synced_at,
        )

    def test_never_synced_is_stale(self):
        assert _is_stale(self._gear(None)) is True

    def test_recent_is_fresh(self):
        assert _is_stale(self._gear(datetime.now(UTC) - timedelta(hours=2))) is False

    def test_older_than_the_ttl_is_stale(self):
        assert _is_stale(self._gear(datetime.now(UTC) - GEAR_DISTANCE_TTL)) is True
