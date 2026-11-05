"""Withings weigh-ins are stored whole, not filtered down to eight columns.

``group_measurements`` decoded every ``measuregrp`` and kept only the types in
``_MEASTYPE_TO_FIELD``; a scale that reported heart pulse, vascular age, BMR or
segmental masses had those values decoded and thrown away. Withings was the one
integration that discarded its provider payload — every other provider keeps one
(``activities.raw_data``, ``routes.raw_data``).

These tests pin the two halves that make the fix safe to widen later: the
payload survives grouping untouched, and the ``getmeas`` request asks for more
than we currently map (so a new mapping is a backfill, not a re-sync).
"""

from __future__ import annotations

import pytest

from app.integrations.withings_client import WITHINGS_MEASTYPES
from app.services.withings import group_measurements

TS = 1_700_000_000


def _measuregrp(measures: list[tuple[int, int, int]], ts: int = TS) -> dict:
    """A ``measuregrp`` shaped like Withings' getmeas response.

    ``measures`` is ``(type, value, unit)``; the real value is
    ``value * 10**unit``.
    """
    return {
        "grpid": 42,
        "date": ts,
        "category": 1,
        "deviceid": "body-comp",
        "measures": [
            {"value": value, "type": mtype, "unit": unit}
            for mtype, value, unit in measures
        ],
    }


class TestPayloadRetention:
    def test_group_carries_the_provider_payload_untouched(self):
        grp = _measuregrp([(1, 7463, -2), (11, 54, 0), (226, 1680, 0)])

        grouped = group_measurements([grp])

        assert len(grouped) == 1
        assert grouped[0]["weight_kilogram"] == pytest.approx(74.63)
        # Identity, not a copy: nothing may rewrite what the provider sent.
        assert grouped[0]["raw"] is grp
        assert [m["type"] for m in grouped[0]["raw"]["measures"]] == [1, 11, 226]

    def test_unmapped_types_survive_even_though_they_have_no_column(self):
        grp = _measuregrp([(1, 7463, -2), (226, 1680, 0)])

        grouped = group_measurements([grp])

        # No column yet — mapping BMR is deliberately a follow-up.
        assert "bmr" not in grouped[0]
        # …but the value is recoverable from what we stored.
        assert any(m["type"] == 226 for m in grouped[0]["raw"]["measures"])

    def test_out_of_range_composition_is_nulled_but_the_payload_keeps_it(self):
        """A rejected value must not vanish from the record.

        The column stores ``None`` so no analysis consumes a bad reading; the
        raw payload still shows what the scale actually reported, which is what
        a later "was this a bad measurement or a bad device?" question needs.
        """
        grp = _measuregrp([(1, 7463, -2), (88, 20, -2)])  # bone mass 0.20 kg

        grouped = group_measurements([grp])

        assert grouped[0]["weight_kilogram"] == pytest.approx(74.63)
        assert grouped[0]["bone_mass_kg"] is None  # below the 0.5 kg floor
        assert grouped[0]["raw"] is grp


class TestBmiDerivation:
    def test_height_is_requested_so_bmi_can_actually_fire(self):
        """The BMI branch reads type 4, but ``meastypes`` filters the response.

        Before this change type 4 was never requested, so the branch could not
        execute: the API removed height before ``group_measurements`` saw it.
        """
        assert 4 in _requested_types()

    def test_bmi_derived_when_height_arrives_with_the_weighing(self):
        grp = _measuregrp([(1, 7463, -2), (4, 178, -2)])

        grouped = group_measurements([grp])

        assert grouped[0]["bmi"] == pytest.approx(74.63 / (1.78**2), rel=1e-6)


class TestRequestedSuperset:
    def test_asks_for_the_scale_capable_types(self):
        """Widening the request is free: getmeas returns only what exists."""
        assert {5, 6, 8, 11, 76, 77, 88, 170} <= _requested_types()

    def test_asks_for_the_types_a_body_comp_or_scan_can_produce(self):
        assert {91, 155, 226, 227} <= _requested_types()

    def test_does_not_ask_for_urinary_or_glucose_types(self):
        """U-Scan and glucose pens are out of scope; asking for their types
        would suggest the app models them."""
        assert not {119, 147, 148, 204, 205, 248, 249, 251} & _requested_types()


def _requested_types() -> set[int]:
    return {int(t) for t in WITHINGS_MEASTYPES.split(",") if t.strip()}
