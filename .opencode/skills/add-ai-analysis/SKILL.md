---
name: add-ai-analysis
description: Use when adding a new Gemini-powered AI analysis endpoint. Covers context compilation, Gemini API call, LlmAnalysis storage, and frontend analysis card.
---

# Add AI Analysis

Step-by-step guide for adding a new Gemini-powered analysis endpoint to FitTrack.

## Reference Implementations

- **Activity analysis**: `backend/app/services/llm_analysis.py` — `run_activity_ai_analysis()`
- **Lifting session**: `backend/app/services/llm_analysis.py` — `run_lifting_session_ai_analysis()`
- **Health analysis**: `backend/app/services/llm_analysis.py` — `run_health_ai_analysis()`
- **Event analysis**: `backend/app/services/llm_analysis.py` — `run_event_ai_analysis()`

## Files to Create/Modify

### 1. Backend: Compile Context Function

Add to `backend/app/services/llm_analysis.py`:

```python
async def compile_your_context(db: AsyncSession, user_id: UUID, entity_id: UUID) -> str:
    # Query relevant data (activities, metrics, etc.)
    # Format into a structured prompt for Gemini
    return formatted_context
```

### 2. Backend: Analysis Function

```python
async def analyze_your_data_with_gemini(context: str) -> dict:
    # Call Gemini API with context
    # Return structured analysis
    pass
```

### 3. Backend: Orchestration Function

```python
async def run_your_ai_analysis(db: AsyncSession, user_id: UUID, entity_id: UUID) -> LlmAnalysis:
    context = await compile_your_context(db, user_id, entity_id)
    analysis = await analyze_your_data_with_gemini(context)

    llm_entry = LlmAnalysis(
        user_id=user_id,
        analysis_type="your_type",  # Matches LlmAnalysis.analysis_type
        content=analysis["content"],
        entity_id=entity_id,  # Optional: link to specific entity
    )
    db.add(llm_entry)
    await db.commit()
    return llm_entry
```

### 4. API Endpoint

Add to `backend/app/api/your_resource.py`:

```python
@router.get("/your-resource/{id}/ai-analysis")
async def get_your_ai_analysis(id: UUID, db: AsyncSession = Depends(get_db), user = Depends(get_current_user)):
    # Return latest analysis or 404

@router.post("/your-resource/{id}/ai-analysis")
async def trigger_your_ai_analysis(id: UUID, db: AsyncSession = Depends(get_db), user = Depends(get_current_user)):
    # Trigger on-demand analysis
    analysis = await run_your_ai_analysis(db, user.id, id)
    return analysis
```

### 5. Frontend: API Client

Add to `frontend/src/lib/api/yourDomain.ts`:

```typescript
export async function getYourAiAnalysis(id: string) {
  return authFetch(`/api/v1/your-resource/${id}/ai-analysis`)
}

export async function triggerYourAiAnalysis(id: string) {
  return authFetch(`/api/v1/your-resource/${id}/ai-analysis`, { method: 'POST' })
}
```

### 6. Frontend: Analysis Card

Create `frontend/src/components/your-domain/YourAiAnalysisCard.tsx`:

- Uses `useQuery` for fetching analysis
- Uses `useMutation` for triggering analysis
- Shows loading state during Gemini API call
- Renders markdown analysis with `renderAnalysisText` from `lib/analysisRenderer.tsx`
- Shows user-friendly error for Gemini API failures

## LlmAnalysis Model

```python
class LlmAnalysis(Base):
    id: Mapped[UUID]
    user_id: Mapped[UUID]
    analysis_type: Mapped[str]  # "cycling", "activity", "lifting_session", "health", "event", "your_type"
    content: Mapped[str]  # Markdown analysis text
    entity_id: Mapped[Optional[UUID]]  # Optional FK to analyzed entity
    created_at: Mapped[datetime]
```

## Pitfalls

1. **GEMINI_API_KEY required** — analysis returns 400 if key not set
2. **Rate limiting** — Gemini API has quotas; add retry with backoff
3. **Large contexts** — summarize data before sending to Gemini (token limits)
4. **Error handling** — catch Gemini errors gracefully, return user-friendly message
5. **Entity linking** — use `entity_id` to link analysis to specific activity/session/event
