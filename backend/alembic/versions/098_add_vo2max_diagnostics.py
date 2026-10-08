"""Persist personalized-VO2max fit diagnostics on ``cycling_profiles``.

Only ``personalized_vo2max`` (the number) persisted, so a stamped value
whose regression was noise — or whose FRIEND input was threshold rather
than maximal power (prod: 26.5 ml/kg/min at CP 229W / 90.4kg) — was
indistinguishable from a good one. The fitter now reports method,
regression R², points used, HR anchor, and the maximal watts FRIEND was
applied to, and the scheduler stores them here.

Nullable and additive, so no backfill is needed for correctness: existing
rows read as NULL (fitted before diagnostics existed) and the weekly power
task fills them on its next run.

Dialect note: ``sa.String`` / ``sa.Float`` / ``sa.Integer`` are all exported
at SQLAlchemy top level, so the pitfall-22 ``sa.JSONB`` trap does not apply
(``tests/test_migration_dialect_types.py`` still covers this revision).

Revision ID: 098
Revises: 097
Create Date: 2026-10-08
"""

import sqlalchemy as sa

from alembic import op

revision = "098"
down_revision = "097"
branch_labels = None
depends_on = None

# (column name, column factory) — introspected by
# ``tests/test_migration_098_vo2max_diagnostics.py`` so the migration and the
# model cannot drift (pitfall 24).
_ADDITIONS = [
    ("personalized_vo2max_method", lambda: sa.Column("personalized_vo2max_method", sa.String(40), nullable=True)),
    ("personalized_vo2max_r_squared", lambda: sa.Column("personalized_vo2max_r_squared", sa.Float(), nullable=True)),
    ("personalized_vo2max_data_points", lambda: sa.Column("personalized_vo2max_data_points", sa.Integer(), nullable=True)),
    ("personalized_vo2max_hr_threshold", lambda: sa.Column("personalized_vo2max_hr_threshold", sa.Float(), nullable=True)),
    ("personalized_vo2max_maximal_watts", lambda: sa.Column("personalized_vo2max_maximal_watts", sa.Float(), nullable=True)),
]


def upgrade() -> None:
    for _name, factory in _ADDITIONS:
        op.add_column("cycling_profiles", factory())


def downgrade() -> None:
    for name, _factory in reversed(_ADDITIONS):
        op.drop_column("cycling_profiles", name)
