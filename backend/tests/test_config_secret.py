"""A default SECRET_KEY must not boot, even with DEBUG=true."""

from __future__ import annotations

import pytest

from app.config import _DEFAULT_SECRET_KEY, Settings


def test_default_secret_key_is_rejected_in_debug():
    with pytest.raises(ValueError, match="SECRET_KEY"):
        Settings(
            _env_file=None,
            secret_key=_DEFAULT_SECRET_KEY,
            debug=True,
            allow_insecure_defaults=False,
        )


def test_default_secret_key_requires_explicit_opt_in():
    settings = Settings(
        _env_file=None,
        secret_key=_DEFAULT_SECRET_KEY,
        debug=True,
        allow_insecure_defaults=True,
    )
    assert settings.secret_key == _DEFAULT_SECRET_KEY
