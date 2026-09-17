"""Video analysis prompts and scoring logic for powerlifting form analysis (§3.18).

All functions in this module are pure — no DB access, no FastAPI deps.
They run inside the Modal container (only stdlib + google-genai available).
"""

from __future__ import annotations

import json
import logging
import math
from pathlib import Path

logger = logging.getLogger(__name__)

# ── IPF Competition Form Prompts ─────────────────────────────────────────────

SQUAT_FORM_PROMPT = """\
You are an IPF-certified powerlifting judge analyzing a BACK SQUAT video.
I have extracted {frame_count} frames from a set of {rep_count} reps at {weight_kg}kg.

IPF SQUAT RULES — a lift gets RED LIGHTS (fail) if:
1. The hip joint crease does NOT descend below the top surface of the knee (depth fail)
2. The bar is not supported on the back throughout
3. Any downward movement of the bar during the ascent (pressing out)
4. Failure to lockout hips and knees at the top

EVALUATE EACH REP for:
- Depth: hip crease below knee? (pass/fail per IPF)
- Lockout: full hip+knee extension at top?
- Bar path: vertical and symmetrical?
- Knee tracking: knees tracking over toes or caving inward (valgus)?
- Heels: staying flat on the platform?
- Back angle: consistent torso lean or excessive forward lean?
- Setup: walkout efficiency (max 1 step back in competition), stance width, bracing

For each frame, score deviations:
- Competition fail (depth miss): -25 points
- Major form breakdown (significant knee cave, severe forward lean): -15 points
- Moderate deviation (slight knee cave, inconsistent back angle): -10 points
- Minor deviation (slight asymmetry, minor heel lift): -5 points
- Inconsistent depth between reps: -3 per outlier rep

Return ONLY valid JSON (no markdown):
{{
  "exercise": "Back Squat",
  "rep_count": {rep_count},
  "competition_valid": true/false,
  "overall_form_score": 0-100,
  "depth_achieved": true/false,
  "lockout_complete": true/false,
  "bar_path_vertical": true/false,
  "knee_tracking": "good"|"minor_valgus"|"significant_valgus",
  "heels_flat": true/false,
  "back_angle_consistent": true/false,
  "setup_quality": "good"|"adequate"|"poor",
  "deviations": ["list of deviations with severity"],
  "severity": "none"|"minor"|"moderate"|"major",
  "coaching_cues": ["actionable suggestions"],
  "per_rep_notes": ["notes per rep if available"]
}}"""

BENCH_FORM_PROMPT = """\
You are an IPF-certified powerlifting judge analyzing a BENCH PRESS video.
I have extracted {frame_count} frames from a set of {rep_count} reps at {weight_kg}kg.

IPF BENCH PRESS RULES — a lift gets RED LIGHTS (fail) if:
1. Bar does NOT touch the chest (lower chest/sternum area)
2. Bar is NOT motionless on the chest (no pause — "press" command required)
3. Butt lifts off the bench during the press
4. Feet lift off the floor (IPF 2024+ rule)
5. Head lifts off the bench (IPF 2024+ rule)
6. Bar not at full arm extension at start or finish
7. Uneven lockout (one arm extends before the other)

EVALUATE EACH REP for:
- Chest contact: bar touches lower chest/sternum?
- Pause: bar motionless on chest for visible pause (>0.5s)?
- Butt contact: hips stay on bench throughout?
- Feet flat: both feet flat on floor?
- Head contact: back of head stays on bench?
- Lockout: full arm extension at top, symmetrical?
- Elbow position: controlled flare or excessive outward angle?
- Bar path: slight J-curve (optimal) or straight/irregular?

Score deviations:
- Competition fail (no pause, butt lift, feet lift): -25 points
- Major deviation (incomplete pause, significant butt lift): -15 points
- Moderate deviation (slight elbow flare, uneven lockout): -10 points
- Minor deviation (slight head lift, minor asymmetry): -5 points

Return ONLY valid JSON (no markdown):
{{
  "exercise": "Bench Press",
  "rep_count": {rep_count},
  "competition_valid": true/false,
  "overall_form_score": 0-100,
  "chest_contact": true/false,
  "pause_achieved": true/false,
  "butt_on_bench": true/false,
  "feet_flat": true/false,
  "head_on_bench": true/false,
  "lockout_complete": true/false,
  "lockout_symmetrical": true/false,
  "elbow_flare": "controlled"|"moderate"|"excessive",
  "bar_path_quality": "optimal"|"acceptable"|"suboptimal",
  "deviations": ["list of deviations with severity"],
  "severity": "none"|"minor"|"moderate"|"major",
  "coaching_cues": ["actionable suggestions"],
  "per_rep_notes": ["notes per rep if available"]
}}"""

DEADLIFT_FORM_PROMPT = """\
You are an IPF-certified powerlifting judge analyzing a DEADLIFT video.
I have extracted {frame_count} frames from a set of {rep_count} reps at {weight_kg}kg.

IPF DEADLIFT RULES — a lift gets RED LIGHTS (fail) if:
1. Bar does not reach full lockout (hips and knees extended, shoulders back)
2. Bar descends before lockout is complete
3. Bar is supported on the thighs during ascent (hitching/re-racking)
4. Hands slip down the bar during the lift
5. Failure to maintain grip until bar is on the floor
6. Soft knees at lockout (not fully extended)

EVALUATE EACH REP for:
- Lockout: full triple extension (hips, knees, ankles)?
- Hitching: bar resting on thighs during lockout phase?
- Bar path: vertical from floor to lockout?
- Back position: neutral spine or rounding (lumbar/thoracic)?
- Hip position: starting height appropriate (higher than knees for conventional)?
- Grip: hands outside knees, symmetrical?
- Shoulders: pulled back at lockout?
- Stance: conventional (hands outside) or sumo (hands inside)?

Score deviations:
- Competition fail (hitching, no lockout): -25 points
- Significant back rounding (lumbar flexion): -15 points
- Moderate rounding (thoracic only): -10 points
- Minor deviation (slight asymmetry, uneven lockout): -5 points
- Inconsistent starting position: -3 per outlier rep

Return ONLY valid JSON (no markdown):
{{
  "exercise": "Deadlift",
  "variation": "conventional"|"sumo",
  "rep_count": {rep_count},
  "competition_valid": true/false,
  "overall_form_score": 0-100,
  "lockout_complete": true/false,
  "hitching_detected": true/false,
  "bar_path_vertical": true/false,
  "back_position": "neutral"|"mild_thoracic_rounding"|"significant_rounding",
  "hip_start_position": "appropriate"|"too_low"|"too_high",
  "grip_symmetrical": true/false,
  "shoulders_back_at_lockout": true/false,
  "deviations": ["list of deviations with severity"],
  "severity": "none"|"minor"|"moderate"|"major",
  "coaching_cues": ["actionable suggestions"],
  "per_rep_notes": ["notes per rep if available"]
}}"""

ACCESSORY_FORM_PROMPT = """\
You are a strength coach analyzing an accessory lifting exercise video.
Exercise: {exercise_name}
I have extracted {frame_count} frames from a set of {rep_count} reps at {weight_kg}kg.

EVALUATE GENERAL FORM:
- Range of motion: full and consistent?
- Control: smooth concentric and eccentric phases?
- Tempo: consistent rep speed?
- Body position: stable, minimal cheating/momentum?
- Joint alignment: wrists, elbows, knees tracking correctly?
- Breathing: bracing pattern visible?

Score deviations from ideal form:
- Major (incomplete ROM, momentum/cheating): -15 points
- Moderate (inconsistent tempo, slight instability): -10 points
- Minor (slight asymmetry, minor form variation): -5 points

Return ONLY valid JSON (no markdown):
{{
  "exercise": "{exercise_name}",
  "rep_count": {rep_count},
  "overall_form_score": 0-100,
  "range_of_motion": "full"|"partial"|"inconsistent",
  "control": "excellent"|"good"|"poor",
  "tempo_consistent": true/false,
  "body_stable": true/false,
  "deviations": ["list of deviations"],
  "severity": "none"|"minor"|"moderate"|"major",
  "coaching_cues": ["actionable suggestions"],
  "per_rep_notes": ["notes per rep if available"]
}}"""

# ── Velocity Prompt ───────────────────────────────────────────────────────────

VELOCITY_PROMPT = """\
Analyze these consecutive frames from a weightlifting exercise ({exercise_name}).
Frame A is at time {t1:.2f}s, Frame B is at time {t2:.2f}s. Gap: {gap:.3f}s.

Estimate the bar vertical position in each frame as a percentage of total range of motion:
- 0% = bottom position (e.g., squat depth, chest level for bench, floor for deadlift)
- 100% = top position (full lockout/extension)

Return ONLY valid JSON (no markdown):
{{
  "position_a_pct": N.N,
  "position_b_pct": N.N,
  "phase": "concentric"|"eccentric"|"transition",
  "velocity_relative": "fast"|"moderate"|"slow"
}}"""

# ── Setup Prompt ──────────────────────────────────────────────────────────────

SETUP_PROMPT = """\
Analyze these frames from the SETUP PHASE of a {exercise_name} lift.
The lifter is preparing to perform the first rep. These are frames from BEFORE the lift starts.

Evaluate:
1. Foot positioning and stance width (shoulder-width? toes out? sumo width?)
2. Hand/grip placement on the bar (width, symmetry, hook grip?)
3. Back position and spinal alignment (neutral? rounded? overextended?)
4. Bracing/core engagement (visible abdominal expansion before the lift?)
5. Bar position (for squat: high bar vs low bar placement)
6. Overall setup routine quality and readiness
7. Walkout efficiency (for squat: how many steps taken?)

Return ONLY valid JSON (no markdown):
{{
  "setup_score": 0-100,
  "setup_duration_seconds": N.N,
  "bracing_detected": true/false,
  "foot_position": "description",
  "grip_notes": "description",
  "back_alignment": "neutral"|"rounded"|"overextended",
  "bar_position": "description",
  "walkout_steps": N,
  "deviations": ["list of issues"],
  "coaching_cues": ["actionable suggestions"]
}}"""

# ── Consistency Prompt ────────────────────────────────────────────────────────

CONSISTENCY_PROMPT = """\
These are frames from the BOTTOM position of each rep in a set of {exercise_name}.
There are {rep_count} reps total. Each frame shows the lifter at maximum depth/bottom position.

Compare the body positions across all reps:
1. Is the depth consistent across all reps?
2. Is the bar position consistent at the bottom?
3. Is the back angle consistent across reps?
4. Are there any reps that look significantly different from the others?

Return ONLY valid JSON (no markdown):
{{
  "rep_count": {rep_count},
  "depth_consistent": true/false,
  "bar_position_consistent": true/false,
  "back_angle_consistent": true/false,
  "outlier_reps": [list of rep numbers that differ],
  "consistency_score": 0-100,
  "notes": "brief explanation"
}}"""

# ── RPE Estimation Prompt ────────────────────────────────────────────────────

RPE_PROMPT = """\
Based on the following analysis of a {exercise_name} set, estimate the RPE
(Rate of Perceived Exertion) on a modified RIR (Reps in Reserve) scale.

Evidence:
- Bar velocity: mean={velocity:.2f} m/s, loss={velocity_loss:.1f}%
- Form breakdown: severity={form_severity}, score={form_score}/100
- Rest periods: avg={avg_rest:.0f}s between sets
- Set number: {set_number} of {total_sets}
- Weight: {weight_kg}kg x {reps} reps
- Consistency score: {consistency}/100

RPE CHART (powerlifting):
- RPE 10: 0 RIR — max effort, could not do another rep (>30% velocity loss)
- RPE 9.5: 0.5 RIR — maybe one more (20-30% velocity loss)
- RPE 9: 1 RIR — could definitely do one more (15-25% loss)
- RPE 8.5: 1.5 RIR — could do one more, maybe two (10-20% loss)
- RPE 8: 2 RIR — could do two more reps (8-15% loss)
- RPE 7.5: 2.5 RIR — could do two more, maybe three (5-12% loss)
- RPE 7: 3 RIR — could do three more reps (<8% loss)
- RPE 6: 4 RIR — could do four more reps
- RPE 5: 5+ RIR — easy, many reps left

Return ONLY valid JSON (no markdown):
{{
  "estimated_rpe": N.N,
  "rir_estimate": N.N,
  "confidence": 0.0-1.0,
  "evidence": ["list of visual cues used"],
  "reasoning": "brief explanation"
}}"""


# ── Exercise Classification ───────────────────────────────────────────────────

# Powerlifting exercises that have specific IPF form prompts
BIG3 = {"Back Squat", "Bench Press", "Deadlift"}
# Map common variations to the canonical prompt
EXERCISE_PROMPT_MAP: dict[str, str] = {
    "Back Squat": "squat",
    "Squat": "squat",
    "Front Squat": "squat",
    "Bench Press": "bench",
    "Bench": "bench",
    "Incline Bench Press": "bench",
    "Close-Grip Bench Press": "bench",
    "Deadlift": "deadlift",
    "Conventional Deadlift": "deadlift",
    "Sumo Deadlift": "deadlift",
}

# Powerlifting-specific VBT zones (m/s)
# {exercise: [(zone_name, min_velocity, max_velocity), ...]}
VBT_ZONES: dict[str, list[tuple[str, float, float]]] = {
    "Back Squat": [
        ("Absolute Strength", 0.0, 0.35),
        ("Maximum Strength", 0.35, 0.50),
        ("Strength-Speed", 0.50, 0.65),
        ("Power", 0.65, 0.85),
        ("Speed", 0.85, 99.0),
    ],
    "Bench Press": [
        ("Absolute Strength", 0.0, 0.30),
        ("Maximum Strength", 0.30, 0.45),
        ("Strength-Speed", 0.45, 0.60),
        ("Power", 0.60, 0.80),
        ("Speed", 0.80, 99.0),
    ],
    "Deadlift": [
        ("Absolute Strength", 0.0, 0.35),
        ("Maximum Strength", 0.35, 0.50),
        ("Strength-Speed", 0.50, 0.65),
        ("Power", 0.65, 0.85),
        ("Speed", 0.85, 99.0),
    ],
}

# Default zones for accessory exercises
VBT_ZONES_DEFAULT: list[tuple[str, float, float]] = [
    ("Absolute Strength", 0.0, 0.40),
    ("Maximum Strength", 0.40, 0.55),
    ("Strength-Speed", 0.55, 0.70),
    ("Power", 0.70, 0.90),
    ("Speed", 0.90, 99.0),
]

# ROM estimates in metres (powerlifting standards)
ROM_DEFAULTS: dict[str, float] = {
    "Back Squat": 0.50,
    "Squat": 0.50,
    "Front Squat": 0.50,
    "Bench Press": 0.40,
    "Bench": 0.40,
    "Incline Bench Press": 0.35,
    "Close-Grip Bench Press": 0.40,
    "Deadlift": 0.45,
    "Conventional Deadlift": 0.45,
    "Sumo Deadlift": 0.40,
    "Overhead Press": 0.55,
    "Barbell Row": 0.40,
    "Romanian Deadlift": 0.35,
}

# Velocity loss thresholds
VELOCITY_LOSS_GREEN = 10.0   # <10% = well within capacity
VELOCITY_LOSS_YELLOW = 20.0  # 10-20% = normal for hard sets
VELOCITY_LOSS_RED = 30.0     # >30% = excessive fatigue


# ── Helper Functions ──────────────────────────────────────────────────────────


def _get_form_prompt(exercise_name: str) -> str:
    """Return the appropriate form prompt for the exercise."""
    prompt_key = EXERCISE_PROMPT_MAP.get(exercise_name, "")
    if prompt_key == "squat":
        return SQUAT_FORM_PROMPT
    elif prompt_key == "bench":
        return BENCH_FORM_PROMPT
    elif prompt_key == "deadlift":
        return DEADLIFT_FORM_PROMPT
    return ACCESSORY_FORM_PROMPT


def _get_vbt_zone(exercise_name: str, velocity: float) -> str:
    """Map velocity to a powerlifting VBT zone name."""
    zones = VBT_ZONES.get(exercise_name, VBT_ZONES_DEFAULT)
    for zone_name, min_v, max_v in zones:
        if min_v <= velocity < max_v:
            return zone_name
    return zones[-1][0]  # highest zone if above all thresholds


def _get_rom(exercise_name: str) -> float:
    """Return estimated ROM in metres for the exercise."""
    return ROM_DEFAULTS.get(exercise_name, 0.45)


def _velocity_loss_pct(first_velocity: float, last_velocity: float) -> float:
    """Calculate velocity loss percentage from first to last rep."""
    if first_velocity <= 0:
        return 0.0
    return round(((first_velocity - last_velocity) / first_velocity) * 100, 1)


def _parse_gemini_json(raw_text: str) -> dict:
    """Parse JSON from Gemini response, handling markdown code blocks."""
    text = raw_text.strip()
    if text.startswith("```"):
        text = text.split("\n", 1)[1]
        text = text.removesuffix("```").strip()
    return json.loads(text)


def _call_gemini_form(client, prompt: str, frame_paths: list[Path]) -> dict:
    """Send frames to Gemini Vision and parse the JSON response."""
    from google.genai import types

    contents: list = [prompt]
    for fp in frame_paths:
        img_bytes = fp.read_bytes()
        contents.append(
            types.Part.from_bytes(data=img_bytes, mime_type="image/jpeg")
        )

    response = client.models.generate_content(
        model="gemini-3.6-flash",
        contents=contents,
        config=types.GenerateContentConfig(
            temperature=0.2,  # low temperature for consistent scoring
            max_output_tokens=1024,
        ),
    )

    return _parse_gemini_json(response.text or "{}")


# ── Dense Frame Extraction ───────────────────────────────────────────────────


def extract_dense_frames(
    input_path: Path,
    tmpdir: str,
    trim_start: float,
    trim_end: float,
    fps: float = 1.0,
    prefix: str = "dense",
) -> list[tuple[Path, float]]:
    """Extract frames at the given FPS using a single ffmpeg invocation.

    Returns list of (frame_path, timestamp_seconds) tuples.
    """
    import subprocess

    segment_duration = trim_end - trim_start
    if segment_duration <= 0:
        return []

    output_pattern = str(Path(tmpdir) / f"{prefix}_%04d.jpg")
    subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-ss",
            str(trim_start),
            "-to",
            str(trim_end),
            "-i",
            str(input_path),
            "-vf",
            f"fps={fps}",
            "-q:v",
            "2",
            output_pattern,
        ],
        capture_output=True,
        timeout=120,
    )

    frames: list[tuple[Path, float]] = []
    frame_interval = 1.0 / fps
    idx = 0
    while True:
        frame_path = Path(tmpdir) / f"{prefix}_{idx:04d}.jpg"
        if not frame_path.exists():
            break
        t = trim_start + (idx * frame_interval) + (frame_interval / 2)
        frames.append((frame_path, round(min(t, trim_end), 3)))
        idx += 1

    logger.info("Extracted %d dense frames at %.1f fps", len(frames), fps)
    return frames


def extract_rep_frames(
    input_path: Path,
    tmpdir: str,
    trim_start: float,
    trim_end: float,
    rep_count: int,
) -> list[tuple[Path, float]]:
    """Extract one frame per rep at evenly spaced intervals.

    Returns list of (frame_path, timestamp_seconds) tuples.
    """
    import subprocess

    if rep_count <= 0:
        return []

    segment_duration = trim_end - trim_start
    rep_interval = segment_duration / rep_count
    frames: list[tuple[Path, float]] = []

    for i in range(rep_count):
        # Extract frame at the midpoint of each rep interval
        t = trim_start + (i * rep_interval) + (rep_interval / 2)
        frame_path = Path(tmpdir) / f"rep_{i:02d}.jpg"
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-ss",
                str(t),
                "-i",
                str(input_path),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                str(frame_path),
            ],
            capture_output=True,
            timeout=30,
        )
        if frame_path.exists():
            frames.append((frame_path, round(t, 3)))

    logger.info("Extracted %d rep frames", len(frames))
    return frames


# ── Full Analysis Pipeline ───────────────────────────────────────────────────


def run_full_analysis(
    client,
    input_path: Path,
    tmpdir: str,
    trim_start: float,
    trim_end: float,
    exercise_name: str,
    rep_count: int,
    weight_kg: float,
) -> dict:
    """Run the full analysis pipeline: form, velocity, consistency, setup, RPE.

    All functions are pure and run inside the Modal container.
    """
    result: dict = {}

    # ── 1. Form analysis ─────────────────────────────────────────────────
    form_prompt_template = _get_form_prompt(exercise_name)
    # Use the dense frames for form analysis (up to 20 frames max for token limits)
    dense_frames = extract_dense_frames(input_path, tmpdir, trim_start, trim_end, fps=1.0, prefix="form")
    form_frame_paths = [fp for fp, _ in dense_frames[:20]]

    if form_frame_paths:
        try:
            form_prompt = form_prompt_template.format(
                frame_count=len(form_frame_paths),
                rep_count=rep_count,
                weight_kg=weight_kg,
                exercise_name=exercise_name,
            )
            form_result = _call_gemini_form(client, form_prompt, form_frame_paths)
            result["form"] = form_result
            logger.info("Form analysis: score=%s, valid=%s",
                        form_result.get("overall_form_score"),
                        form_result.get("competition_valid"))
        except Exception as e:
            logger.warning("Form analysis failed: %s", e)
            result["form"] = {"overall_form_score": 50, "competition_valid": None,
                              "deviations": [str(e)], "severity": "unknown",
                              "coaching_cues": []}

    # ── 2. Velocity tracking ─────────────────────────────────────────────
    # Extract frames at 2fps for velocity estimation
    velocity_frames = extract_dense_frames(input_path, tmpdir, trim_start, trim_end, fps=2.0, prefix="vel")
    if len(velocity_frames) >= 2 and rep_count > 0:
        try:
            velocities = []
            # Analyse pairs of consecutive frames
            for i in range(0, min(len(velocity_frames) - 1, rep_count * 3), 2):
                fp_a, t_a = velocity_frames[i]
                fp_b, t_b = velocity_frames[i + 1]
                gap = t_b - t_a
                if gap <= 0 or gap > 2.0:
                    continue

                velocity_prompt = VELOCITY_PROMPT.format(
                    exercise_name=exercise_name,
                    t1=t_a,
                    t2=t_b,
                    gap=gap,
                )
                vel_result = _call_gemini_form(client, velocity_prompt, [fp_a, fp_b])
                pos_a = vel_result.get("position_a_pct", 50)
                pos_b = vel_result.get("position_b_pct", 50)
                phase = vel_result.get("phase", "concentric")

                if phase == "concentric" and gap > 0:
                    rom = _get_rom(exercise_name)
                    displacement_m = abs(pos_b - pos_a) / 100.0 * rom
                    velocity_ms = displacement_m / gap
                    velocities.append(round(velocity_ms, 3))

            if velocities:
                result["velocity"] = {
                    "mean_concentric_velocity": round(
                        sum(velocities) / len(velocities), 3
                    ),
                    "peak_velocity": round(max(velocities), 3),
                    "velocities": velocities,
                }
                # Calculate velocity loss
                if len(velocities) >= 2:
                    loss = _velocity_loss_pct(velocities[0], velocities[-1])
                    result["velocity"]["velocity_loss_pct"] = loss
                    result["velocity"]["vbt_zone"] = _get_vbt_zone(
                        exercise_name, result["velocity"]["mean_concentric_velocity"]
                    )
                logger.info("Velocity: mean=%.3f m/s, peak=%.3f m/s",
                            result["velocity"]["mean_concentric_velocity"],
                            result["velocity"]["peak_velocity"])
        except Exception as e:
            logger.warning("Velocity analysis failed: %s", e)

    # ── 3. Consistency analysis ──────────────────────────────────────────
    rep_frames = extract_rep_frames(input_path, tmpdir, trim_start, trim_end, rep_count)
    if len(rep_frames) >= 2:
        try:
            consistency_prompt = CONSISTENCY_PROMPT.format(
                exercise_name=exercise_name,
                rep_count=len(rep_frames),
            )
            consistency_result = _call_gemini_form(
                client, consistency_prompt, [fp for fp, _ in rep_frames]
            )
            result["consistency"] = consistency_result
            logger.info("Consistency: score=%s", consistency_result.get("consistency_score"))
        except Exception as e:
            logger.warning("Consistency analysis failed: %s", e)

    # ── 4. Setup analysis ────────────────────────────────────────────────
    # Extract first 5 frames from the trimmed segment (setup phase)
    setup_frames = []
    setup_duration = min(5.0, trim_end - trim_start)
    for i in range(5):
        t = trim_start + (setup_duration * i / 5)
        frame_path = Path(tmpdir) / f"setup_{i}.jpg"
        import subprocess
        subprocess.run(
            [
                "ffmpeg", "-y", "-ss", str(t),
                "-i", str(input_path),
                "-frames:v", "1", "-q:v", "2", str(frame_path),
            ],
            capture_output=True, timeout=30,
        )
        if frame_path.exists():
            setup_frames.append(frame_path)

    if setup_frames:
        try:
            setup_prompt = SETUP_PROMPT.format(exercise_name=exercise_name)
            setup_result = _call_gemini_form(client, setup_prompt, setup_frames)
            result["setup"] = setup_result
            logger.info("Setup: score=%s", setup_result.get("setup_score"))
        except Exception as e:
            logger.warning("Setup analysis failed: %s", e)

    # ── 5. RPE estimation ────────────────────────────────────────────────
    # RPE is computed from the other analysis results (no extra Gemini call needed)
    mean_vel = result.get("velocity", {}).get("mean_concentric_velocity", 0.5)
    vel_loss = result.get("velocity", {}).get("velocity_loss_pct", 0)
    form_score = result.get("form", {}).get("overall_form_score", 70)
    form_severity = result.get("form", {}).get("severity", "unknown")
    consistency_score = result.get("consistency", {}).get("consistency_score", 70)

    # Heuristic RPE estimation based on velocity loss + form breakdown
    # Base RPE from velocity loss
    if vel_loss > 30:
        base_rpe = 10.0
    elif vel_loss > 20:
        base_rpe = 9.5
    elif vel_loss > 15:
        base_rpe = 9.0
    elif vel_loss > 10:
        base_rpe = 8.5
    elif vel_loss > 8:
        base_rpe = 8.0
    elif vel_loss > 5:
        base_rpe = 7.5
    elif vel_loss > 3:
        base_rpe = 7.0
    elif vel_loss > 1:
        base_rpe = 6.0
    else:
        base_rpe = 5.0

    # Adjust for form breakdown
    if form_severity == "major":
        base_rpe = min(10.0, base_rpe + 1.0)
    elif form_severity == "moderate":
        base_rpe = min(10.0, base_rpe + 0.5)

    # Adjust for late set (if rep count suggests fatigue)
    if rep_count >= 5:
        base_rpe = min(10.0, base_rpe + 0.5)

    # Confidence based on data quality
    confidence = 0.5
    if vel_loss > 0:
        confidence += 0.2
    if form_score > 0:
        confidence += 0.15
    if consistency_score > 0:
        confidence += 0.15
    confidence = min(1.0, confidence)

    result["rpe"] = {
        "estimated_rpe": round(base_rpe, 1),
        "rir_estimate": round(max(0, (10 - base_rpe)) / 2, 1),
        "confidence": round(confidence, 2),
        "evidence": [
            f"velocity_loss={vel_loss:.1f}%",
            f"form_score={form_score}",
            f"form_severity={form_severity}",
            f"consistency={consistency_score}",
            f"mean_velocity={mean_vel:.3f} m/s",
        ],
        "reasoning": (
            f"Based on {vel_loss:.1f}% velocity loss and {form_severity} form "
            f"breakdown (score {form_score}/100). Mean concentric velocity "
            f"{mean_vel:.3f} m/s."
        ),
    }

    # ── 6. Competition validity summary ──────────────────────────────────
    form_data = result.get("form", {})
    result["competition_valid"] = form_data.get("competition_valid")
    result["competition_notes"] = ""
    if result["competition_valid"] is False:
        deviations = form_data.get("deviations", [])
        result["competition_notes"] = "; ".join(deviations[:3]) if deviations else "Form deviations detected"

    return result
