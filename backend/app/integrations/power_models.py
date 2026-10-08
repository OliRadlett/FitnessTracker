"""Power models — Modal-powered personalized training model fitting.

Provides critical power curve fitting (Morton 2004), personalized VO2max
estimation from maximal power via FRIEND (with a gated power-HR regression
fallback), and adaptive CTL/ATL time constant fitting from HRV recovery
patterns. All functions are pure-compute with no DB access — data flows in
via arguments, results via return values.

Requires ``MODAL_TOKEN_ID`` and ``MODAL_TOKEN_SECRET`` env vars.
"""

import logging
import math

logger = logging.getLogger(__name__)


def _modal_configured() -> bool:
    # Imported lazily so the Modal remote container can import this module
    # without app.config's dependencies (the worker decorates a module-global
    # function, so the whole module is imported inside the bare image).
    from app.config import get_settings

    settings = get_settings()
    return bool(settings.modal_token_id and settings.modal_token_secret)


# ── Critical Power Model (Morton 2004) ──────────────────────────────────────


def _morton_power_duration(t: float, cp: float, w_prime: float) -> float:
    """Morton 2004 (2-param): P(t) = W'/t + CP.

    The hyperbolic power-duration relationship. Kept as a fallback when
    the 3-param fit fails — note it diverges as t → 0, so it must NOT be
    evaluated at short durations (see the 3-param variant below).
    """
    if t <= 0:
        return 0.0
    return w_prime / t + cp


def _morton_3param_power_duration(
    t: float, cp: float, w_prime: float, p_max: float
) -> float:
    """Morton 3-param hyperbolic model with a finite max-power ceiling.

    P(t) = W' / (t + k) + CP, where k = W' / (Pmax - CP).

    P(0) = Pmax, P(∞) = CP. Unlike the 2-param form this stays bounded at
    short durations, so the fitted curve can be shown over the full 5s–120min
    range without the 3000W+ spike the 2-param model produces at 5s.
    Falls back to the 2-param form if Pmax <= CP (degenerate).
    """
    if t <= 0:
        return 0.0
    if p_max <= cp:
        return w_prime / t + cp
    k = w_prime / (p_max - cp)
    return w_prime / (t + k) + cp


def _morton_residuals(params: tuple, durations: list, powers: list) -> list:
    """Residuals for 2-param curve fitting: observed - predicted power."""
    cp, w_prime = params
    return [
        p - _morton_power_duration(t, cp, w_prime) for t, p in zip(durations, powers)
    ]


def _morton_3param_residuals(params: tuple, durations: list, powers: list) -> list:
    """Residuals for 3-param curve fitting: observed - predicted power."""
    cp, w_prime, p_max = params
    return [
        p - _morton_3param_power_duration(t, cp, w_prime, p_max)
        for t, p in zip(durations, powers)
    ]


def _levenberg_marquardt(
    f,
    x0: tuple,
    data_x: list,
    data_y: list,
    max_iter: int = 200,
    tol: float = 1e-6,
    lam0: float = 1e-3,
    constrain=None,
) -> tuple:
    """Simple Levenberg-Marquardt implementation for curve fitting.

    Minimizes sum of squared residuals. No numpy/scipy dependency.

    ``constrain`` is an optional callable ``(new_params) -> list`` applied
    to each trial step to enforce parameter bounds (e.g. Pmax > CP for the
    3-param model). Defaults to clamping every parameter to >= 1.0.
    """
    n_params = len(x0)
    n_data = len(data_x)
    params = list(x0)
    lam = lam0

    def _compute_jacobian(params, data_x):
        """Compute Jacobian matrix numerically."""
        eps = 1e-7
        jacobian = []
        for j in range(n_params):
            p_plus = params[:]
            p_minus = params[:]
            p_plus[j] += eps
            p_minus[j] -= eps
            f_plus = f(p_plus, data_x, data_y)
            f_minus = f(p_minus, data_x, data_y)
            col = [(fp - fm) / (2 * eps) for fp, fm in zip(f_plus, f_minus)]
            jacobian.append(col)
        return list(zip(*jacobian))  # transpose

    for _ in range(max_iter):
        residuals = f(params, data_x, data_y)
        cost = sum(r * r for r in residuals)

        jacobian = _compute_jacobian(params, data_x)

        # J^T J
        jtj = [[0.0] * n_params for _ in range(n_params)]
        jtr = [0.0] * n_params
        for i in range(n_data):
            for j in range(n_params):
                jtr[j] += jacobian[i][j] * residuals[i]
                for k in range(n_params):
                    jtj[j][k] += jacobian[i][j] * jacobian[i][k]

        # Damped normal equations: (J^T J + lambda * diag(J^T J)) * delta = -J^T r
        for j in range(n_params):
            jtj[j][j] += lam * (jtj[j][j] + 1e-10)

        # Solve via Gaussian elimination
        augmented = [row[:] + [-jtr[i]] for i, row in enumerate(jtj)]
        for i in range(n_params):
            # Find pivot
            max_row = i
            for k in range(i + 1, n_params):
                if abs(augmented[k][i]) > abs(augmented[max_row][i]):
                    max_row = k
            augmented[i], augmented[max_row] = augmented[max_row], augmented[i]

            if abs(augmented[i][i]) < 1e-15:
                break

            for k in range(i + 1, n_params):
                factor = augmented[k][i] / augmented[i][i]
                for j in range(i, n_params + 1):
                    augmented[k][j] -= factor * augmented[i][j]

        # Back-substitution
        delta = [0.0] * n_params
        for i in range(n_params - 1, -1, -1):
            delta[i] = augmented[i][n_params]
            for j in range(i + 1, n_params):
                delta[i] -= augmented[i][j] * delta[j]
            delta[i] /= augmented[i][i] if abs(augmented[i][i]) > 1e-15 else 1.0

        # Try the step
        new_params = [params[j] + delta[j] for j in range(n_params)]

        # Enforce parameter bounds
        if constrain is not None:
            new_params = constrain(new_params)
        else:
            new_params = [max(p, 1.0) for p in new_params]

        new_residuals = f(new_params, data_x, data_y)
        new_cost = sum(r * r for r in new_residuals)

        if new_cost < cost:
            # Accept step
            params = new_params
            if abs(cost - new_cost) / (cost + 1e-10) < tol:
                break
            lam *= 0.3
        else:
            # Reject step, increase damping
            lam *= 3.0
            if lam > 1e6:
                break

    return tuple(params)


def _constrain_3param(new_params: list) -> list:
    """Bounds for the 3-param fit: CP/W' positive, Pmax above CP.

    Keeps the optimizer inside physiologically plausible ranges so a noisy
    short-duration bucket can't push Pmax below CP or W' negative.
    """
    cp = max(new_params[0], 1.0)
    w_prime = min(max(new_params[1], 500.0), 100000.0)
    p_max = min(max(new_params[2], cp + 50.0), 3000.0)
    return [cp, w_prime, p_max]


def _fit_2param_fallback(dur_list: list, pow_list: list) -> dict | None:
    """2-param Morton fallback when the 3-param fit is unreasonable.

    Fits CP/W' to durations >= 60s only (as before) and deliberately omits
    the short-duration predictions that blow up — the returned curve starts
    at 60s so the chart never shows the 3000W+ spike.
    """
    data = [(d, p) for d, p in zip(dur_list, pow_list) if d >= 60]
    if len(data) < 2:
        return None
    d2 = [d for d, _ in data]
    p2 = [p for _, p in data]
    try:
        cp, w_prime = _levenberg_marquardt(
            _morton_residuals,
            (p2[-1], 20000.0),
            d2,
            p2,
        )
    except Exception as e:
        logger.warning(f"CP 2-param fallback failed: {e}")
        return None
    if cp < 50 or cp > 600:
        return None
    predicted = [_morton_power_duration(t, cp, w_prime) for t in d2]
    mean_power = sum(p2) / len(p2)
    ss_res = sum((p - pred) ** 2 for p, pred in zip(p2, predicted))
    ss_tot = sum((p - mean_power) ** 2 for p in p2)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    fitted_curve = {
        str(d): round(_morton_power_duration(d, cp, w_prime), 1)
        for d in [60, 120, 300, 600, 1200, 1800, 2700, 3600, 5400, 7200]
    }
    return {
        "cp": round(cp, 1),
        "w_prime": round(w_prime, 0),
        "p_max": None,
        "model_r_squared": round(max(0.0, r_squared), 4),
        "fitted_curve": fitted_curve,
        "method": "morton_2004",
        "data_points_used": len(data),
    }


def fit_critical_power(
    durations: list[int],
    powers: list[float],
    min_duration: int = 5,
) -> dict:
    """Fit a critical power model to power-duration data.

    Uses the Morton 3-param hyperbolic model with a max-power ceiling:
    P(t) = W' / (t + k) + CP, where k = W' / (Pmax - CP).
    P(0) = Pmax, P(∞) = CP, so the curve stays bounded at sprint durations
    instead of diverging like the 2-param P(t) = W'/t + CP form (which
    predicted 3000W+ at 5s when extrapolated from 60s+ data).

    Fits via Levenberg-Marquardt (no scipy dependency). Falls back to the
    2-param model (60s+ curve only) if the 3-param result is unreasonable.

    Parameters
    ----------
    durations:
        List of duration buckets in seconds (e.g. [5, 30, 300, 3600]).
    powers:
        Corresponding best power at each duration (watts).
    min_duration:
        Minimum duration to include in the fit. Defaults to 5s so sprint
        buckets anchor Pmax.

    Returns
    -------
    dict with cp, w_prime, p_max, model_r_squared, fitted_curve, method.
    """
    # Filter to valid data points
    data = [(d, p) for d, p in zip(durations, powers) if d >= min_duration and p > 0]

    if len(data) < 4:
        return {
            "cp": None,
            "w_prime": None,
            "p_max": None,
            "model_r_squared": 0.0,
            "fitted_curve": None,
            "method": "insufficient_data",
        }

    dur_list = [d for d, _ in data]
    pow_list = [p for _, p in data]

    # Initial guess: CP ≈ longest-duration power, W' ≈ 20000 J,
    # Pmax ≈ best short-duration power.
    cp_guess = pow_list[-1] if pow_list else 200.0
    w_prime_guess = 20000.0
    pmax_guess = max(pow_list)

    try:
        cp, w_prime, p_max = _levenberg_marquardt(
            _morton_3param_residuals,
            (cp_guess, w_prime_guess, pmax_guess),
            dur_list,
            pow_list,
            constrain=_constrain_3param,
        )
    except Exception as e:
        logger.warning(f"CP 3-param fitting failed: {e}")
        fallback = _fit_2param_fallback(dur_list, pow_list)
        if fallback is not None:
            return fallback
        return {
            "cp": None,
            "w_prime": None,
            "p_max": None,
            "model_r_squared": 0.0,
            "fitted_curve": None,
            "method": "fitting_failed",
        }

    # Sanity check: CP 50–600W, W' 1–100kJ, Pmax above CP and within reason.
    # Pmax must also roughly agree with the observed sprint best (within
    # -30%/+15%) so a stale 5s bucket can't drag the whole curve.
    observed_sprint = max(pow_list)
    pmax_ok = (
        p_max > cp + 50
        and 200 <= p_max <= 2500
        and observed_sprint * 0.7 <= p_max <= observed_sprint * 1.15 + 50
    )
    if not (50 <= cp <= 600 and 1000 <= w_prime <= 100000 and pmax_ok):
        fallback = _fit_2param_fallback(dur_list, pow_list)
        if fallback is not None:
            return fallback
        return {
            "cp": None,
            "w_prime": None,
            "p_max": None,
            "model_r_squared": 0.0,
            "fitted_curve": None,
            "method": "unreasonable_cp",
        }

    # Compute R² over all fitted points (including sprints)
    predicted = [_morton_3param_power_duration(t, cp, w_prime, p_max) for t in dur_list]
    mean_power = sum(pow_list) / len(pow_list)
    ss_res = sum((p - pred) ** 2 for p, pred in zip(pow_list, predicted))
    ss_tot = sum((p - mean_power) ** 2 for p in pow_list)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    # Generate fitted curve for all standard durations
    all_durations = [
        5,
        10,
        15,
        30,
        60,
        120,
        300,
        600,
        1200,
        1800,
        2700,
        3600,
        5400,
        7200,
    ]
    fitted_curve = {
        str(d): round(_morton_3param_power_duration(d, cp, w_prime, p_max), 1)
        for d in all_durations
    }

    return {
        "cp": round(cp, 1),
        "w_prime": round(w_prime, 0),
        "p_max": round(p_max, 0),
        "model_r_squared": round(max(0.0, r_squared), 4),
        "fitted_curve": fitted_curve,
        "method": "morton_3param",
        "data_points_used": len(data),
    }


# ── Personalized VO2max from Power-HR Regression ────────────────────────────

# Sample-size / quality gates for the personalized VO2max fit.
#
# The FRIEND equation is calibrated on MAXIMAL power, so the number must come
# from a maximal input (best ~5-min power, the same input the canonical
# ``estimate_vo2max`` service uses). Reading threshold power off the
# power-HR regression instead understated prod by ~25% (26.5 ml/kg/min at
# CP 229W / 90.4kg — a "Poor" label on a trained rider).
VO2_MAXIMAL_TARGET_S = 300
# Moderate-fit floor for the legacy threshold-regression fallback: below it
# the extrapolated threshold wattage is noise, so no number is stamped.
VO2_R2_MIN = 0.5


def _maximal_power_at(
    durations: list, best_watts: list, target: int = VO2_MAXIMAL_TARGET_S
) -> tuple[float | None, str | None]:
    """Best maximal power at ``target`` seconds from a power-duration curve.

    Returns ``(watts, source)`` where source is ``"exact:{t}s"`` for a direct
    bucket hit or ``"interpolated:{lo}-{hi}s"`` for a log-linear interpolation
    between bracketing buckets (power-duration is near-linear in log(t), so a
    straight linear interpolation in duration would bias the read). Returns
    ``(None, None)`` when the target cannot be read without extrapolating
    beyond the observed data — extrapolating a power-duration curve past its
    ends is exactly the failure the 3-param Morton fit exists to avoid.
    """
    pairs: list[tuple[float, float]] = []
    for t, p in zip(durations or [], best_watts or []):
        try:
            t_f, p_f = float(t), float(p)
        except (TypeError, ValueError):
            continue
        if t_f > 0 and p_f > 0:
            pairs.append((t_f, p_f))
    pairs.sort()
    if not pairs:
        return None, None
    for t, p in pairs:
        if t == float(target):
            return p, f"exact:{int(target)}s"
    below = [(t, p) for t, p in pairs if t < target]
    above = [(t, p) for t, p in pairs if t > target]
    if not below or not above:
        return None, None
    lo_t, lo_p = below[-1]
    hi_t, hi_p = above[0]
    frac = (math.log(target) - math.log(lo_t)) / (math.log(hi_t) - math.log(lo_t))
    interp = lo_p + (hi_p - lo_p) * frac
    return round(interp, 1), f"interpolated:{int(lo_t)}-{int(hi_t)}s"


def _friend_vo2max_maximal(power_watts: float, weight_kg: float | None) -> float | None:
    """FRIEND-ergometry VO2max from a MAXIMAL power (ml/kg/min).

    VO2 = 10.649 × W/kg + 3.5 (Nes et al. 2018, PMID 29692203). Deliberately
    duplicated from ``app.services.cycling.vo2max._friend_vo2max`` rather than
    imported: this module is mounted into the bare Modal image, where any
    ``app.services`` import would drag SQLAlchemy along (pitfalls 16/17).
    Keep the two formulas identical; the service is canonical.
    """
    weight = weight_kg if weight_kg and weight_kg > 0 else 75.0
    vo2 = 10.649 * power_watts / weight + 3.5
    if vo2 < 20 or vo2 > 90:
        return None
    return round(vo2, 1)


def fit_personalized_vo2max(
    steady_state_rides: list[dict],
    weight_kg: float | None = None,
    hr_anchor: float | None = None,
    durations: list | None = None,
    best_watts: list | None = None,
) -> dict:
    """Fit personalized VO2max, preferring a maximal power input.

    Primary path (``friend_maximal_power``): FRIEND applied to the best ~5-min
    power read from the power-duration curve — the same maximal input the
    canonical ``estimate_vo2max`` service uses. FRIEND is calibrated on
    maximal power; feeding it regression-extrapolated *threshold* power
    understated prod by ~25%, so the threshold read is no longer used for
    the number.

    Fallback path (``power_hr_regression``): when no maximal power is
    readable (curve too short to bracket 300s), the legacy power-HR
    regression at LTHR (else 170 bpm) still runs — but now gated on
    ``VO2_R2_MIN``: a weak regression stamps nothing (``weak_regression_gated``)
    instead of a noise number.

    Parameters
    ----------
    steady_state_rides:
        [{avg_watts, avg_hr, duration_seconds}] — only includes
        steady-state efforts (>20min, CV of power < 15%).
    weight_kg:
        User weight for W/kg normalization.
    hr_anchor:
        Heart rate at which to read power off the regression line. Uses the
        user's LTHR when supplied (valid 100–210 bpm); otherwise falls back
        to 170. A fixed 170 for everyone biases the estimate for riders
        whose threshold sits well above or below it.
    durations / best_watts:
        Power-duration curve ({durations, best_watts} as passed to the CP
        fit). Supplies the maximal input; when absent or too short to read
        300s, the gated regression fallback applies.

    Returns
    -------
    dict with vo2max, method, r_squared, regression_slope,
    regression_intercept, hr_threshold_used, data_points_used,
    maximal_power_watts, maximal_power_source.
    """
    # Filter to valid steady-state data
    valid = [
        r
        for r in steady_state_rides
        if r.get("avg_watts")
        and r.get("avg_hr")
        and r["avg_watts"] > 0
        and r["avg_hr"] > 0
    ]

    if len(valid) < 3:
        return {
            "vo2max": None,
            "method": "insufficient_data",
            "r_squared": None,
            "data_points_used": len(valid),
            "maximal_power_watts": None,
            "maximal_power_source": None,
        }

    # Use W/kg if weight available, otherwise raw watts
    if weight_kg and weight_kg > 0:
        x = [r["avg_watts"] / weight_kg for r in valid]  # W/kg
        y = [r["avg_hr"] for r in valid]  # HR
    else:
        x = [r["avg_watts"] for r in valid]
        y = [r["avg_hr"] for r in valid]

    # Linear regression: HR = slope * power + intercept
    n = len(x)
    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(xi * yi for xi, yi in zip(x, y))
    sum_xx = sum(xi * xi for xi in x)

    denom = n * sum_xx - sum_x * sum_x
    if abs(denom) < 1e-10:
        return {
            "vo2max": None,
            "method": "degenerate_data",
            "r_squared": None,
            "data_points_used": n,
            "maximal_power_watts": None,
            "maximal_power_source": None,
        }

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R²
    mean_y = sum_y / n
    ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, y))
    ss_tot = sum((yi - mean_y) ** 2 for yi in y)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    r_squared = round(max(0.0, r_squared), 4)

    # Anchor for the threshold read (legacy fallback only).
    if hr_anchor is not None and 100 <= hr_anchor <= 210:
        hr_threshold = float(hr_anchor)
    else:
        hr_threshold = 170.0  # typical threshold HR for estimation

    # Primary path: FRIEND on a maximal input. The power-duration curve is
    # measured bests, so the 300s read is the rider's maximal 5-min power —
    # the input FRIEND is calibrated on. This does not touch the regression
    # above, so its result is independent of regression quality; the
    # regression diagnostics are still reported for transparency.
    maximal_power_watts, maximal_power_source = _maximal_power_at(
        durations, best_watts
    )
    if maximal_power_watts:
        vo2max = _friend_vo2max_maximal(maximal_power_watts, weight_kg)
        return {
            "vo2max": vo2max,
            "method": "friend_maximal_power",
            "r_squared": r_squared,
            "regression_slope": round(slope, 6),
            "regression_intercept": round(intercept, 2),
            "hr_threshold_used": hr_threshold,
            "data_points_used": n,
            "maximal_power_watts": maximal_power_watts,
            "maximal_power_source": maximal_power_source,
        }

    # Fallback path: legacy threshold-power read, now gated. Without a
    # maximal input the only estimate is the regression extrapolation, and a
    # weak regression's threshold wattage is noise — stamp nothing.
    if r_squared < VO2_R2_MIN or slope <= 0:
        return {
            "vo2max": None,
            "method": "weak_regression_gated",
            "r_squared": r_squared,
            "regression_slope": round(slope, 6),
            "regression_intercept": round(intercept, 2),
            "hr_threshold_used": hr_threshold,
            "data_points_used": n,
            "maximal_power_watts": None,
            "maximal_power_source": None,
        }

    # Estimate VO2max using the FRIEND equation:
    # VO2 = 10.649 * W/kg + 3.5
    # (1.74 × 6.12 = 10.649; Nes et al. 2018, PMID 29692203 — >4× lower error
    # than the traditional ACSM 11.016×W/kg+7.)
    # Read power off the regression line at the user's threshold HR
    # (their LTHR when known, else the 170 bpm population fallback), then
    # apply FRIEND.
    power_at_threshold = (hr_threshold - intercept) / slope
    if weight_kg and weight_kg > 0:
        vo2max = 10.649 * power_at_threshold + 3.5
    else:
        # Without weight, assume 75kg
        vo2max = 10.649 * power_at_threshold / 75.0 + 3.5

    if vo2max and (vo2max < 20 or vo2max > 90):
        vo2max = None

    return {
        "vo2max": round(vo2max, 1) if vo2max else None,
        "method": "power_hr_regression",
        "r_squared": r_squared,
        "regression_slope": round(slope, 6),
        "regression_intercept": round(intercept, 2),
        "hr_threshold_used": hr_threshold,
        "data_points_used": n,
        "maximal_power_watts": None,
        "maximal_power_source": None,
    }


# ── Adaptive CTL/ATL Time Constants ─────────────────────────────────────────


def adaptive_taus_to_persist(
    constants: dict,
) -> tuple[int | None, int | None] | None:
    """Decide which adaptive CTL/ATL taus to persist from a fit result.

    Returns ``(ctl_tau, atl_tau)`` to store, or ``None`` to leave the stored
    values unchanged:

    - successful fit → the fitted values;
    - a real run that could not personalise (insufficient data/overlap) →
      ``(None, None)``, so the canonical 42/7 defaults are not later reported
      as a personalized ``hrv_recovery_fit``;
    - no/unknown result (transient failure, circuit breaker) → ``None`` (keep
      any previously fitted values).
    """
    method = (constants or {}).get("method")
    if method == "hrv_recovery_fit":
        return (constants.get("ctl_tau"), constants.get("atl_tau"))
    if method in ("insufficient_data", "insufficient_overlap"):
        return (None, None)
    return None


def fit_adaptive_time_constants(
    daily_tss: list[dict],
    hrv_data: list[dict],
    ctl_range: tuple[int, int] = (21, 63),
    atl_range: tuple[int, int] = (3, 14),
) -> dict:
    """Fit personalized CTL/ATL time constants using HRV recovery patterns.

    The idea: after a hard session (high TSS), HRV should drop and then
    recover. The rate of recovery indicates the appropriate ATL time constant.
    Similarly, the long-term HRV trend aligns with CTL.

    Parameters
    ----------
    daily_tss:
        [{date: str, tss: float}]
    hrv_data:
        [{date: str, hrv_ms: float}]
    ctl_range:
        (min, max) days to search for CTL time constant.
    atl_range:
        (min, max) days to search for ATL time constant.

    Returns
    -------
    dict with ctl_tau, atl_tau, improvement_pct, method.
    """
    if len(daily_tss) < 30 or len(hrv_data) < 30:
        return {
            "ctl_tau": 42,
            "atl_tau": 7,
            "improvement_pct": 0.0,
            "method": "insufficient_data",
        }

    # Convert to lookup dicts
    tss_by_date = {d["date"]: d["tss"] for d in daily_tss}
    hrv_by_date = {d["date"]: d["hrv_ms"] for d in hrv_data if d.get("hrv_ms")}

    # Find common dates
    common_dates = sorted(set(tss_by_date.keys()) & set(hrv_by_date.keys()))
    if len(common_dates) < 30:
        return {
            "ctl_tau": 42,
            "atl_tau": 7,
            "improvement_pct": 0.0,
            "method": "insufficient_overlap",
        }

    # Grid search over (ctl_tau, atl_tau) pairs
    best_score = float("inf")
    best_ctl = 42
    best_atl = 7

    for ctl_d in range(ctl_range[0], ctl_range[1] + 1, 3):
        for atl_d in range(atl_range[0], atl_range[1] + 1):
            ctl_decay = 1 - math.exp(-1 / ctl_d)
            atl_decay = 1 - math.exp(-1 / atl_d)

            ctl = 0.0
            atl = 0.0
            predictions = []

            for date in common_dates:
                tss = tss_by_date.get(date, 0.0)
                ctl = ctl + (tss - ctl) * ctl_decay
                atl = atl + (tss - atl) * atl_decay
                tsb = ctl - atl

                # TSB should predict HRV recovery (higher TSB = higher HRV)
                hrv = hrv_by_date[date]
                predictions.append((tsb, hrv))

            # Score: correlation between TSB and HRV
            if len(predictions) < 10:
                continue

            tsb_vals = [p[0] for p in predictions]
            hrv_vals = [p[1] for p in predictions]

            mean_tsb = sum(tsb_vals) / len(tsb_vals)
            mean_hrv = sum(hrv_vals) / len(hrv_vals)

            cov = sum(
                (t - mean_tsb) * (h - mean_hrv) for t, h in zip(tsb_vals, hrv_vals)
            )
            std_tsb = math.sqrt(sum((t - mean_tsb) ** 2 for t in tsb_vals))
            std_hrv = math.sqrt(sum((h - mean_hrv) ** 2 for h in hrv_vals))

            if std_tsb > 0 and std_hrv > 0:
                correlation = cov / (std_tsb * std_hrv)
                # We want to maximize correlation, so minimize negative correlation
                score = -correlation

                if score < best_score:
                    best_score = score
                    best_ctl = ctl_d
                    best_atl = atl_d

    # No grid point produced a valid correlation (e.g. constant HRV makes
    # every std zero). Report defaults rather than -inf correlation.
    if best_score == float("inf"):
        return {
            "ctl_tau": 42,
            "atl_tau": 7,
            "improvement_pct": None,
            "correlation": 0.0,
            "method": "no_valid_fit",
            "data_points_used": len(common_dates),
        }

    # Compute improvement over defaults
    default_ctl_decay = 1 - math.exp(-1 / 42)
    default_atl_decay = 1 - math.exp(-1 / 7)

    # Re-run with defaults to compare
    ctl = 0.0
    atl = 0.0
    default_predictions = []
    for date in common_dates:
        tss = tss_by_date.get(date, 0.0)
        ctl = ctl + (tss - ctl) * default_ctl_decay
        atl = atl + (tss - atl) * default_atl_decay
        tsb = ctl - atl
        default_predictions.append((tsb, hrv_by_date[date]))

    if default_predictions:
        tsb_v = [p[0] for p in default_predictions]
        hrv_v = [p[1] for p in default_predictions]
        m_tsb = sum(tsb_v) / len(tsb_v)
        m_hrv = sum(hrv_v) / len(hrv_v)
        c_default = sum((t - m_tsb) * (h - m_hrv) for t, h in zip(tsb_v, hrv_v))
        s_tsb = math.sqrt(sum((t - m_tsb) ** 2 for t in tsb_v))
        s_hrv = math.sqrt(sum((h - m_hrv) ** 2 for h in hrv_v))
        corr_default = c_default / (s_tsb * s_hrv) if s_tsb > 0 and s_hrv > 0 else 0

        # A % improvement over a ~zero baseline is undefined (dividing by
        # ~1e-10 prints astronomical nonsense like 3e9%). Report None unless
        # the default taus actually correlate with HRV.
        if abs(corr_default) < 0.05:
            improvement = None
        else:
            improvement = ((-best_score) - corr_default) / abs(corr_default) * 100
    else:
        improvement = 0.0

    return {
        "ctl_tau": best_ctl,
        "atl_tau": best_atl,
        "improvement_pct": round(improvement, 1) if improvement is not None else None,
        "correlation": round(-best_score, 4),
        "method": "hrv_recovery_fit",
        "data_points_used": len(common_dates),
    }


# ── Modal remote worker (module scope — Modal rejects closures) ───────────────


def _fit_power_models_modal(
    pc_json: str,
    ss_json: str,
    tss_json: str,
    hrv_json: str,
    weight: float | None,
    hr_anchor: float | None = None,
) -> dict:
    """Modal remote worker for power model fitting.

    Must stay at module global scope: Modal raises ``InvalidError`` for
    functions defined inside other functions. All inputs arrive as explicit
    arguments (JSON strings + scalars); pure-compute helpers are module globals.
    ``hr_anchor`` is appended (not packed into JSON) so older scheduled calls
    passing 5 positional args keep working.
    """
    import json as _json

    pc_data = _json.loads(pc_json)
    ss_data = _json.loads(ss_json) if ss_json else None
    tss_data = _json.loads(tss_json) if tss_json else None
    hrv = _json.loads(hrv_json) if hrv_json else None

    result: dict = {}

    # Critical power fitting
    durations = pc_data.get("durations", [])
    powers = pc_data.get("best_watts", [])
    if durations and powers:
        result["critical_power"] = fit_critical_power(durations, powers)
    else:
        result["critical_power"] = {
            "cp": None,
            "w_prime": None,
            "p_max": None,
            "method": "no_data",
        }

    # Personalized VO2max. The power-duration curve doubles as the maximal
    # input: best ~5-min power is read inside the fitter (exact bucket or
    # log-linear interpolation, never extrapolation), so FRIEND gets the
    # maximal power it is calibrated on.
    if ss_data and len(ss_data) >= 3:
        result["personalized_vo2max"] = fit_personalized_vo2max(
            ss_data, weight, hr_anchor, durations, powers
        )
    else:
        result["personalized_vo2max"] = {"vo2max": None, "method": "insufficient_data"}

    # Adaptive time constants
    if tss_data and hrv and len(tss_data) >= 30 and len(hrv) >= 30:
        result["adaptive_constants"] = fit_adaptive_time_constants(tss_data, hrv)
    else:
        result["adaptive_constants"] = {
            "ctl_tau": 42,
            "atl_tau": 7,
            "method": "insufficient_data",
        }

    return result


# ── Public API (called from Celery tasks) ────────────────────────────────────


def fit_power_models_on_modal(
    power_curve_data: dict,
    steady_state_rides: list[dict] | None = None,
    daily_tss: list[dict] | None = None,
    hrv_data: list[dict] | None = None,
    weight_kg: float | None = None,
    hr_anchor: float | None = None,
) -> dict:
    """Dispatch power model fitting to Modal and return results.

    Parameters
    ----------
    power_curve_data:
        {durations: [5, 30, 300, ...], best_watts: [800, 500, 350, ...]}
    steady_state_rides:
        [{avg_watts, avg_hr, duration_seconds}] for VO2max fitting.
    daily_tss:
        [{date, tss}] for adaptive time constant fitting.
    hrv_data:
        [{date, hrv_ms}] for adaptive time constant fitting.
    weight_kg:
        User weight for W/kg normalization.
    hr_anchor:
        User's LTHR (bpm) anchoring the VO2max power-HR extrapolation;
        falls back to 170 inside the worker when absent/invalid.

    Returns
    -------
    dict with critical_power, personalized_vo2max, adaptive_constants.
    """
    import json as _json

    if not _modal_configured():
        raise RuntimeError(
            "Modal is not configured — set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET"
        )

    import modal

    image = modal.Image.debian_slim(python_version="3.12").pip_install("numpy")

    app = modal.App("fittrack-power-models", image=image)

    # Decorate the module-global worker (Modal rejects closures defined here).
    remote_fit = app.function(timeout=300, memory=1024)(_fit_power_models_modal)

    # Serialize inputs
    pc_json = _json.dumps(power_curve_data)
    ss_json = _json.dumps(steady_state_rides or [])
    tss_json = _json.dumps(daily_tss or [])
    hrv_json = _json.dumps(hrv_data or [])

    with app.run():
        return remote_fit.remote(
            pc_json, ss_json, tss_json, hrv_json, weight_kg, hr_anchor
        )
