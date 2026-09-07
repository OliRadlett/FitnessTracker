"""Schemas for per-user UI preferences (unit system, locale, time format)."""

from pydantic import BaseModel

UNIT_SYSTEMS = ("metric", "imperial")
LOCALES = ("en-GB", "en-US")
TIME_FORMATS = ("24h", "12h")


class UserPreferences(BaseModel):
    unit_system: str = "metric"
    locale: str = "en-GB"
    time_format: str = "24h"


class UserPreferencesUpdate(BaseModel):
    unit_system: str | None = None
    locale: str | None = None
    time_format: str | None = None
