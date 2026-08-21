"""Session analysis service — static analysis for lifting sessions and ride activities."""

import uuid
from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.activity import Activity, ActivityStream
from app.models.cycling import CyclingProfile
from app.models.lifting import LiftingSession, LiftingSet, PersonalRecord
from app.services.cycling import (
    POWER_ZONES,
    calculate_intensity_factor,
    calculate_vam,
    calculate_variability_index,
    compute_decoupling_for_activity,
    compute_normalized_power,
)
from app.services.lifting import brzycki_1rm

# ── Lifting Session Analysis ─────────────────────────────────────────────────


async def analyze_lifting_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    session_id: uuid.UUID,
) -> dict | None:
    """Analyze a single lifting session and return comprehensive metrics.

    Returns None if the session doesn't exist or doesn't belong to the user.
    """
    # Fetch session with sets
    result = await db.execute(
        select(LiftingSession)
        .options(selectinload(LiftingSession.sets))
        .where(
            LiftingSession.id == session_id,
            LiftingSession.user_id == user_id,
        )
    )
    session = result.scalar_one_or_none()
    if not session:
        return None

    sets = session.sets or []
    if not sets:
        return {
            "volume_breakdown": [],
            "set_progression": {},
            "rep_dropoff": [],
            "pr_proximity": [],
            "rpe_analysis": {
                "session_rpe": session.rpe_session,
                "avg_set_rpe": None,
                "rpe_vs_volume_correlation": None,
            },
            "fatigue_index": 0.0,
            "session_density": None,
            "exercise_count": 0,
            "working_sets_count": 0,
        }

    working_sets = [s for s in sets if not s.is_warmup]
    exercises = list({s.exercise_name for s in sets})

    # 1. Volume breakdown (per-exercise)
    volume_map: dict[str, float] = defaultdict(float)
    for s in working_sets:
        volume_map[s.exercise_name] += s.weight_kg * s.reps
    volume_breakdown = [
        {"exercise_name": name, "volume_kg": round(vol, 1)}
        for name, vol in sorted(volume_map.items(), key=lambda x: -x[1])
    ]

    # 2. Set progression (per-exercise, working sets only)
    sets_by_exercise: dict[str, list[LiftingSet]] = defaultdict(list)
    for s in working_sets:
        sets_by_exercise[s.exercise_name].append(s)

    set_progression: dict[str, list[dict]] = {}
    for exercise, exercise_sets in sets_by_exercise.items():
        points = []
        for s in sorted(exercise_sets, key=lambda x: x.set_number):
            est_1rm = brzycki_1rm(s.weight_kg, s.reps) if s.reps > 0 else None
            points.append({
                "set_number": s.set_number,
                "weight_kg": s.weight_kg,
                "reps": s.reps,
                "estimated_1rm": round(est_1rm, 1) if est_1rm else None,
            })
        set_progression[exercise] = points

    # 3. Rep dropoff (first vs last working set per exercise)
    rep_dropoff = []
    for exercise, exercise_sets in sets_by_exercise.items():
        sorted_sets = sorted(exercise_sets, key=lambda x: x.set_number)
        if len(sorted_sets) < 2:
            continue
        first_reps = sorted_sets[0].reps
        last_reps = sorted_sets[-1].reps
        if first_reps > 0:
            dropoff_pct = round(((first_reps - last_reps) / first_reps) * 100, 1)
        else:
            dropoff_pct = 0.0
        rep_dropoff.append({
            "exercise_name": exercise,
            "first_set_reps": first_reps,
            "last_set_reps": last_reps,
            "dropoff_pct": dropoff_pct,
        })

    # 4. PR proximity
    # Get all PRs for exercises in this session
    pr_exercises = list({s.exercise_name for s in working_sets})
    pr_result = await db.execute(
        select(PersonalRecord).where(
            PersonalRecord.user_id == user_id,
            PersonalRecord.exercise_name.in_(pr_exercises),
            PersonalRecord.estimated_1rm.isnot(None),
        )
    )
    prs = pr_result.scalars().all()

    # Build best PR per exercise (highest estimated_1rm)
    pr_by_exercise: dict[str, float] = {}
    for pr in prs:
        if pr.estimated_1rm is not None:
            if pr.exercise_name not in pr_by_exercise or pr.estimated_1rm > pr_by_exercise[pr.exercise_name]:
                pr_by_exercise[pr.exercise_name] = pr.estimated_1rm

    pr_proximity = []
    for exercise, exercise_sets in sets_by_exercise.items():
        if exercise not in pr_by_exercise:
            continue
        # Find the top set (highest estimated 1RM)
        top_1rm = 0.0
        for s in exercise_sets:
            est = brzycki_1rm(s.weight_kg, s.reps) if s.reps > 0 else 0
            top_1rm = max(top_1rm, est)
        if top_1rm <= 0:
            continue
        pr_1rm = pr_by_exercise[exercise]
        proximity_pct = round((top_1rm / pr_1rm) * 100, 1) if pr_1rm > 0 else 0.0
        pr_proximity.append({
            "exercise_name": exercise,
            "top_set_1rm": round(top_1rm, 1),
            "pr_1rm": round(pr_1rm, 1),
            "proximity_pct": proximity_pct,
        })

    # 5. RPE analysis
    set_rpes = [s.rpe for s in working_sets if s.rpe is not None]
    avg_set_rpe = round(sum(set_rpes) / len(set_rpes), 1) if set_rpes else None

    rpe_vs_volume_correlation = None
    if len(set_rpes) >= 3 and session.rpe_session is not None:
        # Simple correlation: compare session RPE trend to volume trend
        # Use per-exercise RPE escalation as a proxy
        rpe_escalations = []
        for exercise, exercise_sets in sets_by_exercise.items():
            sorted_s = sorted(exercise_sets, key=lambda x: x.set_number)
            exercise_rpes = [s.rpe for s in sorted_s if s.rpe is not None]
            if len(exercise_rpes) >= 2:
                rpe_escalations.append(exercise_rpes[-1] - exercise_rpes[0])
        if rpe_escalations:
            avg_escalation = sum(rpe_escalations) / len(rpe_escalations)
            # Positive escalation means RPE increased across sets (expected)
            rpe_vs_volume_correlation = round(avg_escalation, 2)

    rpe_analysis = {
        "session_rpe": session.rpe_session,
        "avg_set_rpe": avg_set_rpe,
        "rpe_vs_volume_correlation": rpe_vs_volume_correlation,
    }

    # 6. Fatigue index (0-100 composite)
    fatigue_components = []

    # Component A: Average rep dropoff (0-50 points)
    if rep_dropoff:
        avg_dropoff = sum(d["dropoff_pct"] for d in rep_dropoff) / len(rep_dropoff)
        # 0% dropoff = 0 points, 50%+ dropoff = 50 points
        fatigue_components.append(min(50.0, avg_dropoff))
    else:
        fatigue_components.append(0.0)

    # Component B: RPE escalation (0-30 points)
    if rpe_vs_volume_correlation is not None:
        # 0 escalation = 0 points, 3+ escalation = 30 points
        fatigue_components.append(min(30.0, max(0.0, rpe_vs_volume_correlation * 10)))
    else:
        fatigue_components.append(0.0)

    # Component C: Session RPE (0-20 points)
    if session.rpe_session is not None:
        # RPE 1-10 mapped to 0-20 points
        fatigue_components.append(min(20.0, max(0.0, (session.rpe_session - 1) * 20 / 9)))
    else:
        fatigue_components.append(0.0)

    fatigue_index = round(min(100.0, sum(fatigue_components)), 1)

    # 7. Session density
    session_density = None
    if session.duration_seconds and session.duration_seconds > 0 and session.total_volume_kg:
        session_density = round(session.total_volume_kg / (session.duration_seconds / 60), 1)

    # 8 & 9. Counts
    exercise_count = len(exercises)
    working_sets_count = len(working_sets)

    return {
        "volume_breakdown": volume_breakdown,
        "set_progression": set_progression,
        "rep_dropoff": rep_dropoff,
        "pr_proximity": pr_proximity,
        "rpe_analysis": rpe_analysis,
        "fatigue_index": fatigue_index,
        "session_density": session_density,
        "exercise_count": exercise_count,
        "working_sets_count": working_sets_count,
    }


# ── Ride Activity Analysis ───────────────────────────────────────────────────


def _extract_stream_data(stream: ActivityStream | None) -> list[float]:
    """Extract numeric data from an ActivityStream, filtering out None values."""
    if not stream:
        return []
    raw = stream.data.get("data", []) if isinstance(stream.data, dict) else []
    return [float(v) for v in raw if v is not None]


async def analyze_ride(
    db: AsyncSession,
    user_id: uuid.UUID,
    activity_id: uuid.UUID,
) -> dict | None:
    """Analyze a single ride activity and return comprehensive metrics.

    Returns None if the activity doesn't exist or doesn't belong to the user.
    """
    # Fetch activity
    result = await db.execute(
        select(Activity).where(
            Activity.id == activity_id,
            Activity.user_id == user_id,
        )
    )
    activity = result.scalar_one_or_none()
    if not activity:
        return None

    # Fetch streams
    stream_result = await db.execute(
        select(ActivityStream).where(ActivityStream.activity_id == activity_id)
    )
    streams = list(stream_result.scalars().all())

    stream_map: dict[str, ActivityStream] = {}
    for s in streams:
        stream_map[s.stream_type] = s

    power_stream = stream_map.get("watts") or stream_map.get("power")
    hr_stream = stream_map.get("heartrate")
    altitude_stream = stream_map.get("altitude")

    power_data = _extract_stream_data(power_stream)
    hr_data = _extract_stream_data(hr_stream)
    altitude_data = _extract_stream_data(altitude_stream)

    # 1. Power zones (requires FTP)
    power_zones = []
    if power_data:
        # Get cycling profile for FTP
        profile_result = await db.execute(
            select(CyclingProfile).where(CyclingProfile.user_id == user_id)
        )
        profile = profile_result.scalar_one_or_none()
        ftp = profile.ftp_watts if profile and profile.ftp_watts else None

        if ftp and ftp > 0:
            resolution = power_stream.resolution if power_stream and power_stream.resolution else 1
            zone_times: dict[str, int] = {z[0]: 0 for z in POWER_ZONES}

            for val in power_data:
                if val <= 0:
                    continue
                pct_ftp = val / ftp
                for zone_id, _, lower, upper in POWER_ZONES:
                    if lower <= pct_ftp < upper:
                        zone_times[zone_id] += resolution
                        break
                else:
                    zone_times["Z7"] += resolution

            total_zone_time = sum(zone_times.values()) or 1
            for zone_id, zone_name, _, _ in POWER_ZONES:
                secs = zone_times.get(zone_id, 0)
                power_zones.append({
                    "zone_name": zone_id,
                    "zone_label": zone_name,
                    "seconds": secs,
                    "pct": round((secs / total_zone_time) * 100, 1),
                })

    # 2. Power distribution histogram
    histogram_buckets = [
        (0, 50, "0-50W"),
        (50, 100, "50-100W"),
        (100, 150, "100-150W"),
        (150, 200, "150-200W"),
        (200, 250, "200-250W"),
        (250, 300, "250-300W"),
        (300, 350, "300-350W"),
        (350, 400, "350-400W"),
        (400, float("inf"), "400+W"),
    ]
    power_distribution = []
    if power_data:
        total_points = len(power_data)
        for low, high, label in histogram_buckets:
            count = sum(1 for p in power_data if low <= p < high)
            power_distribution.append({
                "range_label": label,
                "count": count,
                "pct": round((count / total_points) * 100, 1) if total_points > 0 else 0.0,
            })

    # 3. Pacing analysis (10% segments)
    pacing_analysis = None
    if power_data and len(power_data) >= 10:
        n = len(power_data)
        segments = []
        for i in range(10):
            start_idx = int(n * i / 10)
            end_idx = int(n * (i + 1) / 10)
            segment_data = power_data[start_idx:end_idx]
            avg_pwr = round(sum(segment_data) / len(segment_data), 1) if segment_data else None
            segments.append({
                "pct_start": round(i * 10, 1),
                "pct_end": round((i + 1) * 10, 1),
                "avg_power": avg_pwr,
            })

        # Power variability across segments
        seg_powers = [s["avg_power"] for s in segments if s["avg_power"] is not None]
        if len(seg_powers) >= 2:
            mean_pwr = sum(seg_powers) / len(seg_powers)
            if mean_pwr > 0:
                variance = sum((p - mean_pwr) ** 2 for p in seg_powers) / len(seg_powers)
                power_variability = round((variance ** 0.5) / mean_pwr * 100, 1)
            else:
                power_variability = None
        else:
            power_variability = None

        pacing_analysis = {
            "segments": segments,
            "power_variability": power_variability,
        }

    # 4. Variability index (NP / AP)
    variability_index = None
    if power_data:
        np_val = compute_normalized_power(power_data)
        if np_val and activity.average_power:
            variability_index = calculate_variability_index(np_val, activity.average_power)

    # 5. Intensity factor (NP / FTP)
    intensity_factor = None
    if power_data:
        np_val = compute_normalized_power(power_data)
        if np_val:
            # Get FTP from profile
            if not profile:
                profile_result = await db.execute(
                    select(CyclingProfile).where(CyclingProfile.user_id == user_id)
                )
                profile = profile_result.scalar_one_or_none()
            ftp = profile.ftp_watts if profile and profile.ftp_watts else None
            if ftp:
                intensity_factor = calculate_intensity_factor(np_val, ftp)

    # 6. Decoupling (ride > 60 min with both power + HR streams)
    decoupling = None
    if activity.duration_seconds and activity.duration_seconds > 3600 and power_data and hr_data:
        dec_result = await compute_decoupling_for_activity(db, activity_id)
        if dec_result:
            decoupling = {
                "decoupling_pct": dec_result.decoupling_pct,
                "first_half_ratio": dec_result.first_half_ratio,
                "second_half_ratio": dec_result.second_half_ratio,
                "classification": dec_result.classification,
                "duration_seconds": dec_result.duration_seconds,
            }

    # 7. Efficiency factor (NP / avg HR)
    efficiency_factor = None
    if power_data:
        np_val = compute_normalized_power(power_data)
        if np_val and activity.average_heartrate and activity.average_heartrate > 0:
            efficiency_factor = round(np_val / activity.average_heartrate, 2)

    # 8. VAM
    vam = None
    if activity.elevation_gain_meters and activity.duration_seconds:
        vam = calculate_vam(activity.elevation_gain_meters, activity.duration_seconds)

    # 9. TSS breakdown
    tss_breakdown = {
        "total_tss": activity.tss,
        "tss_per_hour": None,
    }
    if activity.tss and activity.duration_seconds and activity.duration_seconds > 0:
        tss_breakdown["tss_per_hour"] = round(activity.tss / (activity.duration_seconds / 3600), 1)

    # 10. Climbing analysis (from altitude stream)
    climbing_analysis = None
    if altitude_data and len(altitude_data) >= 2:
        # Compute gradient from altitude changes
        # Assume 1-second resolution unless specified
        resolution = altitude_stream.resolution if altitude_stream and altitude_stream.resolution else 1

        total_climbing = 0.0
        total_descending = 0.0
        climbing_seconds = 0
        flat_seconds = 0
        descending_seconds = 0
        gradients = []

        # Estimate distance per sample from average speed
        dist_per_sample = None
        if activity.average_speed and activity.average_speed > 0:
            # average_speed is in m/s
            dist_per_sample = activity.average_speed * resolution

        for i in range(1, len(altitude_data)):
            alt_diff = altitude_data[i] - altitude_data[i - 1]
            if alt_diff > 0:
                total_climbing += alt_diff
                climbing_seconds += resolution
            elif alt_diff < 0:
                total_descending += abs(alt_diff)
                descending_seconds += resolution
            else:
                flat_seconds += resolution

            # Compute gradient if we have distance info
            if dist_per_sample and dist_per_sample > 0 and alt_diff != 0:
                gradient_pct = (alt_diff / dist_per_sample) * 100
                gradients.append(gradient_pct)

        total_climb_desc_time = climbing_seconds + flat_seconds + descending_seconds
        climbing_analysis = {
            "total_climbing_m": round(total_climbing, 1),
            "total_descending_m": round(total_descending, 1),
            "avg_gradient_pct": round(sum(gradients) / len(gradients), 1) if gradients else None,
            "max_gradient_pct": round(max(gradients), 1) if gradients else None,
            "climbing_seconds": climbing_seconds,
            "flat_seconds": flat_seconds,
            "descending_seconds": descending_seconds,
            "climbing_pct": round((climbing_seconds / total_climb_desc_time) * 100, 1) if total_climb_desc_time > 0 else None,
        }

    return {
        "power_zones": power_zones,
        "power_distribution": power_distribution,
        "pacing_analysis": pacing_analysis if pacing_analysis else {"segments": [], "power_variability": None},
        "variability_index": variability_index,
        "intensity_factor": intensity_factor,
        "decoupling": decoupling,
        "efficiency_factor": efficiency_factor,
        "vam": vam,
        "tss_breakdown": tss_breakdown,
        "climbing_analysis": climbing_analysis,
    }
