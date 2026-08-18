"""PDF report generation service — weekly and monthly training reports."""

import io
import uuid
from datetime import date, timedelta

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.lifting import LiftingSession, PersonalRecord
from app.models.sleep import SleepLog
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


def _build_summary_table(rows: list[list[str]], col_widths: list[float] | None = None) -> Table:
    """Build a styled summary table from rows of [label, value] pairs."""
    if col_widths is None:
        col_widths = [50 * mm, 50 * mm]

    table = Table(rows, colWidths=col_widths)
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
        ("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor("#1a1a2e")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
        ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ]))
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
        sum(m.hrv_ms for m in metrics if m.hrv_ms) / len([m for m in metrics if m.hrv_ms])
        if any(m.hrv_ms for m in metrics)
        else None
    )
    sleep_seconds = [s.total_sleep_seconds for s in sleep_logs if s.total_sleep_seconds]
    avg_sleep_hours = (
        round(sum(sleep_seconds) / len(sleep_seconds) / 3600, 1) if sleep_seconds else None
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
    story.append(Paragraph(f"Weekly Training Report", TITLE_STYLE))
    story.append(Paragraph(
        f"{user_name} — {week_start.strftime('%b %d')} to {week_end.strftime('%b %d, %Y')}",
        SUBTITLE_STYLE,
    ))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=1))

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
            act_rows.append([
                a.start_date.strftime("%a %d") if a.start_date else "—",
                (a.name[:30] + "…") if a.name and len(a.name) > 30 else (a.name or "—"),
                a.sport_type or "—",
                _format_duration(a.duration_seconds),
                _format_distance(a.distance_meters),
                f"{a.tss:.0f}" if a.tss else "—",
            ])
        act_table = Table(act_rows, colWidths=[22 * mm, 55 * mm, 22 * mm, 22 * mm, 22 * mm, 17 * mm])
        act_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
        ]))
        story.append(act_table)
        story.append(Spacer(1, 4 * mm))

    # PR highlights
    if prs:
        story.append(Paragraph("🏆 Personal Records", SECTION_STYLE))
        pr_rows = [["Date", "Exercise", "Type", "Weight", "Reps", "Est. 1RM"]]
        for pr in prs:
            pr_rows.append([
                pr.achieved_date.strftime("%a %d"),
                pr.exercise_name,
                pr.record_type,
                f"{pr.weight_kg:.1f} kg",
                str(pr.reps),
                f"{pr.estimated_1rm:.1f} kg" if pr.estimated_1rm else "—",
            ])
        pr_table = Table(pr_rows, colWidths=[22 * mm, 40 * mm, 18 * mm, 22 * mm, 16 * mm, 22 * mm])
        pr_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fff8e1")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fffde7")]),
        ]))
        story.append(pr_table)

    # Footer
    story.append(Spacer(1, 8 * mm))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Paragraph(
        f"Generated by FitTrack — {date.today().isoformat()}",
        SMALL_STYLE,
    ))

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
    sleep_seconds = [s.total_sleep_seconds for s in sleep_logs if s.total_sleep_seconds]
    avg_sleep_hours = (
        round(sum(sleep_seconds) / len(sleep_seconds) / 3600, 1) if sleep_seconds else None
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
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=1))

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
        week_rows.append([
            f"Wk {week_num} ({current.strftime('%b %d')})",
            f"{len(w_acts) + len(w_lifts)}",
            f"{w_tss:.0f}",
            _format_distance(w_dist),
            f"{w_vol:,.0f} kg",
        ])
        current += timedelta(days=7)
        week_num += 1

    wk_table = Table(week_rows, colWidths=[35 * mm, 22 * mm, 22 * mm, 25 * mm, 30 * mm])
    wk_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
    ]))
    story.append(wk_table)
    story.append(Spacer(1, 4 * mm))

    # Activity list (limit to 25 most recent to avoid overly long reports)
    if activities:
        story.append(Paragraph("Activities", SECTION_STYLE))
        act_rows = [["Date", "Name", "Sport", "Duration", "Distance", "TSS"]]
        for a in activities[-25:]:
            act_rows.append([
                a.start_date.strftime("%a %d") if a.start_date else "—",
                (a.name[:28] + "…") if a.name and len(a.name) > 28 else (a.name or "—"),
                a.sport_type or "—",
                _format_duration(a.duration_seconds),
                _format_distance(a.distance_meters),
                f"{a.tss:.0f}" if a.tss else "—",
            ])
        act_table = Table(act_rows, colWidths=[22 * mm, 55 * mm, 22 * mm, 22 * mm, 22 * mm, 17 * mm])
        act_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f0f0f5")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fafafa")]),
        ]))
        story.append(act_table)
        story.append(Spacer(1, 4 * mm))

    # PR highlights
    if prs:
        story.append(Paragraph("🏆 Personal Records", SECTION_STYLE))
        pr_rows = [["Date", "Exercise", "Type", "Weight", "Reps", "Est. 1RM"]]
        for pr in prs:
            pr_rows.append([
                pr.achieved_date.strftime("%a %d"),
                pr.exercise_name,
                pr.record_type,
                f"{pr.weight_kg:.1f} kg",
                str(pr.reps),
                f"{pr.estimated_1rm:.1f} kg" if pr.estimated_1rm else "—",
            ])
        pr_table = Table(pr_rows, colWidths=[22 * mm, 40 * mm, 18 * mm, 22 * mm, 16 * mm, 22 * mm])
        pr_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#fff8e1")),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
            ("TOPPADDING", (0, 0), (-1, -1), 2 * mm),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e0e0e0")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#fffde7")]),
        ]))
        story.append(pr_table)

    # Footer
    story.append(Spacer(1, 8 * mm))
    story.append(HRFlowable(width="100%", color=colors.HexColor("#e0e0e0"), thickness=0.5))
    story.append(Paragraph(
        f"Generated by FitTrack — {date.today().isoformat()}",
        SMALL_STYLE,
    ))

    doc.build(story)
    buf.seek(0)
    return buf.getvalue()
