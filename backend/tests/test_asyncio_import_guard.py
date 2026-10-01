"""Guard: any function that uses ``asyncio`` must have it in scope.

``app/tasks/scheduler.py`` imports ``asyncio`` *inside* each Celery task rather
than at module scope (35 of them).  ``reap_stale_videos`` was added later
(commit ``c9f459b``, #122) without that import, so every scheduled run raised
``NameError: name 'asyncio' is not defined`` at ``asyncio.run(...)`` — a task
that silently never did its job.

``symtable`` tells us, per function scope, whether ``asyncio`` is *bound*
(local import / assignment) or merely *referenced* from an outer scope.  A
function is a violation only when it references ``asyncio`` and nothing binds
it — not the function, not an enclosing function, not the module.  That makes
a module-level ``import asyncio`` (the more common convention elsewhere in the
codebase) equally acceptable.
"""

from __future__ import annotations

import symtable
from collections.abc import Iterator
from pathlib import Path

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def _walk_scopes(table: symtable.SymbolTable) -> Iterator[symtable.SymbolTable]:
    for child in table.get_children():
        yield child
        yield from _walk_scopes(child)


def _unbound_asyncio_functions(path: Path) -> list[str]:
    """Return ``"<file>:<function>"`` for each function using an unbound ``asyncio``."""
    top = symtable.symtable(path.read_text(encoding="utf-8"), str(path), "exec")
    if "asyncio" in top.get_identifiers():
        # Module-level import — every function can see it.
        return []

    offenders: list[str] = []
    for scope in _walk_scopes(top):
        if scope.get_type() != "function":
            continue
        if "asyncio" not in scope.get_identifiers():
            continue
        symbol = scope.lookup("asyncio")
        bound_here = (
            symbol.is_local()
            or symbol.is_assigned()
            or symbol.is_parameter()
            or symbol.is_free()
            or symbol.is_imported()
        )
        if symbol.is_referenced() and not bound_here:
            offenders.append(f"{path.name}:{scope.get_name()}")
    return offenders


def test_asyncio_is_imported_wherever_it_is_used() -> None:
    offenders: list[str] = []
    for path in sorted(APP_DIR.rglob("*.py")):
        offenders.extend(_unbound_asyncio_functions(path))

    assert offenders == [], (
        "These functions reference `asyncio` without importing it (add "
        "`import asyncio`): " + ", ".join(offenders)
    )
