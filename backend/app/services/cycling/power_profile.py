"""Static cycling power-profile W/kg norms (Coggan-style power profile).

Approximate best-effort power (W/kg) by percentile and duration, based on
Andrew Coggan's cycling power profile chart. Values are population norms for
male riders; treat as rough reference bands rather than precise targets.
"""

# duration_seconds -> {percentile: wkg}
POWER_PROFILE_WKG: dict[int, dict[int, float]] = {
    5: {25: 8.0, 50: 10.0, 75: 11.5, 90: 13.0},
    60: {25: 5.6, 50: 6.8, 75: 7.9, 90: 9.0},
    300: {25: 3.4, 50: 4.0, 75: 4.7, 90: 5.5},
    1200: {25: 2.9, 50: 3.3, 75: 3.8, 90: 4.3},
    3600: {25: 2.5, 50: 3.0, 75: 3.5, 90: 4.0},
}

PERCENTILES = [25, 50, 75, 90]

PROFILE_DURATIONS = sorted(POWER_PROFILE_WKG.keys())


def percentile_wkg_at(duration_seconds: int, percentile: int) -> float:
    """Best-effort W/kg at a given duration for a percentile.

    Linearly interpolates between the nearest tabulated durations.
    """
    table = POWER_PROFILE_WKG
    durations = PROFILE_DURATIONS
    if duration_seconds <= durations[0]:
        return table[durations[0]][percentile]
    if duration_seconds >= durations[-1]:
        return table[durations[-1]][percentile]

    lower = max(d for d in durations if d <= duration_seconds)
    upper = min(d for d in durations if d >= duration_seconds)
    if lower == upper:
        return table[lower][percentile]

    fraction = (duration_seconds - lower) / (upper - lower)
    lo_val = table[lower][percentile]
    hi_val = table[upper][percentile]
    return round(lo_val + (hi_val - lo_val) * fraction, 2)
