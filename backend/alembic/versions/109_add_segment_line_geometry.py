"""Store each segment line's own geometry for effort matching.

A ``SegmentGroup`` stores the canonical line's geometry for maps. The matcher
also needs every member line's geometry: a rider can take a 1,024 m detection
of a hill whose canonical detection is 896 m, and matching only the canonical
one rejected that real effort (87 % recall on the known prod set; all five
misses were this shape).

Additive, nullable. ``SegmentGroup.geometry`` is unchanged.

Revision ID: 109
Revises: 108
Create Date: 2026-11-05
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "109"
down_revision: str | Sequence[str] | None = "108"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "segments",
        sa.Column("geometry", postgresql.JSONB(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("segments", "geometry")
