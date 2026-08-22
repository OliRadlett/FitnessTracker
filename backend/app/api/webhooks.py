"""Webhook API — Strava webhook challenge + event receiver."""

import hashlib
import hmac

from fastapi import APIRouter, HTTPException, Query, Request

from app.config import get_settings
from app.services.strava import handle_strava_event

settings = get_settings()
router = APIRouter()


def _verify_strava_signature(payload_body: bytes, signature_header: str | None) -> bool:
    """Verify the Strava X-Hub-Signature-256 header using HMAC-SHA256.

    The signature is sent as ``sha256=<hex_digest>`` of the raw request body,
    keyed with the Strava client secret.
    """
    if not signature_header:
        return False

    expected = hmac.new(
        key=settings.strava_client_secret.encode("utf-8"),
        msg=payload_body,
        digestmod=hashlib.sha256,
    ).hexdigest()
    expected_formatted = f"sha256={expected}"

    return hmac.compare_digest(expected_formatted, signature_header)


@router.get("/strava")
async def strava_webhook_challenge(
    hub_mode: str = Query(alias="hub.mode"),
    hub_verify_token: str = Query(alias="hub.verify_token"),
    hub_challenge: str = Query(alias="hub.challenge"),
):
    """Handle Strava webhook verification challenge.

    Strava sends a GET request with a challenge to verify the endpoint.
    We must echo back the challenge if the verify token matches.
    """
    if hub_mode == "subscribe" and hub_verify_token == settings.strava_verify_token:
        return {"hub.challenge": hub_challenge}
    raise HTTPException(status_code=403, detail="Verification failed")


@router.post("/strava")
async def strava_webhook_event(
    request: Request,
):
    """Receive Strava webhook events.

    Strava POSTs event data when activities are created, updated, or deleted.
    Verifies the ``X-Hub-Signature-256`` header before processing.
    """
    raw_body = await request.body()

    if not _verify_strava_signature(
        raw_body, request.headers.get("x-hub-signature-256")
    ):
        raise HTTPException(status_code=401, detail="Invalid webhook signature")

    body = await request.json()

    object_type = body.get("object_type")
    object_id = body.get("object_id")
    aspect_type = body.get("aspect_type")
    owner_id = body.get("owner_id")
    updates = body.get("updates")

    if not all([object_type, object_id, aspect_type, owner_id]):
        raise HTTPException(status_code=400, detail="Missing required fields")

    # Use a new DB session for the background event processing
    from app.database import async_session_factory

    async with async_session_factory() as db:
        try:
            await handle_strava_event(
                db=db,
                object_type=object_type,
                object_id=object_id,
                aspect_type=aspect_type,
                owner_id=owner_id,
                updates=updates,
            )
            await db.commit()
        except Exception:
            await db.rollback()
            raise

    return {"status": "ok"}
