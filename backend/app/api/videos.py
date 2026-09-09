"""Strength video API (§1.1).

Endpoints mounted under `/api/v1/lifting/videos/`. The MVP implements
**URL-only** mode (externally hosted YouTube/Vimeo embeds) end-to-end.
Upload-via-R2 is stubbed: `POST /upload-url` returns 501 when Cloudflare R2
credentials aren't configured, so the feature degrades gracefully and the
URL-only flow keeps working.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.lifting import LiftVideo
from app.models.user import User
from app.schemas.lifting import (
    LiftVideoCreate,
    LiftVideoListParams,
    LiftVideoRead,
    VideoStreamUrl,
    VideoUploadRequest,
    VideoUploadResponse,
)
from app.services.auth import get_current_user

router = APIRouter()


def _s3_configured() -> bool:
    """True only when all Cloudflare R2 env fields are populated."""
    settings = get_settings()
    return bool(
        settings.r2_account_id
        and settings.r2_access_key_id
        and settings.r2_secret_access_key
        and settings.r2_bucket
    )


@router.get("/", response_model=list[LiftVideoRead])
async def list_videos(
    params: LiftVideoListParams = Depends(),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List the current user's strength videos."""
    stmt = select(LiftVideo).where(LiftVideo.user_id == current_user.id)
    if params.source:
        stmt = stmt.where(LiftVideo.source == params.source)
    if params.exercise_name:
        stmt = stmt.where(LiftVideo.exercise_name == params.exercise_name)
    stmt = (
        stmt.order_by(LiftVideo.created_at.desc())
        .limit(params.limit)
        .offset(params.offset)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return rows


@router.post("/", response_model=LiftVideoRead, status_code=status.HTTP_201_CREATED)
async def create_video(
    payload: LiftVideoCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a strength video (§1.1).

    URL-only mode: provide `external_url` + `source="url"`.
    Upload mode: provide `r2_key` + metadata (after a successful R2 PUT via
    `/upload-url`); requires S3 to be configured.
    """
    if payload.source not in ("upload", "url"):
        raise HTTPException(400, "source must be 'upload' or 'url'")
    if payload.source == "url" and not payload.external_url:
        raise HTTPException(400, "external_url is required for url-mode videos")
    if payload.source == "upload" and not payload.r2_key:
        raise HTTPException(400, "r2_key is required for upload-mode videos")
    if payload.source == "upload" and not _s3_configured():
        raise HTTPException(
            501,
            "R2 storage is not configured — use url mode (external_url) instead",
        )

    video = LiftVideo(
        user_id=current_user.id,
        source=payload.source,
        external_url=payload.external_url,
        r2_key=payload.r2_key,
        file_name=payload.file_name,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        duration_seconds=payload.duration_seconds,
        exercise_name=payload.exercise_name,
        lifting_session_id=payload.lifting_session_id,
        personal_record_id=payload.personal_record_id,
        notes=payload.notes,
    )
    db.add(video)
    await db.commit()
    await db.refresh(video)
    return video


@router.get("/{video_id}", response_model=LiftVideoRead)
async def get_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single strength video by id (owner only)."""
    video = (
        await db.execute(
            select(LiftVideo).where(
                LiftVideo.id == video_id, LiftVideo.user_id == current_user.id
            )
        )
    ).scalar_one_or_none()
    if video is None:
        raise HTTPException(404, "Video not found")
    return video


@router.post("/upload-url", response_model=VideoUploadResponse)
async def create_upload_url(
    payload: VideoUploadRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Request a Cloudflare R2 presigned PUT URL for uploading a video.

    Returns 501 when R2 is not configured (the URL-only flow keeps working).
    """
    if not _s3_configured():
        raise HTTPException(501, "R2 storage is not configured on this instance")
    try:
        from app.integrations.r2 import create_presigned_put  # lazy import
    except ImportError as exc:  # boto3 optional until §1.1 follow-up
        raise HTTPException(501, "R2 storage client is not installed") from exc

    key = await create_presigned_put(
        current_user, payload.file_name, payload.content_type, payload.size_bytes
    )
    return key


@router.get("/{video_id}/stream-url", response_model=VideoStreamUrl)
async def get_stream_url(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resolve a URL/PUT key for playback.

    - URL-only videos return their external embed URL (`mode: "embed"`).
    - Uploaded videos return a presigned GET (R2) when configured, else 501.
    """
    video = (
        await db.execute(
            select(LiftVideo).where(
                LiftVideo.id == video_id, LiftVideo.user_id == current_user.id
            )
        )
    ).scalar_one_or_none()
    if video is None:
        raise HTTPException(404, "Video not found")

    if video.external_url:
        return VideoStreamUrl(url=video.external_url, mode="embed")

    if video.r2_key:
        if not _s3_configured():
            raise HTTPException(501, "R2 storage is not configured on this instance")
        try:
            from app.integrations.r2 import create_presigned_get  # lazy
        except ImportError as exc:  # boto3 optional until §1.1 follow-up
            raise HTTPException(501, "R2 storage client is not installed") from exc
        url = await create_presigned_get(video.r2_key)
        return VideoStreamUrl(url=url, mode="direct")

    raise HTTPException(404, "No playable source for this video")


@router.delete(
    "/{video_id}", response_model=LiftVideoRead, status_code=status.HTTP_200_OK
)
async def delete_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a strength video (owner only)."""
    video = (
        await db.execute(
            select(LiftVideo).where(
                LiftVideo.id == video_id, LiftVideo.user_id == current_user.id
            )
        )
    ).scalar_one_or_none()
    if video is None:
        raise HTTPException(404, "Video not found")
    await db.delete(video)
    await db.commit()
    return video
