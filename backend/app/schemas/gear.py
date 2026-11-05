import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class GearRead(BaseModel):
    """A gear item plus its wear state.

    ``wear_percent`` / ``wear_remaining_meters`` are derived, not stored: the
    interval is the user's and can be changed at any time, while the distance is
    the provider's. ``wear_percent`` is None until a threshold is set — the app
    does not invent service intervals.
    """

    id: uuid.UUID
    provider: str
    name: str
    kind: str
    brand_name: str | None = None
    model_name: str | None = None
    #: The provider's lifetime metres for this item, including use before
    #: FitTrack existed.
    distance_meters: float | None = None
    distance_synced_at: datetime | None = None
    wear_threshold_meters: float | None = None
    wear_percent: float | None = None
    wear_remaining_meters: float | None = None
    retired_at: datetime | None = None


class GearUpdate(BaseModel):
    """Editable gear fields.

    Omitted fields are left alone; there is deliberately no way to *clear* the
    threshold through this schema (a service interval is set, not unset), and
    ``retired`` is a toggle rather than a timestamp so the client does not have to
    invent one.
    """

    name: str | None = Field(default=None, min_length=1, max_length=255)
    wear_threshold_meters: float | None = Field(default=None, gt=0, le=10_000_000)
    retired: bool | None = None
