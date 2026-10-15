"""Read the athlete's Wahoo zone sets and compare them with FitTrack's.

Why this exists: the weekly FTP auto-estimate has always moved FTP silently, and an
ELEMNT keeps colouring the live zone against whatever anchor it was told last — so
the charts and the head unit disagree until the athlete re-enters FTP by hand. Pushed
structured workouts inherit the problem, because ``wahoo_plan_file`` emits targets as
*fractions* of FTP and the device resolves those against **its own** FTP.

What Wahoo models (support docs + Cloud API, 2026-10-15 — see
``plans/wahoo-zone-sync.md`` §3.3): **one anchor plus derived boundaries per sport
profile**. Power sets anchor on FTP, heart-rate sets on THR, and both allow
per-zone lower-threshold overrides. A sync is therefore "write the anchor, and
rescale the boundaries the athlete already has" — *not* "impose FitTrack's zone
model", which would silently reshuffle the colours they train by (our Coggan power
bands and our 80/89/95/105 %LTHR bands do not match Wahoo's published ones).

Two constraints shape what is deliberately absent here:

* **HR zones are read-only by absence.** Wahoo's Cloud API exposes no
  ``heart_rate_zones`` resource and no matching OAuth scope, and ``user_write``
  carries only profile fields (first/last/birth/gender/height/weight). There is
  nothing to write to, so the card says so instead of offering controls that cannot
  work.
* **The write path is not in this module yet, on purpose.** Phase 1 is read-only:
  the shape of a real account's sets — how many exist, which family/location they
  carry, who created them, and whether ``GET /v1/power_zones`` even returns sets the
  Wahoo app owns — is exactly what §11 of the plan sets out to learn. Encoding a
  write policy before that evidence exists would bake in a guess; the plan's
  "never overwrite the Wahoo-app set" rule in particular is an *unverified* guess
  that the read path is meant to test, since that set is the one the head unit most
  likely uses.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.errors import PermanentAuthError, TransientSyncError
from app.integrations.wahoo_client import (
    WAHOO_FAMILY_BIKING,
    wahoo_client,
)
from app.models.cycling import CyclingProfile
from app.models.wahoo_zones import WahooZoneSet
from app.schemas.wahoo_zones import (
    LocalZoneBoundary,
    LocalZoneSet,
    WahooPowerZoneSet,
    WahooZoneSetTracked,
    WahooZonesStatus,
    ZoneDrift,
)
from app.services.connection_health import CONNECTION_STATUS_NEEDS_REAUTH
from app.services.cycling.zones import LTHR_HR_ZONES, POWER_ZONES
from app.services.wahoo import get_wahoo_connection, refresh_if_needed

logger = logging.getLogger(__name__)

ZONE_KIND_POWER = "power"
ZONE_KIND_HEART_RATE = "heart_rate"

# Wahoo returns decimals as *strings* and marks third-party app records with
# ``fitness_app_id > 1000`` (< 1000 = a Wahoo app). Both facts are load-bearing:
# the first means never `float(value)` blindly, the second is the only provenance
# signal available for deciding whose set we are looking at.
WAHOO_THIRD_PARTY_APP_ID_FLOOR = 1000

# The upper bound of the top zone in our models is a sentinel ("this goes on"), not
# a real ceiling: POWER_ZONES ends at 5.0 × FTP and LTHR_HR_ZONES at 5.0 × LTHR.
# Render those as open-ended rather than multiplying them into absurd watts/bpm.
_OPEN_ENDED_SENTINEL = 5.0

# Phase 1 ships read-only; the write path (plan Phase 2) flips this. Gating
# ``can_write`` on it means the API cannot advertise a capability that has no
# implementation behind it yet.
WRITE_PATH_IMPLEMENTED = False


class WahooZoneError(Exception):
    """Actionable error from a Wahoo zone operation.

    Mirrors :class:`app.services.wahoo_push.WahooPushError` so the endpoint layer
    can translate it into a status code without knowing which Wahoo feature raised
    it.
    """

    def __init__(self, message: str, status_code: int = 400, code: str = "zone_failed"):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


# ── Pure helpers ─────────────────────────────────────────────────────────────


def as_float(value: Any) -> float | None:
    """Coerce a Wahoo numeric field, which may arrive as a string.

    The docs are explicit that decimal fields come back as strings, so a bare
    ``float(value)`` would raise on a perfectly valid response. Booleans are
    rejected deliberately — ``float(True) == 1.0`` would silently turn a stray flag
    into a zone boundary.
    """
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def as_int(value: Any) -> int | None:
    number = as_float(value)
    return int(number) if number is not None else None


def zone_values(zone_set: dict) -> list[float]:
    """A set's boundary values in order (``zone_1`` … ``zone_7``).

    Absent slots are skipped rather than defaulted, so a set with fewer zones
    yields a shorter list instead of a run of zeros.

    The *convention* of ``zone_N`` is not documented — Wahoo's own example sends
    ``zone_1`` … ``zone_7`` alongside ``zone_count=8`` — so callers must treat these
    as "the boundary numbers, in order" and never assume lower-bound semantics.
    """
    values: list[float] = []
    for index in range(1, 8):
        value = as_float(zone_set.get(f"zone_{index}"))
        if value is not None:
            values.append(value)
    return values


def anchor_from_zone_set(zone_set: dict, zone_kind: str) -> float | None:
    """The anchor a set is built around: FTP for power, THR for heart rate."""
    key = "thr" if zone_kind == ZONE_KIND_HEART_RATE else "ftp"
    return as_float(zone_set.get(key))


def is_third_party_zone_set(zone_set: dict) -> bool | None:
    """Whether a set was created by a third-party app.

    ``None`` means "cannot tell" (no ``fitness_app_id`` in the payload) and is
    deliberately distinct from ``False``: a policy that treats unknown as "ours"
    would overwrite whatever it could not identify.

    ``originator_type`` is ignored on purpose — its values are undocumented, and a
    guess dressed as provenance is worse than the one signal that is documented.
    """
    app_id = as_int(zone_set.get("fitness_app_id"))
    if app_id is None:
        return None
    return app_id > WAHOO_THIRD_PARTY_APP_ID_FLOOR


def _boundary_rows(
    zones: list[tuple[str, str, float, float]], anchor: float
) -> list[LocalZoneBoundary]:
    rows: list[LocalZoneBoundary] = []
    for zone_id, zone_name, lower_pct, upper_pct in zones:
        rows.append(
            LocalZoneBoundary(
                zone=zone_id,
                zone_name=zone_name,
                lower=round(anchor * lower_pct),
                upper=(
                    None
                    if upper_pct >= _OPEN_ENDED_SENTINEL
                    else round(anchor * upper_pct)
                ),
            )
        )
    return rows


def local_zone_sets(profile: CyclingProfile | None) -> list[LocalZoneSet]:
    """FitTrack's own power + HR zones for the card, in each model's own units.

    Empty zone lists (rather than absent entries) when an anchor is missing, so the
    UI can distinguish "no FTP set" from "feature unavailable".
    """
    ftp = profile.ftp_watts if profile else None
    lthr = profile.lactate_threshold_hr if profile else None

    power = LocalZoneSet(
        zone_kind=ZONE_KIND_POWER,
        anchor_kind="ftp",
        anchor_value=ftp,
        zones=_boundary_rows(POWER_ZONES, ftp) if ftp else [],
    )
    heart_rate = LocalZoneSet(
        zone_kind=ZONE_KIND_HEART_RATE,
        anchor_kind="lthr",
        anchor_value=lthr,
        zones=_boundary_rows(LTHR_HR_ZONES, lthr) if lthr else [],
    )
    return [power, heart_rate]


def compute_drift(local_anchor: float | None, wahoo_anchor: float | None) -> float | None:
    """``wahoo - local``: positive means the head unit is set *higher* than us.

    Signed rather than absolute because the direction is the actionable part — "your
    device is 18 W behind" and "your device is 18 W ahead" want different copy.
    """
    if local_anchor is None or wahoo_anchor is None:
        return None
    return round(wahoo_anchor - local_anchor, 1)


def describe_zone_sets(sets: list[dict]) -> list[WahooPowerZoneSet]:
    """Normalise Wahoo's raw power-zone records for both display and legibility."""
    described: list[WahooPowerZoneSet] = []
    for zone_set in sets:
        set_id = as_int(zone_set.get("id"))
        if set_id is None:
            # A set with no id cannot be referenced or updated; surfacing it would
            # only invite the UI to offer an action that cannot be addressed.
            logger.warning("Wahoo returned a power zone set with no id: %s", zone_set)
            continue
        described.append(
            WahooPowerZoneSet(
                id=set_id,
                workout_type_family_id=as_int(zone_set.get("workout_type_family_id")),
                workout_type_location_id=as_int(
                    zone_set.get("workout_type_location_id")
                ),
                ftp=anchor_from_zone_set(zone_set, ZONE_KIND_POWER),
                zone_count=as_int(zone_set.get("zone_count")),
                zones=zone_values(zone_set),
                fitness_app_id=as_int(zone_set.get("fitness_app_id")),
                originator_type=as_int(zone_set.get("originator_type")),
                third_party=is_third_party_zone_set(zone_set),
            )
        )
    return described


# ── Read path ────────────────────────────────────────────────────────────────


async def _load_profile(
    db: AsyncSession, user_id: uuid.UUID
) -> CyclingProfile | None:
    result = await db.execute(
        select(CyclingProfile).where(CyclingProfile.user_id == user_id)
    )
    return result.scalar_one_or_none()


async def _load_tracked(
    db: AsyncSession, user_id: uuid.UUID
) -> list[WahooZoneSetTracked]:
    result = await db.execute(
        select(WahooZoneSet)
        .where(WahooZoneSet.user_id == user_id)
        .order_by(
            WahooZoneSet.zone_kind,
            WahooZoneSet.workout_type_family_id,
            WahooZoneSet.workout_type_location_id,
        )
    )
    rows = []
    for tracked in result.scalars().all():
        rows.append(
            WahooZoneSetTracked(
                id=tracked.id,
                zone_kind=tracked.zone_kind,
                workout_type_family_id=tracked.workout_type_family_id,
                workout_type_location_id=tracked.workout_type_location_id,
                wahoo_zone_set_id=tracked.wahoo_zone_set_id,
                anchor_value=tracked.anchor_value,
                boundaries=tracked.boundaries,
                # `prior is not None` rather than a truthiness check: an empty dict
                # snapshot is still a snapshot, and JSONB `null` reads back as None.
                has_prior=tracked.prior is not None,
                pushed_at=tracked.pushed_at,
                last_error=tracked.last_error,
            )
        )
    return rows


def _drift_rows(
    state: list[LocalZoneSet], wahoo_sets: list[WahooPowerZoneSet]
) -> list[ZoneDrift]:
    """Drift for the sets that are *about* cycling power.

    A running or swimming power set carries its own FTP, so comparing it with the
    athlete's cycling FTP would invent a drift that is not there. An unattributed
    set (no family) is kept: the field is always present in the documented payload,
    so a missing one is odd rather than evidence of another sport.
    """
    power_local = next(
        (s.anchor_value for s in state if s.zone_kind == ZONE_KIND_POWER), None
    )
    rows: list[ZoneDrift] = []
    for zone_set in wahoo_sets:
        if zone_set.workout_type_family_id not in (None, WAHOO_FAMILY_BIKING):
            continue
        rows.append(
            ZoneDrift(
                zone_kind=ZONE_KIND_POWER,
                workout_type_location_id=zone_set.workout_type_location_id,
                wahoo_zone_set_id=zone_set.id,
                local_anchor=power_local,
                wahoo_anchor=zone_set.ftp,
                delta=compute_drift(power_local, zone_set.ftp),
            )
        )
    return rows


async def read_wahoo_zones(db: AsyncSession, user_id: uuid.UUID) -> WahooZonesStatus:
    """Build the card's payload. Never raises for a Wahoo-side problem.

    Degrades per-component (an unavailable Wahoo read still returns the local zones
    and the reason) so the card can always render something true.
    """
    profile = await _load_profile(db, user_id)
    state = local_zone_sets(profile)
    opt_in = bool(profile is not None and profile.push_wahoo_zones)

    status = WahooZonesStatus(
        connected=False,
        opt_in=opt_in,
        local_sets=state,
        # HR has no writable surface at all, so this is a fact about Wahoo, not
        # about our connection state.
        hr_write_supported=False,
        can_write=False,
    )

    connection = await get_wahoo_connection(db, user_id)
    if connection is None:
        status.error_code = "no_connection"
        status.error = "No Wahoo connection. Connect Wahoo in Settings."
        return status

    status.connected = True
    status.connection_status = connection.status
    if connection.status == CONNECTION_STATUS_NEEDS_REAUTH:
        status.error_code = "needs_reauth"
        status.error = "Wahoo needs re-authorising — reconnect it in Settings."
        return status

    try:
        # Refresh only because we are about to call the API, and only when the
        # token is actually expiring: Wahoo caps unrevoked tokens per user and
        # invalidates the old one only once the refreshed token is *used*, so a
        # speculative refresh is how an integration exhausts that cap.
        connection = await refresh_if_needed(db, connection)
        raw = await wahoo_client.get_power_zones(connection.access_token)
    except PermanentAuthError:
        status.error_code = "needs_reauth"
        status.error = "Wahoo needs re-authorising — reconnect it in Settings."
        return status
    except TransientSyncError:
        status.error_code = "transient"
        status.error = "Wahoo is not reachable right now — try again shortly."
        return status
    except httpx.HTTPStatusError as exc:
        if exc.response.status_code == 403:
            status.error_code = "missing_scopes"
            status.error = (
                "Wahoo did not grant power-zone access for this connection — "
                "reconnect Wahoo to approve it."
            )
        else:
            status.error_code = "http_error"
            status.error = f"Wahoo returned {exc.response.status_code}."
        logger.warning("Wahoo power zone read failed: %s", exc)
        return status

    status.wahoo_sets = describe_zone_sets(raw)
    status.tracked = await _load_tracked(db, user_id)
    status.drift = _drift_rows(state, status.wahoo_sets)
    status.can_write = bool(
        WRITE_PATH_IMPLEMENTED
        and opt_in
        and profile is not None
        and profile.ftp_watts
        and not status.error_code
    )
    return status
