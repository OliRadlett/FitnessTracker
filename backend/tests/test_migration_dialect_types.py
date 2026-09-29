"""Migrations must not build dialect-specific types off the bare ``sa`` alias.

``087_fix_mislabelled_activities_add_activity_road_match.py`` reached
production and crashed ``alembic upgrade head`` on the first statement of
its ``upgrade()``::

    AttributeError: module 'sqlalchemy' has no attribute 'JSONB'

``JSONB`` is a *PostgreSQL dialect* type: it lives in
``sqlalchemy.dialects.postgresql`` and is deliberately absent from the
top-level ``sqlalchemy`` namespace, whose portable types are ``JSON``,
``UUID``, ``ARRAY``-free and so on.

Because alembic runs under transactional DDL, that ``AttributeError``
rolled the whole upgrade back. Production silently stayed at revision
086: the three ``activities.road_match*`` columns were never created, the
26 mislabelled strength rows were never reclassified, and the
``map_match_activities`` Celery task — which filters on
``Activity.road_match_version.is_(None)`` — would have thrown against a
column that did not exist every Sunday until the fix was redeployed.

The deploy step did report failure, so this was loud rather than silent;
the cost was a release that sat half-applied until someone read the log.
This test turns the failure into a local one, before the image is built.

The check is static on purpose: it needs no database, runs in milliseconds,
and — unlike an ``upgrade()`` round-trip — still covers the migrations that
have already been applied everywhere and would never be re-executed.
"""

from __future__ import annotations

import ast
from pathlib import Path

import sqlalchemy

VERSIONS_DIR = Path(__file__).resolve().parents[1] / "alembic" / "versions"


def _top_level_sqlalchemy_aliases(tree: ast.Module) -> set[str]:
    """Names bound to the top-level ``sqlalchemy`` module by ``import ... as``.

    Only these are checked: ``from sqlalchemy.dialects import postgresql``
    binds a *different* module whose attributes are legitimately
    dialect-specific, and a migration is free to use ``postgresql.JSONB()``.
    """
    aliases: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                if alias.name == "sqlalchemy" and alias.asname:
                    aliases.add(alias.asname)
                elif alias.name == "sqlalchemy" and not alias.asname:
                    aliases.add("sqlalchemy")
    return aliases


def _migration_files() -> list[Path]:
    return sorted(p for p in VERSIONS_DIR.glob("*.py") if not p.name.startswith("_"))


def _dialect_leaks(path: Path) -> list[tuple[int, str]]:
    """Every ``<sa-alias>.<attr>`` in ``path`` that top-level sqlalchemy lacks."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    aliases = _top_level_sqlalchemy_aliases(tree)
    if not aliases:
        return []

    leaks: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id in aliases
            and not hasattr(sqlalchemy, node.attr)
        ):
            leaks.append((node.lineno, node.attr))
    return sorted(set(leaks))


def test_versions_directory_is_populated() -> None:
    """Guard the guard: an empty/moved directory must not pass vacuously."""
    assert len(_migration_files()) > 50, "expected the full migration chain"


def test_sa_alias_reaches_the_top_level_module() -> None:
    """``import sqlalchemy as sa`` is the only form the checker recognises.

    Pins the alias discovery so a future edit to the helper cannot silently
    reduce coverage to zero files.
    """
    tree = ast.parse("import sqlalchemy as sa\nsa.JSONB()\n")
    assert _top_level_sqlalchemy_aliases(tree) == {"sa"}


def test_dialect_import_is_not_treated_as_a_leak() -> None:
    """``postgresql.JSONB()`` is the correct spelling and must not be flagged."""
    path_source = "from sqlalchemy.dialects import postgresql\npostgresql.JSONB()\n"
    tree = ast.parse(path_source)
    assert _top_level_sqlalchemy_aliases(tree) == set()

    # And the attribute access on the *dialect* module is not scanned, because
    # only aliases bound to top-level sqlalchemy are.
    assert not any(
        isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name)
        and node.value.id in _top_level_sqlalchemy_aliases(tree)
        for node in ast.walk(tree)
    )


def test_top_level_portable_types_are_not_flagged() -> None:
    """``sa.UUID``/``sa.JSON``/``sa.Text`` are real and must stay allowed.

    Migrations 037, 038 and 071 use ``sa.UUID()``; a naive "reject anything
    that isn't a plain builtin" check would condemn correct code.
    """
    assert hasattr(sqlalchemy, "UUID")
    assert hasattr(sqlalchemy, "JSON")
    assert hasattr(sqlalchemy, "Text")


def test_no_migration_uses_a_dialect_only_type_via_sa() -> None:
    """The regression itself, checked across the whole chain.

    Before the fix this reports ``087_...py:59 JSONB`` and
    ``087_...py:60 JSONB``, which is exactly what crashed production.
    """
    offenders: dict[str, list[str]] = {}
    for path in _migration_files():
        leaks = _dialect_leaks(path)
        if leaks:
            offenders[path.name] = [f"line {ln}: {attr}" for ln, attr in leaks]

    assert not offenders, (
        "dialect-specific type reached through the top-level 'sqlalchemy' "
        "namespace, which raises AttributeError at upgrade time:\n"
        + "\n".join(
            f"  {name}: {', '.join(details)}" for name, details in offenders.items()
        )
        + "\nUse 'from sqlalchemy.dialects import postgresql' and "
        "postgresql.JSONB() instead."
    )
