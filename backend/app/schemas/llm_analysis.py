"""LLM Analysis schemas."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class LlmAnalysisRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    activity_id: UUID | None = None
    lifting_session_id: UUID | None = None
    event_id: UUID | None = None
    analysis_type: str = "cycling"
    analysis_date: date
    stats_json: dict
    analysis_text: str
    model_used: str
    created_at: datetime


class LlmAnalysisSummary(BaseModel):
    """Lightweight version without the full stats JSON."""

    model_config = {"from_attributes": True}

    id: UUID
    activity_id: UUID | None = None
    lifting_session_id: UUID | None = None
    event_id: UUID | None = None
    analysis_type: str = "cycling"
    analysis_date: date
    analysis_text: str
    model_used: str
    created_at: datetime
