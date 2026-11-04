"""Regression guard for the 2026-11-04 sync auth-handler bug.

``sync_all_strava_activities`` imported only ``CONNECTION_STATUS_NEEDS_REAUTH``
from ``connection_health`` while its handlers called ``mark_connection_reauth``
and ``handle_sync_http_error``. F821 was ignored repo-wide, so neither Ruff nor
the existing error-isolation test noticed the undefined names.

This test reads the function's own imports (not the whole module, which imports
the same names later for the Whoop path) so adding the names to the sync task is
the only way to pass it.
"""

from __future__ import annotations

import ast
from pathlib import Path

SOURCE = Path(__file__).resolve().parents[1] / "app" / "tasks" / "scheduler.py"
REQUIRED = {"mark_connection_reauth", "handle_sync_http_error"}


def _sync_task() -> ast.FunctionDef | ast.AsyncFunctionDef:
    tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "sync_all_strava_activities":
            return node
    raise AssertionError("sync_all_strava_activities not found")


def test_sync_task_imports_both_auth_handlers() -> None:
    imported: set[str] = set()
    for node in ast.walk(_sync_task()):
        if isinstance(node, ast.ImportFrom) and node.module == "app.services.connection_health":
            imported.update(alias.name for alias in node.names)

    missing = REQUIRED - imported
    assert not missing, (
        "sync_all_strava_activities must import its auth handlers from "
        f"app.services.connection_health; missing {sorted(missing)}"
    )
