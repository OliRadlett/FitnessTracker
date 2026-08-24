"""Chart API — Generic GET /{chart_name} endpoint."""

import json
import logging
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.cache import _get_redis, _make_cache_key
from app.services.charts import ChartService

logger = logging.getLogger(__name__)

router = APIRouter()

# Stream-heavy charts cached in Redis (short TTL; data changes only on sync)
CACHED_CHARTS: set[str] = {
    "training_load",
    "stream_power_curve",
    "power_zones",
    "hr_zone_distribution",
    "power_curve_comparison",
}
CHART_CACHE_TTL = 300  # seconds

# Registry of available chart methods and their params.
# `required` lists params that must be supplied — missing ones return 422.
#
# Charts not currently rendered by the frontend are kept as API surface
# for future use: sleep_quality_trend, whoop_strain_trend,
# recovery_vs_performance, estimated_1rm_history, weekly_volume.
# Superseded duplicates (power_curve, ftp_over_time, hrv_trend,
# recovery_vs_strain) were removed — use stream_power_curve, ftp_history,
# hrv_trend_detailed and strain_vs_recovery instead.
CHART_REGISTRY: dict[str, dict[str, Any]] = {
    "weekly_tss": {"method": "weekly_tss", "params": ["weeks"]},
    "estimated_1rm_history": {
        "method": "estimated_1rm_history",
        "params": ["exercise_name"],
        "required": ["exercise_name"],
    },
    "weekly_volume": {"method": "weekly_volume", "params": ["weeks"]},
    "sleep_quality_trend": {"method": "sleep_quality_trend", "params": ["days"]},
    "whoop_strain_trend": {"method": "whoop_strain_trend", "params": ["days"]},
    # Cycling charts
    "training_load": {"method": "training_load", "params": ["days"]},
    "ftp_history": {"method": "ftp_history", "params": []},
    "stream_power_curve": {"method": "stream_power_curve", "params": ["days"]},
    "power_zones": {"method": "power_zones", "params": ["days"]},
    "hr_zone_distribution": {"method": "hr_zone_distribution", "params": ["days"]},
    "daily_tss": {"method": "daily_tss", "params": ["days"]},
    "exercise_progress": {
        "method": "exercise_progress",
        "params": ["exercise_name", "weeks"],
        "required": ["exercise_name"],
    },
    "power_curve_comparison": {
        "method": "power_curve_comparison",
        "params": ["days", "days_b"],
    },
    # Phase 5.2 — Whoop intelligence charts
    "strain_vs_recovery": {"method": "strain_vs_recovery", "params": ["days"]},
    "recovery_vs_performance": {
        "method": "recovery_vs_performance",
        "params": ["days"],
    },
    "hrv_trend_detailed": {"method": "hrv_trend_detailed", "params": ["days"]},
    "weight_trend": {"method": "weight_trend", "params": ["days"]},
    "training_load_balance": {"method": "training_load_balance", "params": ["weeks"]},
    "rest_day_analysis": {"method": "rest_day_analysis", "params": ["days"]},
    # VO2max and decoupling charts
    "vo2max_trend": {"method": "vo2max_trend", "params": ["months"]},
    "decoupling_trend": {"method": "decoupling_trend", "params": ["days"]},
    # Training plan periodization
    "periodization": {"method": "periodization", "params": ["weeks"]},
    # New intelligence charts
    "ramp_rate": {"method": "ramp_rate", "params": ["weeks"]},
    "wkg_power_curve": {"method": "wkg_power_curve", "params": ["days"]},
    "power_duration_percentile": {
        "method": "power_duration_percentile",
        "params": ["days"],
    },
    "consistency_heatmap": {"method": "consistency_heatmap", "params": ["days"]},
    "sleep_consistency": {"method": "sleep_consistency", "params": ["days"]},
    "strength_balance": {"method": "strength_balance", "params": []},
}


@router.get("/available")
async def list_available_charts():
    """List all available chart types."""
    return {
        "charts": [
            {
                "name": name,
                "params": info["params"],
            }
            for name, info in CHART_REGISTRY.items()
        ]
    }


@router.get("/{chart_name}")
async def get_chart(
    chart_name: str,
    days: int | None = Query(None, ge=1, le=365),
    weeks: int | None = Query(None, ge=1, le=52),
    months: int | None = Query(None, ge=1, le=24),
    exercise_name: str | None = Query(None),
    days_b: int | None = Query(
        None, ge=1, le=365, description="Second period in days (for comparison charts)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get chart data by name with optional query parameters."""
    if chart_name not in CHART_REGISTRY:
        raise HTTPException(status_code=404, detail=f"Chart '{chart_name}' not found")

    chart_info = CHART_REGISTRY[chart_name]
    service = ChartService(db)
    method = getattr(service, chart_info["method"])

    # Enforce required params before calling the service method
    provided: dict[str, Any] = {
        "days": days,
        "weeks": weeks,
        "months": months,
        "exercise_name": exercise_name,
        "days_b": days_b,
    }
    missing_required = [
        p for p in chart_info.get("required", []) if provided.get(p) is None
    ]
    if missing_required:
        raise HTTPException(
            status_code=422,
            detail=f"Chart '{chart_name}' requires parameter(s): {', '.join(missing_required)}",
        )

    # Build kwargs from provided query params
    kwargs: dict[str, Any] = {"user_id": current_user.id}
    for param_name, value in provided.items():
        if value is not None and param_name in chart_info["params"]:
            kwargs[param_name] = value

    # Try Redis cache for expensive charts (keyed per user + params)
    cache_key = None
    if chart_name in CACHED_CHARTS:
        try:
            cache_key = _make_cache_key(f"chart:{chart_name}", *kwargs.values())
            r = _get_redis()
            cached_val = await r.get(cache_key)
            if cached_val is not None:
                return json.loads(cached_val)
        except Exception as e:
            logger.debug("Chart cache read failed for %s: %s", chart_name, e)

    chart_data = await method(**kwargs)

    payload = {
        "chart_type": chart_data.chart_type,
        "title": chart_data.title,
        "labels": chart_data.labels,
        "series": [asdict(s) for s in chart_data.series],
        "x_label": chart_data.x_label,
        "y_label": chart_data.y_label,
        "insights": chart_data.insights,
        "reference_areas": [asdict(r) for r in chart_data.reference_areas],
    }

    if cache_key is not None:
        try:
            r = _get_redis()
            await r.setex(cache_key, CHART_CACHE_TTL, json.dumps(payload))
        except Exception as e:
            logger.debug("Chart cache write failed for %s: %s", chart_name, e)

    return payload
