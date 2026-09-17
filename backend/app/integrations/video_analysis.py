"""Video analysis prompts and scoring logic for powerlifting form analysis (§3.18).

All functions in this module are pure — no DB access, no FastAPI deps.
They run inside the Modal container (only stdlib + google-genai available).
"""

from __future__ import annotations

import json
import logging
import math
import time
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Gemini retry helper ──────────────────────────────────────────────────────

_RETRYABLE_codes = {429, 500, 502, 503, 504}


def _gemini_retry(func, *args, max_retries: int = 3, **kwargs):
    """Call func with exponential backoff on transient Gemini errors."""
    last_exc = None
    for attempt in range(max_retries):
        try:
            return func(*args, **kwargs)
        except Exception as exc:
            msg = str(exc)
            retryable = any(
                code in msg for code in ("429", "500", "502", "503", "504", "UNAVAILABLE", "RESOURCE_EXHAUSTED")
            )
            if retryable and attempt < max_retries - 1:
                wait = 2 ** attempt * 2  # 2s, 4s, 8s
                logger.warning("Gemini call failed (attempt %d/%d): %s — retrying in %ds",
                               attempt + 1, max_retries, msg[:120], wait)
                time.sleep(wait)
                last_exc = exc
            else:
                raise
    raise last_exc  # unreachable but satisfies type checker

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

    def _do_call():
        return client.models.generate_content(
            model="gemini-3.6-flash",
            contents=contents,
            config=types.GenerateContentConfig(
                temperature=0.2,  # low temperature for consistent scoring
                max_output_tokens=1024,
            ),
        )

    response = _gemini_retry(_do_call)
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


# ── OpenCV Optical Flow Velocity Estimation ──────────────────────────────────


def _smooth_signal(signal, window: int = 5):
    """Simple moving average smoothing (no scipy dependency)."""
    import numpy as np

    if len(signal) < window:
        return signal
    kernel = np.ones(window) / window
    return np.convolve(signal, kernel, mode="same")


def _extract_frames_gray(
    input_path: Path, tmpdir: str, trim_start: float, trim_end: float, fps: float = 10.0
):
    """Extract grayscale frames from video segment using ffmpeg.

    Returns list of (numpy_array, timestamp) tuples.
    """
    import subprocess

    import cv2
    import numpy as np

    segment_duration = trim_end - trim_start
    if segment_duration <= 0:
        return [], []

    output_pattern = str(Path(tmpdir) / "flow_%04d.jpg")
    subprocess.run(
        [
            "ffmpeg", "-y",
            "-ss", str(trim_start),
            "-to", str(trim_end),
            "-i", str(input_path),
            "-vf", f"fps={fps}",
            "-q:v", "2",
            output_pattern,
        ],
        capture_output=True, timeout=60,
    )

    frames = []
    timestamps = []
    for i in range(1, 9999):
        fp = Path(tmpdir) / f"flow_{i:04d}.jpg"
        if not fp.exists():
            break
        img = cv2.imread(str(fp), cv2.IMREAD_GRAYSCALE)
        if img is not None:
            frames.append(img)
            timestamps.append(trim_start + (i - 1) / fps)

    return frames, timestamps


def _estimate_pixels_per_meter(
    frames_gray: list,
    exercise_name: str,
) -> float:
    """Estimate pixel-to-meter scale from video frames.

    Strategy:
    1. Track total vertical displacement across the set
    2. Divide by ROM to get pixels_per_meter
    """
    import cv2
    import numpy as np

    if len(frames_gray) < 2:
        return 0.0

    # Use Lucas-Kanade to track features and measure total displacement
    feature_params = {"maxCorners": 200, "qualityLevel": 0.3, "minDistance": 7, "blockSize": 7}
    lk_params = {
        "winSize": (21, 21), "maxLevel": 3,
        "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.01),
    }

    p0 = cv2.goodFeaturesToTrack(frames_gray[0], mask=None, **feature_params)
    if p0 is None:
        return 0.0

    max_disp = 0.0
    prev_gray = frames_gray[0]
    for gray in frames_gray[1:]:
        p1, st, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, p0, None, **lk_params)
        if p1 is None:
            break
        good_new = p1[st == 1]
        good_old = p0[st == 1]
        if len(good_new) < 10:
            break
        # Vertical displacement of all tracked points
        dy = np.abs(good_new[:, 1] - good_old[:, 1])
        median_disp = float(np.median(dy))
        max_disp += median_disp
        prev_gray = gray

    rom = _get_rom(exercise_name)
    if max_disp > 10 and rom > 0:
        return max_disp / rom
    return 0.0


def track_barbell_optical_flow(
    input_path: Path,
    tmpdir: str,
    trim_start: float,
    trim_end: float,
    exercise_name: str,
    fps: float = 10.0,
) -> dict:
    """Track barbell vertical position using Lucas-Kanade optical flow.

    Returns dict with velocity metrics and per-rep timing data.
    """
    import cv2
    import numpy as np

    frames_gray, timestamps = _extract_frames_gray(
        input_path, tmpdir, trim_start, trim_end, fps
    )
    if len(frames_gray) < 3:
        return {"tracking_quality": "failed", "mean_concentric_velocity": 0.0}

    feature_params = {"maxCorners": 200, "qualityLevel": 0.3, "minDistance": 7, "blockSize": 7}
    lk_params = {
        "winSize": (21, 21), "maxLevel": 3,
        "criteria": (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 20, 0.01),
    }

    # Detect features on first frame
    p0 = cv2.goodFeaturesToTrack(frames_gray[0], mask=None, **feature_params)
    if p0 is None:
        return {"tracking_quality": "failed", "mean_concentric_velocity": 0.0}

    # Track features through all frames
    vertical_positions = []
    prev_gray = frames_gray[0]
    tracked_count = 0

    for i, gray in enumerate(frames_gray[1:], 1):
        p1, st, _ = cv2.calcOpticalFlowPyrLK(prev_gray, gray, p0, None, **lk_params)
        if p1 is None:
            vertical_positions.append(vertical_positions[-1] if vertical_positions else 0.0)
            prev_gray = gray
            continue

        good_new = p1[st == 1]
        good_old = p0[st == 1]

        if len(good_new) < 10:
            # Re-detect features
            p0 = cv2.goodFeaturesToTrack(gray, mask=None, **feature_params)
            vertical_positions.append(vertical_positions[-1] if vertical_positions else 0.0)
            prev_gray = gray
            continue

        tracked_count += 1
        # Median vertical displacement (robust to outliers).
        # NOTE: this assumes a static (tripod) camera, which holds for lift
        # videos. An earlier revision subtracted the global median motion as
        # "camera motion" — but both medians were computed over the same
        # features, so bar_motion was identically zero on every frame and no
        # velocity was ever measured (found 2026-09-17).
        dy = good_new[:, 1] - good_old[:, 1]
        median_dy = float(np.median(dy))
        bar_motion = median_dy

        if vertical_positions:
            vertical_positions.append(vertical_positions[-1] + bar_motion)
        else:
            vertical_positions.append(bar_motion)

        # Redetect features periodically
        if len(good_new) < 50 or i % 15 == 0:
            p0 = cv2.goodFeaturesToTrack(gray, mask=None, **feature_params)
        else:
            p0 = good_new.reshape(-1, 1, 2)

        prev_gray = gray

    if not vertical_positions or tracked_count < 3:
        return {"tracking_quality": "failed", "mean_concentric_velocity": 0.0}

    ts = np.array(timestamps[: len(vertical_positions)])
    pos = np.array(vertical_positions)

    # Smooth the position signal
    pos_smooth = _smooth_signal(pos, window=5)

    # Estimate pixels per meter
    ppm = _estimate_pixels_per_meter(frames_gray, exercise_name)
    if ppm <= 0:
        # Fallback: assume total displacement = ROM
        total_disp = float(np.max(pos_smooth) - np.min(pos_smooth))
        rom = _get_rom(exercise_name)
        if total_disp > 10 and rom > 0:
            ppm = total_disp / rom
        else:
            ppm = 100.0  # arbitrary fallback

    # Detect reps from the motion signal
    rep_data = _detect_reps_from_motion(pos_smooth, ts, ppm, fps)

    # Extract concentric velocities
    velocities = [r["concentric_velocity_ms"] for r in rep_data if r.get("concentric_velocity_ms", 0) > 0]

    result = {
        "tracking_quality": "good" if tracked_count > len(frames_gray) * 0.5 else "degraded",
        "frame_count": len(frames_gray),
        "pixels_per_meter": round(ppm, 1),
        "rep_timings": rep_data,
        "velocities": [round(v, 3) for v in velocities],
    }

    if velocities:
        result["mean_concentric_velocity"] = round(sum(velocities) / len(velocities), 3)
        result["peak_velocity"] = round(max(velocities), 3)
        if len(velocities) >= 2:
            result["velocity_loss_pct"] = round(
                _velocity_loss_pct(velocities[0], velocities[-1]), 1
            )
            result["vbt_zone"] = _get_vbt_zone(exercise_name, result["mean_concentric_velocity"])
    else:
        result["mean_concentric_velocity"] = 0.0
        result["peak_velocity"] = 0.0

    logger.info(
        "Optical flow: %d frames, %d reps, quality=%s, mean_vel=%.3f m/s",
        len(frames_gray), len(rep_data), result["tracking_quality"],
        result["mean_concentric_velocity"],
    )
    return result


def _detect_reps_from_motion(
    vertical_position,
    timestamps,
    pixels_per_meter: float,
    fps: float,
    min_rep_duration: float = 0.3,
    max_rep_duration: float = 8.0,
) -> list:
    """Detect individual reps from vertical position signal.

    Uses peak/valley detection on the smoothed position curve.
    """
    import numpy as np

    if len(vertical_position) < 5:
        return []

    signal = np.array(vertical_position)
    ts = np.array(timestamps)

    # Find local minima (bottom of each rep) and maxima (top of each rep)
    # by looking at sign changes of the first derivative
    diff = np.diff(signal)
    minima_idx = []
    maxima_idx = []

    for i in range(1, len(diff)):
        if diff[i - 1] < 0 and diff[i] >= 0:
            minima_idx.append(i)
        elif diff[i - 1] > 0 and diff[i] <= 0:
            maxima_idx.append(i)

    # Pair minima and maxima into reps
    reps = []
    used_maxima = set()

    for mi in minima_idx:
        # Find the next maximum after this minimum
        best_max = None
        for mx in maxima_idx:
            if mx > mi and mx not in used_maxima:
                duration = ts[mx] - ts[mi]
                if min_rep_duration <= duration <= max_rep_duration:
                    best_max = mx
                    break

        if best_max is None:
            continue

        used_maxima.add(best_max)
        concentric_time = ts[best_max] - ts[mi]
        amplitude_px = abs(signal[best_max] - signal[mi])

        # Convert to velocity
        amplitude_m = amplitude_px / pixels_per_meter if pixels_per_meter > 0 else 0
        concentric_velocity = amplitude_m / concentric_time if concentric_time > 0 else 0

        reps.append({
            "rep_number": len(reps) + 1,
            "start_time": round(float(ts[mi]), 2),
            "end_time": round(float(ts[best_max]), 2),
            "concentric_time": round(concentric_time, 2),
            "amplitude_px": round(float(amplitude_px), 1),
            "amplitude_m": round(amplitude_m, 3),
            "concentric_velocity_ms": round(concentric_velocity, 3),
        })

    return reps


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
    logger.info("run_full_analysis: exercise=%s reps=%d weight=%.1f trim=%.1f-%.1f",
                exercise_name, rep_count, weight_kg, trim_start, trim_end)

    # ── 1. Form analysis ─────────────────────────────────────────────────
    form_prompt_template = _get_form_prompt(exercise_name)
    # Use the dense frames for form analysis (up to 20 frames max for token limits)
    dense_frames = extract_dense_frames(input_path, tmpdir, trim_start, trim_end, fps=1.0, prefix="form")
    form_frame_paths = [fp for fp, _ in dense_frames[:20]]
    logger.info("Form analysis: %d frames extracted", len(form_frame_paths))

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

    # ── 2. Velocity tracking (OpenCV optical flow, Gemini fallback) ──────
    try:
        vel_result = track_barbell_optical_flow(
            input_path=input_path,
            tmpdir=tmpdir,
            trim_start=trim_start,
            trim_end=trim_end,
            exercise_name=exercise_name,
        )
        if vel_result.get("tracking_quality") != "failed":
            result["velocity"] = {
                "mean_concentric_velocity": vel_result["mean_concentric_velocity"],
                "peak_velocity": vel_result["peak_velocity"],
                "velocities": vel_result.get("velocities", []),
                "velocity_loss_pct": vel_result.get("velocity_loss_pct"),
                "vbt_zone": vel_result.get("vbt_zone"),
            }
            result["rep_timing"] = vel_result.get("rep_timings", [])
            logger.info("Velocity (optical flow): mean=%.3f m/s, %d reps, quality=%s",
                        vel_result["mean_concentric_velocity"],
                        len(vel_result.get("rep_timings", [])),
                        vel_result["tracking_quality"])
        else:
            logger.warning("Optical flow tracking failed, trying Gemini fallback")
            raise RuntimeError("optical flow failed")
    except Exception as e:
        logger.warning("Optical flow velocity failed (%s), trying Gemini fallback", e)
        # Gemini fallback: single call with all frames
        try:
            velocity_frames = extract_dense_frames(
                input_path, tmpdir, trim_start, trim_end, fps=2.0, prefix="vel"
            )
            if len(velocity_frames) >= 2 and rep_count > 0:
                all_frame_paths = [fp for fp, _ in velocity_frames[:20]]
                fallback_prompt = (
                    f"Analyze these {len(all_frame_paths)} frames from a {exercise_name} set "
                    f"of {rep_count} reps. For EACH consecutive pair of frames, estimate:\n"
                    "1. Bar vertical position as % of ROM (0%=bottom, 100%=top)\n"
                    "2. Phase: concentric (going up) or eccentric (going down)\n\n"
                    "Return ONLY valid JSON:\n"
                    '{"pairs": [{"frame_a_pct": N, "frame_b_pct": N, "phase": "..."}]}'
                )
                fallback_result = _call_gemini_form(client, fallback_prompt, all_frame_paths)
                pairs = fallback_result.get("pairs", [])
                velocities = []
                for pair in pairs:
                    if pair.get("phase") == "concentric":
                        pos_a = pair.get("frame_a_pct", 50)
                        pos_b = pair.get("frame_b_pct", 50)
                        displacement_m = abs(pos_b - pos_a) / 100.0 * _get_rom(exercise_name)
                        velocity_ms = displacement_m / 0.5  # ~0.5s gap at 2fps
                        velocities.append(round(velocity_ms, 3))
                if velocities:
                    result["velocity"] = {
                        "mean_concentric_velocity": round(sum(velocities) / len(velocities), 3),
                        "peak_velocity": round(max(velocities), 3),
                        "velocities": velocities,
                    }
                    if len(velocities) >= 2:
                        result["velocity"]["velocity_loss_pct"] = round(
                            _velocity_loss_pct(velocities[0], velocities[-1]), 1
                        )
                        result["velocity"]["vbt_zone"] = _get_vbt_zone(
                            exercise_name, result["velocity"]["mean_concentric_velocity"]
                        )
                    logger.info("Velocity (Gemini fallback): mean=%.3f m/s",
                                result["velocity"]["mean_concentric_velocity"])
        except Exception as e2:
            logger.warning("Gemini velocity fallback also failed: %s", e2)

    # ── 3. Consistency analysis (from rep timing data) ───────────────────
    rep_timings = result.get("rep_timing", [])
    if len(rep_timings) >= 2:
        durations = [r["end_time"] - r["start_time"] for r in rep_timings]
        mean_dur = sum(durations) / len(durations)
        std_dur = (sum((d - mean_dur) ** 2 for d in durations) / len(durations)) ** 0.5
        cv = (std_dur / mean_dur * 100) if mean_dur > 0 else 0

        # Amplitude consistency (how similar is each rep's range of motion)
        amplitudes = [r.get("amplitude_m", 0) for r in rep_timings if r.get("amplitude_m", 0) > 0]
        if amplitudes:
            mean_amp = sum(amplitudes) / len(amplitudes)
            std_amp = (sum((a - mean_amp) ** 2 for a in amplitudes) / len(amplitudes)) ** 0.5
            amp_cv = (std_amp / mean_amp * 100) if mean_amp > 0 else 0
        else:
            amp_cv = 0

        consistency_score = max(0, 100 - cv - amp_cv * 0.5)
        result["consistency"] = {
            "consistency_score": round(consistency_score, 1),
            "rep_count": len(rep_timings),
            "tempo_consistency_cv": round(cv, 1),
            "amplitude_consistency_cv": round(amp_cv, 1),
        }
        logger.info("Consistency: score=%.1f, cv=%.1f%%, %d reps",
                    consistency_score, cv, len(rep_timings))

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
    logger.info("RPE inputs: vel_loss=%.1f%% form_score=%s severity=%s mean_vel=%.3f consistency=%s",
                vel_loss, form_score, form_severity, mean_vel, consistency_score)

    # Heuristic RPE estimation: velocity loss is primary, absolute velocity
    # is fallback when loss is unavailable (e.g. Gemini couldn't estimate
    # bar position reliably).  Form breakdown and consistency add small bumps.
    has_vel_data = vel_loss > 0 or mean_vel != 0.5  # 0.5 is the default

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
    elif has_vel_data:
        # Velocity loss is 0 but we have real velocity data — use absolute
        # velocity as the RPE signal (slow = hard, fast = easy).
        if mean_vel < 0.30:
            base_rpe = 9.5
        elif mean_vel < 0.40:
            base_rpe = 8.5
        elif mean_vel < 0.50:
            base_rpe = 7.5
        elif mean_vel < 0.60:
            base_rpe = 6.5
        elif mean_vel < 0.75:
            base_rpe = 5.5
        else:
            base_rpe = 5.0
    else:
        # No velocity data at all — fall back to form severity only
        base_rpe = 6.0  # conservative default when we have no speed signal

    # Adjust for form breakdown
    if form_severity == "major":
        base_rpe = min(10.0, base_rpe + 1.0)
    elif form_severity == "moderate":
        base_rpe = min(10.0, base_rpe + 0.5)

    # Adjust for late set (if rep count suggests fatigue)
    if rep_count >= 5:
        base_rpe = min(10.0, base_rpe + 0.5)

    # Confidence based on data quality
    confidence = 0.4  # base confidence (low when we have no velocity data)
    if vel_loss > 0:
        confidence += 0.25  # best signal
    elif has_vel_data:
        confidence += 0.15  # absolute velocity is weaker
    if form_score > 0 and form_severity != "unknown":
        confidence += 0.15
    if consistency_score > 0:
        confidence += 0.1
    confidence = min(1.0, confidence)

    result["rpe"] = {
        "estimated_rpe": round(base_rpe, 1),
        "rir_estimate": round(max(0, (10 - base_rpe)) / 2, 1),
        "confidence": round(confidence, 2),
        "evidence": [
            f"velocity_loss={vel_loss:.1f}%",
            f"mean_velocity={mean_vel:.3f} m/s",
            f"form_score={form_score}",
            f"form_severity={form_severity}",
            f"consistency={consistency_score}",
            f"has_vel_data={has_vel_data}",
        ],
        "reasoning": (
            f"Based on {vel_loss:.1f}% velocity loss"
            + (f" (mean velocity {mean_vel:.3f} m/s)" if has_vel_data else " (no velocity data)")
            + f", {form_severity} form breakdown (score {form_score}/100)"
        ),
    }

    # ── 6. Competition validity summary ──────────────────────────────────
    form_data = result.get("form", {})
    result["competition_valid"] = form_data.get("competition_valid")
    result["competition_notes"] = ""
    if result["competition_valid"] is False:
        deviations = form_data.get("deviations", [])
        result["competition_notes"] = "; ".join(deviations[:3]) if deviations else "Form deviations detected"

    logger.info("run_full_analysis complete: keys=%s rpe=%.1f", list(result.keys()), result.get("rpe", {}).get("estimated_rpe", 0))
    return result


# ── Standalone RPE Heuristic ─────────────────────────────────────────────────


def estimate_rpe_heuristic(analysis_result: dict, exercise_name: str, rep_count: int) -> dict:
    """Estimate RPE from analysis results. Called from modal_client.py after
    pose analysis + optical flow are complete."""
    vel_data = analysis_result.get("velocity", {})
    form_data = analysis_result.get("form", {})

    mean_vel = vel_data.get("mean_concentric_velocity", 0.5)
    # NOTE: .get default only applies to MISSING keys — the optical-flow
    # result includes velocity_loss_pct=None when <2 reps are tracked, and
    # None > 0 raises TypeError. `or 0` normalizes both cases (2026-09-17 —
    # this crash nulled every RPE estimate).
    vel_loss = vel_data.get("velocity_loss_pct") or 0
    form_score = form_data.get("overall_form_score", 70)
    form_severity = form_data.get("severity", "unknown")
    consistency_score = analysis_result.get("consistency", {}).get("consistency_score", 70)

    has_vel_data = vel_loss > 0 or mean_vel != 0.5

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
    elif has_vel_data:
        if mean_vel < 0.30:
            base_rpe = 9.5
        elif mean_vel < 0.40:
            base_rpe = 8.5
        elif mean_vel < 0.50:
            base_rpe = 7.5
        elif mean_vel < 0.60:
            base_rpe = 6.5
        elif mean_vel < 0.75:
            base_rpe = 5.5
        else:
            base_rpe = 5.0
    else:
        base_rpe = 6.0

    if form_severity == "major":
        base_rpe = min(10.0, base_rpe + 1.0)
    elif form_severity == "moderate":
        base_rpe = min(10.0, base_rpe + 0.5)

    if rep_count >= 5:
        base_rpe = min(10.0, base_rpe + 0.5)

    confidence = 0.4
    if vel_loss > 0:
        confidence += 0.25
    elif has_vel_data:
        confidence += 0.15
    if form_score > 0 and form_severity != "unknown":
        confidence += 0.15
    if consistency_score > 0:
        confidence += 0.1
    confidence = min(1.0, confidence)

    return {
        "estimated_rpe": round(base_rpe, 1),
        "rir_estimate": round(max(0, (10 - base_rpe)) / 2, 1),
        "confidence": round(confidence, 2),
        "evidence": [
            f"velocity_loss={vel_loss:.1f}%",
            f"mean_velocity={mean_vel:.3f} m/s",
            f"form_score={form_score}",
            f"form_severity={form_severity}",
            f"consistency={consistency_score}",
            f"has_vel_data={has_vel_data}",
        ],
        "reasoning": (
            f"Based on {vel_loss:.1f}% velocity loss"
            + (f" (mean velocity {mean_vel:.3f} m/s)" if has_vel_data else " (no velocity data)")
            + f", {form_severity} form breakdown (score {form_score}/100)"
        ),
    }
