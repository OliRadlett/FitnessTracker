"""Provenance guard (I1) + partial index guard (I4).

Static source-text checks — no database needed.  They scan migration files
and the import graph so they fail fast and cannot be bypassed by a stale
test database.

I1: purge/identity operations must key on ``activity_sources.provider``,
    never the mutable ``activities.source`` column (pitfall 21).
    ``_MERGE_FIELDS`` must carry ``sport_type`` (I1 second clause).
I4: ``activities.import_fingerprint`` unique index must be partial
    (``postgresql_where IS NOT NULL``) — not a full unique constraint on
    NULLs (pitfall 31).

Run with:  pytest tests/test_provenance_guard.py -v
"""

from __future__ import annotations

import re
from pathlib import Path

from app.services.merge_service import _MERGE_FIELDS

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"


# ── I1a: no migration purges via the mutable activities.source column ─────────

# 085 is the historical exception: it shipped to prod purging by
# ``activities.source`` (pitfall 21). 087 fixed the 28 survivors that had
# been merged with Strava (flipping source to 'strava') forward using the
# provenance predicate ``EXISTS (FROM activity_sources WHERE provider = ...)``.
# 085 cannot be edited (pitfall 24); the guard prevents recurrence in any
# migration.
_PROVENANCE_EXEMPT = {"085_purge_legacy_wahoo_activities.py"}


def _delete_activity_statements(src: str) -> list[str]:
    """Extract each ``DELETE FROM activities`` statement from migration source.

    A statement runs from ``DELETE FROM activities`` to the next semicolon
    (or end of string), mirroring how Postgres parses statement boundaries.
    """
    stmts: list[str] = []
    for m in re.finditer(r"DELETE\s+FROM\s+activities\b", src, re.IGNORECASE):
        start = m.start()
        semi = src.find(";", start)
        if semi == -1:
            semi = len(src)
        stmts.append(src[start:semi])
    return stmts


def test_no_migration_purges_by_activities_source() -> None:
    """I1: a DELETE on activities must not filter on bare ``source =``.

    ``activities.source`` is mutable — ``merge_activity`` flips it to the
    higher-priority provider when providers merge. A purge keyed on it misses
    rows already merged with a higher-priority source (pitfall 21: 28 Wahoo
    rows survived because their source was flipped to 'strava').

    Migration 085 is the one known offender (already applied to prod).
    """
    offenders: list[str] = []
    for path in sorted(VERSIONS.glob("*.py")):
        if path.name.startswith("_"):
            continue
        src = path.read_text(encoding="utf-8")
        for stmt in _delete_activity_statements(src):
            if re.search(r"\bsource\s*=", stmt, re.IGNORECASE):
                if path.name not in _PROVENANCE_EXEMPT:
                    offenders.append(path.name)
    assert not offenders, (
        f"{offenders} purge activities by `activities.source =` — "
        "use `EXISTS (FROM activity_sources WHERE provider = ...)` instead (I1)."
    )


def test_migration_085_is_the_documented_provenance_exception() -> None:
    """085 is the pinned historical violation; the exemption above must not
    silently hide a fix."""
    path = VERSIONS / "085_purge_legacy_wahoo_activities.py"
    assert path.exists()
    src = path.read_text(encoding="utf-8")
    assert re.search(r"DELETE\s+FROM\s+activities", src, re.IGNORECASE), (
        "085 expected to DELETE FROM activities"
    )
    assert re.search(r"\bsource\s*=", src, re.IGNORECASE), (
        "085 expected to purge by activities.source — if that changed, it no "
        "longer belongs in _PROVENANCE_EXEMPT"
    )


def test_migration_087_uses_provenance_predicate() -> None:
    """I1: 087's reclassify must key on ``activity_sources.provider``.

    This is the migration that fixed 085's survivors forward — it must prove
    it uses the provenance predicate (EXISTS + activity_sources.provider)
    rather than the mutable ``activities.source``.
    """
    path = VERSIONS / "087_fix_mislabelled_activities_add_activity_road_match.py"
    assert path.exists()
    src = path.read_text(encoding="utf-8")
    up = src.split("def upgrade()", 1)[1].split("def downgrade()", 1)[0]

    # The provenance predicate: EXISTS (... activity_sources ... provider = ...)
    assert "EXISTS" in up.upper()
    assert "activity_sources" in up
    assert "provider = 'wahoo'" in up

    # No UPDATE ... activities may filter on bare ``source =``.
    for m in re.finditer(r"UPDATE\s+activities\b", up, re.IGNORECASE):
        start = m.start()
        semi = up.find(";", start)
        if semi == -1:
            semi = len(up)
        stmt = up[start:semi]
        assert not re.search(r"\bsource\s*=", stmt, re.IGNORECASE), (
            "087 UPDATE on activities filters on bare `activities.source =` — "
            "must use `EXISTS (FROM activity_sources WHERE provider = ...)`"
        )


# ── I1b: _MERGE_FIELDS carries sport_type ──────────────────────────────────────


def test_merge_fields_carries_sport_type() -> None:
    """I1: sport_type must be in _MERGE_FIELDS so a higher-priority provider
    (Strava) corrects a lower-priority one (Wahoo) at sync time, not just
    in a one-off migration (pitfall 21: 087 did it for survivors; I1 keeps it
    from recurring at every future sync)."""
    assert "sport_type" in _MERGE_FIELDS, (
        "_MERGE_FIELDS must carry sport_type (I1: provenance-on-merge)"
    )


# ── I4: partial unique index on activities.import_fingerprint ──────────────────


def test_migration_094_partial_index_predicate() -> None:
    """I4: the import_fingerprint unique index must be PARTIAL.

    A plain ``unique(user_id, import_fingerprint)`` collides across the
    thousands of provider-synced rows that are NULL. The index must exist
    only over non-NULL rows via ``postgresql_where`` (pitfall 31).

    Checked on the migration source so the predicate cannot be silently
    dropped by a refactor or AST rewrite — only Postgres itself decides
    which rows a partial index covers (pitfall 28).
    """
    path = VERSIONS / "094_add_activity_import_fingerprint.py"
    assert path.exists(), "migration 094 must exist"
    src = path.read_text(encoding="utf-8")

    assert "create_index" in src, "must use op.create_index (supports partial)"
    assert "postgresql_where" in src, "must be a partial index"
    assert "import_fingerprint IS NOT NULL" in src, (
        "predicate must be `import_fingerprint IS NOT NULL`"
    )
    assert "unique=True" in src, "the index must still be unique on non-NULL rows"


def test_migration_094_links_into_linear_chain() -> None:
    """094 must link 093 → 094 → 095 (pitfall 34: revision collisions orphan
    migrations and break ``alembic upgrade head``)."""
    path = VERSIONS / "094_add_activity_import_fingerprint.py"
    src = path.read_text(encoding="utf-8")
    assert re.search(r"""revision\s*=\s*["']094["']""", src)
    assert re.search(r"""down_revision\s*=\s*["']093["']""", src)

    # 095 must chain from 094 — if it doesn't, 094 is orphaned.
    next_path = VERSIONS / "095_add_segment_geo_cluster_id.py"
    next_src = next_path.read_text(encoding="utf-8")
    assert re.search(r"""down_revision\s*=\s*["']094["']""", next_src), (
        "095 must down_revision '094' — otherwise 094 is orphaned"
    )
