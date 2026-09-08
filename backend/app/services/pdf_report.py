"""PDF report generation service — weekly and monthly training reports."""

import io
import uuid
from datetime import date, timedelta

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.event import Event
from app.models.lifting import LiftingSession, PersonalRecord
from app.models.sleep import SleepLog
from app.models.training_plan import TrainingPlan
from app.models.user import User

# ── Styles ────────────────────────────────────────────────────────────────

_styles = getSampleStyleSheet()

TITLE_STYLE = ParagraphStyle(
    "ReportTitle",
    parent=_styles["Heading1"],
    fontSize=20,
    spaceAfter=4 * mm,
    textColor=colors.HexColor("#1a1a2e"),
)

SUBTITLE_STYLE = ParagraphStyle(
    "ReportSubtitle",
    parent=_styles["Normal"],
    fontSize=11,
    textColor=colors.HexColor("#666666"),
    spaceAfter=6 * mm,
)

SECTION_STYLE = ParagraphStyle(
    "SectionHeader",
    parent=_styles["Heading2"],
    fontSize=14,
    spaceBefore=6 * mm,
    spaceAfter=3 * mm,
    textColor=colors.HexColor("#16213e"),
)

BODY_STYLE = ParagraphStyle(
    "Body",
    parent=_styles["Normal"],
    fontSize=10,
    textColor=colors.HexColor("#333333"),
    leading=14,
)

SMALL_STYLE = ParagraphStyle(
    "Small",
    parent=_styles["Normal"],
    fontSize=8,
    textColor=colors.HexColor("#999999"),
)


def _format_duration(seconds: float | None) -> str:
    if not seconds:
        return "—"
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    if hrs > 0:
        return f"{hrs}h {mins}m"
    return f"{mins}m"


def _format_distance(meters: float | None) -> str:
    if not meters:
        return "—"
    return f"{meters / 1000:.1f} km"


def _build_summary_table(
    rows: list[list[str]], col_widths: list[float] | None = None
) -> Table:
    """Build a styled summary table from rows of [label, value] pairs."""
    if col_widths is None:
        col_widths = [50 * mm, 50 * mm]

    table = Table(rows, colWidths=col_widths)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 10),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                (
                    "ROWBACKGROUNDS",
                    (0, 1),
                    (-1, -1),
                    [colors.white, colors.HexColor("#fafafa")],
                ),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ]
        )
    )
    return table


# ── Weekly Report ─────────────────────────────────────────────────────────


async def generate_weekly_report(
    db: AsyncSession,
    user_id: uuid.UUID,
    week_start: date,
) -> bytes:
    """Generate a PDF weekly training report.

    Args:
        db: Async database session.
        user_id: UUID of the user.
        week_start: Monday of the target week.

    Returns:
        PDF bytes.
    """
    week_end = week_start + timedelta(days=6)

    # ── Fetch user ───────────────────────────────────────────────────────
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    user_name = user.name if user and user.name else "Athlete"

    # ── Gather data ──────────────────────────────────────────────────────
    # Activities
    result = await db.execute(
        select(Activity)
        .where(
            Activity.user_id == user_id,
            Activity.source != "wahoo",
            Activity.start_date >= week_start,
            Activity.start_date <= week_end,
        )
        .order_by(Activity.start_date)
    )
    activities = list(result.scalars().all())

    # Lifting sessions
    result = await db.execute(
        select(LiftingSession)
        .where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date >= week_start,
            LiftingSession.session_date <= week_end,
        )
        .order_by(LiftingSession.session_date)
    )
    lifting_sessions = list(result.scalars().all())

    # Recovery / HRV
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == user_id,
            DailyMetric.metric_date >= week_start,
            DailyMetric.metric_date <= week_end,
            DailyMetric.recovery_score.isnot(None),
        )
        .order_by(DailyMetric.metric_date)
    )
    metrics = list(result.scalars().all())

    # Sleep
    result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == user_id,
            SleepLog.sleep_date >= week_start,
            SleepLog.sleep_date <= week_end,
        )
        .order_by(SleepLog.sleep_date)
    )
    sleep_logs = list(result.scalars().all())

    # PRs
    result = await db.execute(
        select(PersonalRecord)
        .where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.achieved_date >= week_start,
            PersonalRecord.achieved_date <= week_end,
        )
        .order_by(PersonalRecord.achieved_date)
    )
    prs = list(result.scalars().all())

    # ── Compute stats ────────────────────────────────────────────────────
    total_tss = sum(a.tss or 0 for a in activities)
    total_distance = sum(a.distance_meters or 0 for a in activities)
    total_cardio_time = sum(a.duration_seconds or 0 for a in activities)
    total_lifting_volume = sum(s.total_volume_kg or 0 for s in lifting_sessions)

    avg_recovery = (
        sum(m.recovery_score for m in metrics) / len(metrics) if metrics else None
    )
    avg_hrv = (
        sum(m.hrv_ms for m in metrics if m.hrv_ms)
        / len([m for m in metrics if m.hrv_ms])
        if any(m.hrv_ms for m in metrics)
        else None
    )
    sleep_seconds = [
        s.effective_total_sleep_seconds
        for s in sleep_logs
        if s.effective_total_sleep_seconds
    ]
    avg_sleep_hours = (
        round(sum(sleep_seconds) / len(sleep_seconds) / 3600, 1)
        if sleep_seconds
        else None
    )

    # ── Build PDF ────────────────────────────────────────────────────────
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    story: list = []

    # Header
    story.append(Paragraph("Weekly Training Report", TITLE_STYLE))
    story.append(
        Paragraph(
            f"{user_name} — {week_start.strftime('%b %d')} to {week_end.strftime('%b %d, %Y')}",
            SUBTITLE_STYLE,
        )
    )
    story.append(
        HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=1)
    )

    # Summary stats
    story.append(Paragraph("Summary", SECTION_STYLE))
    summary_rows = [
        ["Metric", "Value"],
        ["Total Sessions", f"{len(activities) + len(lifting_sessions)}"],
        ["Cardio Sessions", str(len(activities))],
        ["Lifting Sessions", str(len(lifting_sessions))],
        ["Total TSS", f"{total_tss:.0f}"],
        ["Total Distance", _format_distance(total_distance)],
        ["Cardio Time", _format_duration(total_cardio_time)],
        ["Lifting Volume", f"{total_lifting_volume:,.0f} kg"],
        ["New PRs", str(len(prs))],
    ]
    story.append(_build_summary_table(summary_rows))
    story.append(Spacer(1, 4 * mm))

    # Recovery / Sleep
    story.append(Paragraph("Recovery & Sleep", SECTION_STYLE))
    recovery_rows = [
        ["Metric", "Value"],
        ["Avg Recovery", f"{avg_recovery:.0f}%" if avg_recovery else "—"],
        ["Avg HRV", f"{avg_hrv:.0f} ms" if avg_hrv else "—"],
        ["Avg Sleep", f"{avg_sleep_hours}h" if avg_sleep_hours else "—"],
    ]
    story.append(_build_summary_table(recovery_rows))
    story.append(Spacer(1, 4 * mm))

    # Activity list
    if activities:
        story.append(Paragraph("Activities", SECTION_STYLE))
        act_rows = [["Date", "Name", "Sport", "Duration", "Distance", "TSS"]]
        for a in activities:
            act_rows.append(
                [
                    a.start_date.strftime("%a %d") if a.start_date else "—",
                    (a.name[:30] + "…")
                    if a.name and len(a.name) > 30
                    else (a.name or "—"),
                    a.sport_type or "—",
                    _format_duration(a.duration_seconds),
                    _format_distance(a.distance_meters),
                    f"{a.tss:.0f}" if a.tss else "—",
                ]
            )
        act_table = Table(
            act_rows, colWidths=[22 * mm, 55 * mm, 22 * mm, 22 * mm, 22 * mm, 17 * mm]
        )
        act_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#fafafa")],
                    ),
                ]
            )
        )
        story.append(act_table)
        story.append(Spacer(1, 4 * mm))

    # PR highlights
    if prs:
        story.append(Paragraph("🏆 Personal Records", SECTION_STYLE))
        pr_rows = [["Date", "Exercise", "Type", "Weight", "Reps", "Est. 1RM"]]
        for pr in prs:
            pr_rows.append(
                [
                    pr.achieved_date.strftime("%a %d"),
                    pr.exercise_name,
                    pr.record_type,
                    f"{pr.weight_kg:.1f} kg",
                    str(pr.reps),
                    f"{pr.estimated_1rm:.1f} kg" if pr.estimated_1rm else "—",
                ]
            )
        pr_table = Table(
            pr_rows, colWidths=[22 * mm, 40 * mm, 18 * mm, 22 * mm, 16 * mm, 22 * mm]
        )
        pr_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fff8e1")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#fffde7")],
                    ),
                ]
            )
        )
        story.append(pr_table)

    # Footer
    story.append(Spacer(1, 8 * mm))
    story.append(
        HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5)
    )
    story.append(
        Paragraph(
            f"Generated by FitTrack — {date.today().isoformat()}",
            SMALL_STYLE,
        )
    )

    doc.build(story)
    buf.seek(0)
    return buf.getvalue()


# ── Monthly Report ────────────────────────────────────────────────────────


async def generate_monthly_report(
    db: AsyncSession,
    user_id: uuid.UUID,
    month: str,
) -> bytes:
    """Generate a PDF monthly training report.

    Args:
        db: Async database session.
        user_id: UUID of the user.
        month: Month string in "YYYY-MM" format.

    Returns:
        PDF bytes.
    """
    year, mon = month.split("-")
    month_start = date(int(year), int(mon), 1)
    # Last day of month
    if int(mon) == 12:
        month_end = date(int(year) + 1, 1, 1) - timedelta(days=1)
    else:
        month_end = date(int(year), int(mon) + 1, 1) - timedelta(days=1)

    # Clamp to today if current month
    today = date.today()
    effective_end = min(month_end, today)

    # ── Fetch user ───────────────────────────────────────────────────────
    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    user_name = user.name if user and user.name else "Athlete"

    month_label = month_start.strftime("%B %Y")

    # ── Gather data ──────────────────────────────────────────────────────
    # Activities
    result = await db.execute(
        select(Activity)
        .where(
            Activity.user_id == user_id,
            Activity.source != "wahoo",
            Activity.start_date >= month_start,
            Activity.start_date <= effective_end,
        )
        .order_by(Activity.start_date)
    )
    activities = list(result.scalars().all())

    # Lifting sessions
    result = await db.execute(
        select(LiftingSession)
        .where(
            LiftingSession.user_id == user_id,
            LiftingSession.session_date >= month_start,
            LiftingSession.session_date <= effective_end,
        )
        .order_by(LiftingSession.session_date)
    )
    lifting_sessions = list(result.scalars().all())

    # Recovery / HRV
    result = await db.execute(
        select(DailyMetric)
        .where(
            DailyMetric.user_id == user_id,
            DailyMetric.metric_date >= month_start,
            DailyMetric.metric_date <= effective_end,
            DailyMetric.recovery_score.isnot(None),
        )
        .order_by(DailyMetric.metric_date)
    )
    metrics = list(result.scalars().all())

    # Sleep
    result = await db.execute(
        select(SleepLog)
        .where(
            SleepLog.user_id == user_id,
            SleepLog.sleep_date >= month_start,
            SleepLog.sleep_date <= effective_end,
        )
        .order_by(SleepLog.sleep_date)
    )
    sleep_logs = list(result.scalars().all())

    # PRs
    result = await db.execute(
        select(PersonalRecord)
        .where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.achieved_date >= month_start,
            PersonalRecord.achieved_date <= effective_end,
        )
        .order_by(PersonalRecord.achieved_date)
    )
    prs = list(result.scalars().all())

    # ── Compute stats ────────────────────────────────────────────────────
    total_tss = sum(a.tss or 0 for a in activities)
    total_distance = sum(a.distance_meters or 0 for a in activities)
    total_cardio_time = sum(a.duration_seconds or 0 for a in activities)
    total_lifting_volume = sum(s.total_volume_kg or 0 for s in lifting_sessions)
    total_sessions = len(activities) + len(lifting_sessions)

    avg_recovery = (
        sum(m.recovery_score for m in metrics) / len(metrics) if metrics else None
    )
    avg_hrv_vals = [m.hrv_ms for m in metrics if m.hrv_ms]
    avg_hrv = sum(avg_hrv_vals) / len(avg_hrv_vals) if avg_hrv_vals else None
    sleep_seconds = [
        s.effective_total_sleep_seconds
        for s in sleep_logs
        if s.effective_total_sleep_seconds
    ]
    avg_sleep_hours = (
        round(sum(sleep_seconds) / len(sleep_seconds) / 3600, 1)
        if sleep_seconds
        else None
    )

    # ── Build PDF ────────────────────────────────────────────────────────
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    story: list = []

    # Header
    story.append(Paragraph("Monthly Training Report", TITLE_STYLE))
    story.append(Paragraph(f"{user_name} — {month_label}", SUBTITLE_STYLE))
    story.append(
        HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=1)
    )

    # Summary stats
    story.append(Paragraph("Summary", SECTION_STYLE))
    summary_rows = [
        ["Metric", "Value"],
        ["Total Sessions", str(total_sessions)],
        ["Cardio Sessions", str(len(activities))],
        ["Lifting Sessions", str(len(lifting_sessions))],
        ["Total TSS", f"{total_tss:.0f}"],
        ["Total Distance", _format_distance(total_distance)],
        ["Cardio Time", _format_duration(total_cardio_time)],
        ["Lifting Volume", f"{total_lifting_volume:,.0f} kg"],
        ["New PRs", str(len(prs))],
    ]
    story.append(_build_summary_table(summary_rows))
    story.append(Spacer(1, 4 * mm))

    # Recovery / Sleep
    story.append(Paragraph("Recovery & Sleep", SECTION_STYLE))
    recovery_rows = [
        ["Metric", "Value"],
        ["Avg Recovery", f"{avg_recovery:.0f}%" if avg_recovery else "—"],
        ["Avg HRV", f"{avg_hrv:.0f} ms" if avg_hrv else "—"],
        ["Avg Sleep", f"{avg_sleep_hours}h" if avg_sleep_hours else "—"],
    ]
    story.append(_build_summary_table(recovery_rows))
    story.append(Spacer(1, 4 * mm))

    # Weekly breakdown within the month
    story.append(Paragraph("Weekly Breakdown", SECTION_STYLE))
    week_rows = [["Week", "Sessions", "TSS", "Distance", "Lifting Vol"]]
    # Split activities and lifting into weeks
    current = month_start
    week_num = 1
    while current <= effective_end:
        w_end = min(current + timedelta(days=6), effective_end)
        w_acts = [a for a in activities if current <= a.start_date.date() <= w_end]
        w_lifts = [s for s in lifting_sessions if current <= s.session_date <= w_end]
        w_tss = sum(a.tss or 0 for a in w_acts)
        w_dist = sum(a.distance_meters or 0 for a in w_acts)
        w_vol = sum(s.total_volume_kg or 0 for s in w_lifts)
        week_rows.append(
            [
                f"Wk {week_num} ({current.strftime('%b %d')})",
                f"{len(w_acts) + len(w_lifts)}",
                f"{w_tss:.0f}",
                _format_distance(w_dist),
                f"{w_vol:,.0f} kg",
            ]
        )
        current += timedelta(days=7)
        week_num += 1

    wk_table = Table(week_rows, colWidths=[35 * mm, 22 * mm, 22 * mm, 25 * mm, 30 * mm])
    wk_table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                (
                    "ROWBACKGROUNDS",
                    (0, 1),
                    (-1, -1),
                    [colors.white, colors.HexColor("#fafafa")],
                ),
            ]
        )
    )
    story.append(wk_table)
    story.append(Spacer(1, 4 * mm))

    # Activity list (limit to 25 most recent to avoid overly long reports)
    if activities:
        story.append(Paragraph("Activities", SECTION_STYLE))
        act_rows = [["Date", "Name", "Sport", "Duration", "Distance", "TSS"]]
        for a in activities[-25:]:
            act_rows.append(
                [
                    a.start_date.strftime("%a %d") if a.start_date else "—",
                    (a.name[:28] + "…")
                    if a.name and len(a.name) > 28
                    else (a.name or "—"),
                    a.sport_type or "—",
                    _format_duration(a.duration_seconds),
                    _format_distance(a.distance_meters),
                    f"{a.tss:.0f}" if a.tss else "—",
                ]
            )
        act_table = Table(
            act_rows, colWidths=[22 * mm, 55 * mm, 22 * mm, 22 * mm, 22 * mm, 17 * mm]
        )
        act_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#fafafa")],
                    ),
                ]
            )
        )
        story.append(act_table)
        story.append(Spacer(1, 4 * mm))

    # PR highlights
    if prs:
        story.append(Paragraph("🏆 Personal Records", SECTION_STYLE))
        pr_rows = [["Date", "Exercise", "Type", "Weight", "Reps", "Est. 1RM"]]
        for pr in prs:
            pr_rows.append(
                [
                    pr.achieved_date.strftime("%a %d"),
                    pr.exercise_name,
                    pr.record_type,
                    f"{pr.weight_kg:.1f} kg",
                    str(pr.reps),
                    f"{pr.estimated_1rm:.1f} kg" if pr.estimated_1rm else "—",
                ]
            )
        pr_table = Table(
            pr_rows, colWidths=[22 * mm, 40 * mm, 18 * mm, 22 * mm, 16 * mm, 22 * mm]
        )
        pr_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fff8e1")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#fffde7")],
                    ),
                ]
            )
        )
        story.append(pr_table)

    # Footer
    story.append(Spacer(1, 8 * mm))
    story.append(
        HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5)
    )
    story.append(
        Paragraph(
            f"Generated by FitTrack — {date.today().isoformat()}",
            SMALL_STYLE,
        )
    )

    doc.build(story)
    buf.seek(0)
    return buf.getvalue()


# ── Race-Day Prep Report (§3.14) ──────────────────────────────────────────


async def generate_event_report(
    db: AsyncSession,
    user_id: uuid.UUID,
    event_id: uuid.UUID,
) -> bytes:
    """Generate a PDF race-day prep report for an event.

    Wraps event overview, freshness (TSB projection toward the event date),
    plan conformity, a taper checklist, a bike-leg fuel plan, and the
    race-week weather forecast for the user's home location.

    Args:
        db: Async database session.
        user_id: UUID of the user.
        event_id: UUID of the event.

    Returns:
        PDF bytes.

    Raises:
        ValueError: if the event cannot be found for the user.
    """
    result = await db.execute(
        select(Event).where(Event.id == event_id, Event.user_id == user_id)
    )
    event = result.scalar_one_or_none()
    if not event:
        raise ValueError("Event not found")

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    user_name = user.name if user and user.name else "Athlete"

    today = date.today()
    days_until = (event.event_date - today).days

    # ── Plan linked to the event ────────────────────────────────────────
    result = await db.execute(
        select(TrainingPlan)
        .options(selectinload(TrainingPlan.days))
        .where(TrainingPlan.user_id == user_id, TrainingPlan.event_id == event.id)
        .order_by(TrainingPlan.start_date.desc())
    )
    plan = result.scalars().first()

    # ── Freshness (TSB projection toward event day) ─────────────────────
    tsb_info: dict | None = None
    if plan is not None and days_until >= 0:
        from app.services.projections import compute_tsb_projection

        try:
            tsb_info = await compute_tsb_projection(
                db, user_id, plan.id, days_ahead=max(1, days_until)
            )
        except ValueError:
            tsb_info = None

    # ── Plan conformity ─────────────────────────────────────────────────
    conformity: dict | None = None
    if plan is not None:
        from app.services.conformity import get_plan_conformity

        try:
            conformity = await get_plan_conformity(db, user_id, plan.id)
        except ValueError:
            conformity = None

    # ── Taper checklist ─────────────────────────────────────────────────
    taper_days = event.taper_days or 14
    taper_start = event.event_date - timedelta(days=taper_days)
    taper_days_ctx = [
        d
        for d in (plan.days if plan else [])
        if taper_start <= d.day_date <= event.event_date and d.day_date >= today
    ]

    # ── Fuel plan (planned duration / IF, no activity needed) ───────────
    from app.services.nutrition import _get_weight_kg, compute_fuel_targets

    weight_kg = await _get_weight_kg(db, user_id)
    race_day = next(
        (d for d in (plan.days if plan else []) if d.day_date == event.event_date),
        None,
    )
    if race_day and race_day.planned_duration_min:
        duration_min = int(race_day.planned_duration_min)
    elif event.target_tss:
        # Duration from TSS = hours * IF^2 * 100 at the 0.75 default IF
        duration_min = max(60, round(event.target_tss / 56.25))
    else:
        duration_min = 120
    planned_if = 0.75
    fuel = compute_fuel_targets(duration_min, planned_if, weight_kg)

    # ── Race-week weather (home location) ───────────────────────────────
    from app.services.weather import get_forecast, resolve_user_coords

    forecast: dict | None = None
    coords = await resolve_user_coords(db, user_id)
    if coords:
        try:
            forecast = await get_forecast(db, user_id, coords[0], coords[1], days=7)
        except Exception:
            forecast = None
    forecast_days = (forecast or {}).get("days", [])

    # ── Build PDF ────────────────────────────────────────────────────────
    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf,
        pagesize=A4,
        leftMargin=20 * mm,
        rightMargin=20 * mm,
        topMargin=15 * mm,
        bottomMargin=15 * mm,
    )

    story: list = []

    story.append(Paragraph("Race-Day Prep Report", TITLE_STYLE))
    story.append(
        Paragraph(
            f"{user_name} — {event.name} on {event.event_date.strftime('%A, %b %d, %Y')}",
            SUBTITLE_STYLE,
        )
    )
    story.append(
        HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=1)
    )

    # Event overview
    story.append(Paragraph("Event Overview", SECTION_STYLE))
    overview_rows: list[list[str]] = [
        ["Metric", "Value"],
        ["Event", event.name],
        ["Date", event.event_date.isoformat()],
        ["Type", event.event_type.title()],
        ["Days Until", f"{days_until} days"],
        ["Target TSS", f"{event.target_tss:.0f}" if event.target_tss else "—"],
        ["Taper Length", f"{taper_days} days"],
    ]
    if event.notes:
        overview_rows.append(["Notes", event.notes])
    story.append(_build_summary_table(overview_rows))
    story.append(Spacer(1, 4 * mm))

    # Readiness
    story.append(Paragraph("Readiness", SECTION_STYLE))
    if tsb_info and tsb_info.get("race_day_tsb") is not None:
        story.append(
            _build_summary_table(
                [
                    ["Metric", "Value"],
                    ["Current TSB", f"{tsb_info['current_tsb']:.1f}"],
                    ["Race-Day TSB (projected)", f"{tsb_info['race_day_tsb']:.1f}"],
                    ["Assessment", tsb_info.get("freshness_assessment") or "—"],
                ]
            )
        )
        proj = tsb_info.get("projection") or []
        if proj:
            story.append(Spacer(1, 3 * mm))
            story.append(Paragraph("TSB projection (next days)", BODY_STYLE))
            proj_rows = [["Date", "CTL", "ATL", "TSB"]]
            for p in proj[-8:]:
                proj_rows.append(
                    [
                        p["date"].strftime("%b %d"),
                        f"{p['ctl']:.0f}",
                        f"{p['atl']:.0f}",
                        f"{p['tsb']:.0f}",
                    ]
                )
            proj_table = Table(
                proj_rows, colWidths=[30 * mm, 30 * mm, 30 * mm, 30 * mm]
            )
            proj_table.setStyle(
                TableStyle(
                    [
                        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8f0ff")),
                        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                        ("FONTSIZE", (0, 0), (-1, -1), 8),
                        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                        ("ALIGN", (1, 0), (-1, -1), "RIGHT"),
                    ]
                )
            )
            story.append(proj_table)
    else:
        story.append(
            Paragraph(
                "No linked training plan (or event date is in the past) — link a "
                "plan to see your freshness projection.",
                BODY_STYLE,
            )
        )
    story.append(Spacer(1, 4 * mm))

    # Plan conformity
    story.append(Paragraph("Plan Conformity", SECTION_STYLE))
    if conformity:
        if conformity["overall_pct"] is not None:
            story.append(
                Paragraph(
                    f"Overall: {conformity['overall_pct']:.0f}% "
                    f"({conformity['trend'] or '—'})",
                    BODY_STYLE,
                )
            )
        else:
            story.append(Paragraph("No scored sessions yet.", BODY_STYLE))
        story.append(Spacer(1, 3 * mm))
        wk_rows = [["Week", "Start", "Scored Days", "Pct", "Cycle", "Strength"]]
        for w in conformity["weeks"]:
            wk_rows.append(
                [
                    str(w["week_number"]),
                    w["week_start"].strftime("%b %d"),
                    f"{w['days_scored']}/{w['days_total']}",
                    f"{w['pct']:.0f}%" if w["pct"] is not None else "—",
                    f"{w['by_sport']['cycle']:.0f}%"
                    if w["by_sport"]["cycle"] is not None
                    else "—",
                    f"{w['by_sport']['strength']:.0f}%"
                    if w["by_sport"]["strength"] is not None
                    else "—",
                ]
            )
        wk_table = Table(
            wk_rows, colWidths=[18 * mm, 25 * mm, 28 * mm, 18 * mm, 18 * mm, 25 * mm]
        )
        wk_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#fafafa")],
                    ),
                    ("ALIGN", (3, 0), (5, -1), "RIGHT"),
                ]
            )
        )
        story.append(wk_table)
        if conformity.get("patterns"):
            story.append(Spacer(1, 3 * mm))
            story.append(Paragraph("Observations", BODY_STYLE))
            for pattern in conformity["patterns"]:
                story.append(Paragraph(f"− {pattern}", BODY_STYLE))
    else:
        story.append(Paragraph("No plan conformity data available.", BODY_STYLE))
    story.append(Spacer(1, 4 * mm))

    # Taper checklist
    story.append(Paragraph("Taper Checklist", SECTION_STYLE))
    if taper_days_ctx:
        taper_rows = [["Date", "Sport", "Type", "TSS", "Duration", "Focus"]]
        for d in taper_days_ctx:
            taper_rows.append(
                [
                    d.day_date.strftime("%a %d"),
                    d.sport.title(),
                    d.planned_type.title(),
                    f"{d.planned_tss:.0f}" if d.planned_tss else "—",
                    f"{d.planned_duration_min} min" if d.planned_duration_min else "—",
                    (d.planned_focus or "—").replace("_", " "),
                ]
            )
        taper_table = Table(
            taper_rows, colWidths=[22 * mm, 20 * mm, 22 * mm, 17 * mm, 22 * mm, 29 * mm]
        )
        taper_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#fafafa")],
                    ),
                ]
            )
        )
        story.append(taper_table)
    else:
        story.append(
            Paragraph(
                "No upcoming plan days in the taper window — link a plan and add "
                "days to build the checklist.",
                BODY_STYLE,
            )
        )
    story.append(Spacer(1, 4 * mm))

    # Fuel plan
    story.append(Paragraph("Fuel Plan", SECTION_STYLE))
    story.append(
        _build_summary_table(
            [
                ["Metric", "Value"],
                ["Est. Duration", f"{duration_min} min"],
                ["Assumed IF", f"{planned_if:.2f}"],
                ["Body Weight", f"{weight_kg:.1f} kg"],
                ["Pre-Ride Carbs", f"{fuel['pre_ride_carbs_g']:.0f} g"],
                ["During Carbs", f"{fuel['during_carbs_per_hour_g']:.0f} g/h"],
                ["Hydration", f"{fuel['during_hydration_ml_per_hour']:.0f} ml/h"],
                ["Sodium", f"{fuel['during_sodium_mg_per_hour']:.0f} mg/h"],
                ["Post-Ride Carbs", f"{fuel['post_ride_carbs_g']:.0f} g"],
                ["Post-Ride Protein", f"{fuel['post_ride_protein_g']:.0f} g"],
            ]
        )
    )
    if fuel.get("schedule"):
        story.append(Spacer(1, 3 * mm))
        story.append(Paragraph("Feeding schedule", BODY_STYLE))
        sched_rows = [["Time", "Carbs", "Fluid", "Sodium", "Suggestion"]]
        for s in fuel["schedule"]:
            sched_rows.append(
                [
                    f"{s['time_min']} min",
                    f"{s['carbs_g']} g",
                    f"{s['hydration_ml']} ml",
                    f"{s['sodium_mg']} mg",
                    s["suggestion"],
                ]
            )
        sched_table = Table(
            sched_rows,
            colWidths=[20 * mm, 18 * mm, 20 * mm, 22 * mm, 52 * mm],
        )
        sched_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#fafafa")],
                    ),
                ]
            )
        )
        story.append(sched_table)
    story.append(Spacer(1, 4 * mm))

    # Race-week weather
    story.append(Paragraph("Race-Week Weather", SECTION_STYLE))
    if forecast_days:
        event_day = next(
            (f for f in forecast_days if f["date"] == event.event_date.isoformat()),
            None,
        )
        if event_day:
            story.append(
                Paragraph(
                    f"Event day ({event.event_date.strftime('%A, %b %d')}):",
                    BODY_STYLE,
                )
            )
            story.append(
                _build_summary_table(
                    [
                        ["Metric", "Value"],
                        ["Conditions", event_day.get("conditions") or "—"],
                        [
                            "High / Low",
                            f"{event_day['temp_max']:.0f}° / {event_day['temp_min']:.0f}°"
                            if event_day.get("temp_max") is not None
                            else "—",
                        ],
                        [
                            "Precip. Probability",
                            f"{event_day['precipitation_probability']:.0f}%"
                            if event_day.get("precipitation_probability") is not None
                            else "—",
                        ],
                        [
                            "Wind",
                            f"{event_day['wind_speed_max']:.0f} km/h"
                            if event_day.get("wind_speed_max") is not None
                            else "—",
                        ],
                    ]
                )
            )
            story.append(Spacer(1, 3 * mm))
        fc_rows = [["Date", "Conditions", "High", "Low", "Precip", "Wind"]]
        for f in forecast_days:
            fc_rows.append(
                [
                    f["date"],
                    f.get("conditions") or "—",
                    f"{f['temp_max']:.0f}°" if f.get("temp_max") is not None else "—",
                    f"{f['temp_min']:.0f}°" if f.get("temp_min") is not None else "—",
                    f"{f['precipitation_probability']:.0f}%"
                    if f.get("precipitation_probability") is not None
                    else "—",
                    f"{f['wind_speed_max']:.0f} km/h"
                    if f.get("wind_speed_max") is not None
                    else "—",
                ]
            )
        fc_table = Table(
            fc_rows,
            colWidths=[28 * mm, 32 * mm, 18 * mm, 18 * mm, 18 * mm, 18 * mm],
        )
        fc_table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
                    ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                    ("FONTSIZE", (0, 0), (-1, -1), 8),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                    ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
                    ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
                    (
                        "ROWBACKGROUNDS",
                        (0, 1),
                        (-1, -1),
                        [colors.white, colors.HexColor("#fafafa")],
                    ),
                ]
            )
        )
        story.append(fc_table)
    else:
        story.append(
            Paragraph(
                "Forecast unavailable (no home location set, or weather service "
                "error).",
                BODY_STYLE,
            )
        )

    # Footer
    story.append(Spacer(1, 8 * mm))
    story.append(
        HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5)
    )
    story.append(
        Paragraph(
            f"Generated by FitTrack — {today.isoformat()}. "
            "Fuel targets are estimates based on planned duration and IF 0.75.",
            SMALL_STYLE,
        )
    )

    doc.build(story)
    buf.seek(0)
    return buf.getvalue()
