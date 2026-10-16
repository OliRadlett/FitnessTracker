"""Guards for numeric request fields that feed a division.

A float field a caller can set to zero becomes a ZeroDivisionError the moment it
reaches an estimator. The body schema bounds the field so the API answers 422,
and the estimator guards it so a direct call cannot crash either.
"""

from types import SimpleNamespace

import pytest
from pydantic import ValidationError

from app.schemas.route import EffortEstimateRequest
from app.services.effort_estimator import estimate_required_power

ZERO_RESULT = {"power_watts": 0, "speed_kmh": 0, "wpk": 0, "ftp_pct": 0}


def _route():
    return SimpleNamespace(
        distance_meters=1000.0, elevation_gain_meters=100.0, surface_profile=None
    )


@pytest.mark.parametrize("field", ["weight_kg", "ftp_watts"])
@pytest.mark.parametrize("value", [0, -1, -75.0])
def test_effort_request_rejects_non_positive(field, value):
    body = {"ftp_watts": 250.0, "weight_kg": 75.0}
    body[field] = value
    with pytest.raises(ValidationError):
        EffortEstimateRequest(**body)


def test_effort_request_accepts_positive_values():
    body = EffortEstimateRequest(ftp_watts=250.0, weight_kg=75.0)
    assert body.weight_kg == 75.0


@pytest.mark.parametrize("weight_kg", [0, -1, -75.0])
def test_estimate_required_power_guards_non_positive_weight(weight_kg):
    assert estimate_required_power(_route(), 250.0, weight_kg) == ZERO_RESULT


def test_estimate_required_power_guards_non_positive_ftp():
    assert estimate_required_power(_route(), 0, 75.0) == ZERO_RESULT
