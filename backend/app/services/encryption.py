"""Transparent Fernet encryption for OAuth tokens at rest.

Uses Fernet symmetric encryption with a key derived from ``settings.secret_key``.
The ``EncryptedString`` TypeDecorator can be used as a drop-in replacement for
``String`` columns so that encryption/decryption happens automatically at the
SQLAlchemy layer — no service code changes required.
"""

from __future__ import annotations

import base64
import logging

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.types import String, TypeDecorator

from app.config import get_settings

logger = logging.getLogger(__name__)

# ── Fernet key (module-level, lazily built) ──────────────────────────────────

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    """Return a singleton Fernet instance derived from the app secret key."""
    global _fernet
    if _fernet is None:
        import hashlib

        settings = get_settings()
        # Derive a 32-byte key via SHA-256 for consistent entropy regardless of
        # input length (BUG-011: replaces truncation + '=' padding).
        raw = hashlib.sha256(settings.secret_key.encode("utf-8")).digest()
        _fernet = Fernet(base64.urlsafe_b64encode(raw))
    return _fernet


# ── Public helpers ───────────────────────────────────────────────────────────


def encrypt_token(plaintext: str) -> str:
    """Encrypt a plaintext token and return a Fernet ciphertext string."""
    return _get_fernet().encrypt(plaintext.encode()).decode()


def decrypt_token(ciphertext: str) -> str:
    """Decrypt a Fernet ciphertext string and return the plaintext token.

    If *ciphertext* is not valid Fernet data (e.g. a pre-encryption value or a
    sentinel like ``"nextauth_managed"``), the raw value is returned unchanged.
    This makes the function safe to call during the migration window when both
    encrypted and plain-text rows may coexist.
    """
    try:
        return _get_fernet().decrypt(ciphertext.encode()).decode()
    except (InvalidToken, Exception):
        # Not valid Fernet — return as-is (backward compat / sentinel values)
        return ciphertext


# ── SQLAlchemy TypeDecorator ─────────────────────────────────────────────────


class EncryptedString(TypeDecorator):
    """A ``String`` column that transparently encrypts on write and decrypts on
    read using Fernet symmetric encryption.

    Usage in a model::

        access_token: Mapped[str] = mapped_column(EncryptedString(1024), nullable=False)

    All existing service code that reads/writes the column continues to work
    without changes — the encryption layer is fully transparent.
    """

    impl = String
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect) -> str | None:
        """Encrypt before writing to the database."""
        if value is not None:
            return encrypt_token(value)
        return value

    def process_result_value(self, value: str | None, dialect) -> str | None:
        """Decrypt when reading from the database."""
        if value is not None:
            return decrypt_token(value)
        return value
