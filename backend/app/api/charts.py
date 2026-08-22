"""Chart API — Generic GET /{chart_name} endpoint."""

from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.services.auth import get_current_user
from app.services.charts import ChartService

router = APIRouter()

# Registry of available chart methods and their required params
CHART_REGISTRY: dict[str, dict[str, Any]] = {
    "power_curve": {"method": "power_curve", "params": ["days"]},
    "ftp_over_time": {"method": "ftp_over_time", "params": []},
    "weekly_tss": {"method": "weekly_tss", "params": ["weeks"]},
    "estimated_1rm_history": {
        "method": "estimated_1rm_history",
        "params": ["exercise_name"],
    },
    "weekly_volume": {"method": "weekly_volume", "params": ["weeks"]},
    "hrv_trend": {"method": "hrv_trend", "params": ["days"]},
    "recovery_vs_strain": {"method": "recovery_vs_strain", "params": ["days"]},
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

    # Build kwargs from provided query params
    kwargs: dict[str, Any] = {"user_id": current_user.id}
    if days is not None and "days" in chart_info["params"]:
        kwargs["days"] = days
    if weeks is not None and "weeks" in chart_info["params"]:
        kwargs["weeks"] = weeks
    if months is not None and "months" in chart_info["params"]:
        kwargs["months"] = months
    if exercise_name is not None and "exercise_name" in chart_info["params"]:
        kwargs["exercise_name"] = exercise_name
    if days_b is not None and "days_b" in chart_info["params"]:
        kwargs["days_b"] = days_b

    chart_data = await method(**kwargs)

    return {
        "chart_type": chart_data.chart_type,
        "title": chart_data.title,
        "labels": chart_data.labels,
        "series": [asdict(s) for s in chart_data.series],
        "x_label": chart_data.x_label,
        "y_label": chart_data.y_label,
        "insights": chart_data.insights,
        "reference_areas": [asdict(r) for r in chart_data.reference_areas],
    }
