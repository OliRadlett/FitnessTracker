"""Reconcile ``lift_video_analyses`` with the model.

Production's table predates the current column set: it has ``sample_count``
and ``trend_data`` where the model declares ``video_count`` and the three
``*_trend`` text columns. Any query of the model therefore raised
``UndefinedColumnError``, which aborted the enclosing transaction and took
down whatever ran next in it — the form-quality section of the deficiency
dashboard was failing on every load and the follow-on training-plan query
failed with ``InFailedSQLTransactionError``.

The cause is the same class of drift as the 087 incident, one level down.
Migration 053 creates exactly the columns the model declares, and has
only ever had one revision of itself. But the live table is missing 053's
unique index ``ix_lift_video_analyses_user_exercise`` and has only the
three auto-generated ones — so this table was built by ``create_all()``
against an earlier model, and alembic subsequently stamped 053 without
applying it. 053 believes it created this table; it did not.

Fix: make the database match the model, forward. The table is empty on
production, so the rename is free, but it is written to be correct with
data too — the old columns are carried across rather than dropped and
recreated, so a populated database keeps its rows.

Not ``ALTER TABLE ... RENAME``: ``sample_count`` and ``video_count`` hold
the same thing, but ``trend_data`` (a single JSON-ish column) has no
one-to-one counterpart among the three ``*_trend`` text columns, so it
cannot be split. It is left in place as an orphan rather than dropped,
and the new columns start NULL.

Revision ID: 090
Revises: 089
Create Date: 2026-09-30
"""

import sqlalchemy as sa

from alembic import op

revision = "090"
down_revision = "089"
branch_labels = None
depends_on = None

# model column -> (type, nullable, server_default)
_ADDITIONS = [
    ("video_count", sa.Integer(), False, "0"),
    ("form_trend", sa.Text(), True, None),
    ("velocity_trend", sa.Text(), True, None),
    ("consistency_trend", sa.Text(), True, None),
    ("analyzed_at", sa.DateTime(timezone=True), True, None),
]

# Present in the model, absent from the stale production table.
_MISSING = [
    "avg_velocity",
    "avg_consistency",
    "avg_rpe_accuracy",
]

# 053's unique index, missing because the table came from create_all().
_UNIQUE_INDEX = "ix_lift_video_analyses_user_exercise"


def _columns() -> set[str]:
    return {
        row[0]
        for row in op.get_bind()
        .execute(
            sa.text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name = 'lift_video_analyses'"
            )
        )
    }


def _has_index(name: str) -> bool:
    return (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT 1 FROM pg_indexes WHERE tablename='lift_video_analyses' "
                "AND indexname = :name"
            ),
            {"name": name},
        )
        .first()
        is not None
    )


def upgrade() -> None:
    existing = _columns()

    for name in _MISSING:
        if name in existing:
            continue
        op.add_column("lift_video_analyses", sa.Column(name, sa.Float(), nullable=True))

    for name, type_, nullable, default in _ADDITIONS:
        if name in existing:
            continue
        op.add_column(
            "lift_video_analyses",
            sa.Column(name, type_, nullable=nullable, server_default=default),
        )

    # A pre-existing table with rows would otherwise leave video_count at the
    # server default of 0, which is right; but a NOT NULL add on a non-empty
    # table needs the default applied to existing rows first. Postgres does
    # that for us when server_default is set, so nothing more is needed here.

    if not _has_index(_UNIQUE_INDEX):
        # Only safe because the (user_id, exercise_name) pairs are unique in
        # practice. On a table with duplicate pairs this would fail loudly
        # rather than silently dropping a row, which is the intended
        # behaviour — but check first so the failure is legible.
        dupes = (
            op.get_bind()
            .execute(
                sa.text(
                    "SELECT count(*) FROM ("
                    " SELECT user_id, exercise_name FROM lift_video_analyses"
                    " GROUP BY user_id, exercise_name HAVING count(*) > 1"
                    ") d"
                )
            )
            .scalar()
        )
        if dupes:
            raise RuntimeError(
                f"cannot create {_UNIQUE_INDEX}: {dupes} duplicate "
                "(user_id, exercise_name) pair(s). De-duplicate first."
            )
        op.create_index(
            _UNIQUE_INDEX,
            "lift_video_analyses",
            ["user_id", "exercise_name"],
            unique=True,
        )


def downgrade() -> None:
    if _has_index(_UNIQUE_INDEX):
        op.drop_index(_UNIQUE_INDEX, table_name="lift_video_analyses")
    for name, type_, nullable, default in _ADDITIONS:
        if name in _columns():
            op.drop_column("lift_video_analyses", name)
    for name in _MISSING:
        if name in _columns():
            op.drop_column("lift_video_analyses", name)
