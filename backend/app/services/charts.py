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
    compute_hr_zones_from_streams,
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
class ReferenceArea:
    """A colored background zone on a chart (e.g. TSB overtrained zone)."""
    y1: float
    y2: float
    color: str = "#3b82f6"
    opacity: float = 0.08
    label: str = ""


@dataclass
class ChartData:
    chart_type: str  # line, bar, scatter, area, pie
    title: str
    labels: list[str] = field(default_factory=list)
    series: list[ChartSeries] = field(default_factory=list)
    x_label: str = ""
    y_label: str = ""
    insights: list[str] = field(default_factory=list)
    reference_areas: list[ReferenceArea] = field(default_factory=list)


# ── Chart Service ─────────────────────────────────────────────────────────────


class ChartService:
    """Generates chart data from the database for various fitness metrics."""

    def __init__(self, db: AsyncSession):
        self.db = db

    # ── Power curve (best power at each duration) ─────────────────────────────

    async def power_curve(self, user_id: uuid.UUID, days: int = 90) -> ChartData:
        cutoff = date.today() - timedelta(days=days)

        result = await self.db.execute(
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
        result = await self.db.execute(
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

        result = await self.db.execute(
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

        # Generate insights
        insights = []
        tss_values = [float(r.total_tss or 0) for r in rows]
        if tss_values:
            avg_tss = sum(tss_values) / len(tss_values)
            insights.append(f"Average weekly TSS: {avg_tss:.0f}. {'Building well.' if avg_tss > 300 else 'Good base level.' if avg_tss > 150 else 'Light training — consider increasing if building fitness.'}")
            if len(tss_values) >= 4:
                recent_4 = sum(tss_values[-4:]) / 4
                prior_4 = sum(tss_values[-8:-4]) / 4 if len(tss_values) >= 8 else avg_tss
                if prior_4 > 0:
                    change = (recent_4 - prior_4) / prior_4 * 100
                    if change > 15:
                        insights.append(f"Recent 4-week average ({recent_4:.0f}) is {change:.0f}% higher than the prior 4 weeks — volume is increasing.")
                    elif change < -15:
                        insights.append(f"Recent 4-week average ({recent_4:.0f}) is {abs(change):.0f}% lower — volume is tapering or recovery period.")

        return ChartData(
            chart_type="bar",
            title="Weekly TSS",
            labels=[r.week_start.strftime("%Y-%m-%d") if hasattr(r.week_start, "strftime") else str(r.week_start) for r in rows],
            series=[ChartSeries(name="TSS", data=tss_values)],
            x_label="Week",
            y_label="TSS",
            insights=insights,
        )

    # ── Estimated 1RM history ─────────────────────────────────────────────────

    async def estimated_1rm_history(
        self, user_id: uuid.UUID, exercise_name: str
    ) -> ChartData:
        result = await self.db.execute(
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

        result = await self.db.execute(
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

        # Generate insights
        insights = []
        vol_values = [float(r.total_volume or 0) for r in rows]
        if vol_values:
            avg_vol = sum(vol_values) / len(vol_values)
            recent = vol_values[-1]
            if len(vol_values) >= 4:
                recent_4 = sum(vol_values[-4:]) / 4
                prior_4 = sum(vol_values[-8:-4]) / 4 if len(vol_values) >= 8 else avg_vol
                if prior_4 > 0:
                    change = (recent_4 - prior_4) / prior_4 * 100
                    if change > 20:
                        insights.append(f"Volume spike: recent 4-week average ({recent_4:.0f}kg) is {change:.0f}% above prior period. Monitor for injury risk.")
                    elif change < -20:
                        insights.append(f"Volume has decreased {abs(change):.0f}% — deload or taper period.")
            insights.append(f"Latest week: {recent:.0f}kg. Average: {avg_vol:.0f}kg/week.")

        return ChartData(
            chart_type="bar",
            title="Weekly Lifting Volume",
            labels=[r.week_start.strftime("%Y-%m-%d") if hasattr(r.week_start, "strftime") else str(r.week_start) for r in rows],
            series=[ChartSeries(name="Volume (kg)", data=vol_values)],
            x_label="Week",
            y_label="Volume (kg)",
            insights=insights,
        )

    # ── HRV trend ─────────────────────────────────────────────────────────────

    async def hrv_trend(self, user_id: uuid.UUID, days: int = 90) -> ChartData:
        cutoff = date.today() - timedelta(days=days)

        result = await self.db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.hrv_ms.isnot(None),
                DailyMetric.metric_date >= cutoff,
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = list(result.scalars().all())

        # Generate insights
        insights = []
        hrv_values = [m.hrv_ms for m in metrics if m.hrv_ms]
        if hrv_values:
            avg_hrv = sum(hrv_values) / len(hrv_values)
            recent = hrv_values[-1]
            if len(hrv_values) >= 7:
                recent_7 = sum(hrv_values[-7:]) / 7
                if recent_7 > avg_hrv * 1.05:
                    insights.append(f"7-day HRV average ({recent_7:.0f}ms) is above your overall average ({avg_hrv:.0f}ms) — good recovery status.")
                elif recent_7 < avg_hrv * 0.9:
                    insights.append(f"7-day HRV average ({recent_7:.0f}ms) is below your baseline ({avg_hrv:.0f}ms) — may indicate stress or incomplete recovery.")
            insights.append(f"Current HRV: {recent:.0f}ms. Overall average: {avg_hrv:.0f}ms.")

        return ChartData(
            chart_type="line",
            title="HRV Trend",
            labels=[m.metric_date.isoformat() for m in metrics],
            series=[ChartSeries(name="HRV (ms)", data=[m.hrv_ms for m in metrics])],
            x_label="Date",
            y_label="HRV (ms)",
            insights=insights,
        )

    # ── Recovery vs Strain ────────────────────────────────────────────────────

    async def recovery_vs_strain(self, user_id: uuid.UUID, days: int = 30) -> ChartData:
        cutoff = date.today() - timedelta(days=days)

        result = await self.db.execute(
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

        result = await self.db.execute(
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

        result = await self.db.execute(
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

        # Generate insights
        insights = []
        if load_data:
            current = load_data[-1]
            first = load_data[0]
            if first["ctl"] > 0:
                ctl_change = (current["ctl"] - first["ctl"]) / first["ctl"] * 100
                if ctl_change > 10:
                    insights.append(f"CTL has increased {ctl_change:.0f}% over the analysis period — fitness is building well.")
                elif ctl_change < -10:
                    insights.append(f"CTL has declined {abs(ctl_change):.0f}% — fitness is detraining. Consider increasing volume.")
                else:
                    insights.append(f"CTL is stable ({current['ctl']:.0f}). Maintain current training consistency.")
            if current["tsb"] < -30:
                insights.append(f"TSB is {current['tsb']:.0f} — significant fatigue accumulated. Consider a recovery day or easy week.")
            elif current["tsb"] > 25:
                insights.append(f"TSB is +{current['tsb']:.0f} — well-rested and fresh. Good time for a hard effort or race.")
            elif -10 <= current["tsb"] <= 10:
                insights.append(f"TSB is {current['tsb']:.0f} — in the sweet spot for balanced training.")

        # TSB zone coloring: red (overtrained, TSB < -30), green (fresh, TSB > 5), blue (neutral)
        tsb_values = [d["tsb"] for d in load_data]
        tsb_min = min(tsb_values) if tsb_values else -100
        tsb_max = max(tsb_values) if tsb_values else 100
        reference_areas = [
            ReferenceArea(y1=tsb_min, y2=-30, color="#ef4444", opacity=0.06, label="Overtrained"),
            ReferenceArea(y1=-30, y2=5, color="#3b82f6", opacity=0.04, label="Neutral"),
            ReferenceArea(y1=5, y2=tsb_max, color="#22c55e", opacity=0.06, label="Fresh"),
        ]

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
            insights=insights,
            reference_areas=reference_areas,
        )

    # ── FTP history chart ─────────────────────────────────────────────────────

    async def ftp_history(self, user_id: uuid.UUID) -> ChartData:
        """FTP progression over time."""
        from app.models.cycling import FtpHistory

        result = await self.db.execute(
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

        # Generate insights
        insights = []
        if len(entries) >= 2:
            first_ftp = entries[0].ftp_watts
            latest_ftp = entries[-1].ftp_watts
            if first_ftp > 0:
                change_pct = (latest_ftp - first_ftp) / first_ftp * 100
                direction = "improved" if change_pct > 0 else "declined"
                insights.append(f"FTP has {direction} from {first_ftp}W to {latest_ftp}W ({change_pct:+.1f}%) over {len(entries)} recorded changes.")

        return ChartData(
            chart_type="line",
            title="FTP History",
            labels=[e.effective_date.isoformat() for e in entries],
            series=[ChartSeries(name="FTP (W)", data=[e.ftp_watts for e in entries], color="#f59e0b")],
            x_label="Date",
            y_label="FTP (W)",
            insights=insights,
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

        # Generate insights
        insights = []
        if 1200 in best_power and 300 in best_power:
            ratio = best_power[1200] / best_power[300]
            if ratio > 0.85:
                insights.append(f"Strong endurance profile — 20min power ({best_power[1200]}W) is {ratio*100:.0f}% of 5min power ({best_power[300]}W). Good aerobic efficiency.")
            elif ratio < 0.75:
                insights.append(f"Anaerobic-leaning profile — 20min power ({best_power[1200]}W) is {ratio*100:.0f}% of 5min power ({best_power[300]}W). Consider more endurance work.")
        if 5 in best_power:
            insights.append(f"Peak sprint power: {best_power[5]}W (5s). {'Excellent neuromuscular power.' if best_power[5] > 1000 else 'Room to develop sprint power.'}")

        return ChartData(
            chart_type="line",
            title="Power Curve (from Streams)",
            labels=labels,
            series=[ChartSeries(name="Best Power (W)", data=data, color="#f59e0b")],
            x_label="Duration",
            y_label="Power (W)",
            insights=insights,
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

        # Generate insights
        insights = []
        if zones:
            total_time = sum(z["time_seconds"] for z in zones) or 1
            z2_pct = next((z["percentage"] for z in zones if z["zone"] == "Z2"), 0)
            z4_pct = next((z["percentage"] for z in zones if z["zone"] == "Z4"), 0)
            z5_pct = next((z["percentage"] for z in zones if z["zone"] == "Z5"), 0)
            if z2_pct > 40:
                insights.append(f"{z2_pct:.0f}% of ride time in Z2 (Endurance) — good aerobic base building.")
            if z4_pct > 20:
                insights.append(f"{z4_pct:.0f}% in Z4 (Threshold) — significant high-intensity work. Ensure adequate recovery.")
            if z5_pct > 15:
                insights.append(f"{z5_pct:.0f}% in Z5 (VO2max) — strong intensity distribution for fitness gains.")

        return ChartData(
            chart_type="bar",
            title="Power Zones Distribution",
            labels=labels,
            series=[ChartSeries(name="Time (min)", data=data, color="#8b5cf6")],
            x_label="Zone",
            y_label="Time (min)",
            insights=insights,
        )

    # ── HR Zone Distribution chart ────────────────────────────────────────────

    async def hr_zone_distribution(self, user_id: uuid.UUID, days: int = 30) -> ChartData:
        """Heart rate zone distribution as a bar chart (LTHR-based)."""
        from app.models.cycling import CyclingProfile

        result = await self.db.execute(
            select(CyclingProfile).where(CyclingProfile.user_id == user_id)
        )
        profile = result.scalar_one_or_none()
        if not profile or not profile.lactate_threshold_hr:
            return ChartData(
                chart_type="bar",
                title="Heart Rate Zones",
                labels=[],
                series=[],
                x_label="Zone",
                y_label="Time",
            )

        zones = await compute_hr_zones_from_streams(
            self.db, user_id, profile.lactate_threshold_hr, days
        )

        labels = [f"{z['zone']} - {z['zone_name']}" for z in zones]
        data = [round(z["time_seconds"] / 60, 1) for z in zones]  # minutes

        # Generate insights
        insights = []
        if zones:
            z2_pct = next((z["percentage"] for z in zones if z["zone"] == "Z2"), 0)
            z4_pct = next((z["percentage"] for z in zones if z["zone"] == "Z4"), 0)
            z5_pct = next((z["percentage"] for z in zones if z["zone"] == "Z5"), 0)
            if z2_pct > 40:
                insights.append(f"{z2_pct:.0f}% of time in Z2 (Endurance) — solid aerobic base work.")
            if z4_pct > 20:
                insights.append(f"{z4_pct:.0f}% in Z4 (Threshold) — significant tempo work. Monitor recovery.")
            if z5_pct > 15:
                insights.append(f"{z5_pct:.0f}% in Z5 (VO2max) — high-intensity efforts for fitness gains.")
            total_minutes = sum(data)
            insights.append(f"Total tracked time: {total_minutes:.0f} min across {len(zones)} zones (LTHR: {profile.lactate_threshold_hr:.0f} bpm).")

        return ChartData(
            chart_type="bar",
            title="Heart Rate Zone Distribution",
            labels=labels,
            series=[ChartSeries(name="Time (min)", data=data, color="#ef4444")],
            x_label="Zone",
            y_label="Time (min)",
            insights=insights,
        )

    # ── Daily TSS chart ───────────────────────────────────────────────────────

    async def daily_tss(self, user_id: uuid.UUID, days: int = 30) -> ChartData:
        """Daily TSS as a bar chart."""
        cutoff = date.today() - timedelta(days=days)

        result = await self.db.execute(
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

        result = await self.db.execute(
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

        # Generate insights
        insights = []
        if est_1rm_data and len(est_1rm_data) >= 2:
            first_1rm = est_1rm_data[0]
            latest_1rm = est_1rm_data[-1]
            if first_1rm > 0:
                change = (latest_1rm - first_1rm) / first_1rm * 100
                if change > 5:
                    insights.append(f"Estimated 1RM has increased {change:.1f}% ({first_1rm:.0f}kg → {latest_1rm:.0f}kg) — strength is progressing.")
                elif change < -5:
                    insights.append(f"Estimated 1RM has declined {abs(change):.1f}% — consider a deload or program change.")
                else:
                    insights.append(f"Estimated 1RM is stable at {latest_1rm:.0f}kg. Consider progressive overload to continue building.")

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
            insights=insights,
        )
    
        # ── Power curve comparison (two time periods) ────────────────────────────
    
        async def power_curve_comparison(
            self, user_id: uuid.UUID, days: int = 30, days_b: int = 90
        ) -> ChartData:
            """Compare power curves from two different time periods.
    
            Computes best power curve for period A (days) and period B (days_b),
            returning them as two series on the same chart.
            """
            curve_a = await compute_power_curve_from_streams(self.db, user_id, days)
            curve_b = await compute_power_curve_from_streams(self.db, user_id, days_b)
    
            if not curve_a and not curve_b:
                return ChartData(
                    chart_type="line",
                    title=f"Power Curve Comparison ({days}d vs {days_b}d)",
                    labels=[],
                    series=[],
                    x_label="Duration",
                    y_label="Power (W)",
                )
    
            # Use the union of all durations from both curves
            all_durations = sorted(set(list(curve_a.keys()) + list(curve_b.keys())))
            labels = []
            data_a = []
            data_b = []
            for dur in all_durations:
                label = next((lbl for sec, lbl in POWER_DURATION_BUCKETS if sec == dur), f"{dur}s")
                labels.append(label)
                data_a.append(curve_a.get(dur))
                data_b.append(curve_b.get(dur))
    
            # Generate insights
            insights = []
            if curve_a and curve_b:
                shared_durs = set(curve_a.keys()) & set(curve_b.keys())
                if shared_durs:
                    improvements = []
                    declines = []
                    for dur in sorted(shared_durs):
                        a_val = curve_a[dur]
                        b_val = curve_b[dur]
                        if b_val > 0:
                            pct = (a_val - b_val) / b_val * 100
                            label = next((lbl for sec, lbl in POWER_DURATION_BUCKETS if sec == dur), f"{dur}s")
                            if pct > 3:
                                improvements.append(f"{label}: +{pct:.1f}%")
                            elif pct < -3:
                                declines.append(f"{label}: {pct:.1f}%")
                    if improvements:
                        insights.append(f"Recent ({days}d) vs baseline ({days_b}d) improvements: {', '.join(improvements)}")
                    if declines:
                        insights.append(f"Declines vs baseline: {', '.join(declines)}")
                    if not improvements and not declines:
                        insights.append(f"Power output is stable between {days}d and {days_b}d windows.")
    
            return ChartData(
                chart_type="line",
                title=f"Power Curve Comparison ({days}d vs {days_b}d)",
                labels=labels,
                series=[
                    ChartSeries(name=f"Last {days} days", data=data_a, color="#f59e0b"),
                    ChartSeries(name=f"Last {days_b} days", data=data_b, color="#64748b"),
                ],
                x_label="Duration",
                y_label="Power (W)",
                insights=insights,
            )
    
        # ── Strain vs Recovery correlation (scatter) ─────────────────────────────

    async def strain_vs_recovery(self, user_id: uuid.UUID, days: int = 30) -> ChartData:
        """Scatter plot: x-axis = day strain, y-axis = next-day recovery score.

        Each point is a day. Color by recovery level (green/yellow/red).
        Helps identify the optimal strain range for maintaining good recovery.
        """
        cutoff = date.today() - timedelta(days=days)

        # Get metrics ordered by date
        result = await self.db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.strain.isnot(None),
                DailyMetric.metric_date >= cutoff,
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = list(result.scalars().all())

        # Build lookup: metric_date -> metric
        metric_by_date: dict = {m.metric_date: m for m in metrics}

        # For each day with strain, find next-day recovery
        points: list[tuple[float, float, str]] = []
        for m in metrics:
            next_day = m.metric_date + timedelta(days=1)
            next_metric = metric_by_date.get(next_day)
            if next_metric and next_metric.recovery_score is not None and m.strain is not None:
                recovery = next_metric.recovery_score
                if recovery >= 67:
                    color = "#22c55e"
                elif recovery >= 34:
                    color = "#eab308"
                else:
                    color = "#ef4444"
                points.append((m.strain, recovery, color))

        if not points:
            return ChartData(
                chart_type="scatter",
                title="Strain vs Next-Day Recovery",
                labels=[],
                series=[],
                x_label="Daily Strain",
                y_label="Next-Day Recovery %",
            )

        # Scatter charts need paired (x, y) data with aligned indices.
        # Use a single series where labels[i] = strain (x) and data[i] = recovery (y).
        # Sort by strain for clean rendering.
        points.sort(key=lambda p: p[0])
        strains = [p[0] for p in points]
        recoveries = [p[1] for p in points]

        # Separate for insights
        green = [(s, r) for s, r, c in points if c == "#22c55e"]
        red = [(s, r) for s, r, c in points if c == "#ef4444"]

        # Generate insights
        insights = []
        if green:
            avg_green_strain = sum(s for s, _ in green) / len(green)
            insights.append(f"When strain stays below {avg_green_strain:.0f}, recovery tends to stay above 67% — your optimal zone.")
        if red:
            avg_red_strain = sum(s for s, _ in red) / len(red)
            insights.append(f"Strain above {avg_red_strain:.0f} often leads to recovery below 34% — consider limiting high-strain days.")

        return ChartData(
            chart_type="scatter",
            title="Strain vs Next-Day Recovery",
            labels=[str(s) for s in strains],
            series=[ChartSeries(name="Recovery", data=recoveries, color="#3b82f6")],
            x_label="Daily Strain",
            y_label="Next-Day Recovery %",
            insights=insights,
        )

    # ── Recovery vs Performance correlation (scatter) ────────────────────────

    async def recovery_vs_performance(self, user_id: uuid.UUID, days: int = 60) -> ChartData:
        """Scatter plot: x-axis = recovery score, y-axis = next-day performance metric.

        Performance = lifting volume (kg) for strength days, or TSS for cycling days.
        Helps answer: does better recovery lead to better performance?
        """
        cutoff = date.today() - timedelta(days=days)

        # Get recovery scores
        result = await self.db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.recovery_score.isnot(None),
                DailyMetric.metric_date >= cutoff,
            )
            .order_by(DailyMetric.metric_date)
        )
        recovery_map = {m.metric_date: m.recovery_score for m in result.scalars().all()}

        # Get lifting volumes per day
        lift_result = await self.db.execute(
            select(
                LiftingSession.session_date,
                func.sum(LiftingSession.total_volume_kg).label("volume"),
            )
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= cutoff,
            )
            .group_by(LiftingSession.session_date)
        )
        lift_map = {r.session_date: float(r.volume or 0) for r in lift_result.all()}

        # Get TSS per day
        tss_result = await self.db.execute(
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
        )
        tss_map = {r.day: float(r.total_tss or 0) for r in tss_result.all()}

        # Match: for each day with recovery, find next-day performance
        lifting_points: list[tuple[float, float]] = []
        tss_points: list[tuple[float, float]] = []

        for metric_date, recovery in recovery_map.items():
            next_day = metric_date + timedelta(days=1)
            if next_day in lift_map and lift_map[next_day] > 0:
                lifting_points.append((recovery, lift_map[next_day]))
            if next_day in tss_map and tss_map[next_day] > 0:
                tss_points.append((recovery, tss_map[next_day]))

        # Scatter charts need paired (x, y) data with aligned indices.
        # Combine all points into a single series sorted by recovery (x-axis).
        all_points = lifting_points + tss_points
        all_points.sort(key=lambda p: p[0])

        series_list: list[ChartSeries] = []
        if lifting_points:
            # Sort lifting points for their own series
            lifting_sorted = sorted(lifting_points, key=lambda p: p[0])
            series_list.append(ChartSeries(
                name="Lifting Volume (kg)",
                data=[p[1] for p in lifting_sorted],
                color="#8b5cf6",
            ))
        if tss_points:
            tss_sorted = sorted(tss_points, key=lambda p: p[0])
            series_list.append(ChartSeries(
                name="Cycling TSS",
                data=[p[1] for p in tss_sorted],
                color="#3b82f6",
            ))

        # Use the larger dataset's recovery values as labels (x-axis)
        if len(lifting_points) >= len(tss_points):
            labels = [str(p[0]) for p in sorted(lifting_points, key=lambda p: p[0])]
        else:
            labels = [str(p[0]) for p in sorted(tss_points, key=lambda p: p[0])]

        return ChartData(
            chart_type="scatter",
            title="Recovery vs Next-Day Performance",
            labels=labels,
            series=series_list,
            x_label="Recovery Score %",
            y_label="Performance",
        )

    # ── HRV trend with rolling averages ─────────────────────────────────────

    async def hrv_trend_detailed(self, user_id: uuid.UUID, days: int = 90) -> ChartData:
        """HRV over time with 7-day, 30-day rolling averages and personal baseline.

        Shaded region = personal baseline (±1 std dev from 90-day average).
        Points below the baseline are highlighted in red.
        """
        cutoff = date.today() - timedelta(days=days)

        result = await self.db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.hrv_ms.isnot(None),
                DailyMetric.metric_date >= cutoff,
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = list(result.scalars().all())

        if not metrics:
            return ChartData(
                chart_type="line",
                title="HRV Trend (Detailed)",
                labels=[],
                series=[],
                x_label="Date",
                y_label="HRV (ms)",
            )

        hrv_values = [m.hrv_ms for m in metrics]
        labels = [m.metric_date.isoformat() for m in metrics]

        # 7-day rolling average
        rolling_7: list[float | None] = []
        for i in range(len(hrv_values)):
            window = hrv_values[max(0, i - 6) : i + 1]
            rolling_7.append(round(sum(window) / len(window), 1))

        # 30-day rolling average
        rolling_30: list[float | None] = []
        for i in range(len(hrv_values)):
            window = hrv_values[max(0, i - 29) : i + 1]
            rolling_30.append(round(sum(window) / len(window), 1))

        # Personal baseline (±1 std dev from mean)
        mean_hrv = sum(hrv_values) / len(hrv_values)
        std_hrv = (sum((v - mean_hrv) ** 2 for v in hrv_values) / len(hrv_values)) ** 0.5

        return ChartData(
            chart_type="line",
            title="HRV Trend (Detailed)",
            labels=labels,
            series=[
                ChartSeries(name="Daily HRV", data=hrv_values, color="#22c55e"),
                ChartSeries(name="7-day Average", data=rolling_7, color="#3b82f6"),
                ChartSeries(name="30-day Average", data=rolling_30, color="#f59e0b"),
            ],
            x_label="Date",
            y_label="HRV (ms)",
        )

    # ── Weight trend ────────────────────────────────────────────────────────

    async def weight_trend(self, user_id: uuid.UUID, days: int = 90) -> ChartData:
        """Weight over time with 7-day rolling average."""
        from app.models.weight import WeightLog

        cutoff = date.today() - timedelta(days=days)

        result = await self.db.execute(
            select(WeightLog)
            .where(
                WeightLog.user_id == user_id,
                WeightLog.date >= cutoff,
            )
            .order_by(WeightLog.date)
        )
        logs = list(result.scalars().all())

        if not logs:
            return ChartData(
                chart_type="line",
                title="Body Weight Trend",
                labels=[],
                series=[],
                x_label="Date",
                y_label="Weight (kg)",
            )

        weights = [log.weight_kilogram for log in logs]
        labels = [log.date.isoformat() for log in logs]

        # 7-day rolling average
        rolling: list[float] = []
        for i in range(len(weights)):
            window = weights[max(0, i - 6) : i + 1]
            rolling.append(round(sum(window) / len(window), 1))

        # Generate insights
        insights = []
        if len(weights) >= 2:
            first_w = weights[0]
            latest_w = weights[-1]
            change = latest_w - first_w
            if abs(change) > 0.5:
                direction = "increased" if change > 0 else "decreased"
                weeks = len(weights) / 7 if len(weights) > 7 else 1
                rate = abs(change) / weeks
                insights.append(f"Weight has {direction} {abs(change):.1f}kg over {len(weights)} days ({rate:.2f}kg/week). {'Healthy pace.' if rate < 0.5 else 'Rapid change — monitor closely.'}")
            else:
                insights.append(f"Weight is stable at {latest_w:.1f}kg.")

        return ChartData(
            chart_type="line",
            title="Body Weight Trend",
            labels=labels,
            series=[
                ChartSeries(name="Weight (kg)", data=weights, color="#8b5cf6"),
                ChartSeries(name="7-day Average", data=rolling, color="#f59e0b"),
            ],
            x_label="Date",
            y_label="Weight (kg)",
            insights=insights,
        )

    # ── Training Load Balance ───────────────────────────────────────────────

    async def training_load_balance(self, user_id: uuid.UUID, weeks: int = 4) -> ChartData:
        """Stacked area chart: Strava TSS + lifting volume per week.

        Shows how different training modalities contribute to total load.
        """
        cutoff = date.today() - timedelta(weeks=weeks)
        week_start_activity = func.date_trunc("week", Activity.start_date).label("week_start")
        week_start_lifting = func.date_trunc("week", LiftingSession.session_date).label("week_start")

        # TSS per week (from activities)
        tss_result = await self.db.execute(
            select(
                week_start_activity,
                func.coalesce(func.sum(Activity.tss), 0.0).label("total_tss"),
            )
            .where(
                Activity.user_id == user_id,
                Activity.tss.isnot(None),
                Activity.start_date >= cutoff,
            )
            .group_by(week_start_activity)
            .order_by(week_start_activity)
        )
        tss_map = {r.week_start: float(r.total_tss or 0) for r in tss_result.all()}

        # Lifting volume per week (scaled down to comparable units: volume / 100)
        lift_result = await self.db.execute(
            select(
                week_start_lifting,
                func.coalesce(func.sum(LiftingSession.total_volume_kg), 0.0).label("total_volume"),
            )
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= cutoff,
            )
            .group_by(week_start_lifting)
            .order_by(week_start_lifting)
        )
        lift_map = {r.week_start: round(float(r.total_volume or 0) / 100, 1) for r in lift_result.all()}

        # Whoop strain per week (sum of daily strain)
        strain_result = await self.db.execute(
            select(
                func.date_trunc("week", DailyMetric.metric_date).label("week_start"),
                func.coalesce(func.sum(DailyMetric.strain), 0.0).label("total_strain"),
            )
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.strain.isnot(None),
                DailyMetric.metric_date >= cutoff,
            )
            .group_by(func.date_trunc("week", DailyMetric.metric_date))
            .order_by(func.date_trunc("week", DailyMetric.metric_date))
        )
        strain_map = {r.week_start: float(r.total_strain or 0) for r in strain_result.all()}

        # Merge all weeks
        all_weeks = sorted(set(list(tss_map.keys()) + list(lift_map.keys()) + list(strain_map.keys())))

        return ChartData(
            chart_type="area",
            title="Training Load Balance",
            labels=[w.strftime("%Y-%m-%d") if hasattr(w, "strftime") else str(w) for w in all_weeks],
            series=[
                ChartSeries(name="Cycling TSS", data=[tss_map.get(w, 0) for w in all_weeks], color="#3b82f6"),
                ChartSeries(name="Lifting Volume (÷100)", data=[lift_map.get(w, 0) for w in all_weeks], color="#8b5cf6"),
                ChartSeries(name="Whoop Strain", data=[strain_map.get(w, 0) for w in all_weeks], color="#f97316"),
            ],
            x_label="Week",
            y_label="Load Units",
        )

    # ── Rest Day Analysis ───────────────────────────────────────────────────

    async def rest_day_analysis(self, user_id: uuid.UUID, days: int = 30) -> ChartData:
        """Compare recovery scores on rest days vs training days.

        Groups DailyMetric by whether the day had an activity or lifting session.
        """
        cutoff = date.today() - timedelta(days=days)

        # Get all daily metrics with recovery scores
        result = await self.db.execute(
            select(DailyMetric)
            .where(
                DailyMetric.user_id == user_id,
                DailyMetric.recovery_score.isnot(None),
                DailyMetric.metric_date >= cutoff,
            )
            .order_by(DailyMetric.metric_date)
        )
        metrics = list(result.scalars().all())

        # Get activity dates
        act_result = await self.db.execute(
            select(func.date(Activity.start_date).label("day"))
            .where(
                Activity.user_id == user_id,
                Activity.start_date >= cutoff,
            )
            .distinct()
        )
        activity_dates = {r.day for r in act_result.all()}

        # Get lifting dates
        lift_result = await self.db.execute(
            select(LiftingSession.session_date)
            .where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= cutoff,
            )
            .distinct()
        )
        lifting_dates = {r.session_date for r in lift_result.all()}

        training_dates = activity_dates | lifting_dates

        rest_recoveries = [m.recovery_score for m in metrics if m.metric_date not in training_dates]
        training_recoveries = [m.recovery_score for m in metrics if m.metric_date in training_dates]

        avg_rest = round(sum(rest_recoveries) / len(rest_recoveries), 1) if rest_recoveries else 0
        avg_training = round(sum(training_recoveries) / len(training_recoveries), 1) if training_recoveries else 0

        return ChartData(
            chart_type="bar",
            title="Rest Day vs Training Day Recovery",
            labels=["Training Days", "Rest Days"],
            series=[
                ChartSeries(
                    name="Avg Recovery %",
                    data=[avg_training, avg_rest],
                    color="#3b82f6",
                ),
            ],
            x_label="Day Type",
            y_label="Recovery %",
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


