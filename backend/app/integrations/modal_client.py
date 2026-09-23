"""Modal integration for serverless video processing.

Provides ``process_video_on_modal()`` which dispatches a lift video to a
Modal function for scene detection, trimming, and local pose-based analysis
(MediaPipe + OpenCV). The Modal function runs in a container with ffmpeg
and ML libraries installed.

Requires ``MODAL_TOKEN_ID`` and ``MODAL_TOKEN_SECRET`` env vars.
"""

import json
import logging
from pathlib import Path

from app.config import get_settings

logger = logging.getLogger(__name__)

# The Modal app + function are defined inline and deployed on first invocation.
# Container image: debian_slim + ffmpeg + httpx + mediapipe + opencv (no Gemini API).
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

        # v8: CPU-only pose analysis (MediaPipe tasks API, CPU delegate).
        # Proven 100% detection on powerlifting videos; avoids T4 cost.
        # mediapipe 0.10.30+ uses tasks API (solutions was removed).
        # EGL/GLES libs kept (harmless) to avoid forcing a Modal image rebuild.
        image = (
            modal.Image.debian_slim(python_version="3.12")
            .apt_install(
                "ffmpeg",
                "libegl1-mesa",
                "libgles2-mesa",
                "libglib2.0-0",
            )
            .pip_install(
                "httpx",
                "opencv-python-headless",
                "numpy",
                "mediapipe>=0.10.30",
                "protobuf>=3.20,<6",
            )
        )

        # Mount the analysis modules into the container
        if project_root:
            analysis_dir = str(Path(project_root) / "app" / "integrations")
            image = image.add_local_file(
                f"{analysis_dir}/video_analysis.py",
                "/root/app/integrations/video_analysis.py",
            )
            image = image.add_local_file(
                f"{analysis_dir}/pose_analysis.py",
                "/root/app/integrations/pose_analysis.py",
            )
            # pose_analysis imports these for multi-person lifter selection
            # (T1) and bar-path metrics (F1). Missing mount => ImportError in
            # the container (see pitfall #33/#34).
            image = image.add_local_file(
                f"{analysis_dir}/person_tracking.py",
                "/root/app/integrations/person_tracking.py",
            )
            image = image.add_local_file(
                f"{analysis_dir}/bar_tracking.py",
                "/root/app/integrations/bar_tracking.py",
            )

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
    analysis_depth: str = "full",
    expected_reps: int | None = None,
    user_exercise: str | None = None,
    camera_view: str | None = None,
    r2_presigned_put_overlay: str | None = None,
    r2_upload_key_overlay: str | None = None,
    weight_kg: float = 0.0,
    r2_presigned_put_thumbs: str | None = None,
    r2_upload_key_thumbs: str | None = None,
    num_poses: int = 1,
    forced_lifter_track_id: int | None = None,
    pose_fps: float = 10.0,
    gpu_delegate: bool = False,
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
    analysis_depth:
        ``"basic"`` for trim + classify only (current behaviour),
        ``"full"`` for deep analysis (form, velocity, rest, consistency,
        setup, RPE estimation).
    expected_reps:
        User-declared rep count (calibration aid): the deepest valid
        cycles are selected instead of all valid cycles.
    user_exercise:
        User-declared exercise name (DB). Selects the analyzer — pose
        auto-classification only validates (bench is unclassifiable from
        pose statistics alone: identical medians to a deadlift).
    camera_view:
        User-declared camera angle (``side``/``back_left``/``back_right``/
        ``front``). Gates the sagittal-plane form rules; absent/unknown
        leaves them off.

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
        timeout=600,
        memory=4096,
        # CPU-only: MediaPipe Pose uses the CPU delegate (proven 100%
        # detection on powerlifting videos; also cheaper than T4).
        # Heavy model processes ~4 fps on CPU — 600s covers 30s clips at 10fps.
    )
    def _process(
        presigned_get: str,
        presigned_put: str,
        upload_key: str,
        depth: str,
        expected: int | None,
        user_ex: str | None,
        user_view: str = "",
        gemini_key: str = "",
        gemini_model: str = "gemini-3.6-flash",
        overlay_put: str = "",
        overlay_key: str = "",
        weight_in: float = 0.0,
        thumbs_put: str = "",
        thumbs_key: str = "",
        num_poses: int = 1,
        forced_lifter: int = -1,
        pose_fps: float = 10.0,
        gpu_delegate: bool = False,
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

                # Generous padding (start -1s, end +2s): a tight +0.5s end cut
                # the lockout off short single-rep pulls, so the top frame read
                # mid-pull and flagged "Incomplete lockout" (deadlift 85c3239f).
                trim_start = max(0.0, best_start - 1.0)
                trim_end = min(duration, best_end + 2.0)
            else:
                # No clear scenes detected — keep the WHOLE video. The old
                # middle-80% fallback trimmed the last 10%, cutting the lockout
                # off short single-rep pulls (deadlift 85c3239f).
                trim_start = 0.0
                trim_end = duration

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

            # ── Step 6b: Camera view ──────────────────────────────────────
            # Prefer the user-declared angle (free, reliable). Only if it's
            # absent do we fall back to a VLM call — gated off by default
            # because the Gemini daily quota is tiny. Pose geometry cannot
            # determine the view (see classify_view_from_frame docstring).
            # "unknown" leaves sagittal rules off (safe default).
            view = user_view or "unknown"
            if view == "unknown" and frame_paths and gemini_key:
                try:
                    from app.integrations.video_analysis import (
                        classify_view_from_frame,
                    )

                    view = classify_view_from_frame(
                        frame_paths[len(frame_paths) // 2], gemini_key, gemini_model)
                    _logger.info("Camera view (VLM): %s", view)
                except Exception as e:
                    _logger.warning("View classification failed: %s", e)
            _logger.info("Camera view: %s", view)

            # ── Step 7: Classify via pose landmarks (local) ──────────────
            exercise = ""  # Will be determined by pose classification
            reps = 0  # Will be determined by pose analysis
            weight = float(weight_in or 0.0)
            confidence = 0.0
            analysis_text = ""
            landmarks: list = []
            pose_timestamps: list = []
            pose_world: list = []
            pose_track: dict = {}

            try:
                import sys
                sys.path.insert(0, "/root")
                from app.integrations.pose_analysis import (
                    classify_exercise,
                    extract_pose_track,
                    route_exercise,
                )

                forced = forced_lifter if forced_lifter >= 0 else None
                # Multi-person selection is used for the bench press only:
                # there a spotter dominates the single-pose detector (verified
                # on real footage — num_poses=1 tracked the upright spotter for
                # 375/375 frames, 0 horizontal). For every other lift
                # num_poses>1 fragments the track and regresses the analysis
                # (verified: a clean 150 kg squat scored 100 at num_poses=1 vs
                # 75 with the fragmented multi-pose track), so keep the dense
                # single-person track.
                prelim = route_exercise(user_ex, "", 0.0)[0] if user_ex else None
                effective_poses = num_poses if prelim == "Bench Press" else 1
                pose_track = extract_pose_track(
                    input_path, tmpdir, trim_start, trim_end, fps=pose_fps,
                    num_poses=effective_poses,
                    forced_track_id=forced,
                    gpu_delegate=gpu_delegate,
                )
                if effective_poses > 1 and pose_track.get("tracks"):
                    from app.integrations.pose_analysis import reselect_lifter

                    pose_track = reselect_lifter(
                        pose_track, exercise=prelim, forced_track_id=forced)
                landmarks = pose_track["landmarks"]
                pose_timestamps = pose_track["timestamps"]
                pose_world = pose_track["world"]
                if landmarks:
                    classification = classify_exercise(landmarks, pose_timestamps)
                    auto_ex = classification["exercise"]
                    auto_conf = classification["confidence"]
                    # User declaration selects the analyzer; auto validates.
                    routed, source, _ = route_exercise(
                        user_ex, auto_ex, auto_conf)
                    exercise = routed or auto_ex
                    confidence = auto_conf
                    analysis_text = (
                        f"Analyzing as {exercise} "
                        f"(user: {user_ex or '-'}, auto: {auto_ex} "
                        f"{auto_conf:.2f} via {source})"
                    )
                    if source == "user" and auto_ex and auto_ex != routed:
                        analysis_text += f" — auto disagrees ({auto_ex})"
                else:
                    analysis_text = "No pose landmarks detected, keeping user exercise"
                    exercise = user_ex or ""
                _logger.info("Classification: exercise=%s reps=%d conf=%.2f", exercise, reps, confidence)
            except Exception as e:
                _logger.warning("Pose classification failed: %s", e)
                analysis_text = f"Pose classification failed: {e}"

            # ── Step 8: Full analysis (pose-based + optical flow) ────────
            full_result: dict = {}
            # Surface the lifter selection (T1) regardless of depth so the
            # scheduler can persist it and the UI can offer a manual override.
            full_result["lifter_selection"] = pose_track.get("lifter")
            full_result["n_person_tracks"] = len(pose_track.get("tracks") or [])
            if depth == "full":
                # 8a: Pose-based form + setup analysis
                try:
                    import sys
                    sys.path.insert(0, "/root")
                    from app.integrations.pose_analysis import run_pose_analysis

                    pose_result = run_pose_analysis(
                        input_path=input_path,
                        tmpdir=tmpdir,
                        trim_start=trim_start,
                        trim_end=trim_end,
                        exercise_name=exercise,
                        rep_count=expected or reps,
                        weight_kg=weight,
                        view=view,
                        track=pose_track,
                    )
                    full_result.update(pose_result)
                    # Step 7 never sets reps (classification only) — take the
                    # rep count from pose rep detection so reps_count and RPE
                    # have real inputs (was always 0 → RPE NULL; 2026-09-17).
                    reps = pose_result.get("rep_count_detected", 0) or reps
                    _logger.info("Pose analysis complete: form_score=%s",
                                pose_result.get("form", {}).get("overall_form_score"))
                except Exception as e:
                    _logger.warning("Pose analysis failed: %s", e)

                # 8b: Bar velocity — pose landmarks first, optical flow fallback.
                # Pose wins: sparse LK cannot lock fast bars on phone footage
                # (see bar_velocity_from_pose docstring). Landmarks are already
                # in memory from step 7, so this costs nothing extra.
                vel_result: dict = {"tracking_quality": "failed"}
                sprite_reps: list = []
                try:
                    from app.integrations.pose_analysis import (
                        bar_velocity_from_pose,
                        bar_velocity_from_world,
                        detect_reps_from_pose,
                    )

                    if landmarks and pose_timestamps:
                        _pose_reps = detect_reps_from_pose(
                            landmarks, pose_timestamps, exercise,
                            expected_reps=expected)
                        sprite_reps = _pose_reps
                        # World landmarks give metric bar travel; fall back to
                        # the 2D pixels-per-metre path only if they're absent.
                        # ``pose_world`` is None-padded (aligned to landmarks),
                        # so test for any usable frame, not list truthiness.
                        if any(w is not None for w in pose_world):
                            vel_result = bar_velocity_from_world(
                                pose_world, pose_timestamps, _pose_reps, exercise)
                            _logger.info(
                                "Velocity (world): mean=%.3f m/s, %d reps",
                                vel_result.get("mean_concentric_velocity", 0.0),
                                len(vel_result.get("rep_timings", [])))
                        if vel_result.get("tracking_quality") == "failed":
                            import cv2

                            from app.integrations.video_analysis import _get_rom

                            _cap = cv2.VideoCapture(str(input_path))
                            _fh = float(_cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
                            _cap.release()
                            if _fh > 0:
                                vel_result = bar_velocity_from_pose(
                                    landmarks, pose_timestamps, _pose_reps,
                                    exercise, _fh, _get_rom(exercise))
                                _logger.info(
                                    "Velocity (2d): mean=%.3f m/s, %d reps",
                                    vel_result.get("mean_concentric_velocity", 0.0),
                                    len(vel_result.get("rep_timings", [])))
                except Exception as e:
                    _logger.warning("Pose velocity failed: %s", e)

                if vel_result.get("tracking_quality") == "failed":
                    _logger.info("Pose velocity unavailable, trying optical flow")
                    try:
                        from app.integrations.video_analysis import (
                            track_barbell_optical_flow,
                        )

                        vel_result = track_barbell_optical_flow(
                            input_path=input_path,
                            tmpdir=tmpdir,
                            trim_start=trim_start,
                            trim_end=trim_end,
                            exercise_name=exercise,
                        )
                    except Exception as e:
                        _logger.warning("Optical flow failed: %s", e)
                        vel_result = {"tracking_quality": "failed"}

                if vel_result.get("tracking_quality") != "failed":
                    full_result["velocity"] = {
                        "mean_concentric_velocity": vel_result.get("mean_concentric_velocity"),
                        "peak_velocity": vel_result.get("peak_velocity"),
                        "velocities": vel_result.get("velocities", []),
                        "velocity_loss_pct": vel_result.get("velocity_loss_pct"),
                        "vbt_zone": vel_result.get("vbt_zone"),
                    }
                    full_result["rep_timing"] = vel_result.get("rep_timings", [])

            # 8b-ii: rep-to-rep consistency (pure, from the rep timings)
            try:
                from app.integrations.video_analysis import compute_consistency

                consistency = compute_consistency(
                    full_result.get("rep_timing", []))
                if consistency:
                    full_result["consistency"] = consistency
                    _logger.info(
                        "Consistency: score=%.1f tempo_cv=%.1f%% (%d reps)",
                        consistency["consistency_score"],
                        consistency["tempo_consistency_cv"],
                        consistency["rep_count"])
            except Exception as e:
                _logger.warning("Consistency computation failed: %s", e)

            # 8c: RPE estimation (heuristic, no API calls)
            try:
                from app.integrations.video_analysis import estimate_rpe_heuristic
                rpe = estimate_rpe_heuristic(full_result, exercise, reps)
                full_result["rpe"] = rpe
            except Exception as e:
                _logger.warning("RPE estimation failed: %s", e)

            # ── Step 9: Upload trimmed video to R2 ────────────────────────
            # Retry with backoff: Modal→R2 uploads flake (ReadTimeouts), and
            # failing the whole analysis AFTER pose/form/velocity/RPE all
            # succeeded is pure waste. If the upload still fails, return the
            # analysis with trimmed_r2_key=None (frontend falls back to the
            # original video) instead of raising.
            import time as _time

            uploaded_key: str | None = upload_key
            for _attempt in range(3):
                try:
                    httpx.put(
                        presigned_put,
                        content=trimmed_bytes,
                        headers={"Content-Type": "video/mp4"},
                        timeout=300,
                    ).raise_for_status()
                    _logger.info("Uploaded trimmed video to R2: %s", upload_key)
                    break
                except Exception as e:
                    _logger.warning("Trimmed upload attempt %d failed: %s",
                                    _attempt + 1, e)
                    _time.sleep(5 * (_attempt + 1))
            else:
                _logger.warning("Trimmed upload failed permanently; "
                                "returning analysis without trimmed video")
                uploaded_key = None

            # ── Step 9b: Render + upload the pose/bar-path overlay ────────
            # Best-effort: a failed overlay must not fail the analysis.
            overlay_uploaded_key: str | None = None
            if overlay_put and overlay_key and landmarks and pose_timestamps:
                try:
                    from app.integrations.pose_analysis import (
                        render_overlay_video,
                    )

                    overlay_path = Path(tmpdir) / "overlay.mp4"
                    if render_overlay_video(
                        trimmed_path, landmarks, pose_timestamps, overlay_path,
                        time_offset=trim_start, exercise=exercise,
                    ):
                        overlay_bytes = overlay_path.read_bytes()
                        for _attempt in range(3):
                            try:
                                httpx.put(
                                    overlay_put,
                                    content=overlay_bytes,
                                    headers={"Content-Type": "video/mp4"},
                                    timeout=300,
                                ).raise_for_status()
                                overlay_uploaded_key = overlay_key
                                _logger.info("Uploaded overlay to R2: %s", overlay_key)
                                break
                            except Exception as e:
                                _logger.warning(
                                    "Overlay upload attempt %d failed: %s",
                                    _attempt + 1, e)
                                _time.sleep(5 * (_attempt + 1))
                except Exception as e:
                    _logger.warning("Overlay render/upload failed: %s", e)

            # ── Step 9c: Render + upload the per-rep sprite sheet ─────────
            thumbs_uploaded_key: str | None = None
            if thumbs_put and thumbs_key and landmarks and sprite_reps:
                try:
                    from app.integrations.pose_analysis import render_rep_sprite

                    sprite_path = Path(tmpdir) / "reps.jpg"
                    if render_rep_sprite(
                        trimmed_path, landmarks, pose_timestamps, sprite_reps,
                        sprite_path, time_offset=trim_start,
                    ):
                        sprite_bytes = sprite_path.read_bytes()
                        for _attempt in range(3):
                            try:
                                httpx.put(
                                    thumbs_put,
                                    content=sprite_bytes,
                                    headers={"Content-Type": "image/jpeg"},
                                    timeout=120,
                                ).raise_for_status()
                                thumbs_uploaded_key = thumbs_key
                                _logger.info("Uploaded rep sprite to R2: %s", thumbs_key)
                                break
                            except Exception as e:
                                _logger.warning(
                                    "Rep sprite upload attempt %d failed: %s",
                                    _attempt + 1, e)
                                _time.sleep(5 * (_attempt + 1))
                except Exception as e:
                    _logger.warning("Rep sprite render/upload failed: %s", e)

            form_data = {
                **full_result.get("form", {}),
                "view": view,
                "quality": full_result.get("quality"),
            }
            vel_data = full_result.get("velocity", {})
            consist_data = full_result.get("consistency", {})
            setup_data = full_result.get("setup", {})
            rpe_data = full_result.get("rpe", {})

            # Deterministic coaching text (no LLM) — stored in form_analysis_json.
            try:
                from app.integrations.video_analysis import build_coaching_summary

                form_data["coaching_summary"] = build_coaching_summary({
                    "exercise": exercise,
                    "reps": reps,
                    "weight_kg": weight,
                    "form": form_data,
                    "velocity": vel_data,
                    "estimated_rpe": rpe_data.get("estimated_rpe"),
                    "quality": full_result.get("quality"),
                    "view": view,
                })
            except Exception as e:
                _logger.warning("Coaching summary failed: %s", e)

            def _to_py(obj):
                """Recursively convert numpy scalars/arrays to plain Python.

                The worker container has no numpy, so any np.float64/np.bool_
                in the return dict breaks deserialization of the whole result
                (every video failed with 'numpy module is not available').
                """
                import numpy as np

                if isinstance(obj, np.bool_):
                    return bool(obj)
                if isinstance(obj, np.generic):
                    return obj.item()
                if isinstance(obj, np.ndarray):
                    return [_to_py(v) for v in obj.tolist()]
                if isinstance(obj, dict):
                    return {k: _to_py(v) for k, v in obj.items()}
                if isinstance(obj, (list, tuple)):
                    return [_to_py(v) for v in obj]
                return obj

            analysis_text = f"[view={view}] {analysis_text}".strip()

            return _to_py({
                "trimmed_r2_key": uploaded_key,
                "overlay_r2_key": overlay_uploaded_key,
                "rep_thumbnails_r2_key": thumbs_uploaded_key,
                "view": view,
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
                "competition_valid": form_data.get("competition_valid"),
                "form_analysis_json": form_data,
                "form_deviations": form_data.get("deviations", []),
                "form_coaching_cues": form_data.get("coaching_cues", []),
                "coaching_summary": form_data.get("coaching_summary"),
                # Velocity (§3.18)
                "mean_concentric_velocity": vel_data.get("mean_concentric_velocity"),
                "peak_velocity": vel_data.get("peak_velocity"),
                "velocity_loss_pct": vel_data.get("velocity_loss_pct"),
                "velocity_profile_json": vel_data.get("velocities"),
                "vbt_zone": vel_data.get("vbt_zone"),
                # Bar path (F1) + multi-person lifter selection (T1). These must
                # be surfaced here or the scheduler silently persists nothing.
                "bar_path": full_result.get("bar_path"),
                "lifter_selection": full_result.get("lifter_selection"),
                "n_person_tracks": full_result.get("n_person_tracks"),
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
            })

    # Gemini key is passed through so the container can classify camera view
    # (the container image has no google-genai; the call is a raw REST request).
    # Gated OFF by default — a per-video call competes with the weekly/on-demand
    # LLM analysis under a low daily Gemini quota. Empty key => "unknown" view.
    from app.integrations.video_analysis import normalize_user_view
    from app.services.llm_base import GEMINI_MODEL

    view_key = settings.gemini_api_key if settings.video_view_vlm_enabled else ""
    user_view = normalize_user_view(camera_view)

    # Multi-person lifter selection (T1) — applies to the bench press only
    # (see _process). 1 = single-person behaviour.
    num_poses = (
        max(1, settings.video_num_poses) if settings.video_multi_pose_enabled else 1
    )
    # T2 pose extraction settings (defaults preserve current behaviour).
    pose_fps = float(settings.video_pose_fps or 10.0)
    gpu_delegate = bool(settings.video_gpu_delegate_enabled)

    # Run the Modal function synchronously (blocks until complete)
    with app.run():
        return _process.remote(
            r2_presigned_get,
            r2_presigned_put,
            r2_upload_key,
            analysis_depth,
            expected_reps,
            user_exercise,
            user_view,
            view_key,
            GEMINI_MODEL,
            r2_presigned_put_overlay or "",
            r2_upload_key_overlay or "",
            weight_kg or 0.0,
            r2_presigned_put_thumbs or "",
            r2_upload_key_thumbs or "",
            num_poses,
            forced_lifter_track_id if forced_lifter_track_id is not None else -1,
            pose_fps,
            gpu_delegate,
        )
