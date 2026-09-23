"""Strength video API (§1.1).

Endpoints mounted under `/api/v1/lifting/videos/`. Upload-via-R2 only:
presigned PUT from the browser into Cloudflare R2, then a `LiftVideo` row
referencing the object key. Requires the `R2_*` env vars + a bucket CORS rule
(see `docs/R2_SETUP.md`); otherwise upload endpoints degrade to 501.
"""

import logging
import uuid
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.lifting import LiftingSession, LiftingSet, LiftVideo
from app.models.user import User
from app.schemas.lifting import (
    LiftVideoCreate,
    LiftVideoListParams,
    LiftVideoRead,
    VbtProfileResponse,
    VideoProcessStatus,
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

    # Linking to a specific set: autofill exercise / load / reps from it (the
    # client may have already done so, but the server is the source of truth).
    linked_set = None
    if payload.lifting_set_id:
        linked_set = (
            await db.execute(
                select(LiftingSet)
                .join(LiftingSession, LiftingSet.session_id == LiftingSession.id)
                .where(
                    LiftingSet.id == payload.lifting_set_id,
                    LiftingSession.user_id == current_user.id,
                )
            )
        ).scalar_one_or_none()
        if linked_set is None:
            raise HTTPException(404, "Set not found")

    video = LiftVideo(
        user_id=current_user.id,
        r2_key=payload.r2_key,
        file_name=payload.file_name,
        content_type=payload.content_type,
        size_bytes=payload.size_bytes,
        duration_seconds=payload.duration_seconds,
        exercise_name=payload.exercise_name
        or (linked_set.exercise_name if linked_set else None),
        lifting_session_id=payload.lifting_session_id
        or (linked_set.session_id if linked_set else None),
        lifting_set_id=payload.lifting_set_id,
        personal_record_id=payload.personal_record_id,
        notes=payload.notes,
        expected_reps=payload.expected_reps
        if payload.expected_reps is not None
        else (linked_set.reps if linked_set else None),
        camera_view=payload.camera_view,
        weight_kg=payload.weight_kg
        if payload.weight_kg is not None
        else (linked_set.weight_kg if linked_set else None),
    )
    db.add(video)
    await db.flush()  # BUG-015: flush only (refresh below needs it); get_db commits.
    await db.refresh(video)
    return video


@router.get("/vbt/profile", response_model=VbtProfileResponse)
async def get_vbt_profile(
    exercise_name: str = Query(..., min_length=1),
    days: int = Query(365, ge=1, le=1095),
    target_velocity: float | None = Query(None, gt=0, le=3),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Load-velocity profile + estimated 1RM for one exercise (VBT).

    Uses every analysed video of the exercise that has both a load and a
    measured velocity. The fitted line's MVT crossing estimates 1RM without a
    true max attempt. Registered before the ``/{video_id}`` routes.
    """
    from app.services.vbt import load_for_velocity, load_velocity_profile

    cutoff = datetime.now(UTC) - timedelta(days=days)
    videos = (
        (
            await db.execute(
                select(LiftVideo)
                .where(
                    LiftVideo.user_id == current_user.id,
                    LiftVideo.exercise_name == exercise_name,
                    LiftVideo.weight_kg.isnot(None),
                    LiftVideo.mean_concentric_velocity.isnot(None),
                    LiftVideo.created_at >= cutoff,
                )
                .order_by(LiftVideo.created_at)
            )
        )
        .scalars()
        .all()
    )

    profile = load_velocity_profile(
        [(v.weight_kg, v.mean_concentric_velocity) for v in videos],
        exercise_name,
    )
    return VbtProfileResponse(
        **profile.as_dict(),
        recommended_load_kg=(
            load_for_velocity(profile, target_velocity)
            if target_velocity
            else None
        ),
        points=[
            {
                "date": v.created_at.date().isoformat(),
                "load_kg": v.weight_kg,
                "velocity": v.mean_concentric_velocity,
                "reps": v.reps_count,
                "vbt_zone": v.vbt_zone,
            }
            for v in videos
        ],
    )


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
    variant: str = Query(
        "original", pattern="^(original|trimmed|overlay|thumbnails|track)$"
    ),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Resolve a presigned GET for playback (R2 must be configured).

    ``variant`` selects the object: the original upload, the trimmed clip, or
    the skeleton/bar-path overlay. 404 when that variant hasn't been produced.
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

    key = {
        "original": video.r2_key,
        "trimmed": video.trimmed_r2_key,
        "overlay": video.overlay_r2_key,
        "thumbnails": video.rep_thumbnails_r2_key,
        "track": video.pose_track_r2_key,
    }[variant]
    if not key:
        raise HTTPException(404, f"No {variant} object for this recording")
    if not _s3_configured():
        raise HTTPException(501, "R2 storage is not configured on this instance")
    try:
        from app.integrations.r2 import create_presigned_get  # lazy
    except ImportError as exc:  # boto3 optional until R2 configured
        raise HTTPException(501, "R2 storage client is not installed") from exc
    url = await create_presigned_get(key)
    return VideoStreamUrl(url=url)


@router.post("/{video_id}/process", status_code=status.HTTP_202_ACCEPTED)
async def process_video(
    video_id: uuid.UUID,
    depth: str = Query("full", pattern="^(basic|full)$"),
    force: bool = Query(False),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Trigger video processing (trim + classify) via Modal.

    Enqueues a Celery task that downloads the video from R2, runs ffmpeg
    scene detection, trims to the active segment, classifies via Gemini
    Vision, and uploads the trimmed variant. Returns 202 Accepted.
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

    if not video.r2_key:
        raise HTTPException(400, "Video has no R2 source to process")

    if video.analysis_status == "processing" and not force:
        raise HTTPException(409, "Video is already being processed")

    # Mark queued so the UI can poll until the task flips it to
    # processing/completed/failed. The task only short-circuits on
    # "completed" (and only when not forced), so this is safe for both a
    # first run and a forced reprocess.
    video.analysis_status = "queued"
    await db.flush()  # BUG-015: flush only; get_db commits at return.

    settings = get_settings()
    if not settings.modal_token_id or not settings.modal_token_secret:
        raise HTTPException(
            501, "Video processing is not configured (Modal credentials missing)"
        )

    if not _s3_configured():
        raise HTTPException(501, "R2 storage is not configured on this instance")

    # Enqueue Celery task
    from app.tasks.scheduler import process_lift_video

    process_lift_video.delay(str(video_id), analysis_depth=depth, force=force)

    return {"status": "queued", "video_id": str(video_id), "analysis_depth": depth}


@router.get("/{video_id}/process-status", response_model=VideoProcessStatus)
async def get_process_status(
    video_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Check the processing status of a video."""
    video = (
        await db.execute(
            select(LiftVideo).where(
                LiftVideo.id == video_id, LiftVideo.user_id == current_user.id
            )
        )
    ).scalar_one_or_none()
    if video is None:
        raise HTTPException(404, "Video not found")

    from app.services.video_analytics import calibrated_rpe_for

    return VideoProcessStatus(
        video_id=video.id,
        analysis_status=video.analysis_status,
        exercise_auto=video.exercise_auto,
        reps_count=video.reps_count,
        weight_kg=video.weight_kg,
        confidence=video.confidence,
        analysis_text=video.analysis_text,
        processed_at=video.processed_at,
        form_score=video.form_score,
        competition_valid=video.competition_valid,
        form_deviations=video.form_deviations,
        form_coaching_cues=video.form_coaching_cues,
        mean_concentric_velocity=video.mean_concentric_velocity,
        peak_velocity=video.peak_velocity,
        velocity_loss_pct=video.velocity_loss_pct,
        vbt_zone=video.vbt_zone,
        bar_path_json=video.bar_path_json,
        avg_rest_seconds=video.avg_rest_seconds,
        rest_cv=video.rest_cv,
        rep_consistency_score=video.rep_consistency_score,
        setup_score=video.setup_score,
        setup_duration_seconds=video.setup_duration_seconds,
        estimated_rpe=video.estimated_rpe,
        rpe_confidence=video.rpe_confidence,
        rpe_evidence_json=video.rpe_evidence_json,
        calibrated_rpe=await calibrated_rpe_for(
            db, current_user.id, video.exercise_name, video.estimated_rpe
        ),
        lifter_selected=video.lifter_selected,
        lifter_selection_json=video.lifter_selection_json,
        pose_track_r2_key=video.pose_track_r2_key,
        analysis_version=video.analysis_version,
    )


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
    # BUG-015: no explicit commit; get_db commits at return.
    return video


class VideoPatchRequest(BaseModel):
    """Partial update for a strength video (owner only)."""

    exercise_name: str | None = None
    expected_reps: int | None = None
    notes: str | None = None
    # User corrections to auto-detected fields (Phase 4 correction loop):
    camera_view: str | None = None
    weight_kg: float | None = None
    reps_count: int | None = None
    # Manual lifter override (T1): track id from the last run's
    # `lifter_selection_json`. Applied on the next reprocess.
    lifter_track_id: int | None = None


@router.patch("/{video_id}", response_model=LiftVideoRead)
async def update_video(
    video_id: uuid.UUID,
    payload: VideoPatchRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update a strength video's metadata (owner only).

    Setting `expected_reps` constrains the next reprocessing run to the
    deepest valid cycles (calibration aid for rep detection); reprocess
    via POST /{video_id}/reprocess afterwards to apply it.
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

    if payload.exercise_name is not None:
        video.exercise_name = payload.exercise_name
    if payload.expected_reps is not None:
        if payload.expected_reps < 0:
            raise HTTPException(400, "expected_reps must be >= 0")
        video.expected_reps = payload.expected_reps
    if payload.notes is not None:
        video.notes = payload.notes
    if payload.camera_view is not None:
        # "" (Not sure) normalises to None -> sagittal rules stay off.
        video.camera_view = payload.camera_view or None
    if payload.weight_kg is not None:
        if payload.weight_kg < 0:
            raise HTTPException(400, "weight_kg must be >= 0")
        video.weight_kg = payload.weight_kg
    if payload.reps_count is not None:
        if payload.reps_count < 0:
            raise HTTPException(400, "reps_count must be >= 0")
        video.reps_count = payload.reps_count
    if payload.lifter_track_id is not None:
        if payload.lifter_track_id < 0:
            raise HTTPException(400, "lifter_track_id must be >= 0")
        # Persist the override; the next reprocess forces this track.
        video.lifter_selected = payload.lifter_track_id

    await db.flush()  # BUG-015: flush only (refresh below needs it); get_db commits.
    await db.refresh(video)
    return video
