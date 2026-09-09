"""Strength video API (§1.1).

Endpoints mounted under `/api/v1/lifting/videos/`. Upload-via-R2 only:
presigned PUT from the browser into Cloudflare R2, then a `LiftVideo` row
referencing the object key. Requires the `R2_*` env vars + a bucket CORS rule
(see `docs/R2_SETUP.md`); otherwise upload endpoints degrade to 501.
"""

import logging
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

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_UPLOAD_BYTES = 250 * 1024 * 1024
ALLOWED_CONTENT_TYPES = {"video/mp4", "video/quicktime", "video/webm"}


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
    if params.exercise_name:
        stmt = stmt.where(LiftVideo.exercise_name == params.exercise_name)
    if params.lifting_session_id:
        stmt = stmt.where(LiftVideo.lifting_session_id == params.lifting_session_id)
    if params.personal_record_id:
        stmt = stmt.where(LiftVideo.personal_record_id == params.personal_record_id)
    if params.after:
        stmt = stmt.where(LiftVideo.created_at >= params.after)
    if params.before:
        stmt = stmt.where(LiftVideo.created_at <= params.before)
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

    Upload mode only: provide `r2_key` + metadata (after a successful R2 PUT
    via `/upload-url`); requires R2 to be configured.
    """
    if not payload.r2_key:
        raise HTTPException(400, "r2_key is required")
    if not payload.file_name or not payload.content_type or not payload.size_bytes:
        raise HTTPException(400, "file_name, content_type and size_bytes are required")
    if not _s3_configured():
        raise HTTPException(501, "R2 storage is not configured on this instance")
    if payload.content_type not in ALLOWED_CONTENT_TYPES or not (
        0 < payload.size_bytes <= MAX_UPLOAD_BYTES
    ):
        raise HTTPException(
            400,
            "invalid content_type or size_bytes for upload-mode video",
        )

    video = LiftVideo(
        user_id=current_user.id,
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

    Server-side size + type validation (mirrors the frontend's own checks) so
    the issued presign is honoured only for an acceptably-sized video.
    Returns 501 when R2 is not configured (the URL-only flow keeps working).
    """
    if not (payload.content_type in ALLOWED_CONTENT_TYPES):
        raise HTTPException(
            400,
            f"content_type must be one of: {', '.join(sorted(ALLOWED_CONTENT_TYPES))}",
        )
    if not (0 < payload.size_bytes <= MAX_UPLOAD_BYTES):
        raise HTTPException(
            400,
            f"size_bytes must be between 1 and {MAX_UPLOAD_BYTES} "
            f"({MAX_UPLOAD_BYTES // (1024 * 1024)} MB)",
        )
    if not _s3_configured():
        raise HTTPException(501, "R2 storage is not configured on this instance")
    try:
        from app.integrations.r2 import create_presigned_put  # lazy import
    except ImportError as exc:  # boto3 optional until R2 configured
        raise HTTPException(501, "R2 storage client is not installed") from exc

    key = await create_presigned_put(
        current_user.id, payload.file_name, payload.content_type, payload.size_bytes
    )
    return key


@router.get("/{video_id}/stream-url", response_model=VideoStreamUrl)
async def get_stream_url(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resolve a presigned GET for playback (R2 must be configured)."""
    video = (
        await db.execute(
            select(LiftVideo).where(
                LiftVideo.id == video_id, LiftVideo.user_id == current_user.id
            )
        )
    ).scalar_one_or_none()
    if video is None:
        raise HTTPException(404, "Video not found")

    if not video.r2_key:
        raise HTTPException(404, "No playable source for this video")
    if not _s3_configured():
        raise HTTPException(501, "R2 storage is not configured on this instance")
    try:
        from app.integrations.r2 import create_presigned_get  # lazy
    except ImportError as exc:  # boto3 optional until R2 configured
        raise HTTPException(501, "R2 storage client is not installed") from exc
    url = await create_presigned_get(video.r2_key)
    return VideoStreamUrl(url=url)


@router.delete(
    "/{video_id}", response_model=LiftVideoRead, status_code=status.HTTP_200_OK
)
async def delete_video(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete a strength video (owner only).

    Also deletes the R2 object (best-effort — if the object delete fails, the
    DB row is still removed and the error logged, so a stale row can never
    orphan the UI; a later sweep can reclaim the file).
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

    if video.r2_key and _s3_configured():
        try:
            from app.integrations.r2 import delete_object

            await delete_object(video.r2_key)
        except Exception as e:  # never fail the delete on R2 errors
            logger.warning("Failed to delete R2 object %s: %s", video.r2_key, e)

    await db.delete(video)
    await db.commit()
    return video
