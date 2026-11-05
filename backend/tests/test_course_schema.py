"""Model and migration-chain checks for Course -> Route -> Ride.

These are schema-shape tests, not migration round-trips. They catch the
mistakes that are invisible until runtime: a missing FK, the wrong ON DELETE,
a model not registered in ``Base.metadata``, a broken revision chain, or a
link-status check that does not exist.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

from app.database import Base
from app.models import Activity, Course, CourseLinkLog, Route

MIGRATIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _load_migration(filename: str):
    path = MIGRATIONS / filename
    spec = importlib.util.spec_from_file_location(filename.removesuffix(".py"), path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_course_tables_are_registered():
    assert "courses" in Base.metadata.tables
    assert "course_link_log" in Base.metadata.tables
    assert Course.__tablename__ == "courses"
    assert CourseLinkLog.__tablename__ == "course_link_log"


def test_route_course_fk_is_set_null():
    column = Route.__table__.c.course_id
    assert column.nullable is True
    fk = next(iter(column.foreign_keys))
    assert fk.target_fullname == "courses.id"
    assert fk.ondelete == "SET NULL"


def test_course_canonical_route_is_optional_and_unique():
    column = Course.__table__.c.canonical_route_id
    assert column.nullable is True
    fk = next(iter(column.foreign_keys))
    assert fk.target_fullname == "routes.id"
    assert fk.ondelete == "SET NULL"

    index = next(
        i for i in Course.__table__.indexes if i.name == "uq_courses_canonical_route"
    )
    assert index.unique is True
    assert index.dialect_options["postgresql"]["where"] is not None


def test_course_link_log_actions_are_constrained():
    checks = [
        str(c.sqltext)
        for c in CourseLinkLog.__table__.constraints
        if c.__class__.__name__ == "CheckConstraint"
    ]
    assert any("group" in c and "ungroup" in c for c in checks)


def test_activity_link_trust_columns_and_check():
    columns = Activity.__table__.c
    for name in (
        "route_link_status",
        "route_link_source",
        "route_link_confidence",
        "route_link_confirmed_at",
    ):
        assert name in columns

    checks = [
        str(c.sqltext)
        for c in Activity.__table__.constraints
        if c.__class__.__name__ == "CheckConstraint"
    ]
    assert any("route_link_status" in c and "route_id" in c for c in checks)


def test_migration_chain_is_linear():
    migration_107 = _load_migration("107_add_courses_and_route_course_id.py")
    migration_108 = _load_migration("108_add_activity_route_link_trust.py")

    assert migration_107.revision == "107"
    assert migration_107.down_revision == "106"
    assert migration_108.revision == "108"
    assert migration_108.down_revision == "107"
