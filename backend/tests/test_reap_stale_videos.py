"""Stale lift-video reaper policy (services.video_lifecycle).

A worker killed mid-task leaves a video in `processing` forever; the reaper
re-queues it once, then marks it failed so it stops occupying the queue.
"""

from app.services.video_lifecycle import STALE_RETRY_MARKER, stale_reap_decision


def test_first_pass_requeues_with_marker():
    status, text = stale_reap_decision(None)
    assert status == "queued"
    assert text.startswith(STALE_RETRY_MARKER)


def test_first_pass_preserves_existing_text():
    _, text = stale_reap_decision("Downloading video")
    assert text.endswith("Downloading video")


def test_second_pass_marks_failed():
    status, text = stale_reap_decision(f"{STALE_RETRY_MARKER} Downloading video")
    assert status == "failed"
    assert "reprocess" in text
