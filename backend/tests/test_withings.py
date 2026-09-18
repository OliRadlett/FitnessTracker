"""Tests for Withings body-composition sync — pure helpers (no DB)."""

from app.integrations.withings_client import withings_client
from app.services.withings import (
    RANGE_VALIDATORS,
    decode_measure_value,
    group_measurements,
)


def _grp(grpid, ts, measures, category=1):
    return {
        "grpid": grpid,
        "date": ts,
        "created": ts,
        "category": category,
        "measures": measures,
    }


def _m(value, type_, unit):
    return {"value": value, "type": type_, "unit": unit}


class TestDecodeMeasureValue:
    def test_weight_decoding(self):
        # 7463 * 10^-2 = 74.63 kg
        assert decode_measure_value(7463, -2) == 74.63

    def test_percent_decoding(self):
        # 185 * 10^-1 = 18.5%
        assert decode_measure_value(185, -1) == 18.5

    def test_positive_unit(self):
        assert decode_measure_value(75, 0) == 75.0


class TestGroupMeasurements:
    def test_single_weighing_groups_all_types(self):
        ts = 1726444800  # 2024-09-16 UTC
        groups = group_measurements(
            [
                _grp(
                    1,
                    ts,
                    [
                        _m(7463, 1, -2),  # weight 74.63kg
                        _m(185, 6, -1),  # fat 18.5%
                        _m(5800, 76, -2),  # muscle 58.00kg
                        _m(620, 77, -1),  # hydration 62.0%
                        _m(320, 88, -2),  # bone 3.20kg
                        _m(7, 170, 0),  # visceral fat 7
                        _m(1380, 8, -2),  # fat mass 13.80kg
                        _m(6083, 5, -2),  # lean mass 60.83kg
                    ],
                )
            ]
        )
        assert len(groups) == 1
        g = groups[0]
        assert g["weight_kilogram"] == 74.63
        assert g["body_fat_percent"] == 18.5
        assert g["muscle_mass_kg"] == 58.0
        assert g["hydration_percent"] == 62.0
        assert g["bone_mass_kg"] == 3.2
        assert g["visceral_fat_index"] == 7
        assert g["fat_mass_kg"] == 13.8
        assert g["lean_mass_kg"] == 60.83
        assert g["date"].isoformat() == "2024-09-16"

    def test_category_2_goals_skipped(self):
        groups = group_measurements(
            [_grp(1, 1726444800, [_m(7000, 1, -2)], category=2)]
        )
        assert groups == []

    def test_weight_only_scale_still_syncs(self):
        groups = group_measurements([_grp(1, 1726444800, [_m(8000, 1, -2)])])
        assert len(groups) == 1
        assert groups[0]["weight_kilogram"] == 80.0
        assert groups[0].get("body_fat_percent") is None

    def test_out_of_range_weight_drops_group(self):
        groups = group_measurements([_grp(1, 1726444800, [_m(50000, 1, -2)])])
        assert groups == []

    def test_out_of_range_composition_becomes_none(self):
        # Body fat 95% is impossible — weight must survive, fat → None.
        groups = group_measurements(
            [_grp(1, 1726444800, [_m(7463, 1, -2), _m(950, 6, -1)])]
        )
        assert len(groups) == 1
        assert groups[0]["weight_kilogram"] == 74.63
        assert groups[0]["body_fat_percent"] is None

    def test_bmi_derived_from_same_group_height(self):
        # Height 180cm (type 4, unit -2 → 1.80m) + 74.63kg → BMI ≈ 23.0
        groups = group_measurements(
            [_grp(1, 1726444800, [_m(7463, 1, -2), _m(180, 4, -2)])]
        )
        assert len(groups) == 1
        assert groups[0]["bmi"] == 74.63 / (1.80 * 1.80)

    def test_multiple_weigh_ins_sorted_by_timestamp(self):
        groups = group_measurements(
            [
                _grp(2, 1726448400, [_m(7500, 1, -2)]),
                _grp(1, 1726444800, [_m(7463, 1, -2)]),
            ]
        )
        assert [g["timestamp"] for g in groups] == [1726444800, 1726448400]

    def test_group_without_weight_skipped(self):
        # Composition-only group (no type 1) has no row key — dropped.
        groups = group_measurements([_grp(1, 1726444800, [_m(185, 6, -1)])])
        assert groups == []


class TestRangeValidators:
    def test_all_expected_fields_have_bounds(self):
        for field in (
            "weight_kilogram",
            "body_fat_percent",
            "fat_mass_kg",
            "lean_mass_kg",
            "muscle_mass_kg",
            "bone_mass_kg",
            "hydration_percent",
            "visceral_fat_index",
            "bmi",
        ):
            assert field in RANGE_VALIDATORS
            lo, hi = RANGE_VALIDATORS[field]
            assert lo < hi


class TestWeightDedupPriority:
    def test_withings_beats_whoop_and_manual(self):
        from app.api.metrics import _dedup_weight_logs

        class _Log:
            def __init__(self, source, weight):
                from datetime import date as _date

                self.source = source
                self.weight_kilogram = weight
                self.date = _date(2024, 9, 16)

        deduped = _dedup_weight_logs(
            [_Log("manual", 75.0), _Log("whoop", 74.8), _Log("withings", 74.63)]
        )
        assert len(deduped) == 1
        assert deduped[0].source == "withings"

    def test_whoop_beats_manual(self):
        from app.api.metrics import _dedup_weight_logs

        class _Log:
            def __init__(self, source, weight):
                from datetime import date as _date

                self.source = source
                self.weight_kilogram = weight
                self.date = _date(2024, 9, 16)

        deduped = _dedup_weight_logs([_Log("manual", 75.0), _Log("whoop", 74.8)])
        assert deduped[0].source == "whoop"


class TestNormalizeTokenResponse:
    """Regression test: the oauth2 endpoint nests tokens under ``body``.

    Without flattening, the callback sees no top-level ``access_token``
    and fails with 'token exchange failed' despite HTTP 200.
    """

    def test_nested_body_flattened(self):
        raw = {
            "status": 0,
            "body": {
                "access_token": "tok",
                "refresh_token": "ref",
                "expires_in": 10800,
                "userid": "12345",
            },
        }
        flat = withings_client.normalize_token_response(raw)
        assert flat["access_token"] == "tok"
        assert flat["refresh_token"] == "ref"
        assert flat["expires_in"] == 10800
        assert flat["userid"] == "12345"

    def test_top_level_passthrough(self):
        raw = {"access_token": "tok", "userid": "12345"}
        assert withings_client.normalize_token_response(raw) == raw

    def test_error_payload_untouched(self):
        raw = {"status": 286, "error": "Invalid code"}
        assert withings_client.normalize_token_response(raw) == raw
