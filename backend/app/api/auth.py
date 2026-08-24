"""Auth API — OAuth authorize/callback, sync-user, /me, /logout."""

import uuid
from datetime import UTC

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.user import User
from app.schemas.auth import AuthResponse, TokenResponse, UserRead
from app.services.auth import (
    OAUTH_PROVIDERS,
    create_access_token,
    exchange_code_for_user,
    get_authorize_url,
    get_current_user,
)

router = APIRouter()


class SyncUserRequest(BaseModel):
    email: str
    name: str
    avatar_url: str | None = None
    provider: str  # google, github
    provider_user_id: str


class SyncUserResponse(BaseModel):
    user: UserRead
    access_token: str
    token_type: str = "bearer"


@router.post("/sync-user", response_model=SyncUserResponse)
async def sync_user(
    body: SyncUserRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create or find a user from NextAuth session data and return a backend JWT.

    This bridges NextAuth (frontend) with the backend user system.
    Called by NextAuth's signIn callback after successful OAuth.
    Protected by X-Internal-Secret header to prevent anonymous JWT issuance.
    """
    from app.config import get_settings as _get_settings

    _s = _get_settings()

    # Require internal API secret to prevent anonymous JWT issuance (BUG-003)
    internal_secret = request.headers.get("x-internal-secret")
    if not internal_secret or internal_secret != _s.internal_api_secret:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing or invalid internal API secret.",
        )

    if not _s.is_email_allowed(body.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account is not allowed to access FitTrack.",
        )

    # Find existing user by email
    result = await db.execute(select(User).where(User.email == body.email))
    user = result.scalar_one_or_none()

    if user is None:
        # Create new user
        user = User(
            id=uuid.uuid4(),
            email=body.email,
            name=body.name,
            avatar_url=body.avatar_url,
        )
        db.add(user)
        await db.flush()

    # Also ensure an OAuth connection exists for this provider

    from app.models.user import OAuthConnection

    conn_result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user.id,
            OAuthConnection.provider == body.provider,
        )
    )
    connection = conn_result.scalar_one_or_none()

    if connection is None:
        connection = OAuthConnection(
            id=uuid.uuid4(),
            user_id=user.id,
            provider=body.provider,
            access_token="nextauth_managed",  # NextAuth manages the actual token
            provider_user_id=body.provider_user_id,
        )
        db.add(connection)
        await db.flush()

    token = create_access_token(user.id)
    return SyncUserResponse(
        user=UserRead.model_validate(user),
        access_token=token,
    )


@router.get("/oauth/{provider}/authorize")
async def oauth_authorize(
    provider: str,
    redirect_uri: str = Query(default=None, description="Callback URL"),
    state: str = Query(default=None, description="Opaque state token (e.g. JWT) passed through to callback"),
):
    """Redirect the user to the OAuth provider's authorize page.

    Accepts an optional ``state`` parameter which is passed through to the
    callback.  The frontend should send a signed JWT here so the callback can
    identify the authenticated user (BUG-002 / BUG-018).
    """
    from app.config import get_settings

    settings = get_settings()

    if provider not in OAUTH_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    # For fitness integrations, use the backend callback URL via public_url
    if not redirect_uri and provider in ("strava", "whoop", "wahoo"):
        redirect_uri = f"{settings.public_url}/api/v1/auth/oauth/{provider}/callback"

    url = get_authorize_url(provider, redirect_uri, state=state)
    return RedirectResponse(url=url)


@router.get("/oauth/{provider}/callback")
async def oauth_callback(
    request: Request,
    provider: str,
    code: str = Query(...),
    redirect_uri: str = Query(default=None),
    state: str = Query(default=None, description="State parameter from authorize step (contains JWT)"),
    db: AsyncSession = Depends(get_db),
):
    """Handle OAuth callback, exchange code for tokens, create/find user.

    For fitness integrations (strava, whoop, wahoo): exchanges code for tokens,
    saves connection to the current user, redirects to frontend.
    For app auth (google, github): exchanges code, creates/finds user, returns JSON.

    The ``state`` parameter should contain a JWT passed from the frontend via
    the authorize step.  This is used to identify the authenticated user when
    creating the OAuth connection (BUG-002, BUG-018).
    """
    import logging as _logging

    _logger = _logging.getLogger(__name__)

    from app.config import get_settings

    _settings = get_settings()
    _frontend_url = _settings.frontend_url  # Frontend lives at /fittrack basePath

    _logger.info(
        "OAuth callback for provider=%s, code=%s..., redirect_uri=%s",
        provider,
        code[:8] if code else None,
        redirect_uri,
    )

    if provider not in OAUTH_PROVIDERS:
        if provider in ("strava", "whoop", "wahoo"):
            return RedirectResponse(
                url=f"{_frontend_url}/settings?error=Unsupported+provider:+{provider}"
            )
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    # For token exchange, we need the same redirect_uri that was used during authorization.
    token_exchange_redirect_uri = redirect_uri
    if not token_exchange_redirect_uri:
        token_exchange_redirect_uri = (
            f"{_settings.public_url}/api/v1/auth/oauth/{provider}/callback"
        )

    # For fitness integrations, save connection to existing user instead of creating new one
    if provider in ("strava", "whoop", "wahoo"):
        try:
            # Exchange code for tokens directly
            import httpx as _httpx

            cfg = OAUTH_PROVIDERS[provider]
            async with _httpx.AsyncClient() as client:
                token_resp = await client.post(
                    cfg["token_url"],
                    data={
                        "client_id": cfg["client_id"](),
                        "client_secret": cfg["client_secret"](),
                        "code": code,
                        "redirect_uri": token_exchange_redirect_uri,
                        "grant_type": "authorization_code",
                    },
                    headers={"Accept": "application/json"},
                )
                try:
                    token_data = token_resp.json()
                except Exception:
                    return RedirectResponse(
                        url=f"{_frontend_url}/settings?error={provider.title()}+HTTP+{token_resp.status_code}+{token_resp.text[:100]}"
                    )

            access_token = token_data.get("access_token")
            if not access_token:
                _logger.error(
                    "%s token exchange failed: status=%s, response=%s",
                    provider.title(),
                    token_resp.status_code,
                    token_data,
                )
                error_detail = token_data.get(
                    "error_description", token_data.get("error", "unknown")
                )
                import urllib.parse as _urlparse

                return RedirectResponse(
                    url=f"{_frontend_url}/settings?error={provider.title()}+token+exchange+failed:+{_urlparse.quote(str(error_detail))}"
                )

            refresh_token = token_data.get("refresh_token")
            from datetime import datetime as _dt
            from datetime import timedelta

            expires_in = token_data.get("expires_in")
            token_expires = None
            if expires_in:
                token_expires = _dt.now(UTC) + timedelta(seconds=int(expires_in))

            # Fetch provider user info
            async with _httpx.AsyncClient() as client:
                headers = {"Authorization": f"Bearer {access_token}"}
                userinfo_resp = await client.get(cfg["userinfo_url"], headers=headers)

                # Whoop fallback: if primary URL returns 404, try developer/v1 endpoint
                if provider == "whoop" and userinfo_resp.status_code == 404:
                    fallback_url = (
                        "https://api.prod.whoop.com/developer/v2/user/profile/basic"
                    )
                    userinfo_resp = await client.get(fallback_url, headers=headers)

                if userinfo_resp.status_code != 200:
                    return RedirectResponse(
                        url=f"{_frontend_url}/settings?error={provider.title()}+userinfo+HTTP+{userinfo_resp.status_code}+{userinfo_resp.text[:80]}"
                    )
                try:
                    userinfo = userinfo_resp.json()
                except Exception:
                    return RedirectResponse(
                        url=f"{_frontend_url}/settings?error={provider.title()}+userinfo+invalid+JSON"
                    )

            # Extract provider user ID
            if provider == "strava":
                provider_user_id = str(userinfo.get("id", ""))
            elif provider == "whoop":
                provider_user_id = str(userinfo.get("user_id", ""))
            else:
                provider_user_id = str(userinfo.get("id", ""))

            # Find existing connection or create new one for the authenticated user
            from sqlalchemy import select as _select

            from app.models.user import OAuthConnection, User

            # Resolve the authenticated user from the state parameter (JWT)
            target_user = None
            if state:
                try:
                    from app.services.auth import get_current_user_id

                    target_user_id = get_current_user_id(state)
                    if target_user_id:
                        user_result = await db.execute(
                            _select(User).where(User.id == target_user_id)
                        )
                        target_user = user_result.scalar_one_or_none()
                except Exception:
                    pass  # Invalid JWT — fall through to error

            if not target_user:
                return RedirectResponse(
                    url=f"{_frontend_url}/settings?error=Could+not+identify+authenticated+user.+Please+log+in+and+try+again."
                )

            # Check if connection already exists for THIS user (BUG-021: filter by user_id)
            conn_result = await db.execute(
                _select(OAuthConnection).where(
                    OAuthConnection.user_id == target_user.id,
                    OAuthConnection.provider == provider,
                    OAuthConnection.provider_user_id == provider_user_id,
                )
            )
            connection = conn_result.scalar_one_or_none()

            if connection:
                # Update existing connection tokens
                connection.access_token = access_token
                if refresh_token:
                    connection.refresh_token = refresh_token
                if token_expires:
                    connection.token_expires_at = token_expires
            else:
                connection = OAuthConnection(
                    user_id=target_user.id,
                    provider=provider,
                    access_token=access_token,
                    refresh_token=refresh_token,
                    token_expires_at=token_expires,
                    provider_user_id=provider_user_id,
                )
                db.add(connection)

            await db.commit()
            return RedirectResponse(
                url=f"{_frontend_url}/settings?connected={provider}"
            )

        except Exception as e:
            import logging

            logging.getLogger(__name__).error(
                f"OAuth callback error for {provider}: {e}"
            )
            import urllib.parse

            error_msg = urllib.parse.quote(str(e))
            return RedirectResponse(url=f"{_frontend_url}/settings?error={error_msg}")

    # For app auth providers (google, github), use the original flow
    try:
        user, is_new = await exchange_code_for_user(
            db, provider, code, token_exchange_redirect_uri
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    token = create_access_token(user.id)
    return AuthResponse(
        user=UserRead.model_validate(user),
        token=TokenResponse(access_token=token),
        is_new_user=is_new,
    )


@router.get("/me", response_model=UserRead)
async def get_me(
    current_user: User = Depends(get_current_user),
):
    """Return the currently authenticated user."""
    return UserRead.model_validate(current_user)


@router.post("/logout")
async def logout():
    """Logout — client should discard the JWT token."""
    return {"detail": "Logged out. Discard your access token."}
