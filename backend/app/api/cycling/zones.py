"""Cycling API — Wahoo zone sync.

Read-only for now (plan Phase 1). The push/revert paths land in Phase 2 behind the
``push_wahoo_zones`` opt-in; ``WahooZonesStatus.can_write`` stays false until then so
the UI cannot advertise an action with nothing behind it.

Path shape note: every route in the cycling router is a static single-segment path
and there is no ``/{param}`` route at all, so AGENTS.md pitfall 13's ordering rule —
which bites when a single-segment static route competes with a single-segment
dynamic one — has nothing to bite on here (pitfall 35). ``/wahoo-zones`` is safely
unambiguous; an ordering assertion would lock in caution while checking nothing.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.wahoo_zones import WahooZonesStatus
from app.services.auth import get_current_user
from app.services.wahoo_zones import read_wahoo_zones

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
