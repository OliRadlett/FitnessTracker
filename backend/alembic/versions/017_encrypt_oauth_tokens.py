"""encrypt oauth tokens at rest

Revision ID: 017
Revises: 016
Create Date: 2026-08-18
"""

import sqlalchemy as sa

from alembic import op

# revision identifiers
revision = "017"
down_revision = "016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1. Add idempotency flag columns (default False)
    op.add_column(
        "oauth_connections",
        sa.Column("access_token_encrypted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )
    op.add_column(
        "oauth_connections",
        sa.Column("refresh_token_encrypted", sa.Boolean(), nullable=False, server_default=sa.text("false")),
    )

    # 2. Encrypt existing plain-text tokens in-place.
    #    Import the encrypt helper; uses the same Fernet key as the app.
    from app.services.encryption import encrypt_token

    conn = op.get_bind()

    # Encrypt access_token where not already encrypted
    rows = conn.execute(
        sa.text("SELECT id, access_token FROM oauth_connections WHERE access_token_encrypted = false")
    ).fetchall()
    for row_id, token in rows:
        if token:
            encrypted = encrypt_token(token)
            conn.execute(
                sa.text("UPDATE oauth_connections SET access_token = :enc, access_token_encrypted = true WHERE id = :id"),
                {"enc": encrypted, "id": row_id},
            )

    # Encrypt refresh_token where not already encrypted
    rows = conn.execute(
        sa.text("SELECT id, refresh_token FROM oauth_connections WHERE refresh_token_encrypted = false AND refresh_token IS NOT NULL")
    ).fetchall()
    for row_id, token in rows:
        if token:
            encrypted = encrypt_token(token)
            conn.execute(
                sa.text("UPDATE oauth_connections SET refresh_token = :enc, refresh_token_encrypted = true WHERE id = :id"),
                {"enc": encrypted, "id": row_id},
            )

    # 3. Mark all rows as encrypted (catch any stragglers)
    conn.execute(sa.text("UPDATE oauth_connections SET access_token_encrypted = true WHERE access_token_encrypted = false"))
    conn.execute(sa.text("UPDATE oauth_connections SET refresh_token_encrypted = true WHERE refresh_token_encrypted = false"))


def downgrade() -> None:
    # Decrypt tokens back to plain text (best-effort)
    from app.services.encryption import decrypt_token

    conn = op.get_bind()

    rows = conn.execute(
        sa.text("SELECT id, access_token FROM oauth_connections WHERE access_token_encrypted = true")
    ).fetchall()
    for row_id, token in rows:
        if token:
            plain = decrypt_token(token)
            conn.execute(
                sa.text("UPDATE oauth_connections SET access_token = :plain, access_token_encrypted = false WHERE id = :id"),
                {"plain": plain, "id": row_id},
            )

    rows = conn.execute(
        sa.text("SELECT id, refresh_token FROM oauth_connections WHERE refresh_token_encrypted = true AND refresh_token IS NOT NULL")
    ).fetchall()
    for row_id, token in rows:
        if token:
            plain = decrypt_token(token)
            conn.execute(
                sa.text("UPDATE oauth_connections SET refresh_token = :plain, refresh_token_encrypted = false WHERE id = :id"),
                {"plain": plain, "id": row_id},
            )

    op.drop_column("oauth_connections", "access_token_encrypted")
    op.drop_column("oauth_connections", "refresh_token_encrypted")
