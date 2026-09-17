"""Add form analysis, VBT, rest timing, consistency, setup, and RPE columns to lift_videos (§3.18).

Revision ID: 051
Revises: 050
Create Date: 2026-09-16
"""

import sqlalchemy as sa

from alembic import op

revision = "051"
down_revision = "050"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # IPF form scoring
    op.add_column("lift_videos", sa.Column("form_score", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("competition_valid", sa.Boolean(), nullable=True))
    op.add_column("lift_videos", sa.Column("form_analysis_json", sa.Text(), nullable=True))
    op.add_column("lift_videos", sa.Column("form_deviations", sa.Text(), nullable=True))
    op.add_column("lift_videos", sa.Column("form_coaching_cues", sa.Text(), nullable=True))

    # Velocity tracking
    op.add_column("lift_videos", sa.Column("mean_concentric_velocity", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("peak_velocity", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("velocity_loss_pct", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("velocity_profile_json", sa.Text(), nullable=True))
    op.add_column("lift_videos", sa.Column("vbt_zone", sa.String(50), nullable=True))

    # Rest timing
    op.add_column("lift_videos", sa.Column("rest_periods_json", sa.Text(), nullable=True))
    op.add_column("lift_videos", sa.Column("avg_rest_seconds", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("rest_cv", sa.Float(), nullable=True))

    # Consistency
    op.add_column("lift_videos", sa.Column("rep_consistency_score", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("tempo_consistency_cv", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("rep_timing_json", sa.Text(), nullable=True))

    # Setup analysis
    op.add_column("lift_videos", sa.Column("setup_score", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("setup_analysis_json", sa.Text(), nullable=True))
    op.add_column("lift_videos", sa.Column("setup_duration_seconds", sa.Float(), nullable=True))

    # Estimated RPE
    op.add_column("lift_videos", sa.Column("estimated_rpe", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("rpe_confidence", sa.Float(), nullable=True))
    op.add_column("lift_videos", sa.Column("rpe_evidence_json", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("lift_videos", "rpe_evidence_json")
    op.drop_column("lift_videos", "rpe_confidence")
    op.drop_column("lift_videos", "estimated_rpe")
    op.drop_column("lift_videos", "setup_duration_seconds")
    op.drop_column("lift_videos", "setup_analysis_json")
    op.drop_column("lift_videos", "setup_score")
    op.drop_column("lift_videos", "rep_timing_json")
    op.drop_column("lift_videos", "tempo_consistency_cv")
    op.drop_column("lift_videos", "rep_consistency_score")
    op.drop_column("lift_videos", "rest_cv")
    op.drop_column("lift_videos", "avg_rest_seconds")
    op.drop_column("lift_videos", "rest_periods_json")
    op.drop_column("lift_videos", "vbt_zone")
    op.drop_column("lift_videos", "velocity_profile_json")
    op.drop_column("lift_videos", "velocity_loss_pct")
    op.drop_column("lift_videos", "peak_velocity")
    op.drop_column("lift_videos", "mean_concentric_velocity")
    op.drop_column("lift_videos", "form_coaching_cues")
    op.drop_column("lift_videos", "form_deviations")
    op.drop_column("lift_videos", "form_analysis_json")
    op.drop_column("lift_videos", "competition_valid")
    op.drop_column("lift_videos", "form_score")
