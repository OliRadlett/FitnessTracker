"""Which sports FitTrack ingests, decided in one place.

Every provider maps its own vocabulary into ``Activity.sport_type`` --
Strava sends ``"Walk"``, Wahoo sends an integer ``workout_type_id``, Whoop
sends its own names -- and each has always mapped everything it recognises
into the database. The set of sports to accept is a policy decision, not a
per-provider detail, so it lives here and every ingestion path asks this
module.

Config
------
``ALLOWED_SPORT_TYPES`` is a comma-separated list on ``Settings``, e.g.
``"cycling,strength"``. It is a setting rather than a constant so sports
can be added later without a deploy. An **empty** value means "allow
everything", which is the safe default for a misconfigured or unset
variable: silently ingesting nothing would look like a broken dashboard
with no hint that a config value was responsible.

The purge in migration 088 states the same policy as a SQL literal
(``sport_type NOT IN ('cycling','strength')``). That duplication is
deliberate -- a migration must behave identically on every replay, so it
cannot read mutable config -- but the two must be changed together.
"""

from __future__ import annotations

import logging

from app.config import get_settings

logger = logging.getLogger(__name__)


def allowed_sport_types() -> frozenset[str]:
    """The configured allowlist, lowercased. Empty set means "allow all"."""
    raw = get_settings().allowed_sport_types
    return frozenset(part.strip().lower() for part in raw.split(",") if part.strip())


def is_allowed_sport(sport_type: str | None) -> bool:
    """Whether an activity of this sport should be ingested.

    An empty allowlist allows everything, including ``None``. A configured
    allowlist rejects ``None``: providers do occasionally send a type we
    cannot map, and letting an unmapped value through would admit unknown
    sports unfiltered.
    """
    allowed = allowed_sport_types()
    if not allowed:
        return True
    if sport_type is None:
        return False
    return sport_type.strip().lower() in allowed
