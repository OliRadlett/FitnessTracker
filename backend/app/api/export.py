"""Export API — CSV/GPX data export endpoints."""

import csv
import io
import uuid
from datetime import date, timedelta

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.database import get_db
from app.models.activity import Activity
from app.models.lifting import LiftingSession, PersonalRecord
from app.models.user import User
from app.services.auth import get_current_user
from app.services.gpx import activity_to_gpx

router = APIRouter()


@router.get("/lifting/csv")
async def export_lifting_csv(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export all lifting sessions with sets as CSV."""
    result = await db.execute(
        select(LiftingSession)
        .options(selectinload(LiftingSession.sets))
        .where(LiftingSession.user_id == current_user.id)
        .order_by(LiftingSession.session_date.desc())
    )
    sessions = list(result.scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "session_date", "focus", "program_name", "session_notes",
        "exercise_name", "set_number", "weight_kg", "reps", "rpe",
        "is_warmup", "is_amrap", "set_notes",
    ])

    for session in sessions:
        for s in sorted(session.sets, key=lambda x: (x.exercise_name, x.set_number)):
            writer.writerow([
                session.session_date.isoformat(),
                session.focus or "",
                session.program_name or "",
                session.notes or "",
                s.exercise_name,
                s.set_number,
                s.weight_kg,
                s.reps,
                s.rpe or "",
                s.is_warmup,
                s.is_amrap,
                s.notes or "",
            ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=fittrack_lifting.csv"},
    )


@router.get("/activities/csv")
async def export_activities_csv(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export all activities as CSV."""
    result = await db.execute(
        select(Activity)
        .where(Activity.user_id == current_user.id)
        .order_by(Activity.start_date.desc())
    )
    activities = list(result.scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "date", "name", "sport_type", "source", "duration_seconds",
        "distance_meters", "elevation_gain_meters", "average_heartrate",
        "max_heartrate", "average_power", "normalized_power", "tss",
        "calories",
    ])

    for a in activities:
        writer.writerow([
            a.start_date.isoformat() if a.start_date else "",
            a.name,
            a.sport_type,
            a.source,
            a.duration_seconds or "",
            a.distance_meters or "",
            a.elevation_gain_meters or "",
            a.average_heartrate or "",
            a.max_heartrate or "",
            a.average_power or "",
            a.normalized_power or "",
            a.tss or "",
            a.calories or "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=fittrack_activities.csv"},
    )


@router.get("/activities/{activity_id}/gpx")
async def export_activity_gpx(
    activity_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export a single activity as a GPX file."""
    result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id,
            Activity.user_id == current_user.id,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="Activity not found")

    gpx_xml = activity_to_gpx(activity)
    if not gpx_xml:
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Activity has no GPS data")

    filename = activity.name.replace(" ", "_").replace("/", "_") if activity.name else "activity"
    return StreamingResponse(
        iter([gpx_xml]),
        media_type="application/gpx+xml",
        headers={"Content-Disposition": f"attachment; filename={filename}.gpx"},
    )


@router.get("/prs/csv")
async def export_prs_csv(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export all personal records as CSV."""
    result = await db.execute(
        select(PersonalRecord)
        .where(PersonalRecord.user_id == current_user.id)
        .order_by(PersonalRecord.exercise_name, PersonalRecord.achieved_date.desc())
    )
    prs = list(result.scalars().all())

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "exercise_name", "record_type", "weight_kg", "reps",
        "estimated_1rm", "achieved_date", "notes",
    ])

    for pr in prs:
        writer.writerow([
            pr.exercise_name,
            pr.record_type,
            pr.weight_kg,
            pr.reps,
            round(pr.estimated_1rm, 1) if pr.estimated_1rm else "",
            pr.achieved_date.isoformat(),
            pr.notes or "",
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=fittrack_prs.csv"},
    )


# ── PDF Reports ──────────────────────────────────────────────────────────


@router.get("/weekly-report/{week_start}")
async def export_weekly_report(
    week_start: date,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export a PDF weekly training report."""
    from app.services.pdf_report import generate_weekly_report

    try:
        pdf_bytes = await generate_weekly_report(db, current_user.id, week_start)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {e}")

    week_end = week_start + timedelta(days=6)
    filename = f"fittrack_weekly_{week_start.isoformat()}_{week_end.isoformat()}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/monthly-report/{month}")
async def export_monthly_report(
    month: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Export a PDF monthly training report.

    Args:
        month: Month string in "YYYY-MM" format (e.g. "2026-08").
    """
    import re
    if not re.match(r"^\d{4}-\d{2}$", month):
        raise HTTPException(status_code=400, detail="Month must be in YYYY-MM format")

    from app.services.pdf_report import generate_monthly_report

    try:
        pdf_bytes = await generate_monthly_report(db, current_user.id, month)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate report: {e}")

    filename = f"fittrack_monthly_{month}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )
