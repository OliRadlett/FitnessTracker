#!/usr/bin/env python3
"""Search a Google Takeout export for lifting videos (T3 / eval ingest).

Takeout carries no ML tags, but it keeps albums as folders and a JSON sidecar
per media file (title, description, photoTakenTime). This walks an export and
filters videos by album folder, keyword (filename/title/description) and date —
optionally scoring each candidate by *content* (sample frames, run the pose +
exercise classifier) so you can pull "looks like a lift" clips without opening
them all.

    # metadata only (fast, no deps)
    python scripts/search_takeout.py --takeout "D:/Takeout/Google Photos" --keyword squat

    # content check (video venv; samples each candidate)
    C:\\Users\\oradl\\.venvs\\fittrack-video\\Scripts\\python.exe scripts/search_takeout.py \\
        --takeout "D:/Takeout/Google Photos" --content --min-lift-score 0.6

Writes `--out` (default `data/inbox/manifest.json`) and optionally `--copy-to`
a staging folder.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".3gp", ".avi", ".mkv", ".webm"}


@dataclass
class Candidate:
    path: Path
    album: str | None = None
    title: str | None = None
    description: str | None = None
    taken_at: float | None = None
    duration_s: float | None = None
    lift_score: float | None = None
    exercise: str | None = None
    view: str | None = None
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "path": str(self.path),
            "album": self.album,
            "title": self.title,
            "description": self.description,
            "taken_at": self.taken_at,
            "duration_s": self.duration_s,
            "lift_score": self.lift_score,
            "exercise": self.exercise,
            "view": self.view,
        }


def _sidecar(path: Path) -> dict:
    """Takeout sidecar JSON sits next to the file as `<name>.<ext>.json`."""
    sc = path.with_name(path.name + ".json")
    if sc.exists():
        try:
            return json.loads(sc.read_text(encoding="utf-8"))
        except (ValueError, OSError):
            return {}
    return {}


def _album_of(path: Path, root: Path) -> str | None:
    try:
        rel = path.relative_to(root)
    except ValueError:
        return None
    parts = rel.parts[:-1]
    for i, part in enumerate(parts):
        if part.lower() == "albums" and i + 1 < len(parts):
            return parts[i + 1]
    return parts[-1] if parts else None


def _iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    try:
        return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()
    except (ValueError, OSError):
        return None


def _matches(c: Candidate, keyword: str | None,
             after: float | None, before: float | None) -> bool:
    if keyword:
        hay = " ".join(filter(None, [c.path.name, c.title, c.description,
                                     c.album or ""])).lower()
        if keyword.lower() not in hay:
            return False
    if after and (c.taken_at is None or c.taken_at < after):
        return False
    return not (before and (c.taken_at is None or c.taken_at > before))


def _content_score(path: Path, sample_s: float = 12.0) -> tuple[float, str | None, str | None]:
    """Pose detection + classified exercise from the first ``sample_s`` seconds."""
    sys.path.insert(0, str(REPO_ROOT / "backend"))
    sys.path.insert(0, str(REPO_ROOT / "scripts"))
    import tempfile

    import run_video_local as rvl
    from app.integrations.pose_analysis import (
        classify_exercise,
        detect_camera_view,
        detect_reps_from_pose,
        extract_pose_track,
    )

    tmp = Path(tempfile.mkdtemp(prefix="takeout_"))
    try:
        dur = min(rvl.probe_duration(path), sample_s)
        track = extract_pose_track(path, str(tmp), 0.0, dur, fps=5.0)
        frames = int(track.get("frames") or 0)
        det = len(track["landmarks"])
        if frames == 0 or det == 0:
            return 0.0, None, None
        cls = classify_exercise(track["landmarks"], track["timestamps"])
        reps = detect_reps_from_pose(track["landmarks"], track["timestamps"],
                                     cls["exercise"], fps=5.0)
        # A lift: most frames have a pose AND at least one rep-like cycle.
        score = (det / frames) * (0.5 + 0.5 * min(1.0, len(reps) / 2.0))
        if cls["exercise"] == "Unknown":
            score *= 0.5
        return round(score, 3), cls["exercise"], detect_camera_view(track["landmarks"])["view"]
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def search(takeout: Path, keyword: str | None, after: float | None,
           before: float | None, min_seconds: float | None,
           content: bool, min_lift_score: float) -> list[Candidate]:
    out: list[Candidate] = []
    for path in sorted(takeout.rglob("*")):
        if not path.is_file() or path.suffix.lower() not in VIDEO_EXTS:
            continue
        meta = _sidecar(path)
        cand = Candidate(
            path=path,
            album=_album_of(path, takeout),
            title=meta.get("title"),
            description=meta.get("description"),
            taken_at=(meta.get("photoTakenTime") or {}).get("timestamp")
            and float((meta.get("photoTakenTime") or {}).get("timestamp")),
        )
        if not _matches(cand, keyword, after, before):
            continue
        if content:
            score, exercise, view = _content_score(path)
            cand.lift_score, cand.exercise, cand.view = score, exercise, view
            if score < min_lift_score:
                continue
        out.append(cand)
    return out


def _ts(value: str | None) -> float | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value).timestamp()
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--takeout", type=Path, required=True)
    ap.add_argument("--keyword", default=None)
    ap.add_argument("--after", default=None, help="ISO date (YYYY-MM-DD)")
    ap.add_argument("--before", default=None, help="ISO date (YYYY-MM-DD)")
    ap.add_argument("--min-seconds", type=float, default=None)
    ap.add_argument("--content", action="store_true")
    ap.add_argument("--min-lift-score", type=float, default=0.6)
    ap.add_argument("--out", type=Path, default=REPO_ROOT / "data" / "inbox" / "manifest.json")
    ap.add_argument("--copy-to", type=Path, default=None)
    args = ap.parse_args()

    if not args.takeout.exists():
        raise SystemExit(f"takeout dir not found: {args.takeout}")

    cands = search(
        args.takeout, args.keyword, _ts(args.after), _ts(args.before),
        args.min_seconds, args.content, args.min_lift_score,
    )
    matches = []
    for c in cands:
        matches.append(c.as_dict())
        tag = f" [{c.exercise} {c.view} {c.lift_score}]" if c.lift_score is not None else ""
        print(f"  {c.path.name[:60]}{tag}")
        if args.copy_to:
            args.copy_to.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(c.path, args.copy_to / c.path.name)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps({"videos": matches}, indent=2), encoding="utf-8")
    print(f"\n{len(matches)} candidate(s) -> {args.out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
