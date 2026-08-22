"""Connections API — list connections, trigger sync, Whoop backfill."""

import json
import logging
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
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

                route_count, route_merged = await sync_strava_routes(
                    db, current_user.id
                )
            except Exception as e:
                logger.error(
                    f"Strava route sync failed for user {current_user.id}: {e}",
                    exc_info=True,
                )
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
            from app.services.wahoo import sync_wahoo_activities, sync_wahoo_routes

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
    elif connection.provider == "whoop":
        try:
            from app.services.whoop import (
                refresh_if_needed as whoop_refresh,
            )
            from app.services.whoop import (
                sync_whoop_cycles,
                sync_whoop_sleep,
                sync_whoop_workouts,
            )

            # Refresh token first (same as Celery task does)
            connection = await whoop_refresh(db, connection)
            metrics = await sync_whoop_cycles(db, current_user.id)
            sleep_logs = await sync_whoop_sleep(db, current_user.id)
            enriched = await sync_whoop_workouts(db, current_user.id)
            await db.commit()
            return {
                "detail": f"Synced {len(metrics)} metrics, {len(sleep_logs)} sleep records, {len(enriched)} enriched activities from Whoop",
                "synced_count": len(metrics) + len(sleep_logs) + len(enriched),
            }
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    else:
        raise HTTPException(
            status_code=400,
            detail=f"Sync not yet implemented for {connection.provider}",
        )


@router.post("/whoop/backfill")
async def backfill_whoop(
    months: int = Query(12, ge=1, le=120, description="Months of history to backfill"),
    chunk_months: int = Query(
        3, ge=1, le=12, description="Months per chunk (smaller = more progress updates)"
    ),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Backfill all historical Whoop data for the current user.

    Processes data in time-window chunks (default 3 months each) with
    independent commits, so partial progress is preserved if the request
    is interrupted. Returns an SSE stream with progress updates.
    """
    # Validate connection exists before starting the stream
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == current_user.id,
            OAuthConnection.provider == "whoop",
        )
    )
    connection = result.scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=404, detail="No Whoop connection found")

    from app.database import async_session_factory
    from app.services.whoop import backfill_whoop_chunked

    user_id = current_user.id

    async def event_stream():
        # Create a dedicated session for the long-running stream.
        # The DI session from get_db is closed after the endpoint returns,
        # which happens immediately for StreamingResponse.
        async with async_session_factory() as stream_db:
            try:
                async for event in backfill_whoop_chunked(
                    stream_db,
                    user_id,
                    months=months,
                    chunk_months=chunk_months,
                ):
                    yield f"data: {json.dumps(event)}\n\n"
            except ValueError as e:
                yield f"data: {json.dumps({'type': 'error', 'detail': str(e)})}\n\n"
            except Exception as e:
                logger.error(
                    f"Whoop backfill stream error for user {user_id}: {e}",
                    exc_info=True,
                )
                yield f"data: {json.dumps({'type': 'error', 'detail': 'An unexpected error occurred during backfill.'})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
