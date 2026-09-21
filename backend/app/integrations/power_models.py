"""Power models — Modal-powered personalized training model fitting.

Provides critical power curve fitting (Morton 2004), personalized VO2max
estimation from power-HR regression, and adaptive CTL/ATL time constant
fitting from HRV recovery patterns. All functions are pure-compute with
no DB access — data flows in via arguments, results via return values.

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
    """Morton 2004: P(t) = W'/t + CP.

    The hyperbolic power-duration relationship.
    """
    if t <= 0:
        return 0.0
    return w_prime / t + cp


def _morton_residuals(params: tuple, durations: list, powers: list) -> list:
    """Residuals for curve fitting: observed - predicted power."""
    cp, w_prime = params
    return [
        p - _morton_power_duration(t, cp, w_prime)
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
) -> tuple:
    """Simple Levenberg-Marquardt implementation for curve fitting.

    Minimizes sum of squared residuals. No numpy/scipy dependency.
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

        # Ensure positive parameters
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


def fit_critical_power(
    durations: list[int],
    powers: list[float],
    min_duration: int = 60,
) -> dict:
    """Fit a critical power model to power-duration data.

    Uses the Morton 2004 hyperbolic model: P(t) = W'/t + CP.
    Fits via Levenberg-Marquardt (no scipy dependency).

    Parameters
    ----------
    durations:
        List of duration buckets in seconds (e.g. [5, 30, 300, 3600]).
    powers:
        Corresponding best power at each duration (watts).
    min_duration:
        Minimum duration to include in the fit (short anaerobic efforts
        can skew the model).

    Returns
    -------
    dict with cp, w_prime, model_r_squared, fitted_curve, method.
    """
    # Filter to valid data points
    data = [(d, p) for d, p in zip(durations, powers) if d >= min_duration and p > 0]

    if len(data) < 2:
        return {
            "cp": None,
            "w_prime": None,
            "model_r_squared": 0.0,
            "fitted_curve": None,
            "method": "insufficient_data",
        }

    dur_list = [d for d, _ in data]
    pow_list = [p for _, p in data]

    # Initial guess: CP ≈ best 60-min power, W' ≈ 20000 J
    cp_guess = pow_list[-1] if pow_list else 200.0
    w_prime_guess = 20000.0

    try:
        cp, w_prime = _levenberg_marquardt(
            _morton_residuals,
            (cp_guess, w_prime_guess),
            dur_list,
            pow_list,
        )
    except Exception as e:
        logger.warning(f"CP fitting failed: {e}")
        return {
            "cp": None,
            "w_prime": None,
            "model_r_squared": 0.0,
            "fitted_curve": None,
            "method": "fitting_failed",
        }

    # Compute R²
    predicted = [_morton_power_duration(t, cp, w_prime) for t in dur_list]
    mean_power = sum(pow_list) / len(pow_list)
    ss_res = sum((p - pred) ** 2 for p, pred in zip(pow_list, predicted))
    ss_tot = sum((p - mean_power) ** 2 for p in pow_list)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    # Generate fitted curve for all standard durations
    all_durations = [5, 10, 15, 30, 60, 120, 300, 600, 1200, 1800, 2700, 3600, 5400, 7200]
    fitted_curve = {
        str(d): round(_morton_power_duration(d, cp, w_prime), 1)
        for d in all_durations
    }

    # Sanity check: CP should be positive and reasonable
    if cp < 50 or cp > 600:
        return {
            "cp": None,
            "w_prime": None,
            "model_r_squared": 0.0,
            "fitted_curve": None,
            "method": "unreasonable_cp",
        }

    return {
        "cp": round(cp, 1),
        "w_prime": round(w_prime, 0),
        "model_r_squared": round(max(0.0, r_squared), 4),
        "fitted_curve": fitted_curve,
        "method": "morton_2004",
        "data_points_used": len(data),
    }


# ── Personalized VO2max from Power-HR Regression ────────────────────────────


def fit_personalized_vo2max(
    steady_state_rides: list[dict],
    weight_kg: float | None = None,
) -> dict:
    """Fit personalized VO2max from steady-state power-HR pairs.

    Uses linear regression of HR on power (or W/kg) to find the
    relationship, then estimates VO2max by extrapolating to the
    user's theoretical max HR.

    Parameters
    ----------
    steady_state_rides:
        [{avg_watts, avg_hr, duration_seconds}] — only includes
        steady-state efforts (>20min, CV of power < 15%).
    weight_kg:
        User weight for W/kg normalization.

    Returns
    -------
    dict with vo2max, hr_max_assumed, method, r_squared, regression_slope,
    regression_intercept, data_points_used.
    """
    # Filter to valid steady-state data
    valid = [
        r for r in steady_state_rides
        if r.get("avg_watts") and r.get("avg_hr") and r["avg_watts"] > 0 and r["avg_hr"] > 0
    ]

    if len(valid) < 3:
        return {
            "vo2max": None,
            "method": "insufficient_data",
            "r_squared": 0.0,
            "data_points_used": len(valid),
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
            "r_squared": 0.0,
            "data_points_used": n,
        }

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R²
    mean_y = sum_y / n
    ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, y))
    ss_tot = sum((yi - mean_y) ** 2 for yi in y)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    # Estimate VO2max using the ACSM relationship:
    # VO2 = 10.8 * W/kg + 7
    # At threshold (HR ≈ HRmax * 0.85), power corresponds to FTP
    # Use the regression to find power at a threshold HR, then apply ACSM
    hr_threshold = 170.0  # typical threshold HR for estimation
    if slope > 0:
        power_at_threshold = (hr_threshold - intercept) / slope
        if weight_kg and weight_kg > 0:
            vo2max = 10.8 * power_at_threshold + 7.0
        else:
            # Without weight, assume 75kg
            vo2max = 10.8 * power_at_threshold / 75.0 + 7.0
    else:
        vo2max = None

    if vo2max and (vo2max < 20 or vo2max > 90):
        vo2max = None

    return {
        "vo2max": round(vo2max, 1) if vo2max else None,
        "method": "power_hr_regression",
        "r_squared": round(max(0.0, r_squared), 4),
        "regression_slope": round(slope, 6),
        "regression_intercept": round(intercept, 2),
        "hr_threshold_used": hr_threshold,
        "data_points_used": n,
    }


# ── Adaptive CTL/ATL Time Constants ─────────────────────────────────────────


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

            cov = sum((t - mean_tsb) * (h - mean_hrv) for t, h in zip(tsb_vals, hrv_vals))
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

        improvement = ((-best_score) - corr_default) / abs(corr_default + 1e-10) * 100
    else:
        improvement = 0.0

    return {
        "ctl_tau": best_ctl,
        "atl_tau": best_atl,
        "improvement_pct": round(improvement, 1),
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
) -> dict:
    """Modal remote worker for power model fitting.

    Must stay at module global scope: Modal raises ``InvalidError`` for
    functions defined inside other functions. All inputs arrive as explicit
    arguments (JSON strings); pure-compute helpers are module globals.
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
        result["critical_power"] = {"cp": None, "w_prime": None, "method": "no_data"}

    # Personalized VO2max
    if ss_data and len(ss_data) >= 3:
        result["personalized_vo2max"] = fit_personalized_vo2max(ss_data, weight)
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

    image = (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install("numpy")
    )

    app = modal.App("fittrack-power-models", image=image)

    # Decorate the module-global worker (Modal rejects closures defined here).
    remote_fit = app.function(timeout=300, memory=1024)(_fit_power_models_modal)

    # Serialize inputs
    pc_json = _json.dumps(power_curve_data)
    ss_json = _json.dumps(steady_state_rides or [])
    tss_json = _json.dumps(daily_tss or [])
    hrv_json = _json.dumps(hrv_data or [])

    with app.run():
        return remote_fit.remote(pc_json, ss_json, tss_json, hrv_json, weight_kg)
