"""Add warmup_templates and warmup_template_steps tables

Revision ID: 002
Revises: 001
Create Date: 2026-08-16
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision: str = "002"
down_revision: Union[str, None] = "001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "warmup_templates",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("exercise_name", sa.String(255), nullable=True, index=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )

    op.create_table(
        "warmup_template_steps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("warmup_template_id", UUID(as_uuid=True), sa.ForeignKey("warmup_templates.id", ondelete="CASCADE"), nullable=False, index=True),
        sa.Column("step_number", sa.Integer, nullable=False),
        sa.Column("weight_kg", sa.Float, nullable=False),
        sa.Column("reps", sa.Integer, nullable=False),
        sa.Column("notes", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("warmup_template_steps")
    op.drop_table("warmup_templates")
