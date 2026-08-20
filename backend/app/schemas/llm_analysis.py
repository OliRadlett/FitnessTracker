"""LLM Analysis schemas."""

from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel


class LlmAnalysisRead(BaseModel):
    model_config = {"from_attributes": True}

    id: UUID
    analysis_date: date
    stats_json: dict
    analysis_text: str
    model_used: str
    created_at: datetime


class LlmAnalysisSummary(BaseModel):
    """Lightweight version without the full stats JSON."""
    model_config = {"from_attributes": True}

    id: UUID
    analysis_date: date
    analysis_text: str
    model_used: str
    created_at: datetime
