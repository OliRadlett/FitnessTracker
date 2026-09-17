"""Modal integration for serverless video processing.

Provides ``process_video_on_modal()`` which dispatches a lift video to a
Modal function for scene detection, trimming, and Gemini Vision classification.
The Modal function runs in a container with ffmpeg installed.

Requires ``MODAL_TOKEN_ID`` and ``MODAL_TOKEN_SECRET`` env vars.
"""

import json
import logging
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)

# The Modal app + function are defined inline and deployed on first invocation.
# Container image: debian_slim + ffmpeg + httpx (for R2 downloads/uploads).
_MODAL_IMAGE = None


def _get_modal_image(project_root: str | None = None):
    """Lazy-load the Modal image to avoid import at module level.

    Parameters
    ----------
    project_root:
        Path to the backend/ directory (for mounting video_analysis.py).
    """
    global _MODAL_IMAGE
    if _MODAL_IMAGE is None:
        import modal

        image = (
            modal.Image.debian_slim(python_version="3.12")
            .apt_install("ffmpeg")
            .pip_install("httpx", "google-genai", "opencv-python-headless", "numpy")
        )

        # Mount the analysis module into the container
        if project_root:
            analysis_path = str(Path(project_root) / "app" / "integrations" / "video_analysis.py")
            image = image.add_local_file(analysis_path, "/root/app/integrations/video_analysis.py")

        _MODAL_IMAGE = image
    return _MODAL_IMAGE


def _modal_configured() -> bool:
    """True only when Modal credentials are set."""
    settings = get_settings()
    return bool(settings.modal_token_id and settings.modal_token_secret)


def process_video_on_modal(
    video_id: str,
    r2_key: str,
    r2_presigned_get: str,
    r2_presigned_put: str,
    r2_upload_key: str,
    gemini_api_key: str,
    analysis_depth: str = "full",
) -> dict:
    """Dispatch video processing to Modal and return the result.

    Parameters
    ----------
    video_id:
        UUID of the LiftVideo row (for logging).
    r2_key:
        The original R2 object key.
    r2_presigned_get:
        Presigned GET URL to download the original video.
    r2_presigned_put:
        Presigned PUT URL to upload the trimmed video.
    r2_upload_key:
        The R2 key for the trimmed video (destination).
    gemini_api_key:
        Gemini API key for Vision classification.
    analysis_depth:
        ``"basic"`` for trim + classify only (current behaviour),
        ``"full"`` for deep analysis (form, velocity, rest, consistency,
        setup, RPE estimation).

    Returns
    -------
    dict with keys: trimmed_r2_key, duration_seconds, trim_start_sec,
    trim_end_sec, exercise, reps, weight_kg, confidence, analysis_text.
    """
    import modal

    settings = get_settings()

    if not _modal_configured():
        raise RuntimeError(
            "Modal is not configured — set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET"
        )

    # Locate the project root (backend/ directory)
    project_root = str(Path(__file__).resolve().parent.parent.parent)

    image = _get_modal_image(project_root=project_root)

    app = modal.App("fittrack-video-processor", image=image)

    @app.function(
        serialized=True,
        timeout=600,  # 10 min max per video (multi-pass Gemini calls)
        memory=2048,  # 2 GB RAM for dense frame extraction + ffmpeg
    )
    def _process(
        presigned_get: str,
        presigned_put: str,
        upload_key: str,
        gemini_key: str,
        depth: str,
    ) -> dict:
        import logging
        import subprocess
        import tempfile

        import httpx

        logging.basicConfig(level=logging.INFO)
        _logger = logging.getLogger("modal._process")

        # ── Step 1: Download video from R2 ────────────────────────────────
        _logger.info("Downloading video from R2...")
        resp = httpx.get(presigned_get, follow_redirects=True, timeout=120)
        resp.raise_for_status()
        video_bytes = resp.content
        _logger.info("Downloaded %d bytes", len(video_bytes))

        with tempfile.TemporaryDirectory() as tmpdir:
            input_path = Path(tmpdir) / "input.mp4"
            trimmed_path = Path(tmpdir) / "trimmed.mp4"
            input_path.write_bytes(video_bytes)

            # ── Step 2: Get video duration ────────────────────────────────
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "quiet",
                    "-print_format",
                    "json",
                    "-show_format",
                    str(input_path),
                ],
                capture_output=True,
                text=True,
                timeout=30,
            )
            duration = 0.0
            try:
                probe_data = json.loads(probe.stdout)
                duration = float(probe_data.get("format", {}).get("duration", 0))
            except (json.JSONDecodeError, ValueError, KeyError):
                pass
            _logger.info("Video duration: %.1fs", duration)

            # ── Step 3: Scene detection ───────────────────────────────────
            # Use ffmpeg scene filter to detect significant frame changes.
            # threshold 0.3 = moderate sensitivity (catches set start/end)
            scene_output = subprocess.run(
                [
                    "ffmpeg",
                    "-i",
                    str(input_path),
                    "-vf",
                    "select='gt(scene,0.3)',showinfo",
                    "-vsync",
                    "vfr",
                    "-f",
                    "null",
                    "-",
                ],
                capture_output=True,
                text=True,
                timeout=120,
            )

            # Parse scene change timestamps from ffmpeg stderr
            scene_times: list[float] = []
            for line in scene_output.stderr.splitlines():
                if "pts_time:" in line:
                    try:
                        pts_part = line.split("pts_time:")[1].split()[0]
                        scene_times.append(float(pts_part))
                    except (IndexError, ValueError):
                        continue

            _logger.info("Detected %d scene changes: %s", len(scene_times), scene_times)

            # ── Step 4: Determine trim points ─────────────────────────────
            # Strategy: find the longest gap between scene changes (likely
            # the active lifting segment), then trim to that segment with
            # 0.5s padding on each side.
            if len(scene_times) >= 2 and duration > 0:
                # Add start (0) and end (duration) as boundaries
                boundaries = [0.0] + scene_times + [duration]
                # Find the longest segment
                best_start = 0.0
                best_end = duration
                max_gap = 0.0
                for i in range(len(boundaries) - 1):
                    gap = boundaries[i + 1] - boundaries[i]
                    if gap > max_gap:
                        max_gap = gap
                        best_start = boundaries[i]
                        best_end = boundaries[i + 1]

                # Add 0.5s padding, clamped to video bounds
                trim_start = max(0.0, best_start - 0.5)
                trim_end = min(duration, best_end + 0.5)
            else:
                # No clear scenes detected — keep the middle 80%
                trim_start = duration * 0.1
                trim_end = duration * 0.9

            _logger.info("Trim points: %.2f -> %.2f", trim_start, trim_end)

            # ── Step 5: Trim video ────────────────────────────────────────
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
                    "-c:v",
                    "libx264",
                    "-preset",
                    "fast",
                    "-c:a",
                    "aac",
                    str(trimmed_path),
                ],
                capture_output=True,
                timeout=300,
            )

            if not trimmed_path.exists():
                raise RuntimeError("ffmpeg trim failed — no output file")

            trimmed_bytes = trimmed_path.read_bytes()
            _logger.info("Trimmed video: %d bytes", len(trimmed_bytes))

            # ── Step 6: Extract key frames for classification ─────────────
            frame_paths: list[Path] = []
            segment_duration = trim_end - trim_start
            # Extract 3 frames: start, middle, end of the lift
            for idx, frac in enumerate([0.1, 0.5, 0.9]):
                frame_time = trim_start + (segment_duration * frac)
                frame_path = Path(tmpdir) / f"frame_{idx}.jpg"
                subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-ss",
                        str(frame_time),
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
                    frame_paths.append(frame_path)

            _logger.info("Extracted %d key frames", len(frame_paths))

            # ── Step 7: Classify via Gemini Vision ────────────────────────
            exercise = ""
            reps = 0
            weight = 0.0
            confidence = 0.0
            analysis_text = ""
            client = None

            if gemini_key and frame_paths:
                try:
                    import base64
                    import time as _time

                    from google import genai
                    from google.genai import types

                    client = genai.Client(api_key=gemini_key)

                    # Build multimodal prompt with frames
                    contents: list = []
                    contents.append(
                        "This is a weightlifting video. I've extracted 3 key frames "
                        "(start, middle, end of the lift). Please analyze them and classify:\n"
                        "1. Exercise name (squat, bench press, deadlift, overhead press, "
                        "barbell row, Romanian deadlift, front squat, or other)\n"
                        "2. Number of reps performed\n"
                        "3. Weight on the bar in kg (if visible on the plates)\n"
                        "4. Confidence level (0.0 to 1.0)\n"
                        "5. Brief notes about form or technique\n\n"
                        "Return ONLY valid JSON (no markdown) in this exact format:\n"
                        '{"exercise": "...", "reps": N, "weight_kg": N.N, '
                        '"confidence": N.N, "notes": "..."}'
                    )

                    for fp in frame_paths:
                        img_bytes = fp.read_bytes()
                        contents.append(
                            types.Part.from_bytes(
                                data=img_bytes,
                                mime_type="image/jpeg",
                            )
                        )

                    # Retry with exponential backoff for transient errors
                    response = None
                    for attempt in range(3):
                        try:
                            response = client.models.generate_content(
                                model="gemini-3.6-flash",
                                contents=contents,
                                config=types.GenerateContentConfig(
                                    temperature=0.3,
                                    max_output_tokens=512,
                                ),
                            )
                            break  # success
                        except Exception as retry_exc:
                            msg = str(retry_exc)
                            retryable = any(s in msg for s in ("429", "500", "502", "503", "504", "UNAVAILABLE", "RESOURCE_EXHAUSTED"))
                            if retryable and attempt < 2:
                                wait = 2 ** attempt * 2  # 2s, 4s
                                _logger.warning("Classification Gemini call failed (attempt %d/3): %s — retrying in %ds",
                                                attempt + 1, msg[:120], wait)
                                _time.sleep(wait)
                            else:
                                raise

                    raw_text = response.text or ""
                    analysis_text = raw_text.strip()

                    # Parse JSON from response (handle markdown code blocks)
                    json_str = raw_text.strip()
                    if json_str.startswith("```"):
                        json_str = json_str.split("\n", 1)[1]
                        json_str = json_str.removesuffix("```")
                        json_str = json_str.strip()

                    result = json.loads(json_str)
                    exercise = result.get("exercise", "")
                    reps = int(result.get("reps", 0))
                    weight = float(result.get("weight_kg", 0))
                    confidence = float(result.get("confidence", 0))
                    if "notes" in result:
                        analysis_text = result["notes"]

                    _logger.info(
                        "Classification: exercise=%s reps=%d weight=%.1f conf=%.2f",
                        exercise,
                        reps,
                        weight,
                        confidence,
                    )
                except Exception as e:
                    _logger.warning("Gemini classification failed: %s", e)
                    analysis_text = f"Classification failed: {e}"

            # ── Step 8: Full analysis (form, velocity, RPE, etc.) ─────────────
            full_result: dict = {}
            if depth == "full" and gemini_key and frame_paths:
                try:
                    import sys
                    # Ensure app.integrations is importable inside the container
                    sys.path.insert(0, "/root")
                    from app.integrations.video_analysis import run_full_analysis

                    full_result = run_full_analysis(
                        client=client,
                        input_path=input_path,
                        tmpdir=tmpdir,
                        trim_start=trim_start,
                        trim_end=trim_end,
                        exercise_name=exercise,
                        rep_count=reps,
                        weight_kg=weight,
                    )
                    _logger.info("Full analysis complete: %s", list(full_result.keys()))
                except Exception as e:
                    _logger.warning("Full analysis failed: %s", e)
                    full_result = {"analysis_error": str(e)}

            # ── Step 9: Upload trimmed video to R2 ────────────────────────
            httpx.put(
                presigned_put,
                content=trimmed_bytes,
                headers={"Content-Type": "video/mp4"},
                timeout=120,
            ).raise_for_status()
            _logger.info("Uploaded trimmed video to R2: %s", upload_key)

            form_data = full_result.get("form", {})
            vel_data = full_result.get("velocity", {})
            consist_data = full_result.get("consistency", {})
            setup_data = full_result.get("setup", {})
            rpe_data = full_result.get("rpe", {})

            return {
                "trimmed_r2_key": upload_key,
                "duration_seconds": round(duration, 1),
                "trim_start_sec": round(trim_start, 2),
                "trim_end_sec": round(trim_end, 2),
                "exercise": exercise,
                "reps": reps,
                "weight_kg": weight,
                "confidence": confidence,
                "analysis_text": analysis_text,
                "analysis_depth": depth,
                # Form (§3.18)
                "form_score": form_data.get("overall_form_score"),
                "competition_valid": full_result.get("competition_valid"),
                "form_analysis_json": form_data,
                "form_deviations": form_data.get("deviations", []),
                "form_coaching_cues": form_data.get("coaching_cues", []),
                # Velocity (§3.18)
                "mean_concentric_velocity": vel_data.get("mean_concentric_velocity"),
                "peak_velocity": vel_data.get("peak_velocity"),
                "velocity_loss_pct": vel_data.get("velocity_loss_pct"),
                "velocity_profile_json": vel_data.get("velocities"),
                "vbt_zone": vel_data.get("vbt_zone"),
                # Rest timing
                "rest_periods_json": None,  # estimated server-side per-rep
                "avg_rest_seconds": None,
                "rest_cv": None,
                # Consistency (§3.18) — from optical flow rep timing
                "rep_consistency_score": consist_data.get("consistency_score"),
                "tempo_consistency_cv": consist_data.get("tempo_consistency_cv"),
                "rep_timing_json": full_result.get("rep_timing") or consist_data,
                # Setup (§3.18)
                "setup_score": setup_data.get("setup_score"),
                "setup_analysis_json": setup_data,
                "setup_duration_seconds": setup_data.get("setup_duration_seconds"),
                # RPE (§3.18)
                "estimated_rpe": rpe_data.get("estimated_rpe"),
                "rpe_confidence": rpe_data.get("confidence"),
                "rpe_evidence_json": rpe_data.get("evidence"),
            }

    # Run the Modal function synchronously (blocks until complete)
    with app.run():
        return _process.remote(
            r2_presigned_get,
            r2_presigned_put,
            r2_upload_key,
            gemini_api_key,
            analysis_depth,
        )
