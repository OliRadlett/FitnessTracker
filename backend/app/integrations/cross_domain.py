"""Cross-domain correlation analysis — Modal-powered.

Analyzes relationships across sleep, HRV, training load, and performance
data to find insights that span multiple data domains. Includes sleep-
performance prediction, cross-sport fatigue correlation, and post-race
retrospective analysis. All functions are pure-compute with no DB access.

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


# ── Linear Regression Helpers ────────────────────────────────────────────────


def _linear_regression(x: list[float], y: list[float]) -> dict:
    """Simple linear regression: y = slope * x + intercept."""
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

    mean_y = sum_y / n
    ss_res = sum((yi - (slope * xi + intercept)) ** 2 for xi, yi in zip(x, y))
    ss_tot = sum((yi - mean_y) ** 2 for yi in y)
    r_squared = 1 - (ss_res / ss_tot) if ss_tot > 0 else 0.0

    return {
        "slope": round(slope, 6),
        "intercept": round(intercept, 4),
        "r_squared": round(max(0.0, r_squared), 4),
    }


def _cross_correlate(
    x: list[float], y: list[float], max_lag: int = 7
) -> list[dict]:
    """Compute cross-correlation between x and y at various lags.

    Positive lag means x leads y (x at time t correlates with y at t+lag).
    Returns [{lag, correlation, n_points}].
    """
    n = len(x)
    results = []
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            x_slice = x[:n - lag] if lag < n else []
            y_slice = y[lag:] if lag < n else []
        else:
            abs_lag = -lag
            x_slice = x[abs_lag:] if abs_lag < n else []
            y_slice = y[:n - abs_lag] if abs_lag < n else []

        min_len = min(len(x_slice), len(y_slice))
        if min_len < 5:
            continue

        x_s = x_slice[:min_len]
        y_s = y_slice[:min_len]

        mean_x = sum(x_s) / min_len
        mean_y = sum(y_s) / min_len

        cov = sum((xi - mean_x) * (yi - mean_y) for xi, yi in zip(x_s, y_s))
        std_x = math.sqrt(sum((xi - mean_x) ** 2 for xi in x_s))
        std_y = math.sqrt(sum((yi - mean_y) ** 2 for yi in y_s))

        if std_x > 0 and std_y > 0:
            corr = cov / (std_x * std_y)
            results.append({
                "lag": lag,
                "correlation": round(corr, 4),
                "n_points": min_len,
            })

    return results


# ── Sleep-Performance Analysis ───────────────────────────────────────────────


def analyze_sleep_performance(
    sleep_data: list[dict],
    performance_data: list[dict],
) -> dict:
    """Analyze how sleep metrics predict next-day performance.

    Parameters
    ----------
    sleep_data:
        [{date, total_sleep_hours, deep_sleep_hours, rem_sleep_hours,
          sleep_efficiency, hrv_ms, recovery_score}]
    performance_data:
        [{date, avg_watts, normalized_power, tss, rpe, decoupling_pct}]

    Returns
    -------
    dict with correlations, insights, optimal_sleep_profile.
    """
    if len(sleep_data) < 14 or len(performance_data) < 14:
        return {
            "correlations": {},
            "insights": [],
            "optimal_sleep_profile": None,
            "data_quality": {"sufficient": False},
        }

    # Index performance by date
    perf_by_date = {p["date"]: p for p in performance_data if p.get("avg_watts")}

    # Build paired data: sleep on day N → performance on day N+1
    paired = []
    for s in sleep_data:
        sleep_date = s.get("date")
        if not sleep_date:
            continue

        # Find next day's performance
        from datetime import datetime, timedelta

        try:
            if isinstance(sleep_date, str):
                sleep_dt = datetime.strptime(sleep_date, "%Y-%m-%d").date()
            else:
                sleep_dt = sleep_date
            next_day = sleep_dt + timedelta(days=1)
            next_day_str = next_day.isoformat()
        except (ValueError, TypeError):
            continue

        perf = perf_by_date.get(next_day_str)
        if perf and perf.get("avg_watts"):
            paired.append({
                "sleep": s,
                "performance": perf,
            })

    if len(paired) < 10:
        return {
            "correlations": {},
            "insights": [],
            "optimal_sleep_profile": None,
            "data_quality": {"sufficient": False, "paired_points": len(paired)},
        }

    # ── Compute correlations ─────────────────────────────────────────────────
    # Per-feature pairing: correlate only the (sleep, performance) pairs where
    # that sleep feature is present. The features must NOT be accumulated into
    # independent ragged lists and sliced positionally against perf_values —
    # one missing value would shift every later day out of alignment and the
    # resulting R²/slope (and any insight derived from them) would be wrong.
    feature_names = [
        "total_sleep_hours",
        "deep_sleep_hours",
        "rem_sleep_hours",
        "sleep_efficiency",
        "hrv_ms",
        "recovery_score",
    ]

    correlations = {}
    for feature_name in feature_names:
        xs: list[float] = []
        ys: list[float] = []
        for p in paired:
            v = p["sleep"].get(feature_name)
            w = p["performance"].get("avg_watts")
            if v is not None and w is not None:
                xs.append(v)
                ys.append(w)
        if len(xs) >= 10:
            reg = _linear_regression(xs, ys)
            correlations[feature_name] = {
                "r_squared": reg["r_squared"],
                "slope": reg["slope"],
                "direction": "positive" if reg["slope"] > 0 else "negative",
                "strength": (
                    "strong" if reg["r_squared"] > 0.3
                    else "moderate" if reg["r_squared"] > 0.1
                    else "weak"
                ),
                "n_points": len(xs),
            }

    # ── Cross-correlation with lag ───────────────────────────────────────────
    # Date-aligned daily series: HRV per sleep-night against mean power per
    # calendar day over their common dates. The two input series have different
    # lengths and cadences (nights vs activities, several activities per day
    # possible), so zipping them positionally would correlate unrelated days.
    power_by_date: dict[str, list[float]] = {}
    for p in performance_data:
        if p.get("date") and p.get("avg_watts"):
            power_by_date.setdefault(p["date"], []).append(p["avg_watts"])
    daily_power = {d: sum(v) / len(v) for d, v in power_by_date.items()}
    hrv_by_date = {
        s["date"]: s["hrv_ms"]
        for s in sleep_data
        if s.get("date") and s.get("hrv_ms") is not None
    }
    common_dates = sorted(set(hrv_by_date) & set(daily_power))
    if len(common_dates) >= 14:
        lag_correlations = _cross_correlate(
            [hrv_by_date[d] for d in common_dates],
            [daily_power[d] for d in common_dates],
            max_lag=7,
        )
    else:
        lag_correlations = []

    # ── Optimal sleep profile ────────────────────────────────────────────────
    # Find sleep characteristics associated with top 25% performances.
    # Derived from the aligned pairs (never from a detached value list).
    paired_powers = [p["performance"]["avg_watts"] for p in paired]
    if paired_powers:
        sorted_perf = sorted(paired_powers)
        threshold = sorted_perf[int(len(sorted_perf) * 0.75)]

        top_sleep = [p["sleep"] for p in paired if p["performance"]["avg_watts"] >= threshold]
        bottom_sleep = [p["sleep"] for p in paired if p["performance"]["avg_watts"] < threshold]

        if top_sleep and bottom_sleep:
            def avg_field(data, field):
                vals = [d.get(field) for d in data if d.get(field) is not None]
                return sum(vals) / len(vals) if vals else None

            optimal = {
                "total_sleep_hours": avg_field(top_sleep, "total_sleep_hours"),
                "deep_sleep_hours": avg_field(top_sleep, "deep_sleep_hours"),
                "rem_sleep_hours": avg_field(top_sleep, "rem_sleep_hours"),
                "sleep_efficiency": avg_field(top_sleep, "sleep_efficiency"),
                "hrv_ms": avg_field(top_sleep, "hrv_ms"),
                "recovery_score": avg_field(top_sleep, "recovery_score"),
            }
        else:
            optimal = None
    else:
        optimal = None

    # ── Insights ─────────────────────────────────────────────────────────────
    insights = []
    for feature, corr in correlations.items():
        if corr["strength"] in ("strong", "moderate"):
            direction = "higher" if corr["direction"] == "positive" else "lower"
            insights.append(
                f"Sleep {feature.replace('_', ' ')} correlates with {direction} "
                f"next-day power (R²={corr['r_squared']:.2f})"
            )

    # Check HRV lag
    if lag_correlations:
        best_lag = max(lag_correlations, key=lambda x: abs(x["correlation"]))
        if abs(best_lag["correlation"]) > 0.2:
            lag_dir = "leads" if best_lag["lag"] > 0 else "follows"
            insights.append(
                f"HRV {abs(best_lag['lag'])}-day {lag_dir} power changes "
                f"(r={best_lag['correlation']:.2f})"
            )

    return {
        "correlations": correlations,
        "lag_correlations": lag_correlations,
        "insights": insights,
        "optimal_sleep_profile": optimal,
        "data_quality": {
            "sufficient": True,
            "paired_points": len(paired),
        },
    }


# ── Cross-Sport Fatigue Correlation ─────────────────────────────────────────


def analyze_cross_sport_fatigue(
    lifting_data: list[dict],
    cycling_data: list[dict],
    recovery_data: list[dict],
) -> dict:
    """Analyze how lifting and cycling affect each other and recovery.

    Parameters
    ----------
    lifting_data:
        [{date, volume_kg, duration_seconds, rpe, focus}]
    cycling_data:
        [{date, tss, avg_watts, normalized_power, decoupling_pct}]
    recovery_data:
        [{date, recovery_score, hrv_ms, resting_hr}]

    Returns
    -------
    dict with lifting_impact, cycling_impact, combined_load, insights.
    """
    if len(lifting_data) < 7 or len(cycling_data) < 7:
        return {
            "lifting_impact": None,
            "cycling_impact": None,
            "combined_load": None,
            "insights": [],
            "data_quality": {"sufficient": False},
        }

    # Index by date
    lift_by_date = {d["date"]: d for d in lifting_data if d.get("volume_kg")}
    cycle_by_date = {d["date"]: d for d in cycling_data if d.get("tss")}
    recovery_by_date = {d["date"]: d for d in recovery_data if d.get("recovery_score")}

    # ── Lifting → next-day cycling power ─────────────────────────────────────
    lift_cycle_pairs = []
    for lift_date, lift in lift_by_date.items():
        from datetime import datetime, timedelta

        try:
            if isinstance(lift_date, str):
                lift_dt = datetime.strptime(lift_date, "%Y-%m-%d").date()
            else:
                lift_dt = lift_date
            next_day = (lift_dt + timedelta(days=1)).isoformat()
        except (ValueError, TypeError):
            continue

        cycle = cycle_by_date.get(next_day)
        if cycle and cycle.get("avg_watts"):
            lift_cycle_pairs.append({
                "lifting_volume": lift.get("volume_kg", 0),
                "lifting_rpe": lift.get("rpe"),
                "next_day_power": cycle["avg_watts"],
                "next_day_tss": cycle.get("tss"),
            })

    lift_impact = None
    if len(lift_cycle_pairs) >= 7:
        volumes = [p["lifting_volume"] for p in lift_cycle_pairs]
        powers = [p["next_day_power"] for p in lift_cycle_pairs]
        reg = _linear_regression(volumes, powers)
        lift_impact = {
            "correlation": reg["r_squared"],
            "slope": reg["slope"],
            "n_points": len(lift_cycle_pairs),
            "direction": "positive" if reg["slope"] > 0 else "negative",
        }

    # ── Cycling TSS → next-day lifting performance ───────────────────────────
    cycle_lift_pairs = []
    for cycle_date, cycle in cycle_by_date.items():
        from datetime import datetime, timedelta

        try:
            if isinstance(cycle_date, str):
                cycle_dt = datetime.strptime(cycle_date, "%Y-%m-%d").date()
            else:
                cycle_dt = cycle_date
            next_day = (cycle_dt + timedelta(days=1)).isoformat()
        except (ValueError, TypeError):
            continue

        lift = lift_by_date.get(next_day)
        if lift and lift.get("volume_kg"):
            cycle_lift_pairs.append({
                "cycling_tss": cycle.get("tss", 0),
                "next_day_volume": lift["volume_kg"],
                "next_day_rpe": lift.get("rpe"),
            })

    cycle_impact = None
    if len(cycle_lift_pairs) >= 7:
        tss_vals = [p["cycling_tss"] for p in cycle_lift_pairs]
        vol_vals = [p["next_day_volume"] for p in cycle_lift_pairs]
        reg = _linear_regression(tss_vals, vol_vals)
        cycle_impact = {
            "correlation": reg["r_squared"],
            "slope": reg["slope"],
            "n_points": len(cycle_lift_pairs),
            "direction": "positive" if reg["slope"] > 0 else "negative",
        }

    # ── Combined load → recovery ─────────────────────────────────────────────
    combined_pairs = []
    for date_str in set(lift_by_date.keys()) | set(cycle_by_date.keys()):
        lift = lift_by_date.get(date_str, {})
        cycle = cycle_by_date.get(date_str, {})
        recovery = recovery_by_date.get(date_str, {})

        if recovery.get("recovery_score") is not None:
            combined_tss = (cycle.get("tss", 0) or 0)
            combined_volume = (lift.get("volume_kg", 0) or 0)
            combined_pairs.append({
                "date": date_str,
                "cycling_tss": combined_tss,
                "lifting_volume": combined_volume,
                "total_load": combined_tss + combined_volume / 10,
                "recovery_score": recovery["recovery_score"],
                "hrv_ms": recovery.get("hrv_ms"),
            })

    combined_load = None
    if len(combined_pairs) >= 10:
        loads = [p["total_load"] for p in combined_pairs]
        recoveries = [p["recovery_score"] for p in combined_pairs]
        reg = _linear_regression(loads, recoveries)
        combined_load = {
            "load_recovery_correlation": reg["r_squared"],
            "load_recovery_slope": reg["slope"],
            "n_points": len(combined_pairs),
            "insight": (
                "Higher combined load correlates with lower recovery"
                if reg["slope"] < 0
                else "Combined load has minimal impact on recovery"
            ),
        }

    # ── Insights ─────────────────────────────────────────────────────────────
    insights = []
    if lift_impact and lift_impact["correlation"] > 0.1:
        direction = "higher" if lift_impact["direction"] == "positive" else "lower"
        insights.append(
            f"Lifting volume correlates with {direction} next-day cycling power "
            f"(R²={lift_impact['correlation']:.2f})"
        )

    if cycle_impact and cycle_impact["correlation"] > 0.1:
        direction = "higher" if cycle_impact["direction"] == "positive" else "lower"
        insights.append(
            f"Cycling TSS correlates with {direction} next-day lifting volume "
            f"(R²={cycle_impact['correlation']:.2f})"
        )

    if combined_load and combined_load["load_recovery_correlation"] > 0.1:
        insights.append(combined_load["insight"])

    return {
        "lifting_impact": lift_impact,
        "cycling_impact": cycle_impact,
        "combined_load": combined_load,
        "insights": insights,
        "data_quality": {
            "sufficient": len(combined_pairs) >= 10,
            "lift_cycle_pairs": len(lift_cycle_pairs),
            "cycle_lift_pairs": len(cycle_lift_pairs),
            "combined_pairs": len(combined_pairs),
        },
    }


# ── Post-Race Retrospective ─────────────────────────────────────────────────


def analyze_race_retrospective(
    race_data: dict,
    pre_race_data: dict,
    training_data: list[dict],
    weather_data: dict | None = None,
) -> dict:
    """Analyze a race performance against projections and context.

    Parameters
    ----------
    race_data:
        {date, actual_watts, actual_np, actual_tss, actual_distance,
         actual_duration, actual_elevation}
    pre_race_data:
        {tsb_projected, target_watts, target_tss, plan_conformity_pct,
         fuel_plan_adherence_pct}
    training_data:
        [{date, tss, type}] — last 30 days of training
    weather_data:
        {temperature, wind_speed_kmh, conditions} (optional)

    Returns
    -------
    dict with vs_projection, factors, lessons.
    """
    insights = []

    # ── Projection vs Actual ─────────────────────────────────────────────────
    vs_projection = None
    if pre_race_data.get("target_watts") and race_data.get("actual_watts"):
        target = pre_race_data["target_watts"]
        actual = race_data["actual_watts"]
        delta_pct = (actual - target) / target * 100

        vs_projection = {
            "target_watts": target,
            "actual_watts": actual,
            "delta_pct": round(delta_pct, 1),
            "verdict": (
                "exceeded" if delta_pct > 3
                else "matched" if delta_pct > -3
                else "fell short"
            ),
        }

        if delta_pct > 3:
            insights.append(f"Exceeded target power by {delta_pct:.1f}%")
        elif delta_pct < -3:
            insights.append(f"Fell short of target power by {abs(delta_pct):.1f}%")

    # ── TSB Analysis ─────────────────────────────────────────────────────────
    tsb_analysis = None
    if pre_race_data.get("tsb_projected") is not None:
        tsb = pre_race_data["tsb_projected"]
        if tsb > 15:
            tsb_analysis = {"tsb": tsb, "interpretation": "well-rested"}
            insights.append(f"Started with positive TSB ({tsb:.0f}) — well-rested")
        elif tsb < -15:
            tsb_analysis = {"tsb": tsb, "interpretation": "fatigued"}
            insights.append(f"Started with negative TSB ({tsb:.0f}) — fatigued")
        else:
            tsb_analysis = {"tsb": tsb, "interpretation": "neutral"}

    # ── Plan Conformity ──────────────────────────────────────────────────────
    conformity = pre_race_data.get("plan_conformity_pct")
    if conformity is not None:
        if conformity < 70:
            insights.append(
                f"Low plan adherence ({conformity:.0f}%) may have impacted performance"
            )
        elif conformity > 90:
            insights.append(f"Excellent plan adherence ({conformity:.0f}%)")

    # ── Training Analysis ────────────────────────────────────────────────────
    training_analysis = None
    if training_data and len(training_data) >= 7:
        # Compute training load in the final 2 weeks
        recent_tss = [d.get("tss", 0) for d in training_data[-14:] if d.get("tss")]
        if recent_tss:
            avg_recent_tss = sum(recent_tss) / len(recent_tss)
            peak_tss = max(recent_tss)

            # Check for taper (last 7 days vs previous 7)
            if len(recent_tss) >= 14:
                taper_tss = recent_tss[-7:]
                build_tss = recent_tss[-14:-7]
                avg_taper = sum(taper_tss) / len(taper_tss)
                avg_build = sum(build_tss) / len(build_tss)
                taper_pct = (avg_taper - avg_build) / avg_build * 100 if avg_build > 0 else 0

                training_analysis = {
                    "avg_recent_tss": round(avg_recent_tss, 1),
                    "peak_tss": peak_tss,
                    "taper_pct": round(taper_pct, 1),
                    "tapered": taper_pct < -20,
                }

                if taper_pct < -20:
                    insights.append(f"Good taper: {abs(taper_pct):.0f}% TSS reduction in final week")
                elif taper_pct > 0:
                    insights.append(f"No taper detected: {taper_pct:.0f}% TSS increase in final week")

    # ── Weather Impact ───────────────────────────────────────────────────────
    weather_analysis = None
    if weather_data:
        temp = weather_data.get("temperature")
        wind = weather_data.get("wind_speed_kmh")
        conditions = weather_data.get("conditions")

        weather_analysis = {
            "temperature": temp,
            "wind_speed_kmh": wind,
            "conditions": conditions,
        }

        if temp and temp > 30:
            insights.append(f"Hot conditions ({temp:.0f}°C) likely impacted performance")
        elif temp and temp < 5:
            insights.append(f"Cold conditions ({temp:.0f}°C) may have affected power output")

        if wind and wind > 30:
            insights.append(f"Strong winds ({wind:.0f} km/h) affected pacing")

    # ── Lessons ──────────────────────────────────────────────────────────────
    lessons = []
    if vs_projection and vs_projection["verdict"] == "exceeded":
        lessons.append("Consider setting more ambitious targets for next race")
    elif vs_projection and vs_projection["verdict"] == "fell short":
        lessons.append("Review training load and taper strategy before next race")

    if conformity and conformity < 70:
        lessons.append("Focus on plan adherence in the build phase")

    return {
        "vs_projection": vs_projection,
        "tsb_analysis": tsb_analysis,
        "training_analysis": training_analysis,
        "weather_analysis": weather_analysis,
        "insights": insights,
        "lessons": lessons,
    }


# ── Modal remote worker (module scope — Modal rejects closures) ───────────────


def _analyze_cross_domain_modal(
    sleep_json: str,
    perf_json: str,
    lift_json: str,
    cycle_json: str,
    recovery_json: str,
    race_json: str | None,
    pre_race_json: str | None,
    race_train_json: str | None,
    race_weather_json: str | None,
) -> dict:
    """Modal remote worker for cross-domain analysis.

    Must stay at module global scope: Modal raises ``InvalidError`` for
    functions defined inside other functions. All inputs arrive as explicit
    arguments (JSON strings); pure-compute helpers are module globals.
    """
    import json as _json

    sleep_d = _json.loads(sleep_json)
    perf_d = _json.loads(perf_json)
    lift_d = _json.loads(lift_json)
    cycle_d = _json.loads(cycle_json)
    recovery_d = _json.loads(recovery_json)
    race_d = _json.loads(race_json) if race_json else None
    pre_race_d = _json.loads(pre_race_json) if pre_race_json else None
    race_train_d = _json.loads(race_train_json) if race_train_json else None
    race_weather_d = _json.loads(race_weather_json) if race_weather_json else None

    result = {
        "sleep_performance": analyze_sleep_performance(sleep_d, perf_d),
        "cross_sport": analyze_cross_sport_fatigue(lift_d, cycle_d, recovery_d),
    }

    if race_d and pre_race_d:
        result["race_retrospective"] = analyze_race_retrospective(
            race_d, pre_race_d, race_train_d or [], race_weather_d
        )
    else:
        result["race_retrospective"] = None

    return result


# ── Public API ───────────────────────────────────────────────────────────────


def analyze_cross_domain_on_modal(
    sleep_data: list[dict],
    performance_data: list[dict],
    lifting_data: list[dict],
    cycling_data: list[dict],
    recovery_data: list[dict],
    race_data: dict | None = None,
    pre_race_data: dict | None = None,
    race_training_data: list[dict] | None = None,
    race_weather_data: dict | None = None,
) -> dict:
    """Dispatch cross-domain analysis to Modal and return results.

    Parameters
    ----------
    sleep_data:
        [{date, total_sleep_hours, deep_sleep_hours, rem_sleep_hours,
          sleep_efficiency, hrv_ms, recovery_score}]
    performance_data:
        [{date, avg_watts, normalized_power, tss, rpe, decoupling_pct}]
    lifting_data:
        [{date, volume_kg, duration_seconds, rpe, focus}]
    cycling_data:
        [{date, tss, avg_watts, normalized_power}]
    recovery_data:
        [{date, recovery_score, hrv_ms, resting_hr}]
    race_data:
        Optional race data for retrospective.
    pre_race_data:
        Optional pre-race projections.
    race_training_data:
        Optional training data leading up to race.
    race_weather_data:
        Optional race day weather.

    Returns
    -------
    dict with sleep_performance, cross_sport, race_retrospective.
    """
    import json as _json

    if not _modal_configured():
        raise RuntimeError(
            "Modal is not configured — set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET"
        )

    import modal

    image = modal.Image.debian_slim(python_version="3.12")

    app = modal.App("fittrack-cross-domain", image=image)

    # Decorate the module-global worker (Modal rejects closures defined here).
    remote_analyze = app.function(timeout=300, memory=1024)(_analyze_cross_domain_modal)

    with app.run():
        return remote_analyze.remote(
            _json.dumps(sleep_data),
            _json.dumps(performance_data),
            _json.dumps(lifting_data),
            _json.dumps(cycling_data),
            _json.dumps(recovery_data),
            _json.dumps(race_data) if race_data else None,
            _json.dumps(pre_race_data) if pre_race_data else None,
            _json.dumps(race_training_data) if race_training_data else None,
            _json.dumps(race_weather_data) if race_weather_data else None,
        )
