"""Cloudflare R2 (S3-compatible) presigned-URL helpers (§1.1 videos).

Imported lazily by `app/api/videos.py` only when R2 credentials are configured,
so this module (and its `boto3` dependency) is optional: without it the video
endpoints return 501 and the URL-only embed flow keeps working.
"""

import uuid

import boto3  # pyright: ignore[reportMissingModuleSource]
from botocore.client import Config  # pyright: ignore[reportMissingModuleSource]

from app.config import get_settings


def _s3_client():
    settings = get_settings()
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.r2_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.r2_access_key_id,
        aws_secret_access_key=settings.r2_secret_access_key,
        config=Config(signature_version="s3v4"),
    )


async def create_presigned_put(
    user_id: uuid.UUID, file_name: str, content_type: str, size_bytes: int
) -> dict:
    """Build a presigned PUT for a new video upload under `lift_videos/{user_id}/`."""
    client = _s3_client()
    settings = get_settings()
    key = f"lift_videos/{user_id}/{file_name}"
    url = client.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": settings.r2_bucket,
            "Key": key,
            "ContentType": content_type,
            "ContentLengthRange": size_bytes,
            "Metadata": {"user_id": str(user_id)},
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
