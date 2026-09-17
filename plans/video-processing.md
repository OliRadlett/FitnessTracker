# Video Processing: Lift Detection, Trimming & Classification

## Goal
Automatically process uploaded lift videos: detect the lift start/end, trim dead time, classify exercise/reps/weight via Gemini Vision, and store both original + trimmed variants.

## Architecture

```
Upload → R2 → DB row created → Celery task fires:
  1. Modal function downloads video from R2 (presigned GET)
  2. ffmpeg scene-change detection → find lift start/end timestamps
  3. Trim video (re-encode to clean cuts)
  4. Upload trimmed video to R2 (new key: lift_videos/{user_id}/{uuid}-trimmed.mp4)
  5. Extract key frames → Gemini Vision API → classify exercise, reps, weight
  6. Update DB: trimmed_r2_key, analysis_status, exercise_name (if auto-detected), analysis_text
  7. Server-pushed notification to user via existing NotificationBell system
```

## Changes by Layer

### 1. Modal Integration (new)

**New file: `backend/app/integrations/modal_client.py`**
- Thin wrapper around the `modal` Python SDK
- Single function: `process_lift_video(video_id: str, r2_key: str, r2_presigned_url: str) -> dict`
- Modal app definition with:
  - Container image: `debian_slim` + `apt_install("ffmpeg")` + `pip_install("httpx")`
  - Function: downloads video via httpx, runs ffmpeg scene detection + trim, uploads trimmed to R2, extracts frames, calls Gemini Vision
  - No GPU needed (ffmpeg is CPU-only, Gemini is an API call)
- Returns: `{trimmed_r2_key, duration_seconds, scene_changes, exercise, reps, weight, confidence, analysis_text}`
- Uses `modal.Remote()` for async invocation from Celery

**Config: `backend/app/config.py`**
- Add `modal_token_id: str = ""` and `modal_token_secret: str = ""`
- Modal auth via `modal token new` (browser flow) or env vars `MODAL_TOKEN_ID` + `MODAL_TOKEN_SECRET`

**Dependency: `backend/pyproject.toml`**
- Add `modal>=0.64.0`

### 2. Database Migration

**New migration: `049_add_video_processing_columns.py`**
Add to `lift_videos` table:
- `trimmed_r2_key`: `String | None` — R2 key for the trimmed variant
- `analysis_status`: `String(20), default='pending'` — `pending` | `processing` | `completed` | `failed`
- `analysis_text`: `Text | None` — Gemini's classification response
- `exercise_auto`: `String(100) | None` — auto-detected exercise name
- `reps_count`: `Integer | None` — auto-detected rep count
- `weight_kg`: `Float | None` — auto-detected weight (if visible)
- `confidence`: `Float | None` — classification confidence 0-1
- `trim_start_sec`: `Float | None` — detected lift start timestamp
- `trim_end_sec`: `Float | None` — detected lift end timestamp
- `processed_at`: `DateTime | None` — when processing completed

### 3. Model & Schema Updates

**`backend/app/models/lifting.py`** — Add new columns to `LiftVideo`
**`backend/app/schemas/lifting.py`** — Extend `LiftVideoRead` with new fields, add `VideoProcessStatus` enum

### 4. Backend API

**`backend/app/api/videos.py`** — Add endpoint:
- `POST /{video_id}/process` — Trigger video processing (enqueues Celery task, returns 202)
- `GET /{video_id}/process-status` — Check processing status (returns analysis_status + results)

**`backend/app/api/videos.py`** — Modify create endpoint:
- After creating the DB row, auto-enqueue the processing Celery task (if R2 + Modal configured)

### 5. Celery Task

**`backend/app/tasks/scheduler.py`** — Add task:
- `process_lift_video(video_id: str)` — standard task pattern with `task_session()`
- Sets `analysis_status = 'processing'`, calls Modal, updates row with results or sets `failed`
- No task-level lock needed (each video is unique)
- Fire-and-forget from the create endpoint

### 6. Modal Processing Logic

The Modal function does the heavy lifting:

**Step A — Download & Detect**
```python
# Download video from R2 presigned URL
video_bytes = httpx.get(presigned_url).content

# Write to /tmp, run ffmpeg scene detection
# Use select='gt(scene,0.3)' to find scene changes
# Parse ffmpeg output for timestamps
```

**Step B — Trim**
```python
# Find the longest continuous "active" segment (the lift)
# Add 0.5s padding on each side
# Trim with ffmpeg: -ss {start} -to {end} -c:v libx264 -c:a aac
```

**Step C — Classify via Gemini Vision**
```python
# Extract 3-5 key frames (start, middle, end of lift)
# Send to Gemini Vision as multimodal prompt:
#   "This is a weightlifting video. Classify:
#    1. Exercise name (squat, bench, deadlift, overhead press, etc.)
#    2. Number of reps performed
#    3. Weight on the bar (if visible, in kg)
#    4. Confidence level (0-1)
#    Return JSON: {exercise, reps, weight_kg, confidence, notes}"
```

**Step D — Upload & Return**
```python
# Upload trimmed video to R2
# Return results dict to Celery task
```

### 7. Frontend Updates

**`frontend/src/lib/api/types/lifting.ts`** — Extend `LiftVideo` interface:
```typescript
export interface LiftVideo {
  // ... existing fields ...
  trimmed_r2_key?: string | null;
  analysis_status?: 'pending' | 'processing' | 'completed' | 'failed';
  analysis_text?: string | null;
  exercise_auto?: string | null;
  reps_count?: number | null;
  weight_kg?: number | null;
  confidence?: number | null;
  processed_at?: string | null;
}
```

**`frontend/src/lib/api/lifting.ts`** — Add API functions:
- `processLiftVideo(authFetch, videoId)` — POST to trigger processing
- `getVideoProcessStatus(authFetch, videoId)` — GET status

**`frontend/src/components/lifting/VideoEmbed.tsx`** — Enhance:
- Show processing status badge (`pending` → spinner, `completed` → checkmark, `failed` → error)
- If `trimmed_r2_key` exists, offer "Play trimmed" / "Play original" toggle
- Show classification results below video (exercise, reps, weight)

**`frontend/src/app/(app)/lifting/videos/page.tsx`** — Enhance video cards:
- Show processing status badge on each card
- Show auto-detected exercise name (if different from user-set)
- Show reps/weight if classified
- "Process" button for failed/unprocessed videos

**`frontend/src/components/lifting/LiftVideoForm.tsx`** — Minor:
- After upload completes, show "Processing video..." message instead of just closing
- Auto-invalidate queries after a short delay to pick up processing results

### 8. Notification Integration

**`backend/app/services/notifications.py`** — Add notification type:
- `video_processed` — fired when processing completes successfully
- `video_processing_failed` — fired when processing fails
- Uses existing `create_notification()` helper → appears in NotificationBell

## File Changes Summary

| File | Change Type |
|------|-------------|
| `backend/app/integrations/modal_client.py` | **NEW** — Modal SDK wrapper |
| `backend/app/tasks/scheduler.py` | MODIFY — add `process_lift_video` task |
| `backend/app/api/videos.py` | MODIFY — add process + status endpoints |
| `backend/app/models/lifting.py` | MODIFY — add columns to LiftVideo |
| `backend/app/schemas/lifting.py` | MODIFY — extend schemas |
| `backend/app/config.py` | MODIFY — add Modal config |
| `backend/pyproject.toml` | MODIFY — add `modal` dependency |
| `backend/alembic/versions/049_add_video_processing_columns.py` | **NEW** — migration |
| `frontend/src/lib/api/types/lifting.ts` | MODIFY — extend LiftVideo type |
| `frontend/src/lib/api/lifting.ts` | MODIFY — add process/status functions |
| `frontend/src/components/lifting/VideoEmbed.tsx` | MODIFY — status badge, trim toggle, classification display |
| `frontend/src/app/(app)/lifting/videos/page.tsx` | MODIFY — status on cards |
| `frontend/src/components/lifting/LiftVideoForm.tsx` | MODIFY — post-upload processing message |

## Setup Requirements

User must:
1. Create a Modal account at modal.com (free, $30/mo compute)
2. Run `modal token new` to authenticate
3. Set `MODAL_TOKEN_ID` and `MODAL_TOKEN_SECRET` in `.env`
4. Set **spend limit to $0** on the Usage & Billing page — this ensures Modal stops all workloads before charging anything beyond the free $30/mo credits
5. Modal function deploys automatically on first invocation (or via `modal deploy`)

### Modal Budget Controls (never-pay guarantee)

Modal has three layers of spend protection:

| Control | Location | Purpose |
|---------|----------|---------|
| **Spend limit** | Usage & Billing page | Monthly cap on out-of-pocket charges (after $30 credits). Set to $0 = Modal stops workloads when free credits are exhausted. This is the key setting. |
| **Workspace budget** | Usage & Billing page | Monthly cap on total usage (before credits). Provides a hard upper bound. |
| **Environment budget** | Workspace Management → Environments | Per-environment compute cap. Useful for isolating this workload if desired. |

For this use case: estimated cost is ~$0.05/month (50 videos). The $30/mo free tier covers ~600x the expected usage. Setting spend limit to $0 ensures zero risk of charges.

## Cost Estimate

- Modal free tier: $30/mo compute credits
- Processing a 2-min lift video: ~15-30s of CPU time (~$0.001)
- At 50 videos/month: ~$0.05/month (well within free tier)
- Gemini Vision API: already configured, costs negligible per call

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| Modal cold start (5-10s first invocation) | Acceptable for async processing; user gets notification when done |
| ffmpeg scene detection not accurate for all lifts | Tunable threshold; fallback to "keep middle 80%" if no clear scenes |
| Gemini Vision misclassifies exercises | Show confidence score; let user override; use exercise_name from form if already set |
| Large videos (250MB) take time to download | Modal runs in cloud with fast internet; ~10s to download 250MB |
| Modal account requires credit card | Modal requires a payment method to create an account, but spend limit set to $0 prevents any charges. Free tier $30/mo credits cover personal use (~600x expected usage). |
