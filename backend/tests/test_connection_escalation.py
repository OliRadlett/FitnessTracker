"""A permanently broken connection must eventually surface as needing reauth.

``_record_transient`` increments ``consecutive_failures`` and nothing ever
reads it. On production the Withings connection sits at **136** consecutive
failures with ``status = 'active'`` — the UI shows a healthy connection that
has failed every single refresh since 2026-08 and has never once asked the
user to reconnect.

Both sibling subsystems already escalate on a threshold
(``push.py`` via ``MAX_CONSECUTIVE_FAILURES``, ``route_intelligence.py`` via
``max_failures``). ``connection_health`` is the one that doesn't, which is why
its counter grows without bound.

The trigger case is not a network blip: Withings returns error code
**2554 "Not implemented"** — an API-level refusal, not a transport failure.
It is not a 401/403, so ``handle_sync_http_error`` falls into its
"anything else is transient" branch and stays there forever.

So: escalate to ``needs_reauth`` once the counter crosses a threshold, which
is what the column was added for (the model comment says it "backs off
transient errors"). Without it the number is decorative.
"""

from __future__ import annotations

import ast
from pathlib import Path

CH_PY = (
    Path(__file__).resolve().parents[1] / "app" / "services" / "connection_health.py"
)

_FN = (ast.FunctionDef, ast.AsyncFunctionDef)


def _find(name):
    tree = ast.parse(CH_PY.read_text(encoding="utf-8"))
    return next(
        n for n in ast.walk(tree) if isinstance(n, _FN) and n.name == name
    )


class TestTransientFailuresEscalate:
    def test_a_threshold_exists(self):
        from app.services.connection_health import MAX_CONSECUTIVE_FAILURES

        assert MAX_CONSECUTIVE_FAILURES > 0
        assert MAX_CONSECUTIVE_FAILURES < 50, (
            "136 consecutive failures reached in production without any "
            "escalation; a threshold anywhere near that is not a threshold"
        )

    def test_record_transient_escalates_past_the_threshold(self):
        unparsed = ast.unparse(_find("_record_transient"))
        assert "MAX_CONSECUTIVE_FAILURES" in unparsed, (
            "_record_transient must compare against the threshold — the "
            "counter is otherwise written and never read"
        )
        assert "_mark_reauth" in unparsed, (
            "crossing the threshold must mark the connection needs_reauth so "
            "the user is asked to reconnect"
        )

    def test_the_check_is_after_the_increment(self):
        """Comparing before incrementing would escalate one attempt early."""
        unparsed = ast.unparse(_find("_record_transient"))
        assert unparsed.index("+ 1") < unparsed.index("MAX_CONSECUTIVE_FAILURES")

    def test_a_single_failure_is_still_transient(self):
        """One blip must not demand a reconnect — only sustained failure does.

        Asserted on the whole comparison rather than a slice: in
        ``consecutive_failures >= MAX_CONSECUTIVE_FAILURES`` the operator
        precedes the constant name, so searching from the constant finds text
        that can never contain it.
        """
        unparsed = ast.unparse(_find("_record_transient"))
        assert (
            "consecutive_failures >= MAX_CONSECUTIVE_FAILURES" in unparsed
        ), "the threshold must be a >= comparison, not a truthy check"

    def test_success_still_resets_the_counter(self):
        """Escalation must not fire on a connection that recovers."""
        src = CH_PY.read_text(encoding="utf-8")
        assert src.count("consecutive_failures = 0") >= 2, (
            "a successful refresh or recovery must clear the counter, or a "
            "connection that recovered once would still escalate later"
        )


class TestEscalationIsVisibleOnce:
    def test_escalation_logs_a_distinct_message(self):
        """Every subsequent sync used to log a warning; after escalation the
        connection is needs_reauth and sync is skipped, so the log should say
        what changed rather than repeating the same line forever."""
        unparsed = ast.unparse(_find("_record_transient"))
        assert "reauth" in unparsed.lower()