"""User UI preferences — unit system, locale, time format.

Stored in the `User.preferences` JSONB column (NULL = defaults).
Same pattern as `services/notifications.py` for notification toggles.
"""

from app.models.user import User
from app.schemas.preferences import (
    LOCALES,
    NUMERIC_PREFERENCES,
    TIME_FORMATS,
    UNIT_SYSTEMS,
    UserPreferences,
)

DEFAULT_PREFERENCES: dict[str, object] = {
    "unit_system": "metric",
    "locale": "en-GB",
    "time_format": "24h",
    "height_cm": None,
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
    db, user: User, updates: dict[str, object]
) -> UserPreferences:
    """Apply partial preference updates (validated per-field) and return the result.

    Strings are checked against their allowed set, numerics against their
    ``NUMERIC_PREFERENCES`` bounds. ``None`` means "not provided" (there is no
    way to clear a value back to its default) — matching the existing UI-pref
    contract.
    """
    stored = user.preferences or {}
    for key, value in updates.items():
        if value is None:
            continue
        if key in _VALID:
            if value not in _VALID[key]:
                raise ValueError(
                    f"Invalid {key!r}: {value!r} (expected one of {_VALID[key]})"
                )
        elif key in NUMERIC_PREFERENCES:
            lo, hi = NUMERIC_PREFERENCES[key]
            if not isinstance(value, int | float) or not lo <= float(value) <= hi:
                raise ValueError(
                    f"Invalid {key!r}: {value!r} (expected a number "
                    f"between {lo} and {hi})"
                )
            value = float(value)
        else:
            continue
        stored[key] = value
    user.preferences = stored
    await db.flush()
    return get_preferences(user)
