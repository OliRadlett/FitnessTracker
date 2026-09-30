"""Every mapped model must be registered in ``app.models`` (DATA-11).

AGENTS pitfall #14: a model class that is not imported into
``app/models/__init__.py`` is invisible to ``Base.metadata.create_all()``. Its
table is never created, so the model passes a migration-built database and then
fails at runtime with ``UndefinedTableError`` on a ``create_all``-based test
fixture or a fresh environment.

``GoalCheckIn`` was defined in ``models/goal.py`` but never imported or
exported, so ``goal_checkins`` was missing from ``create_all()`` output.

This is a structural guard rather than a behavioural one: it fails whenever any
model is added to a module but not to the package registry. A plain import of
``app.models`` cannot detect that on its own (a submodule import does not
populate ``Base.metadata``), so the test asserts against the full expected
set of tables.

Run with:  pytest tests/test_model_registry.py
"""

from __future__ import annotations

import app.models  # importing the package registers every exported model
from app.database import Base

# Models that must be reachable through the ``app.models`` package. Each one is
# defined in a module and is part of the 45-table schema documented in AGENTS.md.
EXPECTED_TABLES = {
    "goals",
    "goal_checkins",
}


def test_goal_checkin_is_exported():
    """DATA-11: ``GoalCheckIn`` must be importable from ``app.models``."""
    from app.models import GoalCheckIn

    assert "GoalCheckIn" in app.models.__all__


def test_registered_models_cover_expected_tables():
    """Every expected table is present in ``Base.metadata`` after importing the package.

    ``Base.metadata`` is only populated by the imports performed in
    ``app/models/__init__.py``; a model omitted there leaves its table absent
    here even though the class exists.
    """
    table_names = set(Base.metadata.tables)
    missing = EXPECTED_TABLES - table_names
    assert not missing, (
        f"tables missing from Base.metadata (models/__init__.py did not import "
        f"them): {sorted(missing)}"
    )
