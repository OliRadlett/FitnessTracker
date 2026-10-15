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

import json
import logging
import uuid
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.errors import PermanentAuthError, TransientSyncError
from app.integrations.wahoo_client import (
    WAHOO_FAMILY_BIKING,
    WAHOO_LOCATION_INDOOR,
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

# Wahoo's power-zone payload exposes `zone_1` … `zone_7` (see the Cloud API
# reference), so seven is the most boundaries a set can carry.
WAHOO_MAX_ZONE_SLOTS = 7

# Wahoo's Workout Type Locations: 0 indoor, 1 outdoor, 255 unknown. We only ever
# *write* 0 or 1, but our own bookkeeping row has to key a set whose location we
# could not read.
WAHOO_LOCATION_UNKNOWN = 255

# Wahoo returns decimals as *strings* and marks third-party app records with
# ``fitness_app_id > 1000`` (< 1000 = a Wahoo app). Both facts are load-bearing:
# the first means never `float(value)` blindly, the second is the only provenance
# signal available for deciding whose set we are looking at.
WAHOO_THIRD_PARTY_APP_ID_FLOOR = 1000

# The upper bound of the top zone in our models is a sentinel ("this goes on"), not
# a real ceiling: POWER_ZONES ends at 5.0 × FTP and LTHR_HR_ZONES at 5.0 × LTHR.
# Render those as open-ended rather than multiplying them into absurd watts/bpm.
_OPEN_ENDED_SENTINEL = 5.0

# Phase 1 shipped read-only; the write path (plan Phase 2) is now implemented, so
# ``can_write`` can advertise it. Gating it here rather than hardcoding true keeps
# one switch for the API surface and the endpoints together.
WRITE_PATH_IMPLEMENTED = True


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
    for index in range(1, WAHOO_MAX_ZONE_SLOTS + 1):
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


# ── Write path: pure helpers ─────────────────────────────────────────────────


def writable_cycling_sets(
    sets: list[WahooPowerZoneSet], *, tracked_ids: set[int]
) -> tuple[list[WahooPowerZoneSet], list[WahooPowerZoneSet]]:
    """Split sets we may update from sets we must keep out of.

    Returns ``(writable, foreign)``. Two exclusions, both deliberate:

    * **Not the cycling family.** A missing ``family_id`` counts as not-cycling
      here, unlike the drift rows above: a wrong guess on a *write* lands on another
      sport's zones, which is worse than showing one drift figure too many.
    * **Another third-party app's set** (``fitness_app_id > 1000`` and not one we
      already track): another integration is syncing those numbers, and two writers
      disagreeing about them is a bug with no winner.

    The athlete's *own* set — including one the Wahoo app created — is fair game.
    It is the set the head unit colours against, and while the plan's first draft
    said "never touch it", refusing to would make the feature do nothing in the
    common case. Opt-in + snapshot + revert is what makes touching it safe (D3).
    """
    writable: list[WahooPowerZoneSet] = []
    foreign: list[WahooPowerZoneSet] = []
    for zone_set in sets:
        if zone_set.workout_type_family_id != WAHOO_FAMILY_BIKING:
            continue
        if zone_set.third_party is True and zone_set.id not in tracked_ids:
            foreign.append(zone_set)
            continue
        writable.append(zone_set)
    return writable, foreign


def rescaled_boundaries(
    boundaries: list[float], *, old_anchor: float | None, new_anchor: float
) -> list[int]:
    """Scale a set's own boundaries onto a new anchor, preserving its shape.

    Deliberately convention-agnostic. The meaning of ``zone_N`` is not documented —
    Wahoo's own example sends ``zone_1`` … ``zone_7`` alongside ``zone_count=8`` —
    but multiplying every value by one ratio preserves whichever it is. So a wrong
    guess about the convention cannot *reshape* the athlete's zones; it can only
    leave them uniformly wrong, which the read-back after each write exposes. That
    is what lets this ship ahead of the plan's Phase 0 spike.

    Returns ``[]`` when there is no shape to scale (no old anchor, or no boundaries
    at all); the caller then writes the anchor alone — which is exactly the
    operation Wahoo's own update example performs.

    Monotonicity is enforced rather than assumed: rounding at a low anchor can push
    two boundaries onto the same watt, and a zone set whose boundaries are not
    strictly increasing is not a zone set.
    """
    if not boundaries or not old_anchor or old_anchor <= 0 or new_anchor <= 0:
        return []
    ratio = new_anchor / old_anchor
    scaled: list[int] = []
    previous: int | None = None
    for value in boundaries:
        candidate = round(value * ratio)
        if previous is not None and candidate <= previous:
            candidate = previous + 1
        scaled.append(int(candidate))
        previous = int(candidate)
    return scaled


def power_zone_payload(
    *,
    ftp: float,
    boundaries: list[int],
    zone_count: int | None = None,
    location_id: int | None = None,
    include_identity: bool = False,
) -> dict[str, Any]:
    """Build a power-zone form payload.

    ``critical_power`` is intentionally **not** sent: we hold a Morton CP, Wahoo
    documents the field as "MMP/Best average power", and those are different
    quantities (plan §8). Writing a number into a field whose meaning has not been
    confirmed is how a sync corrupts the data it was meant to tidy.
    """
    payload: dict[str, Any] = {"ftp": int(round(ftp))}
    for index, value in enumerate(boundaries[:WAHOO_MAX_ZONE_SLOTS], start=1):
        payload[f"zone_{index}"] = value
    if zone_count:
        payload["zone_count"] = zone_count
    if include_identity:
        # Create only: an update must not stomp the family/location the athlete
        # assigned in the Wahoo app.
        payload["workout_type_family_id"] = WAHOO_FAMILY_BIKING
        payload["workout_type_location_id"] = (
            location_id if location_id is not None else WAHOO_LOCATION_INDOOR
        )
    return payload


def prior_snapshot(zone_set: WahooPowerZoneSet) -> dict[str, Any]:
    """The before-state a revert restores: anchor, boundaries, zone count."""
    return {
        "ftp": zone_set.ftp,
        "zone_count": zone_set.zone_count,
        "zones": list(zone_set.zones),
    }


def payload_from_snapshot(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Rebuild a write payload from a stored snapshot (the revert path)."""
    payload: dict[str, Any] = {}
    ftp = as_float(snapshot.get("ftp"))
    if ftp is not None:
        payload["ftp"] = int(round(ftp))
    for index, value in enumerate(
        (snapshot.get("zones") or [])[:WAHOO_MAX_ZONE_SLOTS], start=1
    ):
        number = as_float(value)
        if number is not None:
            payload[f"zone_{index}"] = int(round(number))
    zone_count = as_int(snapshot.get("zone_count"))
    if zone_count:
        payload["zone_count"] = zone_count
    return payload


def json_safe(payload: dict[str, Any], *, label: str) -> dict[str, Any]:
    """Refuse a payload that is not JSON-native at the moment it is written.

    A ``uuid.UUID`` or ``Decimal`` in a JSONB column survives an in-process round
    trip and then fails at flush — after the operation that wrote it has already
    run (AGENTS.md pitfall 40). Round-tripping here turns that into a local, named
    error instead of a driver-level ``TypeError`` later.
    """
    try:
        json.dumps(payload)
    except (TypeError, ValueError) as exc:
        raise WahooZoneError(
            f"{label} is not JSON-serialisable ({exc})", 500, "bad_snapshot"
        ) from exc
    return payload


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

    ``can_write`` answers "may the athlete press *Push now* right now", which needs a
    connection, an FTP and no Wahoo-side error — **not** the opt-in toggle. The toggle
    governs the *automatic* path only; a manual push is its own consent (D1), so
    requiring the toggle here would disable the very button that repairs drift for
    someone who declined automation.
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
        and profile is not None
        and profile.ftp_watts
        and not status.error_code
    )
    return status


# ── Write path ───────────────────────────────────────────────────────────────


def _row_key(zone_set: WahooPowerZoneSet) -> tuple[int, int]:
    """The (family, location) key for our bookkeeping row, with no NULLs.

    Both columns are NOT NULL in the table, and a set whose location we could not
    read still needs a stable key — otherwise the lookup misses, a second row is
    created, and the unique constraint turns that into an IntegrityError on flush.
    """
    return (
        zone_set.workout_type_family_id
        if zone_set.workout_type_family_id is not None
        else WAHOO_FAMILY_BIKING,
        zone_set.workout_type_location_id
        if zone_set.workout_type_location_id is not None
        else WAHOO_LOCATION_UNKNOWN,
    )


def _row_for(rows: list[WahooZoneSet], zone_set: WahooPowerZoneSet) -> WahooZoneSet | None:
    """Our tracked row for a Wahoo set: by id first, then by key."""
    for row in rows:
        if row.wahoo_zone_set_id == zone_set.id:
            return row
    key = _row_key(zone_set)
    for row in rows:
        if row.zone_kind != ZONE_KIND_POWER or row.wahoo_zone_set_id is not None:
            continue
        if (row.workout_type_family_id, row.workout_type_location_id) == key:
            return row
    return None


def _ensure_row(
    db: AsyncSession,
    rows: list[WahooZoneSet],
    user_id: uuid.UUID,
    zone_set: WahooPowerZoneSet,
) -> WahooZoneSet:
    row = _row_for(rows, zone_set)
    if row is not None:
        return row
    family_id, location_id = _row_key(zone_set)
    row = WahooZoneSet(
        user_id=user_id,
        zone_kind=ZONE_KIND_POWER,
        workout_type_family_id=family_id,
        workout_type_location_id=location_id,
        wahoo_zone_set_id=zone_set.id,
    )
    db.add(row)
    rows.append(row)
    return row


def _translate_http_error(exc: httpx.HTTPStatusError, action: str) -> WahooZoneError:
    if exc.response.status_code == 403:
        return WahooZoneError(
            "Wahoo did not grant power-zone access for this connection — reconnect "
            "Wahoo to approve it.",
            403,
            "missing_scopes",
        )
    if exc.response.status_code == 404:
        return WahooZoneError(
            "That Wahoo zone set no longer exists.", 404, "set_gone"
        )
    return WahooZoneError(
        f"Wahoo rejected the zone {action} ({exc.response.status_code}).",
        502,
        "rejected",
    )


def _translate_auth_error(exc: Exception) -> WahooZoneError:
    if isinstance(exc, PermanentAuthError):
        return WahooZoneError(
            "Wahoo needs re-authorising — reconnect it in Settings.",
            409,
            "needs_reauth",
        )
    return WahooZoneError(
        "Wahoo is not reachable right now — try again shortly.", 502, "transient"
    )


async def _load_rows(db: AsyncSession, user_id: uuid.UUID) -> list[WahooZoneSet]:
    result = await db.execute(
        select(WahooZoneSet).where(WahooZoneSet.user_id == user_id)
    )
    return list(result.scalars().all())


def _empty_result(ftp: float | None) -> dict[str, Any]:
    return {
        "ftp": ftp,
        "updated": [],
        "created": [],
        "skipped": [],
        "foreign": [],
        "reason": None,
    }


async def _write_set(
    db: AsyncSession,
    token: str,
    user_id: uuid.UUID,
    rows: list[WahooZoneSet],
    zone_set: WahooPowerZoneSet,
    *,
    ftp: float,
) -> None:
    # Snapshot *before* the write: revert restores the state before our **first**
    # write, not before the last of N.
    snapshot = json_safe(prior_snapshot(zone_set), label="Wahoo zone snapshot")
    boundaries = rescaled_boundaries(
        zone_set.zones, old_anchor=zone_set.ftp, new_anchor=ftp
    )
    payload = power_zone_payload(
        ftp=ftp, boundaries=boundaries, zone_count=zone_set.zone_count
    )
    try:
        await wahoo_client.update_power_zone(token, zone_set.id, payload)
    except httpx.HTTPStatusError as exc:
        raise _translate_http_error(exc, "update") from exc

    row = _ensure_row(db, rows, user_id, zone_set)
    if row.prior is None:
        row.prior = snapshot
    row.wahoo_zone_set_id = zone_set.id
    row.anchor_value = ftp
    row.boundaries = json_safe(
        {
            "ftp": int(round(ftp)),
            "zones": boundaries,
            "zone_count": zone_set.zone_count,
        },
        label="Wahoo zone boundaries",
    )
    row.pushed_at = datetime.now(UTC)
    row.last_error = None
    await db.flush()


async def _create_set(
    db: AsyncSession,
    token: str,
    user_id: uuid.UUID,
    rows: list[WahooZoneSet],
    *,
    ftp: float,
) -> int:
    """Create a set when the athlete has none we may write to.

    Minimal by design: anchor plus cycling identity, no boundaries. There is no
    existing shape to preserve, and synthesising one from our Coggan model is
    precisely the "impose our zones" behaviour the plan rejects (D2). Letting Wahoo
    derive its own boundaries from the anchor is the honest default.

    This path exists because ``GET /v1/power_zones`` may return only *our* app's
    sets (the docs do not say, unlike routes and plans, whose app-scoping is
    explicit). If so, a fresh connection sees nothing to update and would otherwise
    do nothing at all — the card reports what was found so the athlete can spot it.
    """
    payload = power_zone_payload(
        ftp=ftp,
        boundaries=[],
        include_identity=True,
        location_id=WAHOO_LOCATION_INDOOR,
    )
    try:
        data = await wahoo_client.create_power_zone(token, payload)
    except httpx.HTTPStatusError as exc:
        raise _translate_http_error(exc, "create") from exc

    new_id = as_int(data.get("id")) if isinstance(data, dict) else None
    if new_id is None:
        raise WahooZoneError(
            "Wahoo did not return an id for the new zone set.", 502, "no_id"
        )

    row = WahooZoneSet(
        user_id=user_id,
        zone_kind=ZONE_KIND_POWER,
        workout_type_family_id=WAHOO_FAMILY_BIKING,
        workout_type_location_id=WAHOO_LOCATION_INDOOR,
        wahoo_zone_set_id=new_id,
    )
    db.add(row)
    rows.append(row)
    row.anchor_value = ftp
    row.boundaries = json_safe(
        {"ftp": int(round(ftp)), "zones": [], "zone_count": None},
        label="Wahoo zone boundaries",
    )
    row.pushed_at = datetime.now(UTC)
    await db.flush()
    return new_id


async def push_power_zones(
    db: AsyncSession,
    user_id: uuid.UUID,
    *,
    force: bool = False,
    require_opt_in: bool = False,
    allow_create: bool = True,
) -> dict[str, Any]:
    """Write FitTrack's FTP into the athlete's Wahoo power zone sets.

    ``force`` re-pushes a set whose anchor already matches (the manual button);
    ``require_opt_in`` is set by the automatic path so a task enqueued before the
    athlete switched the toggle off cannot still write to their account.

    A per-set failure never aborts the others — the sets are independent, and one
    bad set must not cost the athlete every other update. Conditions that make the
    whole operation meaningless (no connection, no FTP, no scope) raise
    :class:`WahooZoneError` instead, because there is nothing partial to salvage.
    """
    profile = await _load_profile(db, user_id)
    if require_opt_in and not (profile is not None and profile.push_wahoo_zones):
        result = _empty_result(profile.ftp_watts if profile else None)
        result["reason"] = "not_opted_in"
        return result

    ftp = profile.ftp_watts if profile else None
    if not ftp:
        raise WahooZoneError(
            "Set your FTP (Cycling profile) before syncing Wahoo zones.",
            422,
            "no_ftp",
        )

    connection = await get_wahoo_connection(db, user_id)
    if connection is None:
        raise WahooZoneError(
            "No Wahoo connection found — connect Wahoo in Settings.",
            409,
            "no_connection",
        )

    rows = await _load_rows(db, user_id)
    tracked_ids = {
        row.wahoo_zone_set_id for row in rows if row.wahoo_zone_set_id is not None
    }

    try:
        connection = await refresh_if_needed(db, connection)
    except (PermanentAuthError, TransientSyncError) as exc:
        raise _translate_auth_error(exc) from exc
    try:
        raw = await wahoo_client.get_power_zones(connection.access_token)
    except httpx.HTTPStatusError as exc:
        raise _translate_http_error(exc, "read") from exc

    sets = describe_zone_sets(raw)
    cycling_sets = [
        zone_set
        for zone_set in sets
        if zone_set.workout_type_family_id == WAHOO_FAMILY_BIKING
    ]
    writable, foreign = writable_cycling_sets(sets, tracked_ids=tracked_ids)
    result = _empty_result(ftp)
    result["foreign"] = [zone_set.id for zone_set in foreign]
    for zone_set in writable:
        row = _row_for(rows, zone_set)
        if (
            not force
            and row is not None
            and row.anchor_value is not None
            and round(row.anchor_value) == round(ftp)
        ):
            result["skipped"].append({"id": zone_set.id, "reason": "already_current"})
            continue
        if zone_set.ftp is None and zone_set.zones:
            # Boundaries we cannot rescale: writing the anchor alone would leave
            # the boundaries consistent with the *previous* FTP, which is worse
            # than leaving the set alone and saying so.
            result["skipped"].append({"id": zone_set.id, "reason": "no_anchor"})
            continue
        try:
            await _write_set(db, connection.access_token, user_id, rows, zone_set, ftp=ftp)
        except WahooZoneError as exc:
            result["skipped"].append({"id": zone_set.id, "reason": exc.code})
            failed_row = _row_for(rows, zone_set)
            if failed_row is not None:
                failed_row.last_error = str(exc)[:300]
                await db.flush()
            logger.warning("Wahoo zone push failed for set %s: %s", zone_set.id, exc)
            continue
        result["updated"].append(zone_set.id)

    if allow_create and not cycling_sets:
        # Only when GET found no cycling set at all. If it found sets we declined to
        # write (another app owns them), adding our own would be noise on top of a
        # deliberate delegation — report it and leave the athlete's setup alone.
        result["created"].append(
            await _create_set(db, connection.access_token, user_id, rows, ftp=ftp)
        )

    logger.info(
        "Wahoo zone push for user %s: %d updated, %d created, %d skipped, %d foreign",
        user_id,
        len(result["updated"]),
        len(result["created"]),
        len(result["skipped"]),
        len(result["foreign"]),
    )
    return result


async def revert_wahoo_zones(db: AsyncSession, user_id: uuid.UUID) -> dict[str, Any]:
    """Restore the snapshot taken before our first write to each set.

    Only ever restores. A set we *created* has no before-state, and deleting it from
    the athlete's account is a destructive act this button should not infer — those
    rows are left alone, and the athlete can remove the set in the Wahoo app (D4).
    """
    rows = [row for row in await _load_rows(db, user_id) if row.prior is not None]
    if not rows:
        raise WahooZoneError(
            "There is no earlier Wahoo zone state to restore.", 409, "no_snapshot"
        )

    connection = await get_wahoo_connection(db, user_id)
    if connection is None:
        raise WahooZoneError(
            "No Wahoo connection found — connect Wahoo in Settings.",
            409,
            "no_connection",
        )
    try:
        connection = await refresh_if_needed(db, connection)
    except (PermanentAuthError, TransientSyncError) as exc:
        raise _translate_auth_error(exc) from exc

    reverted: list[int] = []
    missing: list[int] = []
    restored_anchor: float | None = None

    for row in rows:
        if row.wahoo_zone_set_id is None:
            continue
        payload = payload_from_snapshot(row.prior or {})
        if not payload:
            continue
        try:
            await wahoo_client.update_power_zone(
                connection.access_token, row.wahoo_zone_set_id, payload
            )
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 404:
                # Gone on Wahoo's side: the snapshot has nothing left to restore
                # onto, so drop it rather than failing the revert forever.
                missing.append(row.wahoo_zone_set_id)
                row.prior = None
                row.last_error = "Zone set no longer exists on Wahoo."
                await db.flush()
                continue
            raise _translate_http_error(exc, "restore") from exc

        restored_anchor = as_float(row.prior.get("ftp")) if row.prior else None
        row.anchor_value = restored_anchor
        row.boundaries = None
        row.prior = None
        row.pushed_at = datetime.now(UTC)
        row.last_error = None
        reverted.append(row.wahoo_zone_set_id)
        await db.flush()

    logger.info(
        "Reverted Wahoo zone sets for user %s: %d restored, %d gone",
        user_id,
        len(reverted),
        len(missing),
    )
    return {"anchor_value": restored_anchor, "reverted": reverted, "missing": missing}


def enqueue_zone_push_if_opted_in(
    user_id: uuid.UUID, profile: CyclingProfile | None
) -> bool:
    """Queue an automatic zone push when the athlete opted in.

    The opt-in check lives here rather than at each call site so it cannot be
    forgotten by one of the places FTP changes. Imported lazily because the Celery
    app drags in the whole task graph, and the FTP endpoints must not become
    import-dependent on it. Returns whether a push was queued.
    """
    if profile is None or not profile.push_wahoo_zones:
        return False
    try:
        from app.tasks.scheduler import push_wahoo_zones_for_user

        push_wahoo_zones_for_user.delay(str(user_id))
    except Exception:
        # A queue that is down must not fail an FTP edit that already succeeded.
        logger.warning(
            "Could not enqueue a Wahoo zone push for user %s", user_id, exc_info=True
        )
        return False
    return True


async def commit_and_enqueue_zone_push(
    db: AsyncSession, user_id: uuid.UUID, profile: CyclingProfile | None
) -> bool:
    """Commit the FTP change, *then* queue the push.

    The ordering is the whole point. A queued worker reads the profile from the
    database, so enqueueing before the request's own commit lets it read the
    *previous* FTP (or an uncommitted opt-in flag) and push a stale anchor. That
    failure is invisible — it looks exactly like a successful "already current"
    no-op — so it would never show up in a log or a test.

    Endpoint sites use this. The weekly task calls
    :func:`enqueue_zone_push_if_opted_in` directly, because it already controls its
    own commit order and has nothing else to commit.
    """
    if profile is None or not profile.push_wahoo_zones:
        return False
    await db.commit()
    return enqueue_zone_push_if_opted_in(user_id, profile)
