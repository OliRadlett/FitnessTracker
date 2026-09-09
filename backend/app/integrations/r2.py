"""Cloudflare R2 (S3-compatible) presigned-URL helpers (§1.1 videos).

Imported lazily by `app/api/videos.py` only when R2 credentials are configured,
so this module (and its `boto3` dependency) is optional: without it the video
endpoints return 501 and the URL-only embed flow keeps working.
"""

import os
import re
import uuid

import boto3  # pyright: ignore[reportMissingModuleSource]
from botocore.client import Config  # pyright: ignore[reportMissingModuleSource]

from app.config import get_settings

# App origins that may PUT/GET videos directly against R2 from the browser.
R2_APP_ORIGINS = [
    "https://oliradlett.co.uk",
    "https://dev.oliradlett.co.uk",
    "https://localhost",
    "http://localhost:3000",
]


def _require_configured() -> None:
    settings = get_settings()
    missing = [
        name
        for name, value in {
            "R2_ACCOUNT_ID": settings.r2_account_id,
            "R2_ACCESS_KEY_ID": settings.r2_access_key_id,
            "R2_SECRET_ACCESS_KEY": settings.r2_secret_access_key,
            "R2_BUCKET": settings.r2_bucket,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(
            "R2 is not configured — missing env var(s): " + ", ".join(missing)
        )


def _s3_client():
    _require_configured()
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        region_name="auto",
        config=Config(signature_version="s3v4"),
    )


def _safe_key_component(file_name: str) -> str:
    """Sanitise an uploaded file name into a safe single-path key component."""
    base = os.path.basename(file_name.replace("\\", "/"))
    base = re.sub(r"[^\w.\- ]+", "_", base).strip().rstrip(".")
    return base or "video"


async def create_presigned_put(
    user_id: uuid.UUID, file_name: str, content_type: str, size_bytes: int
) -> dict:
    """Build a presigned PUT for a new video upload under `lift_videos/{user_id}/`."""
    client = _s3_client()
    settings = get_settings()
    # Random prefix avoids same-name upload collisions overwriting each other.
    # Ownership is enforced by the `{user_id}` prefix + server-side checks, not
    # by object metadata (so the browser PUT needs no extra x-amz-meta headers).
    key = (
        f"lift_videos/{user_id}"
        f"/{uuid.uuid4().hex[:12]}-{_safe_key_component(file_name)}"
    )
    url = client.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": settings.r2_bucket,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=3600,
    )
    return {"upload_url": url, "key": key, "fields": {}}


async def create_presigned_get(key: str) -> str:
    """Build a presigned GET for an existing uploaded video object."""
    client = _s3_client()
    settings = get_settings()
    url = client.generate_presigned_url(
        ClientMethod="get_object",
        Params={"Bucket": settings.r2_bucket, "Key": key},
        ExpiresIn=3600,
    )
    return url


async def delete_object(key: str) -> None:
    """Delete an object from R2. Raises on failure (caller handles best-effort)."""
    client = _s3_client()
    settings = get_settings()
    client.delete_object(Bucket=settings.r2_bucket, Key=key)


async def configure_bucket_cors(origins: list[str] | None = None) -> None:
    """Set the R2 bucket CORS rule required for browser presigned PUT/GET.

    R2 has no CORS UI — the rule must be applied via the S3 API. Idempotent;
    re-run after changing `R2_APP_ORIGINS` or the app's domains.
    """
    client = _s3_client()
    settings = get_settings()
    client.put_bucket_cors(
        Bucket=settings.r2_bucket,
        CORSConfiguration={
            "CORSRules": [
                {
                    "AllowedHeaders": ["*"],
                    "AllowedMethods": ["PUT", "GET", "HEAD"],
                    "AllowedOrigins": origins or R2_APP_ORIGINS,
                    "ExposeHeaders": ["ETag"],
                    "MaxAgeSeconds": 3600,
                }
            ]
        },
    )
