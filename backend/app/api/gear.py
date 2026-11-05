"""Gear API — list the bikes/shoes the athlete's rides were recorded on.

No UI is built on this yet (deliberately: the data has to be right before it is
displayed). The endpoint exists so the resolution can be verified against a real
account, and so a maintenance surface has something correct to read later.
"""

import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.gear import Gear
from app.models.user import User
from app.schemas.gear import GearRead, GearUpdate
from app.services.auth import get_current_user
from app.services.gear import remaining_meters, wear_percent

logger = logging.getLogger(__name__)

router = APIRouter()


def _to_read(gear: Gear) -> GearRead:
    """Serialize a gear row with its derived wear state."""
    return GearRead(
        id=gear.id,
        provider=gear.provider,
        name=gear.name,
        kind=gear.kind,
        brand_name=gear.brand_name,
        model_name=gear.model_name,
        distance_meters=gear.distance_meters,
        distance_synced_at=gear.distance_synced_at,
        wear_threshold_meters=gear.wear_threshold_meters,
        wear_percent=wear_percent(gear.distance_meters, gear.wear_threshold_meters),
        wear_remaining_meters=remaining_meters(
            gear.distance_meters, gear.wear_threshold_meters
        ),
        retired_at=gear.retired_at,
    )


async def _get_or_404(db: AsyncSession, user_id: uuid.UUID, gear_id: uuid.UUID) -> Gear:
    result = await db.execute(
        select(Gear).where(Gear.id == gear_id, Gear.user_id == user_id)
    )
    gear = result.scalar_one_or_none()
    if gear is None:
        raise HTTPException(status_code=404, detail="Gear not found")
    return gear


@router.get("/", response_model=list[GearRead])
async def list_gear(
    include_retired: bool = Query(
        False, description="Include gear marked retired (kept for historical rides)"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List the athlete's gear, active first, then by distance descending."""
    query = select(Gear).where(Gear.user_id == current_user.id)
    if not include_retired:
        query = query.where(Gear.retired_at.is_(None))
    query = query.order_by(Gear.distance_meters.desc().nullslast(), Gear.name)

    result = await db.execute(query)
    return [_to_read(gear) for gear in result.scalars().all()]


@router.patch("/{gear_id}", response_model=GearRead)
async def update_gear(
    gear_id: uuid.UUID,
    body: GearUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Set a service interval, rename a gear, or retire it.

    Only fields present in the request body are touched. Retiring does not delete
    anything: the rides keep pointing at the gear, and the gear stays available
    with ``include_retired=true``.
    """
    gear = await _get_or_404(db, current_user.id, gear_id)

    provided = body.model_fields_set
    if "name" in provided and body.name is not None:
        gear.name = body.name
    if "wear_threshold_meters" in provided and body.wear_threshold_meters is not None:
        gear.wear_threshold_meters = body.wear_threshold_meters
    if "retired" in provided and body.retired is not None:
        from datetime import UTC, datetime

        gear.retired_at = datetime.now(UTC) if body.retired else None

    await db.flush()
    return _to_read(gear)
