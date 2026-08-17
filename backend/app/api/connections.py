"""Connections API — list connections, trigger sync."""

import uuid
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import OAuthConnection, User
from app.schemas.auth import OAuthConnectionRead
from app.services.auth import get_current_user
from app.services.strava import sync_activities

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/", response_model=list[OAuthConnectionRead])
async def list_connections(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """List all OAuth connections for the current user."""
    result = await db.execute(
        select(OAuthConnection).where(OAuthConnection.user_id == current_user.id)
    )
    connections = result.scalars().all()
    return [OAuthConnectionRead.model_validate(c) for c in connections]


@router.delete("/{connection_id}")
async def disconnect(
    connection_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Remove an OAuth connection."""
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.id == connection_id,
            OAuthConnection.user_id == current_user.id,
        )
    )
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    await db.delete(connection)
    return {"detail": f"Disconnected from {connection.provider}"}


@router.post("/{connection_id}/sync")
async def trigger_sync(
    connection_id: uuid.UUID,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Trigger a manual sync for a connection."""
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.id == connection_id,
            OAuthConnection.user_id == current_user.id,
        )
    )
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="Connection not found")

    if connection.provider == "strava":
        try:
            activities = await sync_activities(db, current_user.id, limit=100)
            # Also sync routes
            route_count = 0
            try:
                from app.services.strava import sync_strava_routes
                route_count, route_merged = await sync_strava_routes(db, current_user.id)
            except Exception as e:
                logger.error(f"Strava route sync failed for user {current_user.id}: {e}", exc_info=True)
            return {
                "detail": f"Synced {len(activities)} activities and {route_count} routes from Strava",
                "synced_count": len(activities),
                "routes_synced": route_count,
            }
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    elif connection.provider == "komoot":
        try:
            from app.services.komoot import sync_komoot_routes
            route_count, merged = await sync_komoot_routes(db, current_user.id)
            await db.commit()
            return {
                "detail": f"Synced {route_count} routes from Komoot",
                "synced_count": route_count,
                "merged_count": merged,
            }
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    elif connection.provider == "wahoo":
        try:
            from app.services.wahoo import sync_wahoo_routes, sync_wahoo_activities
            # Sync both routes and activities
            route_count, merged = await sync_wahoo_routes(db, current_user.id)
            activities = await sync_wahoo_activities(db, current_user.id)
            await db.commit()
            return {
                "detail": f"Synced {len(activities)} activities and {route_count} routes from Wahoo",
                "synced_count": len(activities),
                "routes_synced": route_count,
                "routes_merged": merged,
            }
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Sync not yet implemented for {connection.provider}",
        )
