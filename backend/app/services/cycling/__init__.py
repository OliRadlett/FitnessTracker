"""Cycling analysis service — TSS calculation, CTL/ATL/TSB, power curve from streams, zones."""

# Re-export everything for backward compatibility.
# Existing imports like `from app.services.cycling import compute_training_load` continue to work.

from app.services.cycling.power_curve import (
    _POWER_CURVE_CACHE_TTL_SEC,
    POWER_DURATION_BUCKETS,
    FtpEstimateResult,
    _power_curve_cache,
    _riegel_extrapolate,
    backfill_ftp_estimates,
    compute_power_curve_from_streams,
    estimate_ftp_from_power_curve,
    estimate_ftp_from_power_curve_detailed,
)
from app.services.cycling.power_profile import (
    POWER_PROFILE_WKG,
    percentile_wkg_at,
)
from app.services.cycling.training_load import (
    ATL_DAYS,
    CTL_DAYS,
    RANGE_LABELS,
    TYPICAL_RANGES,
    classify_metric,
    compute_training_load,
    get_metric_benchmark,
    get_or_create_cycling_profile,
)
from app.services.cycling.tss import (
    auto_compute_tss_for_activity,
    calculate_hr_tss,
    calculate_intensity_factor,
    calculate_power_tss,
    calculate_vam,
    calculate_variability_index,
    compute_normalized_power,
    get_daily_tss,
)
from app.services.cycling.vo2max import (
    DecouplingResult,
    Vo2maxEstimate,
    _classify_decoupling,
    _classify_vo2max,
    compute_decoupling_for_activity,
    compute_decoupling_from_streams,
    compute_decoupling_history,
    compute_vo2max_history,
    estimate_vo2max,
)
from app.services.cycling.zones import (
    HR_ZONES,
    LTHR_HR_ZONES,
    POWER_ZONES,
    compute_hr_zones_from_lthr,
    compute_hr_zones_from_streams,
    compute_power_zones_from_streams,
)
