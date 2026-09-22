#!/usr/bin/env python3
"""Fetch the production lift videos into the local eval fixture folder.

R2 credentials live only on the Droplet, so this script SSHes to the production
host, runs a short snippet inside the backend container to mint presigned GET
URLs for every ``lift_videos.r2_key``, then downloads each object locally into
``backend/tests/fixtures/videos/`` (gitignored).

It also seeds ``backend/tests/fixtures/video_labels.json`` from the user-declared
metadata (``exercise_name`` + ``expected_reps``) if that file does not exist yet.
Those seeds are a starting point — open the videos and correct
``camera_view`` / ``reps`` / add ``velocity_band`` before trusting the eval.

Usage:
    python scripts/fetch_prod_videos.py
    python scripts/fetch_prod_videos.py --ssh-host fittrack-prod --remote-dir /opt/fitness-tracker
    python scripts/fetch_prod_videos.py --metadata-only   # just write the labels seed
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
FIXTURES = REPO_ROOT / "backend" / "tests" / "fixtures"
VIDEOS_DIR = FIXTURES / "videos"
LABELS_PATH = FIXTURES / "video_labels.json"
MANIFEST_PATH = FIXTURES / "video_manifest.json"

MARKER = "===FT_JSON==="

REMOTE_SNIPPET = """
import asyncio, json
from sqlalchemy import select
from app.database import task_session
from app.models.lifting import LiftVideo
from app.integrations.r2 import create_presigned_get

async def main():
    out = []
    async with task_session() as db:
        rows = (await db.execute(select(LiftVideo))).scalars().all()
        for v in rows:
            if not v.r2_key:
                continue
            out.append({
                "id": str(v.id),
                "file_name": v.file_name,
                "r2_key": v.r2_key,
                "exercise_name": v.exercise_name,
                "expected_reps": v.expected_reps,
                "reps_count": v.reps_count,
                "duration_seconds": v.duration_seconds,
                "created_at": v.created_at.isoformat() if v.created_at else None,
                "url": await create_presigned_get(v.r2_key),
            })
    print("__MARKER__" + json.dumps(out))

asyncio.run(main())
"""


def _safe_name(name: str | None, fallback: str) -> str:
    base = Path((name or fallback).replace("\\", "/")).name
    base = re.sub(r"[^\w.\-]+", "_", base).strip("._")
    return base or fallback


def fetch_metadata(ssh_host: str, remote_dir: str, service: str) -> list[dict]:
    snippet = REMOTE_SNIPPET.replace("__MARKER__", MARKER)
    remote_cmd = (
        f"cd {remote_dir} && docker compose exec -T {service} python -"
    )
    result = subprocess.run(
        ["ssh", ssh_host, remote_cmd],
        input=snippet,
        capture_output=True,
        text=True,
        timeout=180,
        check=False,
    )
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        raise RuntimeError(f"ssh/snippet failed (exit {result.returncode})")
    for line in result.stdout.splitlines():
        if line.startswith(MARKER):
            return json.loads(line[len(MARKER):])
    raise RuntimeError("JSON marker not found in remote output")


def download(url: str, dest: Path) -> None:
    req = urllib.request.Request(url, headers={"User-Agent": "fittrack-video-eval"})
    with urllib.request.urlopen(req, timeout=300) as resp, dest.open("wb") as fh:
        while True:
            chunk = resp.read(1024 * 256)
            if not chunk:
                break
            fh.write(chunk)


def seed_labels(rows: list[dict]) -> None:
    if LABELS_PATH.exists():
        return
    videos = []
    for row in rows:
        fname = f"{row['id'][:8]}-{_safe_name(row.get('file_name'), 'video.mp4')}"
        videos.append(
            {
                "file": fname,
                "id": row["id"],
                "exercise": row.get("exercise_name") or None,
                "camera_view": "unknown",
                "reps": row.get("expected_reps"),
                "set_type": "working",
                "velocity_band": None,
                "notes": "",
            }
        )
    LABELS_PATH.write_text(json.dumps({"videos": videos}, indent=2))
    print(f"seeded {LABELS_PATH} ({len(videos)} entries) — verify against the videos")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--ssh-host", default="fittrack-prod")
    ap.add_argument("--remote-dir", default="/opt/fitness-tracker")
    ap.add_argument("--service", default="backend")
    ap.add_argument("--metadata-only", action="store_true")
    args = ap.parse_args()

    FIXTURES.mkdir(parents=True, exist_ok=True)
    print(f"querying {args.ssh_host} …")
    rows = fetch_metadata(args.ssh_host, args.remote_dir, args.service)
    print(f"found {len(rows)} videos")

    manifest = [
        {
            "file": f"{r['id'][:8]}-{_safe_name(r.get('file_name'), 'video.mp4')}",
            "id": r["id"],
            "r2_key": r["r2_key"],
            "exercise_name": r.get("exercise_name"),
            "expected_reps": r.get("expected_reps"),
            "reps_count": r.get("reps_count"),
            "duration_seconds": r.get("duration_seconds"),
            "created_at": r.get("created_at"),
        }
        for r in rows
    ]
    MANIFEST_PATH.write_text(json.dumps({"videos": manifest}, indent=2))
    seed_labels(rows)

    if args.metadata_only:
        print("metadata-only: skipping downloads")
        return 0

    VIDEOS_DIR.mkdir(parents=True, exist_ok=True)
    for row, meta in zip(rows, manifest):
        dest = VIDEOS_DIR / meta["file"]
        if dest.exists() and dest.stat().st_size > 0:
            print(f"  [have] {dest.name}")
            continue
        print(f"  [get ] {dest.name}")
        download(row["url"], dest)
    print(f"videos in {VIDEOS_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
