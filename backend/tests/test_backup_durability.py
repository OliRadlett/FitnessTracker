"""Guard that the production worker can persist the weekly pg_dump.

The backup task writes to ``settings.backup_dir`` (``/backups``). If the worker
has no mount there, the dump lives in the container layer and the deploy's
``compose down`` destroys it. This is a config test, not a filesystem test: it
reads the production compose override that deploys actually merge.
"""

from __future__ import annotations

from pathlib import Path

COMPOSE = Path(__file__).resolve().parents[2] / "docker-compose.prod.yml"


def _worker_block() -> str:
    text = COMPOSE.read_text(encoding="utf-8")
    worker = text.split("  worker:", 1)[1]
    return worker.split("  beat:", 1)[0]


def test_worker_mounts_the_backup_directory() -> None:
    assert "./backups:/backups" in _worker_block(), (
        "docker-compose.prod.yml worker must mount ./backups:/backups; "
        "otherwise the weekly backup is deleted by the next deploy"
    )
