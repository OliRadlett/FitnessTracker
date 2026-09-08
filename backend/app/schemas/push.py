"""Schemas for Web Push subscription management."""

from pydantic import BaseModel


class PushSubscriptionCreate(BaseModel):
    endpoint: str
    p256dh: str
    auth: str


class PushSubscriptionRead(BaseModel):
    id: str
    endpoint: str
    created_at: str | None = None


class PushSubscriptionList(BaseModel):
    subscriptions: list[PushSubscriptionRead]
    count: int


class PushUnregister(BaseModel):
    endpoint: str | None = None
