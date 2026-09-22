"""Lifting-video analytics (Phase 6 leftovers: B-27 aggregation, B-29 injury
flags, B-30 RPE calibration).

Pure-query aggregation over analyzed LiftVideos — no Modal, no Gemini.
"""

import json
import logging
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.lift_video_analysis import LiftVideoAnalysis
from app.models.lifting import LiftingSession, LiftingSet, LiftVideo
from app.models.rpe_calibration import RpeCalibration

logger = logging.getLogger(__name__)

AGG_WINDOW_DAYS = 90
CALIB_MIN_SAMPLES_EXERCISE = 3
CALIB_MIN_SAMPLES_GLOBAL = 5

# B-29: deviation substrings (matched case-insensitively against the stored
# form_deviations JSON lists) that warrant an injury-risk HealthAlert.
HIGH_RISK_PATTERNS = {
    "form_knee_valgus": ("significant knee cave",),
    "form_back_rounding": ("significant back rounding",),
    "form_hitching": ("hitching detected",),
    "form_butt_lift": ("butt lifted off bench",),
}


def match_set_load(
    sets: list[LiftingSet], exercise_name: str | None, expected_reps: int | None
) -> float | None:
    """Weight of the uniquely-matching set, else None.

    Matches on normalised exercise name (skipping warm-ups), preferring the
    declared rep count. Only returns a value when exactly ONE candidate
    remains — a session with three squat sets must not have an arbitrary one's
    weight attached to the video.
    """
    from app.services.exercise_db import normalise_exercise_name

    target = normalise_exercise_name(exercise_name or "")
    candidates = [
        s for s in sets
        if not s.is_warmup and normalise_exercise_name(s.exercise_name) == target
    ]
    if expected_reps:
        by_reps = [s for s in candidates if s.reps == expected_reps]
        if by_reps:
            candidates = by_reps
    if len(candidates) != 1:
        return None
    return candidates[0].weight_kg


async def infer_video_load(
    db: AsyncSession, video: LiftVideo
) -> float | None:
    """Best-effort load for an unloaded video from its linked session's sets.

    Returns None (no change) when the video already has a load, isn't linked
    to a session, or the session's sets are ambiguous.
    """
    if video.weight_kg or not video.lifting_session_id:
        return None
    sets = list(
        (
            await db.execute(
                select(LiftingSet).where(
                    LiftingSet.session_id == video.lifting_session_id
                )
            )
        )
        .scalars()
        .all()
    )
    return match_set_load(sets, video.exercise_name, video.expected_reps)


async def aggregate_video_analyses(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Aggregate analyzed videos per exercise into LiftVideoAnalysis rows.

    Upserts one row per (user, exercise) over the trailing 90 days:
    rolling averages + {date, value} trend arrays. Returns exercise count.
    """
    cutoff = datetime.now(UTC) - timedelta(days=AGG_WINDOW_DAYS)
    videos = list(
        (
            await db.execute(
                select(LiftVideo).where(
                    LiftVideo.user_id == user_id,
                    LiftVideo.created_at >= cutoff,
                )
            )
        )
        .scalars()
        .all()
    )
    if not videos:
        return 0

    session_ids = {v.lifting_session_id for v in videos if v.lifting_session_id}
    session_rpe: dict[uuid.UUID, float] = {}
    if session_ids:
        rows = (
            await db.execute(
                select(LiftingSession.id, LiftingSession.rpe_session).where(
                    LiftingSession.id.in_(session_ids)
                )
            )
        ).all()
        session_rpe = {sid: rpe for sid, rpe in rows if rpe is not None}

    by_exercise: dict[str, list[LiftVideo]] = {}
    for v in videos:
        by_exercise.setdefault(v.exercise_name or "unknown", []).append(v)

    now = datetime.now(UTC)
    for exercise, vs in by_exercise.items():
        vs.sort(key=lambda v: v.created_at)
        forms = [v.form_score for v in vs if v.form_score is not None]
        vels = [v.mean_concentric_velocity for v in vs if v.mean_concentric_velocity is not None]
        cons = [v.rep_consistency_score for v in vs if v.rep_consistency_score is not None]
        rpe_errs = [
            abs(v.estimated_rpe - session_rpe[v.lifting_session_id])
            for v in vs
            if v.estimated_rpe is not None
            and v.lifting_session_id in session_rpe
        ]

        def avg(xs: list[float]) -> float | None:
            return round(sum(xs) / len(xs), 2) if xs else None

        def trend(rows: list[LiftVideo], getter) -> str:
            return json.dumps(
                [
                    {"date": v.created_at.date().isoformat(), "value": getter(v)}
                    for v in rows
                    if getter(v) is not None
                ]
            )

        await db.execute(
            delete(LiftVideoAnalysis).where(
                LiftVideoAnalysis.user_id == user_id,
                LiftVideoAnalysis.exercise_name == exercise,
            )
        )
        db.add(
            LiftVideoAnalysis(
                user_id=user_id,
                exercise_name=exercise,
                avg_form_score=avg(forms),
                avg_velocity=avg(vels),
                avg_consistency=avg(cons),
                avg_rpe_accuracy=avg(rpe_errs),
                video_count=len(vs),
                form_trend=trend(vs, lambda v: v.form_score),
                velocity_trend=trend(vs, lambda v: v.mean_concentric_velocity),
                consistency_trend=trend(vs, lambda v: v.rep_consistency_score),
                analyzed_at=now,
            )
        )
    await db.flush()
    return len(by_exercise)


async def flag_injury_risks(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Flag high-risk form patterns as HealthAlerts (B-29).

    Scans analyzed videos from the last 30 days for HIGH_RISK_PATTERNS and
    upserts one active alert per pattern (dedup + preference gating handled
    by ``upsert_alert``). Returns the number of new alerts created.
    """
    import json as _json

    cutoff = datetime.now(UTC) - timedelta(days=30)
    videos = list(
        (
            await db.execute(
                select(LiftVideo).where(
                    LiftVideo.user_id == user_id,
                    LiftVideo.created_at >= cutoff,
                    LiftVideo.form_deviations.isnot(None),
                )
            )
        )
        .scalars()
        .all()
    )
    hits: dict[str, list[str]] = {}
    for v in videos:
        try:
            deviations = _json.loads(v.form_deviations or "[]")
        except (ValueError, TypeError):
            continue
        text = " | ".join(str(d).lower() for d in deviations)
        label = v.exercise_name or "unknown"
        day = v.created_at.date().isoformat()
        for alert_type, patterns in HIGH_RISK_PATTERNS.items():
            if any(p in text for p in patterns):
                hits.setdefault(alert_type, []).append(f"{label} ({day})")

    from app.services.health_analysis import upsert_alert as _upsert

    created = 0
    titles = {
        "form_knee_valgus": "Knee valgus flagged in recent videos",
        "form_back_rounding": "Back rounding flagged in recent videos",
        "form_hitching": "Hitching flagged in recent videos",
        "form_butt_lift": "Butt lift flagged in recent videos",
    }
    for alert_type, where in hits.items():
        if await _upsert(
            db,
            user_id,
            {
                "alert_type": alert_type,
                "severity": "warning",
                "title": titles[alert_type],
                "description": (
                    f"High-risk pattern seen in {len(where)} video(s) this month: "
                    + "; ".join(where[:5])
                    + ". Consider deloading the lift and drilling the pattern with light loads."
                ),
                "evidence": {"videos": where, "pattern": alert_type},
            },
        ):
            created += 1
    return created


async def recalibrate_rpe(db: AsyncSession, user_id: uuid.UUID) -> int:
    """Recompute per-user AI↔user RPE offsets (B-30).

    Pairs each analyzed video's ``estimated_rpe`` with its linked session's
    user-reported RPE. Stores one aggregate row (exercise NULL) plus one row
    per exercise with enough samples. Stale rows are left untouched when
    samples are insufficient — a missing calibration simply means "no
    adjustment". Returns the number of rows written.
    """
    import math as _math

    cutoff = datetime.now(UTC) - timedelta(days=AGG_WINDOW_DAYS)
    videos = list(
        (
            await db.execute(
                select(LiftVideo).where(
                    LiftVideo.user_id == user_id,
                    LiftVideo.created_at >= cutoff,
                    LiftVideo.estimated_rpe.isnot(None),
                    LiftVideo.lifting_session_id.isnot(None),
                )
            )
        )
        .scalars()
        .all()
    )
    session_ids = {v.lifting_session_id for v in videos}
    session_rpe: dict[uuid.UUID, float] = {}
    if session_ids:
        rows = (
            await db.execute(
                select(LiftingSession.id, LiftingSession.rpe_session).where(
                    LiftingSession.id.in_(session_ids),
                    LiftingSession.rpe_session.isnot(None),
                )
            )
        ).all()
        session_rpe = {sid: rpe for sid, rpe in rows}

    pairs: list[tuple[str, float]] = []  # (exercise, user - ai)
    for v in videos:
        user_rpe = session_rpe.get(v.lifting_session_id)
        if user_rpe is None:
            continue
        pairs.append((v.exercise_name or "unknown", user_rpe - v.estimated_rpe))

    def stats(deltas: list[float]) -> tuple[float, float]:
        m = sum(deltas) / len(deltas)
        var = sum((d - m) ** 2 for d in deltas) / len(deltas)
        return round(m, 2), round(_math.sqrt(var), 2)

    now = datetime.now(UTC)
    written = 0

    async def upsert(exercise: str | None, deltas: list[float], minimum: int):
        nonlocal written
        if len(deltas) < minimum:
            return
        m, s = stats(deltas)
        await db.execute(
            delete(RpeCalibration).where(
                RpeCalibration.user_id == user_id,
                RpeCalibration.exercise_name.is_(exercise)
                if exercise is None
                else RpeCalibration.exercise_name == exercise,
            )
        )
        breakdown = None
        if exercise is None:
            per_ex: dict[str, list[float]] = {}
            for ex, d in pairs:
                per_ex.setdefault(ex, []).append(d)
            breakdown = json.dumps(
                {
                    ex: {"n": len(ds), "mean_delta": round(sum(ds) / len(ds), 2)}
                    for ex, ds in sorted(per_ex.items())
                }
            )
        db.add(
            RpeCalibration(
                user_id=user_id,
                exercise_name=exercise,
                sample_count=len(deltas),
                mean_delta=m,
                std_delta=s,
                exercise_breakdown=breakdown,
                last_updated=now,
            )
        )
        written += 1

    await upsert(None, [d for _, d in pairs], CALIB_MIN_SAMPLES_GLOBAL)
    per_exercise: dict[str, list[float]] = {}
    for ex, d in pairs:
        per_exercise.setdefault(ex, []).append(d)
    for ex, ds in per_exercise.items():
        await upsert(ex, ds, CALIB_MIN_SAMPLES_EXERCISE)
    await db.flush()
    return written


async def calibrated_rpe_for(
    db: AsyncSession,
    user_id: uuid.UUID,
    exercise_name: str | None,
    estimated_rpe: float | None,
) -> float | None:
    """Apply the stored RPE calibration to one estimate (B-30 read path).

    Exercise-specific offset wins; falls back to the global row. Returns the
    raw estimate unchanged when no calibration exists.
    """
    if estimated_rpe is None:
        return None
    offset = 0.0
    if exercise_name:
        row = (
            await db.execute(
                select(RpeCalibration).where(
                    RpeCalibration.user_id == user_id,
                    RpeCalibration.exercise_name == exercise_name,
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            offset = row.mean_delta
    if offset == 0.0:
        row = (
            await db.execute(
                select(RpeCalibration).where(
                    RpeCalibration.user_id == user_id,
                    RpeCalibration.exercise_name.is_(None),
                )
            )
        ).scalar_one_or_none()
        if row is not None:
            offset = row.mean_delta
    if offset == 0.0:
        return estimated_rpe
    return round(max(1.0, min(10.0, estimated_rpe + offset)), 1)
