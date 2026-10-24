"""Cycling API — Wahoo zone sync: status, push, revert.

The push is **manual here** and automatic via the weekly FTP task. The toggle
(``push_wahoo_zones``) governs the *automatic* path only: pressing "Push now" is
itself the consent, so a user who never turns the toggle on can still sync once.

There is no request body: the plan sketched a ``target: power|all`` switch, but
heart-rate zones have no writable Wahoo surface at all (no endpoint, no scope), so
the only meaningful target is power and a body would be ceremony around a constant.

Path shape note: every route in the cycling router is a static single-segment path
and there is no ``/{param}`` route, so AGENTS.md pitfall 13's ordering rule — which
bites when a single-segment static route competes with a single-segment dynamic one —
has nothing to bite on here (pitfall 35). An ordering assertion would lock in
caution while checking nothing.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.wahoo_zones import (
    WahooZonesPushResult,
    WahooZonesRevertResult,
    WahooZonesStatus,
)
from app.services.auth import get_current_user
from app.services.wahoo_zones import (
    WahooZoneError,
    push_power_zones,
    read_wahoo_zones,
    revert_wahoo_zones,
)

router = APIRouter()


@router.get("/wahoo-zones", response_model=WahooZonesStatus)
async def get_wahoo_zones(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """FitTrack's zones, the athlete's Wahoo sets, and the difference between them.

    Degrades rather than failing: a Wahoo-side problem comes back as
    ``error_code``/``error`` alongside the local zones, so the card still renders
    something true instead of the page erroring because a third party is down.
    """
    return await read_wahoo_zones(db, current_user.id)


@router.post("/wahoo-zones/push", response_model=WahooZonesPushResult)
async def push_wahoo_zone_sets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Write FitTrack's FTP into the athlete's Wahoo power zone sets.

    Forced, so it writes even when our records say the set is already current — the
    athlete pressed a button, and they may have changed the zones in the Wahoo app
    since we last looked.

    Returns 409 without a Wahoo connection, 403 when the connection lacks
    ``power_zones_write``, 422 without an FTP. Per-set failures are reported in
    ``skipped`` rather than failing the whole call.
    """
    try:
        result = await push_power_zones(db, current_user.id, force=True)
    except WahooZoneError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return WahooZonesPushResult.model_validate(result)


@router.post("/wahoo-zones/revert", response_model=WahooZonesRevertResult)
async def revert_wahoo_zone_sets(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Restore each set to the state captured before our first write to it."""
    try:
        result = await revert_wahoo_zones(db, current_user.id)
    except WahooZoneError as exc:
        raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
    return WahooZonesRevertResult.model_validate(result)
