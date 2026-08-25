"""Auth service — Google/GitHub OAuth, JWT, session management."""

import uuid
from datetime import UTC, datetime, timedelta

import httpx
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import get_settings
from app.database import get_db
from app.models.user import OAuthConnection, User
from app.schemas.auth import TokenPayload

settings = get_settings()

# ── JWT helpers ───────────────────────────────────────────────────────────────

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 30  # 30 days


def create_access_token(user_id: uuid.UUID) -> str:
    expire = datetime.now(UTC) + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "exp": expire, "iat": datetime.now(UTC)}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def decode_access_token(token: str) -> TokenPayload | None:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
        return TokenPayload(**payload)
    except JWTError:
        return None


def get_current_user_id(token: str) -> uuid.UUID | None:
    """Extract user ID from a JWT token string. Returns None on failure."""
    import uuid as _uuid

    token_data = decode_access_token(token)
    if token_data is None:
        return None
    try:
        return _uuid.UUID(token_data.sub)
    except (ValueError, AttributeError):
        return None


# ── OAuth provider configs ────────────────────────────────────────────────────

OAUTH_PROVIDERS: dict[str, dict] = {
    "google": {
        "authorize_url": "https://accounts.google.com/o/oauth2/v2/auth",
        "token_url": "https://oauth2.googleapis.com/token",
        "userinfo_url": "https://www.googleapis.com/oauth2/v2/userinfo",
        "client_id": lambda: settings.google_client_id,
        "client_secret": lambda: settings.google_client_secret,
        "scopes": "openid email profile",
    },
    "github": {
        "authorize_url": "https://github.com/login/oauth/authorize",
        "token_url": "https://github.com/login/oauth/access_token",
        "userinfo_url": "https://api.github.com/user",
        "client_id": lambda: settings.github_client_id,
        "client_secret": lambda: settings.github_client_secret,
        "scopes": "read:user user:email",
    },
    "strava": {
        "authorize_url": "https://www.strava.com/oauth/authorize",
        "token_url": "https://www.strava.com/oauth/token",
        "userinfo_url": "https://www.strava.com/api/v3/athlete",
        "client_id": lambda: settings.strava_client_id,
        "client_secret": lambda: settings.strava_client_secret,
        "scopes": "read,activity:read_all",
    },
    # Komoot removed — OAuth doesn't work; uses Basic Auth via komoot_email/komoot_password in settings
    "wahoo": {
        "authorize_url": "https://api.wahooligan.com/oauth/authorize",
        "token_url": "https://api.wahooligan.com/oauth/token",
        "userinfo_url": "https://api.wahooligan.com/v1/user",
        "client_id": lambda: settings.wahoo_client_id,
        "client_secret": lambda: settings.wahoo_client_secret,
        "scopes": "user_read workouts_read routes_read",
    },
    "whoop": {
        "authorize_url": "https://api.prod.whoop.com/oauth/oauth2/auth",
        "token_url": "https://api.prod.whoop.com/oauth/oauth2/token",
        "userinfo_url": "https://api.prod.whoop.com/developer/v2/user/profile/basic",
        "client_id": lambda: settings.whoop_client_id,
        "client_secret": lambda: settings.whoop_client_secret,
        "scopes": "offline read:recovery read:cycles read:sleep read:workout read:profile read:body_measurement",
    },
}


def get_authorize_url(provider: str, redirect_uri: str, state: str | None = None) -> str:
    """Build the OAuth authorize URL for the given provider.

    If *state* is provided it is passed through to the provider so the callback
    can correlate the request (BUG-002 / BUG-018).
    """
    import urllib.parse

    cfg = OAUTH_PROVIDERS[provider]
    client_id = cfg["client_id"]()
    scopes = cfg["scopes"]

    if provider == "google":
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scopes,
            "access_type": "offline",
            "prompt": "consent",
        }
        if state:
            params["state"] = state
        return f"{cfg['authorize_url']}?{urllib.parse.urlencode(params)}"
    elif provider == "github":
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "scope": scopes,
        }
        if state:
            params["state"] = state
        return f"{cfg['authorize_url']}?{urllib.parse.urlencode(params)}"
    elif provider == "strava":
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scopes,
            "approval_prompt": "auto",
        }
        if state:
            params["state"] = state
        return f"{cfg['authorize_url']}?{urllib.parse.urlencode(params)}"
    elif provider == "wahoo":
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scopes,
        }
        if state:
            params["state"] = state
        return f"{cfg['authorize_url']}?{urllib.parse.urlencode(params)}"
    elif provider == "whoop":
        import secrets

        # Use the provided state or generate a random one for Whoop's minimum requirement
        whoop_state = state or secrets.token_hex(8)
        params = {
            "client_id": client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": scopes,
            "state": whoop_state,
        }
        return f"{cfg['authorize_url']}?{urllib.parse.urlencode(params)}"
    raise ValueError(f"Unsupported provider: {provider}")


async def exchange_code_for_user(
    db: AsyncSession,
    provider: str,
    code: str,
    redirect_uri: str,
) -> tuple[User, bool]:
    """Exchange OAuth code for tokens, find or create user. Returns (user, is_new)."""
    from fastapi import HTTPException as _HTTPException
    from fastapi import status as _status

    cfg = OAUTH_PROVIDERS[provider]
    client_id = cfg["client_id"]()
    client_secret = cfg["client_secret"]()

    import logging

    logger = logging.getLogger(__name__)

    # Exchange code for token
    async with httpx.AsyncClient() as client:
        token_resp = await client.post(
            cfg["token_url"],
            data={
                "client_id": client_id,
                "client_secret": client_secret,
                "code": code,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
            },
            headers={"Accept": "application/json"},
        )
        logger.info(
            f"Token exchange response from {provider}: status={token_resp.status_code}, headers={dict(token_resp.headers)}, body={token_resp.text[:500]}"
        )
        try:
            token_data = token_resp.json()
        except Exception:
            logger.error(
                f"Failed to parse token response as JSON from {provider}: status={token_resp.status_code}, body={token_resp.text[:500]}"
            )
            raise ValueError(
                f"Token exchange failed for {provider}: HTTP {token_resp.status_code}, body={token_resp.text[:200]}"
            )

    access_token = token_data.get("access_token")
    if not access_token:
        raise ValueError(f"Failed to get access token from {provider}: {token_data}")

    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")
    token_expires = None
    if expires_in:
        token_expires = datetime.now(UTC) + timedelta(seconds=int(expires_in))

    # Fetch user info
    async with httpx.AsyncClient() as client:
        headers = {"Authorization": f"Bearer {access_token}"}
        if provider == "github":
            headers["Accept"] = "application/vnd.github+json"
        userinfo_resp = await client.get(cfg["userinfo_url"], headers=headers)
        userinfo = userinfo_resp.json()

    # Extract user details based on provider
    if provider == "google":
        provider_user_id = userinfo["id"]
        email = userinfo["email"]
        name = userinfo.get("name", email)
        avatar_url = userinfo.get("picture")
    elif provider == "github":
        provider_user_id = str(userinfo["id"])
        email = userinfo.get("email") or f"{userinfo['login']}@github.local"
        name = userinfo.get("name") or userinfo["login"]
        avatar_url = userinfo.get("avatar_url")
    elif provider == "strava":
        provider_user_id = str(userinfo.get("id", ""))
        firstname = userinfo.get("firstname", "")
        lastname = userinfo.get("lastname", "")
        name = f"{firstname} {lastname}".strip() or "Strava Athlete"
        email = f"strava_{provider_user_id}@strava.local"
        avatar_url = userinfo.get("profile")
    elif provider == "komoot":
        provider_user_id = str(userinfo.get("username", userinfo.get("id", "")))
        firstname = userinfo.get("firstname", "")
        lastname = userinfo.get("lastname", "")
        name = f"{firstname} {lastname}".strip() or "Komoot User"
        email = f"komoot_{provider_user_id}@komoot.local"
        avatar_url = (
            userinfo.get("picture", {}).get("url")
            if isinstance(userinfo.get("picture"), dict)
            else None
        )
    elif provider == "wahoo":
        provider_user_id = str(userinfo.get("id", ""))
        name = (
            userinfo.get("name", "")
            or f"{userinfo.get('first', '')} {userinfo.get('last', '')}".strip()
            or "Wahoo User"
        )
        email = userinfo.get("email") or f"wahoo_{provider_user_id}@wahoo.local"
        avatar_url = None
    elif provider == "whoop":
        provider_user_id = str(userinfo.get("user_id", ""))
        first = userinfo.get("first_name", "")
        last = userinfo.get("last_name", "")
        name = f"{first} {last}".strip() or "Whoop User"
        email = userinfo.get("email") or f"whoop_{provider_user_id}@whoop.local"
        avatar_url = None
    else:
        raise ValueError(f"Unsupported provider: {provider}")

    # Check email allowlist for app auth providers (google, github)
    if provider in ("google", "github") and not settings.is_email_allowed(email):
        raise _HTTPException(
            status_code=_status.HTTP_403_FORBIDDEN,
            detail="This account is not allowed to access FitTrack.",
        )

    # Look up existing connection
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.provider == provider,
            OAuthConnection.provider_user_id == provider_user_id,
        )
    )
    connection = result.scalar_one_or_none()

    is_new = False
    if connection:
        # Update tokens
        user = await db.get(User, connection.user_id)
        if user is None:
            raise ValueError("User not found for existing connection")
        connection.access_token = access_token
        if refresh_token:
            connection.refresh_token = refresh_token
        if token_expires:
            connection.token_expires_at = token_expires
    else:
        # Check if user exists by email
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()

        if user is None:
            user = User(email=email, name=name, avatar_url=avatar_url)
            db.add(user)
            await db.flush()
            is_new = True

        connection = OAuthConnection(
            user_id=user.id,
            provider=provider,
            access_token=access_token,
            refresh_token=refresh_token,
            token_expires_at=token_expires,
            provider_user_id=provider_user_id,
            provider_metadata=userinfo,
        )
        db.add(connection)

    await db.flush()
    return user, is_new


# ── FastAPI dependency ────────────────────────────────────────────────────────

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """FastAPI dependency that extracts the current user from JWT."""
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated"
        )

    token_data = decode_access_token(credentials.credentials)
    if token_data is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token"
        )

    try:
        user_id = uuid.UUID(token_data.sub)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload"
        )

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found"
        )

    return user
