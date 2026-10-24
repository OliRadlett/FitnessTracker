"""Run source-tree verification selected by the changed files.

This command deliberately runs host-side checks. Container tests can execute
stale image code in this repository, so they are not a default verification
path.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def changed_files() -> list[str]:
    result = subprocess.run(
        ["git", "diff", "--name-only", "HEAD", "--"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    tracked = [line for line in result.stdout.splitlines() if line]
    untracked_result = subprocess.run(
        ["git", "ls-files", "--others", "--exclude-standard"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return sorted(set(tracked + [line for line in untracked_result.stdout.splitlines() if line]))


def run(label: str, command: list[str], *, cwd: Path = ROOT) -> int:
    print(f"\n== {label} ==")
    print("$", " ".join(command))
    try:
        return subprocess.run(command, cwd=cwd).returncode
    except FileNotFoundError:
        print(f"UNAVAILABLE: {command[0]} is not installed")
        return 127


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", action="append", help="Path or directory to verify")
    parser.add_argument("--all", action="store_true", help="Run all local checks")
    args = parser.parse_args()

    files = args.scope or changed_files()
    if not files and not args.all:
        print("No changed files found. Use --all to run the full local suite.")
        return 0

    joined = "\n".join(files)
    backend = args.all or any(path.startswith(("backend/", "scripts/")) for path in files)
    frontend = args.all or any(path.startswith("frontend/") for path in files)
    migrations = any(path.startswith("backend/alembic/") for path in files)

    failures: list[str] = []
    unverified: list[str] = []

    def record(label: str, command: list[str]) -> None:
        result = run(label, command)
        if result == 127:
            unverified.append(label.lower())
        elif result != 0:
            failures.append(label.lower())

    if backend:
        os.environ.setdefault("SECRET_KEY", "local-test-secret")
        os.environ.setdefault("DEBUG", "true")
        os.environ.setdefault(
            "DATABASE_URL",
            "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack",
        )
        os.environ.setdefault(
            "TEST_DATABASE_URL",
            "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack_test",
        )
        os.environ.setdefault("REDIS_URL", "redis://:redis_dev_password@localhost:6379/0")
        record("Backend lint", ["ruff", "check", "backend/"])
        record("Backend tests", [sys.executable, "-m", "pytest", "backend/tests/", "-q"])
    if frontend:
        record("Frontend tests", ["npm", "test", "--prefix", "frontend"])
        record("Frontend typecheck", ["npm", "run", "typecheck", "--prefix", "frontend"])
        if args.all:
            record("Frontend build", ["npm", "run", "build", "--prefix", "frontend"])
    if args.all or any(path.startswith((".agent/", "AGENTS.md", "backend/app/", "frontend/src/")) for path in files):
        record("Agent map", [sys.executable, "scripts/check_agent_map.py"])
    if migrations:
        print("\n== Migration contract ==")
        print("Migration changes require a fresh-database upgrade and downgrade/upgrade check.")
        print("Run this check in CI or with the disposable PostgreSQL environment described in docs/RUNNING.md.")
        unverified.append("migration contract")

    print("\nChanged scope:\n" + joined)
    if failures:
        print("Verification failed: " + ", ".join(failures))
        return 1
    if unverified:
        print("Verification incomplete: " + ", ".join(unverified))
        return 2
    print("Verification passed for the selected local checks.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
