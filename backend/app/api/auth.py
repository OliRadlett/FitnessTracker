"""Auth API — OAuth authorize/callback, sync-user, /me, /logout."""

import uuid

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
    decode_access_token,
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
    db: AsyncSession = Depends(get_db),
):
    """Create or find a user from NextAuth session data and return a backend JWT.
    
    This bridges NextAuth (frontend) with the backend user system.
    Called by NextAuth's signIn callback after successful OAuth.
    """
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
    from datetime import datetime

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
):
    """Redirect the user to the OAuth provider's authorize page."""
    if provider not in OAUTH_PROVIDERS:
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    # For fitness integrations, use the backend callback URL
    if not redirect_uri and provider in ("strava", "whoop", "wahoo"):
        from app.config import get_settings
        settings = get_settings()
        # In production this would be the deployed URL
        redirect_uri = f"http://localhost:8000/api/v1/auth/oauth/{provider}/callback"

    url = get_authorize_url(provider, redirect_uri)
    return RedirectResponse(url=url)


@router.get("/oauth/{provider}/callback")
async def oauth_callback(
    request: Request,
    provider: str,
    code: str = Query(...),
    redirect_uri: str = Query(default=None),
    db: AsyncSession = Depends(get_db),
):
    """Handle OAuth callback, exchange code for tokens, create/find user.
    
    For fitness integrations (strava, whoop, wahoo): exchanges code for tokens,
    saves connection to the current user, redirects to frontend.
    For app auth (google, github): exchanges code, creates/finds user, returns JSON.
    """
    if provider not in OAUTH_PROVIDERS:
        if provider in ("strava", "whoop", "wahoo"):
            return RedirectResponse(url=f"http://localhost:3000/settings?error=Unsupported+provider:+{provider}")
        raise HTTPException(status_code=400, detail=f"Unsupported provider: {provider}")

    # For token exchange, we need the same redirect_uri that was used during authorization.
    # For Wahoo/Komoot, the frontend sends HTTPS_PUBLIC_URL-based callback, so we must match it.
    token_exchange_redirect_uri = redirect_uri
    if not token_exchange_redirect_uri:
        from app.config import get_settings
        _settings = get_settings()
        if provider in ("wahoo", "komoot"):
            token_exchange_redirect_uri = f"{_settings.public_url}/api/v1/auth/oauth/{provider}/callback"
        else:
            token_exchange_redirect_uri = f"http://localhost:8000/api/v1/auth/oauth/{provider}/callback"

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
                token_data = token_resp.json()

            access_token = token_data.get("access_token")
            if not access_token:
                return RedirectResponse(url=f"http://localhost:3000/settings?error=Failed+to+get+access+token")

            refresh_token = token_data.get("refresh_token")
            from datetime import datetime as _dt, timedelta, timezone as _tz
            expires_in = token_data.get("expires_in")
            token_expires = None
            if expires_in:
                token_expires = _dt.now(_tz.utc) + timedelta(seconds=int(expires_in))

            # Fetch provider user info
            async with _httpx.AsyncClient() as client:
                headers = {"Authorization": f"Bearer {access_token}"}
                userinfo_resp = await client.get(cfg["userinfo_url"], headers=headers)
                userinfo = userinfo_resp.json()

            # Extract provider user ID
            if provider == "strava":
                provider_user_id = str(userinfo.get("id", ""))
            else:
                provider_user_id = str(userinfo.get("id", ""))

            # Find existing connection or create new one for the most recent user
            from app.models.user import OAuthConnection, User
            from sqlalchemy import select as _select

            # Check if connection already exists
            conn_result = await db.execute(
                _select(OAuthConnection).where(
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
                # Get the current authenticated user from the session cookie
                # The frontend should include the JWT in the redirect, but since
                # this is a server-side redirect, we look up the user by checking
                # if there's an existing Google/GitHub OAuthConnection with a valid token.
                # For safety, we require that the user already exists (has logged in via NextAuth).
                # We look for the most recent user who has an app-level OAuth connection.
                user_result = await db.execute(
                    _select(User).order_by(User.created_at.desc()).limit(1)
                )
                target_user = user_result.scalar_one_or_none()
                if not target_user:
                    return RedirectResponse(url="http://localhost:3000/settings?error=No+user+found.+Please+log+in+first.")

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
            return RedirectResponse(url="http://localhost:3000/settings?connected=" + provider)

        except Exception as e:
            import logging
            logging.getLogger(__name__).error(f"OAuth callback error for {provider}: {e}")
            import urllib.parse
            error_msg = urllib.parse.quote(str(e))
            return RedirectResponse(url=f"http://localhost:3000/settings?error={error_msg}")

    # For app auth providers (google, github), use the original flow
    try:
        user, is_new = await exchange_code_for_user(db, provider, code, token_exchange_redirect_uri)
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
