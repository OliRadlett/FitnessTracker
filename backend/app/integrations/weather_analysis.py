"""Weather-performance correlation — Modal-powered analysis.

Analyzes how weather conditions affect cycling performance via multi-variate
regression: power output vs (temperature, wind, humidity, precipitation),
decoupling vs temperature, and HR response vs temperature. Produces per-user
"weather coefficients" and actionable insights.

All functions are pure-compute with no DB access — data flows in via
arguments, results via return values. Requires ``MODAL_TOKEN_ID`` and
``MODAL_TOKEN_SECRET`` env vars.
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


# ── Linear Regression Helpers ────────────────────────────────────────────────


def _linear_regression(x: list[float], y: list[float]) -> dict:
    """Simple linear regression: y = slope * x + intercept.

    Returns slope, intercept, r_squared.
    """
    n = len(x)
    if n < 3:
        return {"slope": 0.0, "intercept": 0.0, "r_squared": 0.0}

    sum_x = sum(x)
    sum_y = sum(y)
    sum_xy = sum(xi * yi for xi, yi in zip(x, y))
    sum_xx = sum(xi * xi for xi in x)

    denom = n * sum_xx - sum_x * sum_x
    if abs(denom) < 1e-10:
        return {"slope": 0.0, "intercept": sum_y / n if n else 0.0, "r_squared": 0.0}

    slope = (n * sum_xy - sum_x * sum_y) / denom
    intercept = (sum_y - slope * sum_x) / n

    # R²
    mean_y = sum_y / n
    ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, y))
    ss_tot = sum((yi - mean_y) ** 2 for yi in y)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    return {
        "slope": round(slope, 6),
        "intercept": round(intercept, 4),
        "r_squared": round(max(0.0, r_squared), 4),
    }


def _solve_linear_system(a: list[list[float]], b: list[float]) -> list[float]:
    """Solve A·x = b via Gaussian elimination with partial pivoting.

    No numpy dependency (Modal container is bare debian_slim). Near-singular
    dimensions are left at 0.0 instead of exploding.
    """
    n = len(a)
    m = [row[:] + [bi] for row, bi in zip(a, b)]
    for col in range(n):
        piv = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[piv] = m[piv], m[col]
        if abs(m[col][col]) < 1e-12:
            continue
        for row in range(col + 1, n):
            factor = m[row][col] / m[col][col]
            for j in range(col, n + 1):
                m[row][j] -= factor * m[col][j]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        if abs(m[i][i]) < 1e-12:
            continue
        x[i] = m[i][n] - sum(m[i][j] * x[j] for j in range(i + 1, n))
        x[i] /= m[i][i]
    return x


def _multiple_linear_regression(
    x_matrix: list[list[float]], y: list[float],
    feature_names: list[str] | None = None,
) -> dict:
    """Multiple linear regression via least squares (normal equations).

    Solves (XᵀX)·β = Xᵀy for the coefficient vector β (last entry is the
    intercept). Unlike eliminating the raw n×(k+1) system — which merely
    satisfies k+1 of the n equations and biases coefficients toward
    extreme rows — this minimizes the sum of squared residuals over ALL
    data points.

    Zero-variance feature columns (e.g. humidity/pressure placeholders that
    are constant across every ride) are dropped before fitting and reported
    in ``dropped_features``; fitting them would make XᵀX singular.

    x_matrix: list of feature vectors (each is a list of floats).
    y: target vector.

    Returns coefficients (per feature), intercept, r_squared,
    dropped_features.
    """
    n = len(y)
    if n < 5 or not x_matrix or len(x_matrix[0]) < 1:
        return {
            "coefficients": [],
            "intercept": 0.0,
            "r_squared": 0.0,
            "dropped_features": [],
        }

    k = len(x_matrix[0])
    names = feature_names or [f"x{j}" for j in range(k)]

    # Underdetermined without strictly more points than parameters.
    if n <= k + 1:
        return {
            "coefficients": [0.0] * k,
            "intercept": sum(y) / n,
            "r_squared": 0.0,
            "dropped_features": list(names),
        }

    # Drop zero-variance columns (constant placeholders).
    means = [sum(row[j] for row in x_matrix) / n for j in range(k)]
    kept = [
        j for j in range(k)
        if sum((row[j] - means[j]) ** 2 for row in x_matrix) > 1e-12
    ]
    dropped = [names[j] for j in range(k) if j not in kept]

    m = len(kept) + 1  # kept features + intercept
    xtx = [[0.0] * m for _ in range(m)]
    xty = [0.0] * m
    for i in range(n):
        feats = [x_matrix[i][j] for j in kept] + [1.0]
        for a in range(m):
            xty[a] += feats[a] * y[i]
            for b in range(m):
                xtx[a][b] += feats[a] * feats[b]

    sol = _solve_linear_system(xtx, xty)
    kept_coefs = sol[: len(kept)]
    intercept = sol[len(kept)]

    coefficients = [0.0] * k
    for j, c in zip(kept, kept_coefs):
        coefficients[j] = c

    # Compute R² over all points
    y_pred = [
        sum(coefficients[j] * x_matrix[i][j] for j in range(k)) + intercept
        for i in range(n)
    ]
    mean_y = sum(y) / n
    ss_res = sum((yi - yp) ** 2 for yi, yp in zip(y, y_pred))
    ss_tot = sum((yi - mean_y) ** 2 for yi in y)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    return {
        "coefficients": [round(c, 6) for c in coefficients],
        "intercept": round(intercept, 4),
        "r_squared": round(max(0.0, r_squared), 4),
        "dropped_features": dropped,
    }


def _wind_to_components(
    wind_speed: float, wind_direction: float, route_heading: float
) -> tuple[float, float]:
    """Convert wind speed/direction + route heading to headwind/crosswind.

    Returns (headwind, crosswind) in m/s. Positive headwind = into wind.
    """
    # Convert degrees to radians
    wind_rad = math.radians(wind_direction)
    heading_rad = math.radians(route_heading)

    # Wind vector relative to route
    relative_angle = wind_rad - heading_rad
    headwind = wind_speed * math.cos(relative_angle)
    crosswind = wind_speed * math.sin(relative_angle)

    return headwind, crosswind


# ── Core Analysis Functions ──────────────────────────────────────────────────


def analyze_weather_performance(
    rides: list[dict],
    route_headings: dict | None = None,
) -> dict:
    """Analyze weather-performance correlations across all tagged rides.

    Parameters
    ----------
    rides:
        [{date, avg_watts, normalized_power, decoupling_pct,
          avg_hr, moving_time, weather: {temperature, wind_speed_kmh,
          wind_direction, humidity, precipitation_mm, pressure_hpa,
          conditions}, route_heading_degrees}]
    route_headings:
        Optional {route_id: avg_heading_degrees} for wind component analysis.

    Returns
    -------
    dict with power_vs_temp, power_vs_wind, decoupling_vs_temp,
    hr_vs_temp, weather_coefficients, personalized_insights, data_quality.
    """
    if len(rides) < 10:
        return {
            "power_vs_temp": None,
            "power_vs_wind": None,
            "decoupling_vs_temp": None,
            "hr_vs_temp": None,
            "weather_coefficients": None,
            "personalized_insights": [],
            "data_quality": {"total_rides": len(rides), "sufficient": False},
        }

    # ── A. Power vs Temperature ──────────────────────────────────────────────
    temp_power = [
        (r["weather"]["temperature"], r["avg_watts"])
        for r in rides
        if r.get("weather", {}).get("temperature") is not None
        and r.get("avg_watts")
        and r["avg_watts"] > 0
    ]

    power_vs_temp = None
    if len(temp_power) >= 10:
        temps = [t for t, _ in temp_power]
        powers = [p for _, p in temp_power]
        reg = _linear_regression(temps, powers)

        # Find optimal temperature range (power peaks)
        # Bin by 3°C and find the bin with highest average power
        bins: dict[int, list[float]] = {}
        for t, p in temp_power:
            bin_key = int(t // 3) * 3
            bins.setdefault(bin_key, []).append(p)
        bin_avgs = {k: sum(v) / len(v) for k, v in bins.items() if len(v) >= 3}
        if bin_avgs:
            best_bin = max(bin_avgs, key=bin_avgs.get)
            optimal_range = (best_bin, best_bin + 3)
        else:
            optimal_range = None

        power_vs_temp = {
            "slope_per_celsius": reg["slope"],
            "intercept": reg["intercept"],
            "r_squared": reg["r_squared"],
            "optimal_range_c": optimal_range,
            "data_points": len(temp_power),
        }

    # ── B. Power vs Wind ─────────────────────────────────────────────────────
    wind_power = [
        (
            r["weather"]["wind_speed_kmh"],
            r["avg_watts"],
            r.get("route_heading_degrees"),
            r["weather"].get("wind_direction"),
        )
        for r in rides
        if r.get("weather", {}).get("wind_speed_kmh") is not None
        and r.get("avg_watts")
        and r["avg_watts"] > 0
    ]

    power_vs_wind = None
    if len(wind_power) >= 10:
        # Separate into headwind/crosswind/tailwind using route heading
        headwind_powers: list[float] = []
        tailwind_powers: list[float] = []
        crosswind_powers: list[float] = []
        calm_powers: list[float] = []  # wind < 10 km/h

        for ws_kmh, power, heading, wdir in wind_power:
            ws_ms = ws_kmh / 3.6
            if heading is not None and wdir is not None:
                headwind, crosswind = _wind_to_components(ws_ms, wdir, heading)
                if ws_kmh < 10:
                    calm_powers.append(power)
                elif headwind > 2:
                    headwind_powers.append(power)
                elif headwind < -2:
                    tailwind_powers.append(power)
                else:
                    crosswind_powers.append(power)
            else:
                calm_powers.append(power)

        avg_calm = sum(calm_powers) / len(calm_powers) if calm_powers else 0
        avg_headwind = sum(headwind_powers) / len(headwind_powers) if headwind_powers else None
        avg_tailwind = sum(tailwind_powers) / len(tailwind_powers) if tailwind_powers else None
        avg_crosswind = sum(crosswind_powers) / len(crosswind_powers) if crosswind_powers else None

        headwind_penalty = None
        tailwind_boost = None
        crosswind_penalty = None

        if avg_calm > 0 and avg_headwind is not None:
            headwind_penalty = round((avg_headwind - avg_calm) / avg_calm * 100, 2)
        if avg_calm > 0 and avg_tailwind is not None:
            tailwind_boost = round((avg_tailwind - avg_calm) / avg_calm * 100, 2)
        if avg_calm > 0 and avg_crosswind is not None:
            crosswind_penalty = round((avg_crosswind - avg_calm) / avg_calm * 100, 2)

        # Power vs wind speed (no heading needed — just the raw relationship)
        ws_list = [ws for ws, *_ in wind_power]
        pw_list = [p for _, p, *_ in wind_power]
        reg_wind = _linear_regression(ws_list, pw_list)

        power_vs_wind = {
            "headwind_penalty_pct": headwind_penalty,
            "tailwind_boost_pct": tailwind_boost,
            "crosswind_penalty_pct": crosswind_penalty,
            "power_vs_speed_slope": reg_wind["slope"],
            "power_vs_speed_r_squared": reg_wind["r_squared"],
            "data_points": {
                "headwind": len(headwind_powers),
                "tailwind": len(tailwind_powers),
                "crosswind": len(crosswind_powers),
                "calm": len(calm_powers),
            },
        }

    # ── C. Decoupling vs Temperature ─────────────────────────────────────────
    temp_decp = [
        (r["weather"]["temperature"], r["decoupling_pct"])
        for r in rides
        if r.get("weather", {}).get("temperature") is not None
        and r.get("decoupling_pct") is not None
    ]

    decoupling_vs_temp = None
    if len(temp_decp) >= 10:
        temps_d = [t for t, _ in temp_decp]
        decps = [d for _, d in temp_decp]
        reg_decp = _linear_regression(temps_d, decps)

        # Find threshold temperature where decoupling increases sharply
        # Bin by 3°C and find where decoupling jumps
        bins_d: dict[int, list[float]] = {}
        for t, d in temp_decp:
            bin_key = int(t // 3) * 3
            bins_d.setdefault(bin_key, []).append(d)
        bin_avgs_d = {k: sum(v) / len(v) for k, v in bins_d.items() if len(v) >= 3}

        threshold_c = None
        penalty_above = None
        if bin_avgs_d and len(bin_avgs_d) >= 3:
            sorted_bins = sorted(bin_avgs_d.items())
            # Find the temperature where decoupling jumps by >1% from the median
            median_decp = sorted(v for v in bin_avgs_d.values())[len(bin_avgs_d) // 2]
            for temp_bin, avg_decp in sorted_bins:
                if avg_decp > median_decp + 1.0:
                    threshold_c = temp_bin
                    penalty_above = round(avg_decp - median_decp, 2)
                    break

        decoupling_vs_temp = {
            "slope_per_celsius": reg_decp["slope"],
            "r_squared": reg_decp["r_squared"],
            "threshold_c": threshold_c,
            "penalty_above_pct": penalty_above,
            "data_points": len(temp_decp),
        }

    # ── D. HR vs Temperature ─────────────────────────────────────────────────
    temp_hr = [
        (r["weather"]["temperature"], r["avg_hr"])
        for r in rides
        if r.get("weather", {}).get("temperature") is not None
        and r.get("avg_hr")
        and r["avg_hr"] > 0
        and r.get("avg_watts")
        and r["avg_watts"] > 0
    ]

    hr_vs_temp = None
    if len(temp_hr) >= 10:
        temps_h = [t for t, _ in temp_hr]
        hrs = [h for _, h in temp_hr]
        reg_hr = _linear_regression(temps_h, hrs)

        hr_vs_temp = {
            "slope_bpm_per_celsius": reg_hr["slope"],
            "intercept": reg_hr["intercept"],
            "r_squared": reg_hr["r_squared"],
            "data_points": len(temp_hr),
        }

    # ── E. Weather Coefficients (multi-variate) ──────────────────────────────
    # Build feature matrix for multi-variate regression
    # Features: temperature, wind_speed, humidity, precipitation, pressure
    # Target: normalized_power (or avg_watts)
    feature_rides = [
        r for r in rides
        if r.get("weather", {}).get("temperature") is not None
        and r.get("avg_watts")
        and r["avg_watts"] > 0
        and r.get("weather", {}).get("wind_speed_kmh") is not None
    ]

    weather_coefficients = None
    if len(feature_rides) >= 20:
        x_matrix = []
        y_target = []
        for r in feature_rides:
            w = r["weather"]
            # ``or`` defaults (not ``.get(key, default)``): the API builds each
            # ride's weather dict with the keys present but ``None`` when the
            # value isn't stored (humidity/pressure are never stored), so a
            # dict-default lookup still yields None and breaks the regression.
            x_matrix.append([
                w.get("temperature") or 0,
                w.get("wind_speed_kmh") or 0,
                w.get("humidity") or 50,
                w.get("precipitation_mm") or 0,
                w.get("pressure_hpa") or 1013,
            ])
            y_target.append(r.get("normalized_power") or r["avg_watts"])

        feature_names = [
            "temperature",
            "wind_speed",
            "humidity",
            "precipitation",
            "pressure",
        ]
        reg_multi = _multiple_linear_regression(
            x_matrix, y_target, feature_names
        )

        weather_coefficients = {
            "features": feature_names,
            "coefficients": {
                name: coef
                for name, coef in zip(feature_names, reg_multi["coefficients"])
            },
            "intercept": reg_multi["intercept"],
            "r_squared": reg_multi["r_squared"],
            "data_points": len(feature_rides),
            "dropped_features": reg_multi.get("dropped_features", []),
        }

    # ── F. Personalized Insights ─────────────────────────────────────────────
    # Every insight is gated on fit quality (R²) and sample size. An
    # ungated correlation over a handful of rides will happily "discover"
    # patterns in noise and present them as personal physiology.
    insights: list[str] = []

    if power_vs_temp and power_vs_temp.get("optimal_range_c"):
        if (power_vs_temp.get("r_squared") or 0) >= 0.1:
            lo, hi = power_vs_temp["optimal_range_c"]
            insights.append(
                f"Optimal riding temperature: {lo}–{hi}°C"
            )
            if power_vs_temp.get("slope_per_celsius") and power_vs_temp["slope_per_celsius"] < -1:
                insights.append(
                    f"Power drops ~{abs(power_vs_temp['slope_per_celsius']):.1f}W per °C above optimal"
                )

    if power_vs_wind and power_vs_wind.get("headwind_penalty_pct") is not None:
        wind_counts = power_vs_wind.get("data_points", {})
        penalty = power_vs_wind["headwind_penalty_pct"]
        # A penalty averaged over a couple of windy rides is noise: require
        # at least 5 headwind and 5 calm rides before claiming an effect.
        # (The penalty is computed over headwind > ~7 km/h, so the text no
        # longer claims a ">30 km/h" threshold the math never applied.)
        if (
            penalty < -2
            and wind_counts.get("headwind", 0) >= 5
            and wind_counts.get("calm", 0) >= 5
        ):
            insights.append(
                f"Headwinds reduce power by ~{abs(penalty):.1f}%"
            )

    if decoupling_vs_temp and decoupling_vs_temp.get("threshold_c") is not None:
        if (
            (decoupling_vs_temp.get("r_squared") or 0) >= 0.1
            and (decoupling_vs_temp.get("data_points") or 0) >= 15
        ):
            insights.append(
                f"Decoupling increases above {decoupling_vs_temp['threshold_c']}°C "
                f"(+{decoupling_vs_temp['penalty_above_pct']:.1f}% avg)"
            )

    if hr_vs_temp and hr_vs_temp.get("slope_bpm_per_celsius"):
        slope = hr_vs_temp["slope_bpm_per_celsius"]
        if abs(slope) > 0.3 and (hr_vs_temp.get("r_squared") or 0) >= 0.1:
            direction = "increases" if slope > 0 else "decreases"
            insights.append(
                f"Heart rate {direction} by ~{abs(slope):.1f} bpm per °C"
            )

    # ── G. Data Quality ──────────────────────────────────────────────────────
    total = len(rides)
    with_weather = sum(
        1 for r in rides
        if r.get("weather", {}).get("temperature") is not None
    )
    with_power = sum(
        1 for r in rides
        if r.get("avg_watts") and r["avg_watts"] > 0
    )
    with_decp = sum(
        1 for r in rides
        if r.get("decoupling_pct") is not None
    )

    return {
        "power_vs_temp": power_vs_temp,
        "power_vs_wind": power_vs_wind,
        "decoupling_vs_temp": decoupling_vs_temp,
        "hr_vs_temp": hr_vs_temp,
        "weather_coefficients": weather_coefficients,
        "personalized_insights": insights,
        "data_quality": {
            "total_rides": total,
            "with_weather": with_weather,
            "with_power": with_power,
            "with_decoupling": with_decp,
            "sufficient": total >= 20 and with_weather >= 15,
        },
    }


# ── Modal remote worker (module scope — Modal rejects closures) ───────────────


def _analyze_weather_modal(rides_json: str, headings_json: str | None) -> dict:
    """Modal remote worker for weather-performance analysis.

    Must stay at module global scope: Modal raises ``InvalidError`` for
    functions defined inside other functions. All inputs arrive as explicit
    arguments (JSON strings); ``analyze_weather_performance`` is a module global.
    """
    import json as _json

    rides_data = _json.loads(rides_json)
    headings_data = _json.loads(headings_json) if headings_json else None
    return analyze_weather_performance(rides_data, headings_data)


# ── Public API ───────────────────────────────────────────────────────────────


def analyze_weather_on_modal(
    rides: list[dict],
    route_headings: dict | None = None,
) -> dict:
    """Dispatch weather-performance analysis to Modal and return results.

    Parameters
    ----------
    rides:
        [{date, avg_watts, normalized_power, decoupling_pct,
          avg_hr, moving_time, weather: {...}, route_heading_degrees}]
    route_headings:
        Optional {route_id: heading_degrees}.

    Returns
    -------
    dict with full weather analysis results.
    """
    import json as _json

    if not _modal_configured():
        raise RuntimeError(
            "Modal is not configured — set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET"
        )

    import modal

    image = modal.Image.debian_slim(python_version="3.12")

    app = modal.App("fittrack-weather-analysis", image=image)

    # Decorate the module-global worker (Modal rejects closures defined here).
    remote_analyze = app.function(timeout=300, memory=1024)(_analyze_weather_modal)

    rides_json = _json.dumps(rides)
    headings_json = _json.dumps(route_headings) if route_headings else None

    with app.run():
        return remote_analyze.remote(rides_json, headings_json)
