import uuid
from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel

# ── User ──────────────────────────────────────────────────────────────────────


class UserBase(BaseModel):
    email: str
    name: str
    avatar_url: str | None = None


class UserRead(UserBase):
    id: uuid.UUID
    created_at: datetime
    birth_date: date | None = None
    sex: str | None = None

    model_config = {"from_attributes": True}


class UserUpdate(BaseModel):
    """Optional demographics; omitted fields are left unchanged."""

    birth_date: date | None = None
    sex: Literal["male", "female", "other", "prefer_not_to_say"] | None = None


class UserCreate(BaseModel):
    email: str
    name: str
    avatar_url: str | None = None


# ── OAuth ─────────────────────────────────────────────────────────────────────


class OAuthConnectionRead(BaseModel):
    id: uuid.UUID
    provider: str
    provider_user_id: str
    created_at: datetime
    status: str = "active"
    last_synced_at: datetime | None = None
    last_refreshed_at: datetime | None = None
    last_error_at: datetime | None = None
    last_error: str | None = None
    consecutive_failures: int = 0

    model_config = {"from_attributes": True}


class OAuthCallbackState(BaseModel):
    """Encrypted state passed through the OAuth flow."""

    redirect_uri: str | None = None


# ── JWT ───────────────────────────────────────────────────────────────────────


class TokenPayload(BaseModel):
    sub: str  # user UUID as string
    exp: int | None = None
    iat: int | None = None
    jti: str | None = None  # unique token id — checked against the logout denylist


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


# ── Auth response ─────────────────────────────────────────────────────────────


class AuthResponse(BaseModel):
    user: UserRead
    token: TokenResponse
    is_new_user: bool = False
