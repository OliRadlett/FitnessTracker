"""Chart service — ChartData/ChartSeries dataclasses, ChartService with chart methods."""

import uuid
from dataclasses import dataclass, field
from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.daily_metric import DailyMetric
from app.models.lifting import LiftingSession, LiftingSet, PersonalRecord
from app.models.sleep import SleepLog
from app.models.cycling import CyclingProfile
from app.services.cycling import (
    compute_training_load,
    get_daily_tss,
    compute_power_curve_from_streams,
    compute_power_zones_from_streams,
    estimate_ftp_from_power_curve,
    POWER_DURATION_BUCKETS,
    get_or_create_cycling_profile,
)


# ── Data classes ──────────────────────────────────────────────────────────────


@dataclass
class ChartSeries:
    name: str
    data: list[float | int | None] = field(default_factory=list)
    color: str | None = None


@dataclass
class ChartData:
    chart_type: str  # line, bar, scatter, area, pie
    title: str
    labels: list[str] = field(default_factory=list)
    series: list[ChartSeries] = field(default_factory=list)
    x_label: str = ""
    y_label: str = ""


# ── Chart Service ─────────────────────────────────────────────────────────────


class ChartService:
    """Generates chart data from the database for various fitness metrics."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Power curve (best power at each duration) ─────────────────────────────

    async def power_curve(self, user_id: uuid.UUID, days: int = 90) -> ChartData:
        cutoff = date.today() - timedelta(days=days)

        result = await db_execute(
            self.db,
            select(Activity)
            .where(
                Activity.user_id == user_id,
                Activity.average_power.isnot(None),
                Activity.start_date >= cutoff,
            )
            .order_by(Activity.average_power.desc())
        )
        activities = list(result.scalars().all())

        # Group by duration buckets
        buckets: dict[str, float] = {}
        for act in activities:
            if act.duration_seconds and act.average_power:
                bucket = self._duration_bucket(act.duration_seconds)
                if bucket not in buckets or act.average_power > buckets[bucket]:
                    buckets[bucket] = act.average_power

        sorted_buckets = sorted(buckets.items(), key=lambda x: self._bucket_order(x[0]))
        return ChartData(
            chart_type="line",
            title="Power Curve",
            labels=[b[0] for b in sorted_buckets],
            series=[ChartSeries(name="Best Power (W)", data=[b[1] for b in sorted_buckets])],
            x_label="Duration",
            y_label="Power (W)",
        )

    # ── FTP over time ─────────────────────────────────────────────────────────

    async def ftp_over_time(self, user_id: uuid.UUID) -> ChartData:
        """FTP estimated from best 20-min power × 0.95."""
        result = await db_execute(
            self.db,
            select(Activity)
            .where(
                Activity.user_id == user_id,
                Activity.sport_type == "cycling",
                Activity.duration_seconds.between(1080, 1320),  # ~18-22 min
                Activity.average_power.isnot(None),
            )
            .order_by(Activity.start_date)
        )
        activities = list(result.scalars().all())

        labels = []
        data = []
        for act in activities:
            if act.average_power:
                labels.append(act.start_date.strftime("%Y-%m-%d"))
                data.append(round(act.average_power * 0.95, 1))

        return ChartData(
            chart_type="line",
            title="FTP Over Time",
            labels=labels,
            series=[ChartSeries(name="Estimated FTP (W)", data=data)],
            x_label="Date",
            y_label="FTP (W)",
        )

    # ── Weekly TSS ─────────────────────────────────────────────────────────────

    async def weekly_tss(self, user_id: uuid.UUID, weeks: int = 16) -> ChartData:
        cutoff = date.today() - timedelta(weeks=weeks)
        week_start = func.date_trunc("week", Activity.start_date).label("week_start")

        result = await db_execute(
            self.db,
            select(
                week_start,
                func.sum(Activity.tss).label("total_tss"),
            )
            .where(
                Activity.user_id == user_id,
                Activity.tss.isnot(None),
                Activity.start_date >= cutoff,
            )
            .group_by(week_start)
            .order_by(week_start)
        )
        rows = result.all()

        return ChartData(
            chart_type="bar",
            title="Weekly TSS",
            labels=[r.week_start.strftime("%Y-%m-%d") if hasattr(r.week_start, "strftime") else str(r.week_start) for r in rows],
            series=[ChartSeries(name="TSS", data=[float(r.total_tss or 0) for r in rows])],
            x_label="Week",
            y_label="TSS",
        )

    # ── Estimated 1RM history ─────────────────────────────────────────────────

    async def estimated_1rm_history(
        self, user_id: uuid.UUID, exercise_name: str
    ) -> ChartData:
        result = await db_execute(
            self.db,
            select(PersonalRecord)
            .where(
                PersonalRecord.user_id == user_id,
                PersonalRecord.exercise_name == exercise_name,
                PersonalRecord.record_type == "1rm",
            )
            .order_by(PersonalRecord.achieved_date)
        )
        prs = list(result.scalars().all())

        return ChartData(
            chart_type="line",
            title=f"Estimated 1RM — {exercise_name}",
            labels=[pr.achieved_date.isoformat() for pr in prs],
            series=[ChartSeries(name="Est. 1RM (kg)", data=[pr.estimated_1rm or 0 for pr in prs])],
            x_label="Date",
            y_label="1RM (kg)",
        )

    # ── Weekly volume ─────────────────────────────────────────────────────────

    async def weekly_volume(self, user_id: uuid.UUID, weeks: int = 16) -> ChartData:
        cutoff = date.today() - timedelta(weeks=weeks)
        week_start = func.date_trunc("week", LiftingSession.session_date).label("week_start")

        result = await db_execute(
            self.db,
            select(
                week_start,
                func.sum(LiftingSession.total_volume_kg).label("total_volume"),
            )
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= cutoff,
            )
            .group_by(week_start)
            .order_by(week_start)
        )
        rows = result.all()

        return ChartData(
            chart_type="bar",
            title="Weekly Lifting Volume",
            labels=[r.week_start.strftime("%Y-%m-%d") if hasattr(r.week_start, "strftime") else str(r.week_start) for r in rows],
            series=[ChartSeries(name="Volume (kg)", data=[float(r.total_volume or 0) for r in rows])],
            x_label="Week",
            y_label="Volume (kg)",
        )

    # ── HRV trend ─────────────────────────────────────────────────────────────

    async def hrv_trend(self, user_id: uuid.UUID, days: int = 90) -> ChartData:
        cutoff = date.today() - timedelta(days=days)

        result = await db_execute(
            self.db,
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.hrv_ms.isnot(None),
                DailyMetric.metric_date >= cutoff,
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = list(result.scalars().all())

        return ChartData(
            chart_type="line",
            title="HRV Trend",
            labels=[m.metric_date.isoformat() for m in metrics],
            series=[ChartSeries(name="HRV (ms)", data=[m.hrv_ms for m in metrics])],
            x_label="Date",
            y_label="HRV (ms)",
        )

    # ── Recovery vs Strain ────────────────────────────────────────────────────

    async def recovery_vs_strain(self, user_id: uuid.UUID, days: int = 30) -> ChartData:
        cutoff = date.today() - timedelta(days=days)

        result = await db_execute(
            self.db,
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= cutoff,
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = list(result.scalars().all())

        return ChartData(
            chart_type="line",
            title="Recovery vs Strain",
            labels=[m.metric_date.isoformat() for m in metrics],
            series=[
                ChartSeries(name="Recovery %", data=[m.recovery_score for m in metrics]),
                ChartSeries(name="Strain", data=[m.strain for m in metrics]),
            ],
            x_label="Date",
            y_label="Score",
        )

    # ── Whoop strain trend ─────────────────────────────────────────────────────

    async def whoop_strain_trend(self, user_id: uuid.UUID, days: int = 30) -> ChartData:
        """Daily strain score over time from Whoop cycles.

        Bar chart with strain values, colored by intensity:
        - Low (< 10): green
        - Moderate (10-14): yellow
        - High (14-18): orange
        - Very High (> 18): red
        """
        cutoff = date.today() - timedelta(days=days)

        result = await db_execute(
            self.db,
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.strain.isnot(None),
                DailyMetric.metric_date >= cutoff,
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = list(result.scalars().all())

        # Color bars by intensity
        colors = []
        for m in metrics:
            s = m.strain or 0
            if s >= 18:
                colors.append("#ef4444")  # red
            elif s >= 14:
                colors.append("#f97316")  # orange
            elif s >= 10:
                colors.append("#eab308")  # yellow
            else:
                colors.append("#22c55e")  # green

        return ChartData(
            chart_type="bar",
            title="Whoop Strain Trend",
            labels=[m.metric_date.isoformat() for m in metrics],
            series=[
                ChartSeries(
                    name="Strain",
                    data=[m.strain for m in metrics],
                    color="#f97316",
                )
            ],
            x_label="Date",
            y_label="Strain (0-21)",
        )

    # ── Sleep quality trend ───────────────────────────────────────────────────

    async def sleep_quality_trend(self, user_id: uuid.UUID, days: int = 90) -> ChartData:
        cutoff = date.today() - timedelta(days=days)

        result = await db_execute(
            self.db,
            select(SleepLog)
            .where(
                SleepLog.user_id == user_id,
                SleepLog.sleep_date >= cutoff,
            )
            .order_by(SleepLog.sleep_date)
        )
        logs = list(result.scalars().all())

        total_hours = []
        efficiencies = []
        for log in logs:
            if log.total_sleep_seconds:
                total_hours.append(round(log.total_sleep_seconds / 3600, 1))
            else:
                total_hours.append(None)
            efficiencies.append(log.sleep_efficiency)

        return ChartData(
            chart_type="line",
            title="Sleep Quality Trend",
            labels=[log.sleep_date.isoformat() for log in logs],
            series=[
                ChartSeries(name="Sleep Hours", data=total_hours),
                ChartSeries(name="Efficiency %", data=efficiencies),
            ],
            x_label="Date",
            y_label="Hours / %",
        )

    # ── Training load chart (CTL / ATL / TSB) ─────────────────────────────────

    async def training_load(self, user_id: uuid.UUID, days: int = 90) -> ChartData:
        """CTL, ATL, TSB over time."""
        end_date = date.today()
        start_date = end_date - timedelta(days=days + 42)

        daily_tss = await get_daily_tss(self.db, user_id, start_date, end_date)
        load_data = compute_training_load(daily_tss, end_date, lookback_days=days)

        labels = [d["date"].isoformat() for d in load_data]

        return ChartData(
            chart_type="line",
            title="Training Load (CTL / ATL / TSB)",
            labels=labels,
            series=[
                ChartSeries(name="CTL (Fitness)", data=[d["ctl"] for d in load_data], color="#22c55e"),
                ChartSeries(name="ATL (Fatigue)", data=[d["atl"] for d in load_data], color="#ef4444"),
                ChartSeries(name="TSB (Form)", data=[d["tsb"] for d in load_data], color="#3b82f6"),
            ],
            x_label="Date",
            y_label="Load (TSS/day)",
        )

    # ── FTP history chart ─────────────────────────────────────────────────────

    async def ftp_history(self, user_id: uuid.UUID) -> ChartData:
        """FTP progression over time."""
        from app.models.cycling import FtpHistory

        result = await db_execute(
            self.db,
            select(FtpHistory)
            .where(FtpHistory.user_id == user_id)
            .order_by(FtpHistory.effective_date)
        )
        entries = list(result.scalars().all())

        if not entries:
            return ChartData(
                chart_type="line",
                title="FTP History",
                labels=[],
                series=[ChartSeries(name="FTP (W)", data=[])],
                x_label="Date",
                y_label="FTP (W)",
            )

        return ChartData(
            chart_type="line",
            title="FTP History",
            labels=[e.effective_date.isoformat() for e in entries],
            series=[ChartSeries(name="FTP (W)", data=[e.ftp_watts for e in entries], color="#f59e0b")],
            x_label="Date",
            y_label="FTP (W)",
        )

    # ── Power curve from streams ──────────────────────────────────────────────

    async def stream_power_curve(self, user_id: uuid.UUID, days: int = 90) -> ChartData:
        """Best power curve computed from stream data."""
        best_power = await compute_power_curve_from_streams(self.db, user_id, days)

        labels = []
        data = []
        for duration_sec, label in POWER_DURATION_BUCKETS:
            if duration_sec in best_power:
                labels.append(label)
                data.append(best_power[duration_sec])

        return ChartData(
            chart_type="line",
            title="Power Curve (from Streams)",
            labels=labels,
            series=[ChartSeries(name="Best Power (W)", data=data, color="#f59e0b")],
            x_label="Duration",
            y_label="Power (W)",
        )

    # ── Power zones distribution ──────────────────────────────────────────────

    async def power_zones(self, user_id: uuid.UUID, days: int = 30) -> ChartData:
        """Power zone distribution as a bar chart."""
        profile = await get_or_create_cycling_profile(self.db, user_id)
        if not profile.ftp_watts:
            return ChartData(
                chart_type="bar",
                title="Power Zones",
                labels=[],
                series=[],
                x_label="Zone",
                y_label="Time",
            )

        zones = await compute_power_zones_from_streams(self.db, user_id, profile.ftp_watts, days)

        labels = [f"{z['zone']} - {z['zone_name']}" for z in zones]
        data = [round(z["time_seconds"] / 60, 1) for z in zones]  # minutes

        return ChartData(
            chart_type="bar",
            title="Power Zones Distribution",
            labels=labels,
            series=[ChartSeries(name="Time (min)", data=data, color="#8b5cf6")],
            x_label="Zone",
            y_label="Time (min)",
        )

    # ── Daily TSS chart ───────────────────────────────────────────────────────

    async def daily_tss(self, user_id: uuid.UUID, days: int = 30) -> ChartData:
        """Daily TSS as a bar chart."""
        cutoff = date.today() - timedelta(days=days)

        result = await db_execute(
            self.db,
            select(
                func.date(Activity.start_date).label("day"),
                func.coalesce(func.sum(Activity.tss), 0.0).label("total_tss"),
            )
            .where(
                Activity.user_id == user_id,
                Activity.tss.isnot(None),
                Activity.start_date >= cutoff,
            )
            .group_by(func.date(Activity.start_date))
            .order_by(func.date(Activity.start_date))
        )
        rows = result.all()

        return ChartData(
            chart_type="bar",
            title="Daily TSS",
            labels=[str(r.day) for r in rows],
            series=[ChartSeries(name="TSS", data=[float(r.total_tss or 0) for r in rows], color="#3b82f6")],
            x_label="Date",
            y_label="TSS",
        )

    # ── Exercise progress (weight/1RM over time per exercise) ──────────────────

    async def exercise_progress(
        self, user_id: uuid.UUID, exercise_name: str, weeks: int = 12
    ) -> ChartData:
        """Best estimated 1RM and total volume per session for a given exercise."""
        from datetime import date as date_type, timedelta as td

        cutoff = date_type.today() - td(weeks=weeks)

        result = await db_execute(
            self.db,
            select(
                LiftingSession.session_date,
                LiftingSet.weight_kg,
                LiftingSet.reps,
            )
            .join(LiftingSet, LiftingSet.session_id == LiftingSession.id)
            .where(
                LiftingSession.user_id == user_id,
                LiftingSet.exercise_name == exercise_name,
                LiftingSet.is_warmup == False,  # noqa: E712
                LiftingSession.session_date >= cutoff,
            )
            .order_by(LiftingSession.session_date)
        )
        rows = result.all()

        # Group by session date, find best est 1RM and total volume per session
        sessions: dict[str, dict] = {}
        for r in rows:
            key = r.session_date.isoformat()
            if key not in sessions:
                sessions[key] = {"best_1rm": 0, "volume": 0}
            # Brzycki formula: est_1rm = weight × (36 / (37 - reps))
            est_1rm = r.weight_kg * (36 / max(37 - r.reps, 1))
            if est_1rm > sessions[key]["best_1rm"]:
                sessions[key]["best_1rm"] = round(est_1rm, 1)
            sessions[key]["volume"] += r.weight_kg * r.reps

        labels = sorted(sessions.keys())
        est_1rm_data = [sessions[l]["best_1rm"] for l in labels]
        volume_data = [round(sessions[l]["volume"], 1) for l in labels]

        return ChartData(
            chart_type="line",
            title=f"Exercise Progress — {exercise_name}",
            labels=labels,
            series=[
                ChartSeries(name="Est. 1RM (kg)", data=est_1rm_data, color="#22c55e"),
                ChartSeries(name="Volume (kg)", data=volume_data, color="#8b5cf6"),
            ],
            x_label="Date",
            y_label="kg",
        )

    # ── Helpers ────────────────────────────────────────────────────────────────

    @staticmethod
    def _duration_bucket(seconds: int) -> str:
        if seconds <= 30:
            return "30s"
        elif seconds <= 60:
            return "1min"
        elif seconds <= 300:
            return "5min"
        elif seconds <= 600:
            return "10min"
        elif seconds <= 1200:
            return "20min"
        elif seconds <= 1800:
            return "30min"
        elif seconds <= 3600:
            return "60min"
        else:
            return "60min+"

    @staticmethod
    def _bucket_order(bucket: str) -> int:
        order = {"30s": 0, "1min": 1, "5min": 2, "10min": 3, "20min": 4, "30min": 5, "60min": 6, "60min+": 7}
        return order.get(bucket, 99)


async def db_execute(db: AsyncSession, query):
    """Helper to execute a query and return the result."""
    return await db.execute(query)
