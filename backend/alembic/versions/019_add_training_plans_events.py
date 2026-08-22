"""add training plans, plan days, and events tables

Revision ID: 019
Revises: 018
Create Date: 2026-08-18
"""

from alembic import op

# revision identifiers
revision = "019"
down_revision = "018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS to be idempotent (tables may have been created by self-heal)

    # Training Plans
    op.execute("""
        CREATE TABLE IF NOT EXISTS training_plans (
            id UUID NOT NULL,
            user_id UUID NOT NULL,
            name VARCHAR(255) NOT NULL,
            description VARCHAR(1000),
            start_date DATE NOT NULL,
            end_date DATE NOT NULL,
            plan_type VARCHAR(50) DEFAULT 'custom' NOT NULL,
            status VARCHAR(20) DEFAULT 'draft' NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (id),
            CONSTRAINT fk_training_plans_user FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_training_plans_user_id ON training_plans (user_id)"
    )

    # Training Plan Days
    op.execute("""
        CREATE TABLE IF NOT EXISTS training_plan_days (
            id UUID NOT NULL,
            plan_id UUID NOT NULL,
            day_date DATE NOT NULL,
            planned_tss FLOAT,
            planned_duration_min INTEGER,
            planned_type VARCHAR(20) DEFAULT 'rest' NOT NULL,
            notes VARCHAR(500),
            activity_id UUID,
            completed BOOLEAN DEFAULT false NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (id),
            CONSTRAINT fk_tpd_plan FOREIGN KEY(plan_id) REFERENCES training_plans (id) ON DELETE CASCADE,
            CONSTRAINT fk_tpd_activity FOREIGN KEY(activity_id) REFERENCES activities (id) ON DELETE SET NULL
        )
    """)
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tpd_plan_id ON training_plan_days (plan_id)"
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tpd_day_date ON training_plan_days (day_date)"
    )

    # Events
    op.execute("""
        CREATE TABLE IF NOT EXISTS events (
            id UUID NOT NULL,
            user_id UUID NOT NULL,
            name VARCHAR(255) NOT NULL,
            event_date DATE NOT NULL,
            event_type VARCHAR(50) DEFAULT 'race' NOT NULL,
            target_tss FLOAT,
            taper_days INTEGER DEFAULT 14 NOT NULL,
            notes TEXT,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
            PRIMARY KEY (id),
            CONSTRAINT fk_events_user FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS ix_events_user_id ON events (user_id)")
    op.execute("CREATE INDEX IF NOT EXISTS ix_events_event_date ON events (event_date)")


def downgrade() -> None:
    op.drop_table("events")
    op.drop_table("training_plan_days")
    op.drop_table("training_plans")
