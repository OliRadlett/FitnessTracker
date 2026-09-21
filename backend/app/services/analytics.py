"""Deterministic athlete-model insights (Feature 3 / B-15).

Six formula-over-your-data insights from the user's own history. Everything
is an observed mean/median delta or Pearson correlation with explicit
minimum-sample guards — associations, never causation, no model fitting.
Nightly compute stores one row per (user, insight_type, period); the
Analytics page and the Feature 5 brief read the table.
"""

import logging
import math
import uuid
from datetime import date, timedelta
from statistics import mean

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.activity import Activity
from app.models.athlete_insight import AthleteInsight
from app.models.daily_metric import DailyMetric
from app.models.lifting import LiftingSession, PersonalRecord
from app.models.sleep import SleepLog

logger = logging.getLogger(__name__)

PERIOD_DAYS = 90
PERIOD_LABEL = "90d"

# Minimum samples: per-bucket floor, then per-insight floor for confidence.
MIN_BUCKET_N = 3
MIN_INSIGHT_N = 8

INSIGHT_TYPES = (
    "recovery_cost",
    "sleep_performance",
    "load_readiness",
    "power_norms",
    "pr_clustering",
    "tsb_peak",
)


# ── Pure helpers ─────────────────────────────────────────────────────────────

def _pearson(xs: list[float], ys: list[float]) -> float | None:
    """Pearson r, or None when undefined (<2 points or zero variance)."""
    n = len(xs)
    if n != len(ys) or n < 2:
        return None
    mx, my = mean(xs), mean(ys)
    num = sum((x - mx) * (y - my) for x, y in zip(xs, ys))
    den = math.sqrt(sum((x - mx) ** 2 for x in xs) * sum((y - my) ** 2 for y in ys))
    if den == 0:
        return None
    return num / den


def _confidence(n: int) -> str:
    if n < MIN_INSIGHT_N:
        return "collecting"
    if n < MIN_INSIGHT_N * 2:
        return "low"
    if n < MIN_INSIGHT_N * 4:
        return "medium"
    return "high"


def _tss_band(tss: float) -> str:
    if tss < 50:
        return "easy (<50 TSS)"
    if tss < 150:
        return "moderate (50–150 TSS)"
    return "hard (150+ TSS)"


def _vol_band(vol_kg: float) -> str:
    if vol_kg < 5000:
        return "light (<5k kg)"
    if vol_kg < 12000:
        return "moderate (5–12k kg)"
    return "heavy (12k+ kg)"


def _sleep_band(hours: float) -> str:
    if hours < 6:
        return "<6h"
    if hours < 7:
        return "6–7h"
    return "7h+"


def _temp_band(celsius: float) -> str:
    if celsius < 8:
        return "<8°C"
    if celsius < 12:
        return "8–12°C"
    if celsius < 18:
        return "12–18°C"
    if celsius < 24:
        return "18–24°C"
    return "24°C+"


def _tsb_band(tsb: float) -> str:
    if tsb < -20:
        return "very tired (<-20)"
    if tsb < -10:
        return "tired (-20–-10)"
    if tsb <= 10:
        return "neutral (-10–+10)"
    if tsb <= 25:
        return "fresh (+10–+25)"
    return "very fresh (>+25)"


# ── Window loader ────────────────────────────────────────────────────────────

async def _load_window(db: AsyncSession, user_id: uuid.UUID, cutoff: date) -> dict:
    """Batch-load 90 days of activities, lifting, metrics, sleep, and PRs."""
    acts = (
        await db.execute(
            select(Activity).where(
                Activity.user_id == user_id,
                Activity.start_date >= cutoff,
            )
        )
    ).scalars().all()

    lifts = (
        await db.execute(
            select(LiftingSession).where(
                LiftingSession.user_id == user_id,
                LiftingSession.session_date >= cutoff,
            )
        )
    ).scalars().all()

    metrics = (
        await db.execute(
            select(DailyMetric).where(
                DailyMetric.user_id == user_id,
                DailyMetric.metric_date >= cutoff - timedelta(days=14),
            )
        )
    ).scalars().all()
    by_date: dict[date, DailyMetric] = {m.metric_date: m for m in metrics}

    sleeps = (
        await db.execute(
            select(SleepLog).where(
                SleepLog.user_id == user_id,
                SleepLog.sleep_date >= cutoff - timedelta(days=1),
            )
        )
    ).scalars().all()
    sleep_by_date: dict[date, SleepLog] = {s.sleep_date: s for s in sleeps}

    prs = (
        await db.execute(
            select(PersonalRecord).where(
                PersonalRecord.user_id == user_id,
                PersonalRecord.record_type == "1rm",
                PersonalRecord.estimated_1rm.isnot(None),
            )
        )
    ).scalars().all()

    return {
        "activities": list(acts),
        "lifts": list(lifts),
        "metrics": by_date,
        "sleep": sleep_by_date,
        "prs": list(prs),
    }


def _baseline_recovery(
    metrics_by_date: dict[date, DailyMetric], day: date
) -> tuple[float | None, float | None]:
    """Mean recovery + HRV over the 14 days before ``day``."""
    rec = [
        m.recovery_score
        for i in range(1, 15)
        if (m := metrics_by_date.get(day - timedelta(days=i))) is not None
        and m.recovery_score is not None
    ]
    hrv = [
        m.hrv_ms
        for i in range(1, 15)
        if (m := metrics_by_date.get(day - timedelta(days=i))) is not None
        and m.hrv_ms is not None
    ]
    return (mean(rec) if rec else None, mean(hrv) if hrv else None)


# ── The six insights ─────────────────────────────────────────────────────────

def insight_recovery_cost(w: dict) -> dict:
    """#1 — HRV/recovery delta in the 48h after each session, by session type."""
    buckets: dict[str, dict[str, list[float]]] = {}
    n_sessions = 0

    def add(bucket: str, day: date):
        base_rec, base_hrv = _baseline_recovery(w["metrics"], day)
        for offset in (1, 2):
            m = w["metrics"].get(day + timedelta(days=offset))
            if m is None:
                continue
            b = buckets.setdefault(bucket, {"hrv": [], "recovery": []})
            if m.hrv_ms is not None and base_hrv:
                b["hrv"].append(m.hrv_ms - base_hrv)
            if m.recovery_score is not None and base_rec:
                b["recovery"].append(m.recovery_score - base_rec)

    for a in w["activities"]:
        if a.tss is None or a.start_date is None:
            continue
        n_sessions += 1
        add(f"{a.sport_type} · {_tss_band(a.tss)}", a.start_date.date())

    for s in w["lifts"]:
        if s.total_volume_kg is None or s.session_date is None:
            continue
        n_sessions += 1
        focus = s.focus or "general"
        add(f"lift · {focus} · {_vol_band(s.total_volume_kg)}", s.session_date)

    rows = []
    for bucket, vals in sorted(buckets.items()):
        if len(vals["hrv"]) + len(vals["recovery"]) < MIN_BUCKET_N:
            continue
        rows.append(
            {
                "bucket": bucket,
                "n": len(vals["hrv"]) + len(vals["recovery"]),
                "avg_hrv_delta": round(mean(vals["hrv"]), 1) if vals["hrv"] else None,
                "avg_recovery_delta": round(mean(vals["recovery"]), 1)
                if vals["recovery"]
                else None,
            }
        )
    return {"buckets": rows, "n_sessions": n_sessions}


def insight_sleep_performance(w: dict, ftp_watts: float | None) -> dict:
    """#2 — power (NP/FTP) and RPE by prior-night sleep band."""
    bands: dict[str, dict[str, list[float]]] = {}
    sleep_hours: list[float] = []
    np_ftp: list[float] = []

    for a in w["activities"]:
        if a.start_date is None:
            continue
        day = a.start_date.date()
        s = w["sleep"].get(day - timedelta(days=1))
        if s is None or not s.total_sleep_seconds:
            continue
        hours = s.total_sleep_seconds / 3600
        band = bands.setdefault(_sleep_band(hours), {"np_ftp": [], "rpe": []})
        if a.normalized_power and ftp_watts:
            ratio = a.normalized_power / ftp_watts
            band["np_ftp"].append(ratio)
            sleep_hours.append(hours)
            np_ftp.append(ratio)
        if a.rpe is not None:
            band["rpe"].append(a.rpe)

    rows = []
    for band, vals in bands.items():
        n = len(vals["np_ftp"]) + len(vals["rpe"])
        if n < MIN_BUCKET_N:
            continue
        rows.append(
            {
                "band": band,
                "n": n,
                "avg_np_ftp": round(mean(vals["np_ftp"]), 3) if vals["np_ftp"] else None,
                "avg_rpe": round(mean(vals["rpe"]), 1) if vals["rpe"] else None,
            }
        )
    return {
        "bands": sorted(rows, key=lambda r: r["band"]),
        "pearson_sleep_np_ftp": round(r, 3)
        if (r := _pearson(sleep_hours, np_ftp)) is not None
        else None,
    }


def insight_load_readiness(w: dict, weeks: int = 16) -> dict:
    """#3 — weekly strength-vs-endurance split vs that week's recovery."""
    today = date.today()
    shares: list[float] = []
    recs: list[float] = []
    rows = []
    for wk in range(weeks):
        end = today - timedelta(weeks=wk)
        start = end - timedelta(days=6)
        lifts = sum(
            1 for s in w["lifts"] if s.session_date and start <= s.session_date <= end
        )
        cardio = sum(
            1
            for a in w["activities"]
            if a.start_date and start <= a.start_date.date() <= end
        )
        total = lifts + cardio
        if total == 0:
            continue
        rec = [
            m.recovery_score
            for d, m in w["metrics"].items()
            if start <= d <= end and m.recovery_score is not None
        ]
        share = lifts / total
        rows.append(
            {
                "week_start": start.isoformat(),
                "strength_share": round(share, 2),
                "avg_recovery": round(mean(rec), 1) if rec else None,
            }
        )
        if rec:
            shares.append(share)
            recs.append(mean(rec))
    return {
        "weeks": list(reversed(rows)),
        "pearson_strength_share_recovery": round(r, 3)
        if (r := _pearson(shares, recs)) is not None
        else None,
    }


def insight_power_norms(w: dict, ftp_watts: float | None) -> dict:
    """#4 — NP/FTP by temperature band from weather-tagged activities."""
    bands: dict[str, list[float]] = {}
    for a in w["activities"]:
        if not a.normalized_power or not ftp_watts or a.weather_temperature is None:
            continue
        bands.setdefault(_temp_band(a.weather_temperature), []).append(
            a.normalized_power / ftp_watts
        )
    rows = []
    for band, vals in bands.items():
        if len(vals) < MIN_BUCKET_N:
            continue
        rows.append(
            {"band": band, "n": len(vals), "avg_np_ftp": round(mean(vals), 3)}
        )
    rows.sort(key=lambda r: r["avg_np_ftp"] or 0, reverse=True)
    return {"bands": rows, "best_band": rows[0]["band"] if rows else None}


def insight_pr_clustering(w: dict) -> dict:
    """#5 — fraction of PRs achieved after above-baseline recovery markers."""
    checks = {"hrv": [0, 0], "recovery": [0, 0], "sleep": [0, 0], "tsb": [0, 0]}
    n = 0
    tsb_by_date = w.get("tsb_by_date", {})
    for pr in w["prs"]:
        achieved = getattr(pr, "achieved_date", None)
        if achieved is None:
            continue
        day = achieved.date() if isinstance(achieved, datetime) else achieved
        base_rec, base_hrv = _baseline_recovery(w["metrics"], day)
        prior = w["metrics"].get(day - timedelta(days=1))
        s = w["sleep"].get(day - timedelta(days=1))
        n += 1
        if prior and prior.hrv_ms is not None and base_hrv:
            checks["hrv"][1] += 1
            checks["hrv"][0] += 1 if prior.hrv_ms >= base_hrv else 0
        if prior and prior.recovery_score is not None and base_rec:
            checks["recovery"][1] += 1
            checks["recovery"][0] += 1 if prior.recovery_score >= base_rec else 0
        if s and s.total_sleep_seconds and s.total_sleep_seconds / 3600 >= 7:
            checks["sleep"][1] += 1
            checks["sleep"][0] += 1
        elif s and s.total_sleep_seconds:
            checks["sleep"][1] += 1
        tsb = tsb_by_date.get(day)
        if tsb is not None:
            checks["tsb"][1] += 1
            checks["tsb"][0] += 1 if tsb > -10 else 0
    return {
        "n_prs": n,
        "above_baseline": {
            k: {"n": hit, "of": tot, "frac": round(hit / tot, 2) if tot else None}
            for k, (hit, tot) in checks.items()
        },
    }


def insight_tsb_peak(w: dict, ftp_watts: float | None) -> dict:
    """#6 — NP/FTP by personal TSB bucket (also feeds Feature 6)."""
    tsb_by_date: dict[date, float] = w.get("tsb_by_date", {})
    bands: dict[str, list[float]] = {}
    for a in w["activities"]:
        if not a.normalized_power or not ftp_watts or a.start_date is None:
            continue
        tsb = tsb_by_date.get(a.start_date.date())
        if tsb is None:
            continue
        bands.setdefault(_tsb_band(tsb), []).append(a.normalized_power / ftp_watts)
    rows = []
    for band, vals in bands.items():
        if len(vals) < MIN_BUCKET_N:
            continue
        rows.append(
            {"band": band, "n": len(vals), "avg_np_ftp": round(mean(vals), 3)}
        )
    rows.sort(key=lambda r: r["avg_np_ftp"] or 0, reverse=True)
    return {"bands": rows, "peak_band": rows[0]["band"] if rows else None}


# ── Orchestration ────────────────────────────────────────────────────────────

async def _ftp_watts(db: AsyncSession, user_id: uuid.UUID) -> float | None:
    from sqlalchemy import select as _select

    from app.models.cycling import CyclingProfile

    result = await db.execute(
        _select(CyclingProfile.ftp_watts).where(CyclingProfile.user_id == user_id)
    )
    ftp = result.scalar_one_or_none()
    return float(ftp) if ftp else None


async def _tsb_by_date(
    db: AsyncSession, user_id: uuid.UUID, cutoff: date
) -> dict[date, float]:
    """Personal TSB per date (fitted taus when available). Fail-soft → {}."""
    try:
        from app.services.cycling.training_load import training_load_for_user

        series = await training_load_for_user(
            db, user_id, date.today(), lookback_days=PERIOD_DAYS + 14
        )
        out = {}
        for row in series:
            d = row.get("date")
            tsb = row.get("tsb")
            if d is None or tsb is None:
                continue
            day = d.date() if isinstance(d, datetime) else d
            if isinstance(day, str):
                day = date.fromisoformat(day[:10])
            if day >= cutoff:
                out[day] = float(tsb)
        return out
    except Exception as e:
        logger.warning(f"TSB series unavailable for analytics (non-fatal): {e}")
        return {}


async def compute_all_insights(db: AsyncSession, user_id: uuid.UUID) -> list[AthleteInsight]:
    """Compute all six insights and upsert one row per type.

    Upsert (delete + insert per type) keeps the table to the current window —
    idempotent for nightly + on-demand runs.
    """
    from sqlalchemy import delete as _delete

    cutoff = date.today() - timedelta(days=PERIOD_DAYS)
    w = await _load_window(db, user_id, cutoff)
    ftp = await _ftp_watts(db, user_id)
    w["tsb_by_date"] = await _tsb_by_date(db, user_id, cutoff)

    payloads = {
        "recovery_cost": insight_recovery_cost(w),
        "sleep_performance": insight_sleep_performance(w, ftp),
        "load_readiness": insight_load_readiness(w),
        "power_norms": insight_power_norms(w, ftp),
        "pr_clustering": insight_pr_clustering(w),
        "tsb_peak": insight_tsb_peak(w, ftp),
    }

    rows = []
    for itype in INSIGHT_TYPES:
        data = payloads[itype]
        n = _sample_size(itype, data)
        await db.execute(
            _delete(AthleteInsight).where(
                AthleteInsight.user_id == user_id,
                AthleteInsight.insight_type == itype,
                AthleteInsight.period == PERIOD_LABEL,
            )
        )
        row = AthleteInsight(
            user_id=user_id,
            insight_type=itype,
            period=PERIOD_LABEL,
            period_start=cutoff,
            period_end=date.today(),
            data=data,
            sample_size=n,
            confidence=_confidence(n),
        )
        db.add(row)
        rows.append(row)
    await db.flush()
    return rows


def _sample_size(itype: str, data: dict) -> int:
    if itype == "recovery_cost":
        return int(data.get("n_sessions", 0))
    if itype == "pr_clustering":
        return int(data.get("n_prs", 0))
    if itype == "load_readiness":
        return len(data.get("weeks", []))
    if itype in ("sleep_performance", "power_norms", "tsb_peak"):
        return sum(b.get("n", 0) for b in data.get("bands", []))
    return 0
