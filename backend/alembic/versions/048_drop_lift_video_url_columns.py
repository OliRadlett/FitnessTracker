"""Drop URL-mode columns from lift_videos (§1.1 follow-up).

URL embeds (YouTube/Vimeo) are removed now that R2 uploads are live. The table
holds no `url`-mode rows, so the columns drop cleanly.

Revision ID: 048
Revises: 047
Create Date: 2026-09-09
"""

import sqlalchemy as sa

from alembic import op

revision = "048"
down_revision = "047"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint("ck_lift_videos_source", "lift_videos", type_="check")
    op.drop_column("lift_videos", "source")
    op.drop_column("lift_videos", "external_url")


def downgrade() -> None:
    op.add_column("lift_videos", sa.Column("source", sa.String(20), nullable=True))
    op.add_column(
        "lift_videos", sa.Column("external_url", sa.String(2000), nullable=True)
    )
    op.execute("UPDATE lift_videos SET source = 'upload' WHERE source IS NULL")
    op.alter_column("lift_videos", "source", nullable=False)
    op.create_check_constraint(
        "ck_lift_videos_source", "lift_videos", "source IN ('upload', 'url')"
    )
