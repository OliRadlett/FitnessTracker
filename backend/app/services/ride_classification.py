"""Deterministic ride-type classification from cached power metrics.

Unlike strength sessions, a ride's energy-system type is *measurable* — the
intensity factor (normalized power ÷ FTP) says it — so this is deterministic and
Jev is not involved. A ride with no power gets ``None`` rather than a guess; the
Jev ``purpose`` tag is the separate, semantic axis (declared intent).
"""

from __future__ import annotations

# IF bands, upper-bound exclusive (Coggan-style). Below 0.55 is recovery; the
# gaps map to the next band's floor.
_IF_BANDS: tuple[tuple[float, str], ...] = (
    (0.55, "recovery"),
    (0.75, "endurance"),
    (0.88, "tempo"),
    (1.05, "threshold"),
)
_VO2MAX = "vo2max"

# A threshold-band IF on a ride this short reads as an interval session.
_SHORT_RIDE_SECONDS = 20 * 60


def classify_ride_type(
    intensity_factor: float | None,
    *,
    duration_seconds: int | None = None,
) -> str | None:
    """Pure: energy-system label from IF, or None without power.

    ``duration_seconds`` only nudges the threshold band: a short, very hard ride
    (IF ≥ 0.88 under 20 min) is ``vo2max``, not a sustained threshold ride.
    """
    if intensity_factor is None or intensity_factor <= 0:
        return None
    if intensity_factor >= 1.05:
        return _VO2MAX
    band = next(
        (label for upper, label in _IF_BANDS if intensity_factor < upper),
        "threshold",
    )
    if (
        band == "threshold"
        and duration_seconds is not None
        and duration_seconds < _SHORT_RIDE_SECONDS
    ):
        return _VO2MAX
    return band


def ride_type_from_context(
    context: dict | None, duration_seconds: int | None = None
) -> str | None:
    """Classify from the cached ``Activity.context['ride']`` block, or None."""
    ride = (context or {}).get("ride")
    if not isinstance(ride, dict):
        return None
    return classify_ride_type(
        ride.get("intensity_factor"), duration_seconds=duration_seconds
    )
