"""Invariants about repository configuration that a reviewer cannot see in a diff.

The dead code report is advice. If it ever runs on a pull request, or starts
failing a build, it stops being advice and becomes a gate, which is the opposite
of what it is for.

The alert rules must only reference metrics the backend actually serves.
`backend/app/metrics.py` emits its counters inside Celery worker processes, and
Prometheus scrapes the backend, so an alert on those can never fire.
"""

from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
DEADCODE_WORKFLOW = REPO / ".github" / "workflows" / "deadcode-report.yml"


def test_deadcode_report_cannot_gate_a_pull_request():
    text = DEADCODE_WORKFLOW.read_text(encoding="utf-8")
    assert "pull_request" not in text, (
        "the dead code report must stay off the pull request path, or it becomes a gate"
    )
    assert "error-exitcode" not in text, "the dead code report must never fail the build"


def test_deadcode_report_has_a_trigger():
    text = DEADCODE_WORKFLOW.read_text(encoding="utf-8")
    assert "schedule:" in text or "workflow_dispatch:" in text, (
        "the report needs a trigger, or it never runs at all"
    )


# Emitted in Celery worker processes, which are not the process serving /metrics.
PROCESS_LOCAL_METRICS = (
    "fittrack_sync_runs_total",
    "fittrack_sync_items_total",
    "fittrack_connection_reauth_total",
    "fittrack_webhook_events_total",
)


def test_alerts_do_not_reference_process_local_metrics():
    """An alert on a metric the scraper never sees is worse than no alert.

    It looks like coverage on a dashboard and can never fire. This holds until a
    Pushgateway or Prometheus multiprocess mode makes those counters scrapeable,
    at which point this list and `metrics.py` move together.
    """
    text = (REPO / "infra" / "prometheus" / "alerts.yml").read_text(encoding="utf-8")
    # Comments may name these metrics to explain why they are absent; only the
    # rule expressions matter.
    rules = "\n".join(
        line for line in text.splitlines() if not line.lstrip().startswith("#")
    )
    referenced = [name for name in PROCESS_LOCAL_METRICS if name in rules]
    assert not referenced, (
        "alerts.yml references metrics only emitted in Celery workers, so these "
        f"alerts can never fire: {referenced}"
    )
