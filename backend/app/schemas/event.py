import uuid
from datetime import date, datetime

from pydantic import BaseModel


class EventBase(BaseModel):
    name: str
    event_date: date
    event_type: str = "race"  # race, ride, lift, other
    target_tss: float | None = None
    taper_days: int = 14
    notes: str | None = None


class EventCreate(EventBase):
    pass


class EventUpdate(BaseModel):
    name: str | None = None
    event_date: date | None = None
    event_type: str | None = None
    target_tss: float | None = None
    taper_days: int | None = None
    notes: str | None = None


class EventRead(EventBase):
    id: uuid.UUID
    user_id: uuid.UUID
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class EventWithCountdown(EventRead):
    """Event with countdown and taper info."""
    days_until: int = 0
    taper_start_date: date | None = None
    days_until_taper: int | None = None
    is_in_taper: bool = False
