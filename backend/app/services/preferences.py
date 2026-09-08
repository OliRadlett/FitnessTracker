"""User UI preferences — unit system, locale, time format.

Stored in the `User.preferences` JSONB column (NULL = defaults).
Same pattern as `services/notifications.py` for notification toggles.
"""

from app.models.user import User
from app.schemas.preferences import (
    LOCALES,
    TIME_FORMATS,
    UNIT_SYSTEMS,
    UserPreferences,
)

DEFAULT_PREFERENCES: dict[str, str] = {
    "unit_system": "metric",
    "locale": "en-GB",
    "time_format": "24h",
}

_VALID: dict[str, tuple[str, ...]] = {
    "unit_system": UNIT_SYSTEMS,
    "locale": LOCALES,
    "time_format": TIME_FORMATS,
}


def get_preferences(user: User) -> UserPreferences:
    """Return the effective UI preferences for a user (defaults merged)."""
    stored = user.preferences or {}
    merged = {
        **DEFAULT_PREFERENCES,
        **{k: v for k, v in stored.items() if k in DEFAULT_PREFERENCES},
    }
    return UserPreferences(**merged)


async def set_preferences(
    db, user: User, updates: dict[str, str | None]
) -> UserPreferences:
    """Apply partial preference updates (validated per-field) and return the result."""
    stored = user.preferences or {}
    for key, value in updates.items():
        if value is None or key not in _VALID:
            continue
        if value not in _VALID[key]:
            raise ValueError(
                f"Invalid {key!r}: {value!r} (expected one of {_VALID[key]})"
            )
        stored[key] = value
    user.preferences = stored
    await db.flush()
    return get_preferences(user)
