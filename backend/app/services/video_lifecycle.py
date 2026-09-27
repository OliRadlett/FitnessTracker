"""Lift-video lifecycle policy — dependency-free, unit-testable.

A worker killed mid-task (a deploy recreates containers; Celery acks_late only
redelivers to a *live* worker) can leave a video stuck in ``processing`` /
``queued`` forever. One sat in ``processing`` for days after a deploy. The
reaper (``app.tasks.scheduler.reap_stale_videos``) applies the policy below:
re-queue once so transient failures recover, then mark it failed so it stops
occupying the queue and surfaces in the UI with a reprocess action.
"""

from __future__ import annotations

STALE_VIDEO_MINUTES = 45
STALE_RETRY_MARKER = "[auto-retry]"


def stale_reap_decision(analysis_text: str | None) -> tuple[str, str]:
    """``(status, text)`` for a stale video: re-queue once, then fail."""
    if (analysis_text or "").startswith(STALE_RETRY_MARKER):
        return "failed", (
            f"{STALE_RETRY_MARKER} still stuck after a retry — "
            "reprocess from the videos page"
        )
    return "queued", f"{STALE_RETRY_MARKER} {analysis_text or ''}".strip()
