"""Invariants about repository configuration that a reviewer cannot see in a diff.

The dead code report is advice. If it ever runs on a pull request, or starts
failing a build, it stops being advice and becomes a gate, which is the opposite
of what it is for.
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
