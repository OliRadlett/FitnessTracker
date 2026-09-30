"""The purge predicate, evaluated as SQL semantics, without a database.

The other 088 test checks the migration's *source text*; this checks the
*behaviour* of the predicate it builds, by translating the same expression
into SQLite and running it against a seeded table.

SQLite is enough here because the predicate is deliberately portable: it
uses only ``IS NULL``, ``NOT IN`` and ``OR``, which behave identically in
both engines. That portability is the point — the same expression has to
work against production Postgres, and a pure-function test is the only
kind this suite can run.

The behaviour worth proving is the ``NULL`` case. In SQL,
``NULL NOT IN ('cycling','strength')`` evaluates to NULL, not TRUE, so a
row with a NULL sport_type is NOT matched by that clause alone. Without
the explicit ``sport_type IS NULL OR`` prefix such a row survives the
purge and stays in the database as an untracked activity.
"""

from __future__ import annotations

import pytest
import sqlalchemy as sa

# Mirrors 088's upgrade() statements exactly.
KEPT = ("cycling", "strength")
KEEP_LIST = ", ".join(f"'{s}'" for s in KEPT)

CREATE = """
CREATE TABLE activities (
    id INTEGER PRIMARY KEY,
    sport_type TEXT,
    name TEXT
)
"""

# Mirrors 088's upgrade() statements exactly, including the backup's
# WHERE clause — the backup holds only what the delete will remove.
BACKUP = (
    "CREATE TABLE _purged_activities_088 AS SELECT * FROM activities "
    f"WHERE sport_type IS NULL OR sport_type NOT IN ({KEEP_LIST})"
)
DELETE = (
    "DELETE FROM activities "
    f"WHERE sport_type IS NULL OR sport_type NOT IN ({KEEP_LIST})"
)


@pytest.fixture
def conn():
    eng = sa.create_engine("sqlite://")
    with eng.begin() as c:
        c.execute(sa.text(CREATE))
    yield eng
    eng.dispose()


def _seed(conn, rows) -> None:
    with conn.begin() as c:
        for i, (sport, name) in enumerate(rows, 1):
            c.execute(
                sa.text(
                    "INSERT INTO activities (id, sport_type, name) VALUES (:i, :s, :n)"
                ),
                {"i": i, "s": sport, "n": name},
            )


def _survivors(conn) -> list[str]:
    with conn.begin() as c:
        return [r[0] for r in c.execute(sa.text("SELECT sport_type FROM activities"))]


def test_keeps_cycling_and_strength(conn):
    _seed(conn, [("cycling", "a"), ("strength", "b")])
    with conn.begin() as c:
        c.execute(sa.text(DELETE))
    assert sorted(_survivors(conn)) == ["cycling", "strength"]


def test_removes_walking_and_hiking(conn):
    _seed(conn, [("cycling", "a"), ("walking", "b"), ("hiking", "c")])
    with conn.begin() as c:
        c.execute(sa.text(DELETE))
    assert _survivors(conn) == ["cycling"]


def test_removes_other_sports(conn):
    """Golf/swimming/kayaking are untracked too, not just walks."""
    _seed(conn, [("golf", "a"), ("swimming", "b"), ("kayaking", "c")])
    with conn.begin() as c:
        c.execute(sa.text(DELETE))
    assert _survivors(conn) == []


def test_removes_sport_not_in_the_kept_list_at_all(conn):
    """An unanticipated sport is purged, not kept by default."""
    _seed(conn, [("cycling", "a"), ("unicorn_ride", "b")])
    with conn.begin() as c:
        c.execute(sa.text(DELETE))
    assert _survivors(conn) == ["cycling"]


def test_removes_null_sport_type(conn):
    """NULL must be purged.

    ``NULL NOT IN (...)`` is NULL, not TRUE, so without the explicit
    ``IS NULL`` clause this row would survive. That is the subtle case
    this file exists to pin.
    """
    _seed(conn, [("cycling", "a"), (None, "unknown")])
    with conn.begin() as c:
        c.execute(sa.text(DELETE))
    assert _survivors(conn) == ["cycling"]


def test_is_sport_type_case_sensitive_like_production_data(conn):
    """Rows are stored lowercase by every provider mapper.

    If a row ever arrived as 'Cycling' the purge would delete it, because
    the comparison is case-sensitive. Pinned so the behaviour is a
    decision rather than an accident.
    """
    _seed(conn, [("Cycling", "a"), ("cycling", "b")])
    with conn.begin() as c:
        c.execute(sa.text(DELETE))
    assert _survivors(conn) == ["cycling"]


def test_backup_then_delete_partitions_every_row(conn):
    """Backup + survivors must account for every seeded row, exactly once."""
    rows = [
        ("cycling", "a"),
        ("strength", "b"),
        ("walking", "c"),
        ("hiking", "d"),
        ("golf", "e"),
        (None, "f"),
    ]
    _seed(conn, rows)
    with conn.begin() as c:
        c.execute(sa.text(BACKUP))
        c.execute(sa.text(DELETE))
        backed = c.execute(
            sa.text("SELECT count(*) FROM _purged_activities_088")
        ).scalar()
        left = c.execute(sa.text("SELECT count(*) FROM activities")).scalar()
    assert backed + left == len(rows)
    assert left == 2, "cycling + strength survive"
    assert backed == 4, "walking, hiking, golf, null are backed up"


def test_backup_table_has_no_primary_key(conn):
    """CREATE TABLE AS SELECT * copies columns but NOT constraints.

    Pinned because the migration's restore depends on it: ``INSERT ...
    ON CONFLICT (id)`` needs a unique index on ``id`` to match against,
    and the backup table has none. The migration therefore adds one in
    its own right (see the test in test_migration_088_sport_purge.py) —
    without it the downgrade silently re-inserts duplicates.
    """
    _seed(conn, [("cycling", "a"), ("walking", "b")])
    with conn.begin() as c:
        c.execute(sa.text(BACKUP))
        cols = list(c.execute(sa.text("PRAGMA table_info(_purged_activities_088)")))
    pk_cols = [r[1] for r in cols if r[5]]
    assert pk_cols == [], (
        "CREATE TABLE AS drops the primary key; the migration must add one "
        "explicitly so ON CONFLICT (id) has something to match"
    )


def test_restore_puts_rows_back_without_duplicating(conn):
    """Downgrade's restore must be idempotent.

    Expressed as INSERT ... SELECT ... WHERE NOT EXISTS because SQLite
    has no ON CONFLICT. The migration uses the Postgres spelling; both
    rely on the same invariant — a row already present is skipped rather
    than duplicated.
    """
    _seed(conn, [("cycling", "a"), ("walking", "b")])
    restore = (
        "INSERT INTO activities (id, sport_type, name) "
        "SELECT id, sport_type, name FROM _purged_activities_088 b "
        "WHERE NOT EXISTS (SELECT 1 FROM activities a WHERE a.id = b.id)"
    )
    with conn.begin() as c:
        c.execute(sa.text(BACKUP))
        c.execute(sa.text(DELETE))
        c.execute(sa.text(restore))
        # Running it twice must not duplicate, and must not raise.
        c.execute(sa.text(restore))
        total = c.execute(sa.text("SELECT count(*) FROM activities")).scalar()
    assert total == 2, "restore is idempotent"
    assert sorted(_survivors(conn)) == ["cycling", "walking"]
