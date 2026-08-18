"""add goals table

Revision ID: 018
Revises: 017
Create Date: 2026-08-18
"""

from alembic import op

# revision identifiers
revision = "018"
down_revision = "017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS to be idempotent (table may have been created by self-heal)
    op.execute("""
        CREATE TABLE IF NOT EXISTS goals (
            id UUID NOT NULL,
            user_id UUID NOT NULL,
            goal_type VARCHAR(50) NOT NULL,
            target_value FLOAT NOT NULL,
            current_value FLOAT,
            target_date DATE,
            status VARCHAR(20) DEFAULT 'active' NOT NULL,
            notes VARCHAR(500),
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (id),
            CONSTRAINT fk_goals_user FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_goals_user_id ON goals (user_id)")


def downgrade() -> None:
    op.drop_table("goals")
