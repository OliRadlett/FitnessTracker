#!/usr/bin/env python3
"""Offline evaluation harness for the lift-video analysis pipeline.

Runs the repo's own analysis modules over a folder of labelled videos and
reports quantitative metrics, so video changes can be measured instead of
tuned against single anecdotes.

Requires the fittrack-video venv (Python 3.12 + mediapipe + opencv + numpy):

    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/video_eval.py

Videos + labels live under a gitignored fixture folder. Fetch them with
``scripts/fetch_prod_videos.py`` (or drop your own clips in). Labels are JSON:

    {
      "videos": [
        {
          "file": "49403afc-back-squat.mp4",
          "id": "49403afc-8a64-4706-b9b3-6237a924f27e",
          "exercise": "Back Squat",
          "camera_view": "side",
          "reps": 8,
          "set_type": "working",
          "velocity_band": [0.15, 0.50],
          "notes": "8 working reps, moderate grind"
        }
      ]
    }

Flags:
    --labels PATH        label file (default backend/tests/fixtures/video_labels.json)
    --videos-dir PATH    folder of videos (default backend/tests/fixtures/videos)
    --out PATH           write JSON report (default reports/video-eval.json)
    --baseline PATH      diff scalars against a previous report
    --limit N            only evaluate the first N labelled videos
    --fps F              pose extraction fps (default 10.0)
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
import tempfile
import time
from pathlib import Path

logging.basicConfig(level=logging.WARNING, format="%(levelname)s %(message)s")
logger = logging.getLogger("video_eval")

REPO_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(REPO_ROOT / "backend"))
sys.path.insert(0, str(SCRIPTS_DIR))

import run_video_local as rvl
from app.integrations.pose_analysis import (
    bar_velocity_from_pose,
    classify_exercise,
    detect_reps_from_pose,
    extract_pose_landmarks,
    run_pose_analysis,
)
from app.integrations.video_analysis import (
    _get_rom,
    estimate_rpe_heuristic,
)


def family(name: str | None) -> str:
    n = (name or "").lower()
    if "bench" in n:
        return "Bench Press"
    if "deadlift" in n:
        return "Deadlift"
    if "squat" in n:
        return "Squat"
    if any(w in n for w in ("press", "overhead", "ohp", "log", "strict")):
        return "Overhead Press"
    if "stone" in n or "sandbag" in n:
        return "Squat"
    return n.strip() or "unknown"


def probe_duration_cv2(path: Path) -> float:
    return rvl.probe_duration(path)


def run_one(label: dict, videos_dir: Path, fps: float) -> dict:
    video_path = videos_dir / label["file"]
    record: dict = {
        "file": label["file"],
        "id": label.get("id"),
        "label_exercise": label.get("exercise"),
        "label_reps": label.get("reps"),
        "label_view": label.get("camera_view"),
        "present": video_path.exists(),
    }
    if not video_path.exists():
        return record

    t0 = time.time()
    duration = probe_duration_cv2(video_path)
    tmpdir = Path(tempfile.mkdtemp(prefix="videoeval_"))
    rvl.ensure_model(tmpdir)

    trim = label.get("trim")
    if trim:
        trim_start, trim_end = float(trim[0]), float(trim[1])
    else:
        scenes = rvl.detect_scenes(video_path, duration)
        trim_start, trim_end = rvl.trim_points(scenes, duration)
    record["duration_s"] = round(duration, 2)
    record["trim"] = [round(trim_start, 2), round(trim_end, 2)]

    landmarks, timestamps = extract_pose_landmarks(
        video_path, str(tmpdir), trim_start, trim_end, fps=fps
    )
    record["pose_frames"] = len(landmarks)
    if not landmarks:
        record["error"] = "no_pose"
        return record

    classification = classify_exercise(landmarks, timestamps)
    record["auto_exercise"] = classification["exercise"]
    record["auto_confidence"] = classification["confidence"]
    record["auto_correct"] = family(classification["exercise"]) == family(label.get("exercise"))

    auto_reps = detect_reps_from_pose(landmarks, timestamps, classification["exercise"])
    record["auto_reps"] = len(auto_reps)
    record["auto_rep_error"] = abs(len(auto_reps) - int(label.get("reps") or 0))

    declared_reps = detect_reps_from_pose(
        landmarks, timestamps, label.get("exercise") or classification["exercise"],
        expected_reps=label.get("reps"),
    )
    record["declared_reps"] = len(declared_reps)

    pose_result = run_pose_analysis(
        input_path=video_path,
        tmpdir=str(tmpdir),
        trim_start=trim_start,
        trim_end=trim_end,
        exercise_name=label.get("exercise") or classification["exercise"],
        rep_count=label.get("reps") or len(auto_reps),
        weight_kg=0.0,
    )
    form = pose_result.get("form", {})
    record["form_score"] = form.get("overall_form_score")
    record["score_zero"] = record["form_score"] == 0
    record["form_severity"] = form.get("severity")
    record["competition_valid"] = form.get("competition_valid")
    record["deviations"] = form.get("deviations", [])
    record["form_rep_count"] = pose_result.get("rep_count_detected")

    import cv2

    cap = cv2.VideoCapture(str(video_path))
    frame_h = float(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    exercise = label.get("exercise") or classification["exercise"]
    vel = bar_velocity_from_pose(
        landmarks, timestamps, declared_reps, exercise, frame_h, _get_rom(exercise)
    )
    record["velocity_quality"] = vel.get("tracking_quality")
    record["mean_velocity"] = vel.get("mean_concentric_velocity")
    record["velocity_loss_pct"] = vel.get("velocity_loss_pct")
    record["velocity_rep_count"] = len(vel.get("rep_timings", []))
    record["rep_count_mismatch"] = (
        record["form_rep_count"] != record["velocity_rep_count"]
    )

    band = label.get("velocity_band")
    if band and vel.get("mean_concentric_velocity") is not None:
        record["velocity_in_band"] = bool(
            band[0] <= vel["mean_concentric_velocity"] <= band[1]
        )

    analysis = {
        "velocity": {
            "mean_concentric_velocity": vel.get("mean_concentric_velocity"),
            "velocity_loss_pct": vel.get("velocity_loss_pct"),
        },
        "form": form,
        "consistency": {"consistency_score": 0},
    }
    record["rpe"] = estimate_rpe_heuristic(
        analysis, exercise, record["form_rep_count"] or 0
    ).get("estimated_rpe")

    record["elapsed_s"] = round(time.time() - t0, 1)
    return record


def _rate(records: list[dict], key: str) -> float | None:
    vals = [r[key] for r in records if key in r]
    return round(sum(vals) / len(vals), 3) if vals else None


def _rate_true(records: list[dict], key: str) -> float | None:
    vals = [r[key] for r in records if key in r]
    return round(sum(1 for v in vals if v) / len(vals), 3) if vals else None


def aggregate(records: list[dict]) -> dict:
    present = [r for r in records if r.get("present") and "error" not in r]
    multi = [r for r in present if (r.get("label_reps") or 0) > 1 or (r.get("auto_reps") or 0) > 1]
    loss = [r["velocity_loss_pct"] for r in present if r.get("velocity_loss_pct") is not None]
    deviations: dict[str, int] = {}
    for r in present:
        for d in r.get("deviations", []):
            tag = d.split(":", 1)[-1].strip()
            tag = tag.split("(")[0].strip()
            deviations[tag] = deviations.get(tag, 0) + 1

    return {
        "n_labelled": len(records),
        "n_present": sum(1 for r in records if r.get("present")),
        "n_evaluated": len(present),
        "auto_rep_mae": _rate(present, "auto_rep_error"),
        "declared_rep_exact_rate": _rate_true(
            [r | {"exact": r.get("declared_reps") == r.get("label_reps")} for r in present
             if r.get("label_reps") is not None],
            "exact",
        ),
        "exercise_accuracy": _rate_true(present, "auto_correct"),
        "form_score_zero_rate": _rate_true(multi, "score_zero")
        if multi
        else None,
        "rep_count_mismatch_rate": _rate_true(present, "rep_count_mismatch"),
        "velocity_in_band_rate": _rate_true(present, "velocity_in_band"),
        "mean_velocity": _rate(present, "mean_velocity"),
        "velocity_loss_out_of_range_rate": (
            round(sum(1 for v in loss if v < -5 or v > 100) / len(loss), 3)
            if loss
            else None
        ),
        "rpe_saturation_rate": (
            round(sum(1 for r in present if (r.get("rpe") or 0) >= 9.5) / len(present), 3)
            if present
            else None
        ),
        "deviation_counts": dict(sorted(deviations.items(), key=lambda kv: -kv[1])),
    }


def print_summary(report: dict) -> None:
    agg = report["aggregate"]
    print("=" * 62)
    print("VIDEO EVAL SUMMARY")
    print("=" * 62)
    for key in (
        "n_labelled", "n_present", "n_evaluated",
        "auto_rep_mae", "declared_rep_exact_rate", "exercise_accuracy",
        "rep_count_mismatch_rate", "form_score_zero_rate",
        "velocity_in_band_rate", "mean_velocity",
        "velocity_loss_out_of_range_rate", "rpe_saturation_rate",
    ):
        print(f"  {key:34s} {agg.get(key)}")
    print("  top deviations:")
    for tag, count in list(agg["deviation_counts"].items())[:10]:
        print(f"      {count:4d}  {tag}")
    print()


def diff_baseline(current: dict, baseline: dict) -> None:
    cur, base = current["aggregate"], baseline.get("aggregate", {})
    print("=" * 62)
    print("DIFF VS BASELINE")
    print("=" * 62)
    for key in sorted(set(cur) | set(base)):
        if key == "deviation_counts":
            continue
        c, b = cur.get(key), base.get(key)
        if isinstance(c, (int, float)) and isinstance(b, (int, float)) and c != b:
            delta = round(c - b, 3)
            print(f"  {key:34s} {b} -> {c}  ({delta:+})")
    print()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    default_labels = REPO_ROOT / "backend" / "tests" / "fixtures" / "video_labels.json"
    default_videos = REPO_ROOT / "backend" / "tests" / "fixtures" / "videos"
    ap.add_argument("--labels", type=Path, default=default_labels)
    ap.add_argument("--videos-dir", type=Path, default=default_videos)
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "reports" / "video-eval.json")
    ap.add_argument("--baseline", type=Path, default=None)
    ap.add_argument("--limit", type=int, default=None)
    ap.add_argument("--fps", type=float, default=10.0)
    args = ap.parse_args()

    if not args.labels.exists():
        print(f"labels not found: {args.labels}", file=sys.stderr)
        print("See scripts/fetch_prod_videos.py and the docstring for the schema.", file=sys.stderr)
        return 2

    labels = json.loads(args.labels.read_text())["videos"]
    if args.limit:
        labels = labels[: args.limit]

    records = []
    for label in labels:
        rec = run_one(label, args.videos_dir, args.fps)
        status = "skip" if not rec.get("present") else "ok"
        print(f"  [{status}] {label['file']}")
        records.append(rec)

    report = {"records": records, "aggregate": aggregate(records)}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, indent=2))
    print_summary(report)
    if args.baseline and args.baseline.exists():
        diff_baseline(report, json.loads(args.baseline.read_text()))
    print(f"report: {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
