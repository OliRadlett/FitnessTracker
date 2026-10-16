"""Schemas for the Wahoo zone-sync status/push surface.

Shaped around what the card has to *show*, not around Wahoo's wire format: the
local zones, the Wahoo side, and the difference between them. Wahoo's own records
are exposed raw-ish (``WahooPowerZoneSet``) because the whole point of Phase 1 is
that we can see what the API actually returns, including for sets we did not write.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel

HR_UNAVAILABLE_NOTE = (
    "Wahoo does not expose heart rate zones through its Cloud API — there is no "
    "heart_rate_zones endpoint and no matching OAuth scope, and user_write can only "
    "carry profile fields. Your HR zones are set from a Threshold Heart Rate in the "
    "Wahoo app; keep the THR values in step manually."
)


class LocalZoneBoundary(BaseModel):
    """One zone of a FitTrack zone model, in its own units (W or bpm)."""

    zone: str
    zone_name: str
    lower: float
    upper: float | None = None


class LocalZoneSet(BaseModel):
    """What FitTrack currently believes, for one zone kind."""

    zone_kind: str  # "power" | "heart_rate"
    anchor_kind: str  # "ftp" | "lthr"
    anchor_value: float | None = None
    zones: list[LocalZoneBoundary] = []


class WahooPowerZoneSet(BaseModel):
    """A power zone set as Wahoo returns it. Deliberately faithful, not tidied."""

    id: int
    workout_type_family_id: int | None = None
    workout_type_location_id: int | None = None
    ftp: float | None = None
    zone_count: int | None = None
    zones: list[float] = []
    fitness_app_id: int | None = None
    # The wire field is `originator_type_id` — reading `originator_type` silently
    # yielded None for every set, which the probe caught (plans/wahoo-zone-sync.md
    # §3.4). Surfaced for display only; policy never reads it, because the probe's
    # single sample (1 on a set we created, against the docs' 0) is not a vocabulary.
    originator_type_id: int | None = None
    # "ours" | "platform" | "third_party" | "unknown" — see `set_provenance` in
    # services/wahoo_zones.py. Four values rather than a boolean because "not the
    # Wahoo app" covers three situations that want different handling, and our own
    # app's sets sit above the third-party floor too (fitness_app_id 3587).
    provenance: str | None = None
    updated_at: datetime | None = None


class WahooZoneSetTracked(BaseModel):
    """Our bookkeeping row for a set we have written to."""

    id: uuid.UUID
    zone_kind: str
    workout_type_family_id: int
    workout_type_location_id: int
    wahoo_zone_set_id: int | None = None
    anchor_value: float | None = None
    boundaries: dict | None = None
    has_prior: bool = False
    pushed_at: datetime | None = None
    last_error: str | None = None

    model_config = {"from_attributes": True}


class ZoneDrift(BaseModel):
    """Local vs Wahoo anchor for one set. ``delta`` is ``wahoo - local``."""

    zone_kind: str
    workout_type_location_id: int | None = None
    wahoo_zone_set_id: int | None = None
    local_anchor: float | None = None
    wahoo_anchor: float | None = None
    delta: float | None = None


class WahooZoneSkipped(BaseModel):
    """A set we deliberately did not write to, and why."""

    id: int
    reason: str


class WahooZonesPushResult(BaseModel):
    """Outcome of a push. Reports silences, not just successes."""

    ftp: float | None = None
    updated: list[int] = []
    created: list[int] = []
    skipped: list[WahooZoneSkipped] = []
    # Sets owned by another third-party app, which we refuse to fight over.
    foreign: list[int] = []
    # Set when nothing was attempted at all, e.g. the athlete opted out.
    reason: str | None = None


class WahooZonesRevertResult(BaseModel):
    anchor_value: float | None = None
    reverted: list[int] = []
    missing: list[int] = []


class WahooZonesStatus(BaseModel):
    connected: bool
    connection_status: str | None = None
    opt_in: bool = False
    can_write: bool = False
    hr_write_supported: bool = False
    hr_note: str = HR_UNAVAILABLE_NOTE
    local_sets: list[LocalZoneSet] = []
    wahoo_sets: list[WahooPowerZoneSet] = []
    tracked: list[WahooZoneSetTracked] = []
    drift: list[ZoneDrift] = []
    error_code: str | None = None
    error: str | None = None
