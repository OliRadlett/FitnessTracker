"""add_analysis_type_and_event_id_to_llm_analyses

Revision ID: 023
Revises: 022
Create Date: 2026-08-21
"""

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision = "023"
down_revision = "022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add analysis_type column with default 'cycling'
    op.add_column(
        "llm_analyses",
        sa.Column(
            "analysis_type",
            sa.String(30),
            nullable=False,
            server_default="cycling",
        ),
    )
    op.create_index(
        "ix_llm_analyses_analysis_type",
        "llm_analyses",
        ["analysis_type"],
    )

    # Add event_id FK
    op.add_column(
        "llm_analyses",
        sa.Column(
            "event_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("events.id", ondelete="CASCADE"),
            nullable=True,
            index=True,
        ),
    )


def downgrade() -> None:
    op.drop_column("llm_analyses", "event_id")
    op.drop_index("ix_llm_analyses_analysis_type", table_name="llm_analyses")
    op.drop_column("llm_analyses", "analysis_type")
