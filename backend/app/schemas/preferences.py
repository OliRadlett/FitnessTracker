"""Schemas for per-user UI preferences (unit system, locale, time format).

Also holds `height_cm` — the lifter's height, the metric anchor for 3D video
analysis (`plans/bar-tracking-3d.md`): MediaPipe's world landmarks are metric but
scaled by an average-body prior, so a real height is needed for honest metres.

The camera focal is deliberately **not** here — it varies per clip (different
lenses), so it is detected from each video's metadata instead
(`app/services/video_camera.py`).
"""

from pydantic import BaseModel

UNIT_SYSTEMS = ("metric", "imperial")
LOCALES = ("en-GB", "en-US")
TIME_FORMATS = ("24h", "12h")

# Numeric preferences: key -> (min, max) inclusive bounds.
NUMERIC_PREFERENCES = {
    "height_cm": (50.0, 260.0),
}


class UserPreferences(BaseModel):
    unit_system: str = "metric"
    locale: str = "en-GB"
    time_format: str = "24h"
    height_cm: float | None = None


class UserPreferencesUpdate(BaseModel):
    unit_system: str | None = None
    locale: str | None = None
    time_format: str | None = None
    height_cm: float | None = None
