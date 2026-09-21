# Modal Inference Expansion: Lifting Video Intelligence

> **Implementation status (2026-09-20): substantially shipped** (PR #19 — commit
> `b8772e2 "video analysis UI — form score, velocity, RPE, coaching cues"`; migrations
> 049/051/052/053). Form scoring, velocity/VBT, setup, consistency, RPE estimation, and the
> `RpeCalibration` + `LiftVideoAnalysis` models are in the codebase; the frontend ships them
> consolidated in `VideoAnalysisPanel` (not the per-metric cards §11.1 names). **Still open**:
> `video_*_trend` charts (§10.4), `aggregate_video_analyses` weekly task (only the table +
> model docstring exist), RPE auto-calibration computation + weekly recalibration task,
> injury-flag `HealthAlert`s, and Phase 7 (lifting TSS). Phase checkboxes in §14 updated
> accordingly — unchecked boxes below are the remaining work, not the whole plan.
> **Decision 2026-09-20:** all remaining boxes approved into `plans/backlog-2026-09-20.md`
> (B-26…B-31).

## Executive Summary

We have Modal serverless compute + Gemini Vision integrated for basic video trimming and exercise classification. This plan expands that pipeline into a full **lifting intelligence platform** — extracting form quality, bar velocity, rest timing, consistency, setup analysis, and estimated RPE from uploaded videos.

**Current state**: 3 key frames → Gemini Vision → exercise/reps/weight classification.
**Target state**: Dense frame sampling → multi-pass Gemini Vision analysis → structured biomechanical metrics → trend analytics → AI coaching insights.

---

## 1. Architecture: Extended Modal Pipeline

### 1.1 Current Flow
```
Upload → R2 → Celery → Modal:
  ffmpeg scene detect → trim → extract 3 frames → Gemini Vision (classify) → R2
```

### 1.2 Enhanced Flow
```
Upload → R2 → Celery → Modal:
  ffmpeg scene detect → trim →
    ├─ Pass 1: Dense frame extraction (1 fps) → Gemini Vision (form + velocity)
    ├─ Pass 2: Set boundary detection → rest period measurement
    ├─ Pass 3: Per-set frame analysis → consistency scoring
    └─ Pass 4: Synthesis → structured JSON metrics → R2 + DB
```

### 1.3 Modal Image Update

The Modal container image needs `google-genai` explicitly (currently imported inside the function but not declared in the image):

```python
_modal_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("ffmpeg")
    .pip_install("httpx", "google-genai")
)
```

### 1.4 Modal Function Signature Change

Currently: single `_process()` function doing everything.
Proposed: keep single function but add a `analysis_depth` parameter:

```python
@app.function(timeout=600, memory=2048)  # bump from 300s/1GB
def _process(presigned_get, presigned_put, upload_key, gemini_key, analysis_depth="full"):
    # analysis_depth: "basic" (current behavior) | "full" (new deep analysis)
```

**Memory bump**: 1GB → 2GB (dense frame extraction creates more temp files).
**Timeout bump**: 5min → 10min (multi-pass Gemini calls).

---

## 2. Feature: Form Analysis

### 2.1 What It Measures

For each detected set in the video, analyze body positioning and bar path:

| Metric | Description | Exercise-Specific |
|--------|-------------|-------------------|
| `back_angle` | Torso lean angle during descent/ascent | Squat, Deadlift |
| `knee_tracking` | Knee path relative to toes | Squat, Leg Press |
| `bar_path` | Vertical bar displacement symmetry | Squat, Bench, OHP |
| `depth` | Hip crease below knee (squat) | Squat |
| `lockout` | Full extension at top | All compounds |
| `elbow_position` | Elbow flare vs tucked | Bench Press |
| `hip_hinge` | Hip movement pattern | Deadlift, RDL |
| `head_position` | Neutral spine indicator | All compounds |
| `stance_width` | Foot placement consistency | Squat, Deadlift |
| `grip_width` | Hand placement symmetry | Bench, OHP |

### 2.2 Implementation

**Modal function (Pass 1)**: Extract frames at 1fps through the trimmed segment. For each set boundary (detected via scene changes or velocity drops), send 5-8 frames to Gemini Vision with a form-specific prompt:

```python
FORM_PROMPT = """
Analyze this weightlifting video frame sequence for {exercise_name}.
For each frame, evaluate:
1. Body joint angles (back angle, knee angle, hip angle)
2. Bar path verticality and symmetry
3. Depth (if squat: is hip crease below knee?)
4. Lockout completeness at top
5. Any form deviations or asymmetries

Return JSON:
{
  "sets": [{
    "set_number": N,
    "frames_analyzed": N,
    "form_score": 0-100,
    "back_angle_deg": N.N,
    "depth_achieved": true/false,
    "lockout_complete": true/false,
    "bar_path_vertical": true/false,
    "deviations": ["list of observed issues"],
    "severity": "none"|"minor"|"moderate"|"major"
  }],
  "overall_form_score": 0-100,
  "top_deviation": "most common issue",
  "coaching_cues": ["actionable suggestions"]
}
"""
```

**Backend model addition** (`lift_videos` table, migration 050):

```python
# Form analysis results
form_score: Mapped[float | None]           # overall 0-100
form_analysis_json: Mapped[str | None]     # JSONB — full per-set form data
form_deviations: Mapped[str | None]        # comma-separated top issues
form_coaching_cues: Mapped[str | None]     # JSONB — actionable suggestions
```

**Frontend display**: New `FormAnalysisCard` component on the video detail view showing:
- Overall form score gauge (0-100, color-coded)
- Per-set breakdown with deviation flags
- Coaching cues as actionable tips
- Trend chart: form score over time for the same exercise

### 2.3 Cost Impact

- Dense frame extraction: ~60 frames/min of video → 2-min video = 120 frames
- Gemini Vision: ~$0.002 per 1K frames (flash model)
- Per video: ~$0.001-0.003 additional
- At 50 videos/month: ~$0.05-0.15 additional

---

## 3. Feature: Bar Speed / Velocity Tracking

### 3.1 What It Measures

| Metric | Description | Use Case |
|--------|-------------|----------|
| `concentric_velocity_mps` | Bar speed during lifting phase (m/s) | VBT auto-regulation |
| `eccentric_velocity_mps` | Bar speed during lowering phase | Control assessment |
| `velocity_loss_pct` | Speed drop from first to last rep | Fatigue proxy |
| `peak_velocity_mps` | Maximum bar speed in set | Power output |
| `mean_velocity_mps` | Average bar speed across reps | Training load indicator |
| `velocity_profile` | Per-rep speed list | Consistency analysis |

### 3.2 Implementation

**Approach**: Frame-by-frame bar position tracking via Gemini Vision, then velocity = Δposition / Δtime.

**Modal function (enhanced Pass 1)**: For each rep, extract frames at the concentric phase boundaries. Send pairs of frames to Gemini Vision:

```python
VELOCITY_PROMPT = """
Analyze these two consecutive frames from a {exercise_name} video.
Frame A is at time {t1}s, Frame B is at time {t2}s.

Estimate:
1. Bar vertical position in each frame (as % of total range of motion)
2. Whether this represents concentric (lifting) or eccentric (lowering) phase
3. Estimated bar displacement between frames

Return JSON:
{
  "rep_number": N,
  "phase": "concentric"|"eccentric",
  "position_a_pct": N.N,
  "position_b_pct": N.N,
  "displacement_pct": N.N,
  "velocity_relative": "fast"|"moderate"|"slow"
}
"""
```

**Velocity calculation**: Since we know frame timestamps from ffmpeg, velocity = (displacement_pct × estimated_ROM_m) / (t2 - t1). ROM estimation per exercise:
- Squat: ~0.5m (varies with height)
- Bench: ~0.4m
- Deadlift: ~0.45m
- OHP: ~0.5m

**Backend model addition**:

```python
# Velocity tracking
mean_concentric_velocity: Mapped[float | None]    # m/s
peak_velocity: Mapped[float | None]               # m/s
velocity_loss_pct: Mapped[float | None]           # first→last rep drop
velocity_profile_json: Mapped[str | None]         # JSONB — per-rep velocities
```

**Frontend**: New velocity panel on video detail:
- Per-rep velocity bar chart
- Velocity loss % with threshold indicators (green <10%, yellow 10-20%, red >20%)
- Comparison to VBT zones (strength: >0.5 m/s, power: 0.5-0.8, speed-strength: 0.8-1.0)

### 3.3 VBT Zone Reference

| Zone | Velocity Range | Training Effect |
|------|---------------|-----------------|
| Max Strength | < 0.5 m/s | 1-3RM, neural drive |
| Strength-Speed | 0.5 - 0.7 m/s | Heavy compounds |
| Power | 0.7 - 1.0 m/s | Explosive strength |
| Speed-Strength | 1.0 - 1.3 m/s | Loaded speed |
| Speed | > 1.3 m/s | Unloaded/explosive |

---

## 4. Feature: Mid-Set Rest Timing

### 4.1 What It Measures

| Metric | Description |
|--------|-------------|
| `rest_periods` | List of rest durations between sets (seconds) |
| `avg_rest_seconds` | Mean rest period |
| `rest_consistency_cv` | Coefficient of variation of rest times |
| `target_rest_adherence` | How close actual rest is to target (if known) |
| `longest_rest` | Maximum rest period |
| `shortest_rest` | Minimum rest period |

### 4.2 Implementation

**Set boundary detection**: The existing scene detection already finds transitions. Enhance it to classify transitions as:
- **Set start**: Camera angle changes, lifter approaches bar
- **Set end**: Lifter steps away, re-racks
- **Rest period**: Static camera, no lifting activity

**Modal function (Pass 2)**: After initial scene detection, classify each scene transition:

```python
REST_PROMPT = """
Analyze these consecutive video segments to determine if they represent
a rest period between lifting sets or part of the same set.

Segment 1 ends at {t1}s, Segment 2 starts at {t2}s.
Gap duration: {gap_seconds}s.

Classify:
1. Is this a rest period between sets? (yes/no)
2. What activity is occurring during the gap? (resting, walking, adjusting weights, etc.)
3. Is the lifter still near the bar or have they stepped away?

Return JSON:
{
  "is_rest_period": true/false,
  "rest_activity": "resting"|"adjusting"|"walking"|"chatting"|"other",
  "confidence": 0.0-1.0
}
"""
```

**Heuristic fallback**: If Gemini says "resting" and gap > 30s, it's almost certainly a rest period. This reduces Gemini calls for obvious cases.

**Backend model addition**:

```python
# Rest timing
rest_periods_json: Mapped[str | None]     # JSONB — list of rest durations
avg_rest_seconds: Mapped[float | None]
rest_cv: Mapped[float | None]            # coefficient of variation
```

**Frontend**: 
- Rest period timeline visualization on video detail
- Average rest with comparison to recommended ranges (3-5 min for strength, 1-2 min for hypertrophy)
- Rest consistency score

---

## 5. Feature: Rep Consistency Analysis

### 5.1 What It Measures

| Metric | Description |
|--------|-------------|
| `rep_consistency_score` | 0-100, how similar reps are to each other |
| `tempo_consistency` | CV of rep durations |
| `depth_consistency` | Variance in bottom position across reps |
| `path_consistency` | Variance in bar path across reps |
| `speed_consistency` | Variance in concentric velocity across reps |
| `rep_timing_json` | Per-rep duration list |

### 5.2 Implementation

**Modal function (Pass 3)**: For each detected rep, extract the key frame at the bottom position and the key frame at lockout. Compare across reps:

```python
CONSISTENCY_PROMPT = """
These are frames from the bottom position of each rep in a set of {exercise_name}.
There are {rep_count} reps total.

Compare the body positions across all reps:
1. Is the depth consistent across all reps?
2. Is the bar position consistent at the bottom?
3. Are there any reps that look significantly different from the others?

Return JSON:
{
  "rep_count": N,
  "depth_consistent": true/false,
  "bar_position_consistent": true/false,
  "outlier_reps": [list of rep numbers that differ],
  "consistency_score": 0-100,
  "notes": "brief explanation"
}
"""
```

**Backend model addition**:

```python
# Consistency
rep_consistency_score: Mapped[float | None]     # 0-100
tempo_consistency_cv: Mapped[float | None]      # CV of rep durations
rep_timing_json: Mapped[str | None]             # JSONB — per-rep durations
```

**Frontend**:
- Consistency score gauge
- Rep timing waterfall chart (each rep's concentric + eccentric duration)
- Outlier rep highlighting

---

## 6. Feature: Setup Analysis

### 6.1 What It Measures

| Metric | Description |
|--------|-------------|
| `setup_quality_score` | 0-100, how well the lifter sets up before the first rep |
| `setup_duration_seconds` | Time from approach to first rep |
| `bracing_detected` | Whether the lifter appears to brace before lifting |
| `foot_position_notes` | Observations about stance |
| `grip_check_notes` | Observations about grip setup |
| `setup_coaching_cues` | Actionable suggestions for setup improvement |

### 6.2 Implementation

**Modal function (new pass)**: Extract frames from the first 3-5 seconds before the first rep (the "setup phase"):

```python
SETUP_PROMPT = """
Analyze these frames from the setup phase of a {exercise_name}.

The lifter is preparing to perform the first rep. Evaluate:
1. Foot positioning and stance width
2. Hand/grip placement on the bar
3. Back position and spinal alignment
4. Bracing/core engagement (visible abdominal expansion)
5. Bar position relative to body (for squats: on traps vs low bar)
6. Overall setup routine and readiness

Return JSON:
{
  "setup_score": 0-100,
  "setup_duration_seconds": N.N,
  "bracing_detected": true/false,
  "foot_position": "description",
  "grip_notes": "description",
  "back_alignment": "neutral"|"rounded"|"overextended",
  "bar_position": "description",
  "deviations": ["list of issues"],
  "coaching_cues": ["actionable suggestions"]
}
"""
```

**Backend model addition**:

```python
# Setup analysis
setup_score: Mapped[float | None]              # 0-100
setup_analysis_json: Mapped[str | None]        # JSONB — full setup data
setup_duration_seconds: Mapped[float | None]
```

**Frontend**:
- Setup score badge on video detail
- Frame-by-frame setup breakdown
- Comparison to ideal setup checklist per exercise

---

## 7. Feature: Estimated RPE from Video

### 7.1 What It Measures

| Metric | Description |
|--------|-------------|
| `estimated_rpe` | AI-estimated RPE based on video evidence |
| `rpe_confidence` | How confident the estimate is (0-1) |
| `rpe_evidence` | List of visual cues used for estimation |
| `rpe_breakdown` | Per-set RPE estimates |

### 7.2 Implementation

**Approach**: Combine multiple signals from the video analysis to estimate RPE without asking the user:

1. **Bar speed** (from velocity tracking): Slower concentric = higher RPE
2. **Rep consistency** (from consistency analysis): Declining consistency = fatigue
3. **Form breakdown** (from form analysis): Form degradation = high RPE
4. **Rest periods** (from rest timing): Longer rests = accumulating fatigue
5. **Facial expression** (from Gemini Vision): Visible strain indicators

```python
RPE_PROMPT = """
Based on the following analysis of a {exercise_name} set, estimate the RPE
(Rate of Perceived Exertion) on a 1-10 scale.

Evidence:
- Bar velocity: {velocity_data}
- Rep consistency: {consistency_data}
- Form breakdown: {form_data}
- Rest periods: {rest_data}
- Set number: {set_number} of {total_sets}
- Weight: {weight_kg}kg × {reps} reps
- Velocity loss: {velocity_loss}%

Consider:
- RPE 1-3: Easy, could do 5+ more reps
- RPE 4-6: Moderate, 3-4 more reps possible
- RPE 7-8: Hard, 2-3 more reps possible
- RPE 9-10: Maximum effort, 0-1 more reps possible

Return JSON:
{
  "estimated_rpe": N.N,
  "confidence": 0.0-1.0,
  "evidence": ["list of visual cues used"],
  "reasoning": "brief explanation"
}
"""
```

**Backend model addition**:

```python
# Estimated RPE
estimated_rpe: Mapped[float | None]            # 1-10
rpe_confidence: Mapped[float | None]          # 0-1
rpe_evidence_json: Mapped[str | None]         # JSONB — list of cues
```

**Frontend**:
- RPE estimate badge alongside user-entered RPE
- Confidence indicator
- Evidence list for transparency
- RPE accuracy tracking: compare AI estimate vs user RPE over time

---

## 8. Additional Inference Opportunities

### 8.1 Exercise Variation Auto-Detection

Detect specific exercise variations from video:
- High bar vs low bar squat
- Conventional vs sumo deadlift
- Close grip vs wide grip bench
- Pause reps vs touch-and-go
- Competition style vs training style

**Use**: Auto-populate exercise details, improve training log accuracy.

### 8.2 Injury Risk Flags

From form analysis, flag potential injury risks:
- **Knee valgus**: Knees caving inward during squat
- **Lower back rounding**: Lumbar flexion during deadlift
- **Shoulder impingement**: Elbow flare during bench
- **Neck strain**: Head position during OHP

**Use**: Generate health alerts (existing `HealthAlert` model), proactive injury prevention.

### 8.3 Training Load Estimation (Lifting TSS)

Using velocity-based training principles, estimate a lifting TSS:
- Volume load (weight × reps × sets)
- Intensity relative to estimated 1RM
- Velocity-based fatigue (velocity loss as fatigue proxy)
- Time under tension

**Use**: Unified training load metric combining cycling TSS + lifting TSS.

### 8.4 Progress Video Comparison

Compare form/velocity across videos of the same exercise over time:
- Form score trend
- Velocity trend (are you getting faster at the same weight?)
- Consistency improvement
- Setup routine evolution

**Use**: New "Progress" tab on exercise detail pages.

### 8.5 Warmup Effectiveness Analysis

Analyze warmup sets vs working sets:
- Did velocity improve from warmup to working sets?
- Was the warmup progression appropriate?
- Rest periods between warmup sets

**Use**: Optimize warmup template suggestions.

---

## 9. Database Schema Changes

### 9.1 Migration 050: Video Analysis Expansion

17 new columns on `lift_videos`:

```python
# ── Form analysis (IPF standards) ──
form_score: Float | None                    # 0-100 quality score
competition_valid: Boolean | None           # IPF pass/fail
form_analysis_json: String | None           # JSONB — per-set form data
form_deviations: String | None              # JSONB — list of deviations
form_coaching_cues: String | None           # JSONB — actionable suggestions

# ── Velocity tracking ──
mean_concentric_velocity: Float | None      # m/s
peak_velocity: Float | None                 # m/s
velocity_loss_pct: Float | None             # first→last rep drop
velocity_profile_json: String | None        # JSONB — per-rep velocities
vbt_zone: String | None                     # "absolute_strength"|"maximum_strength"|etc.

# ── Rest timing ──
rest_periods_json: String | None            # JSONB — list of rest durations
avg_rest_seconds: Float | None
rest_cv: Float | None                       # coefficient of variation

# ── Consistency ──
rep_consistency_score: Float | None         # 0-100
tempo_consistency_cv: Float | None
rep_timing_json: String | None              # JSONB — per-rep durations

# ── Setup analysis ──
setup_score: Float | None                   # 0-100
setup_analysis_json: String | None          # JSONB — full setup data
setup_duration_seconds: Float | None

# ── Estimated RPE ──
estimated_rpe: Float | None                 # 1-10
rpe_confidence: Float | None                # 0-1
rpe_evidence_json: String | None            # JSONB — list of cues
```

### 9.2 Migration 051: RPE Calibration Table

```python
class RpeCalibration(Base):
    __tablename__ = "rpe_calibrations"
    
    id: UUID PK
    user_id: UUID FK → users, indexed
    exercise_name: String(255), nullable     # NULL = aggregate across all
    
    sample_count: Integer, default=0
    mean_delta: Float, default=0.0           # avg(user_rpe - ai_rpe)
    std_delta: Float, default=0.0            # consistency of offset
    exercise_breakdown: String | None        # JSONB — per-exercise stats
    
    last_updated: DateTime(tz)
    created_at: DateTime(tz)
```

### 9.3 Migration 052: Video Analysis Aggregation Table

```python
class LiftVideoAnalysis(Base):
    __tablename__ = "lift_video_analyses"
    
    id: UUID PK
    user_id: UUID FK → users, indexed
    exercise_name: String(255), indexed
    
    # Aggregated metrics
    avg_form_score: Float | None
    avg_velocity: Float | None
    avg_consistency: Float | None
    avg_rpe_accuracy: Float | None           # mean |ai_rpe - user_rpe|
    video_count: Integer, default=0
    
    # Trends (JSONB arrays of {date, value})
    form_trend: String | None
    velocity_trend: String | None
    consistency_trend: String | None
    
    analyzed_at: DateTime(tz)
    created_at: DateTime(tz)
    updated_at: DateTime(tz)
```

---

## 10. API Changes

### 10.1 Enhanced Process Endpoint

`POST /api/v1/lifting/videos/{video_id}/process` — add optional `analysis_depth` parameter:

```python
@router.post("/{video_id}/process")
async def process_video(
    video_id: UUID,
    depth: str = Query("full", regex="^(basic|full)$"),
    ...
):
    # Pass depth to Celery task
    process_lift_video.delay(str(video_id), analysis_depth=depth)
```

### 10.2 New Endpoint: Video Analysis Summary

`GET /api/v1/lifting/videos/{video_id}/analysis` — returns full analysis results:

```python
@router.get("/{video_id}/analysis")
async def get_video_analysis(video_id: UUID, ...):
    # Returns all form, velocity, rest, consistency, setup, RPE data
```

### 10.3 New Endpoint: Exercise Video Trends

`GET /api/v1/lifting/videos/trends?exercise_name=Back+Squat` — returns trend data:

```python
@router.get("/trends")
async def get_video_trends(
    exercise_name: str,
    days: int = Query(90, ge=7, le=365),
    ...
):
    # Returns form score, velocity, consistency trends over time
```

### 10.4 New Chart: Video Analysis Trends

Add to `CHART_REGISTRY`:
- `video_form_trend`: Form score over time per exercise
- `video_velocity_trend`: Bar speed over time per exercise
- `video_consistency_trend`: Consistency score over time

---

## 11. Frontend Components

### 11.1 New Components

| Component | Location | Purpose |
|-----------|----------|---------|
| `FormAnalysisCard` | `components/lifting/` | Form score gauge + deviations + coaching cues |
| `VelocityPanel` | `components/lifting/` | Per-rep velocity chart + VBT zones |
| `RestTimingPanel` | `components/lifting/` | Rest period timeline + adherence |
| `ConsistencyPanel` | `components/lifting/` | Rep timing waterfall + consistency score |
| `SetupAnalysisCard` | `components/lifting/` | Setup score + frame-by-frame breakdown |
| `VideoRpeEstimate` | `components/lifting/` | AI RPE badge + evidence |
| `VideoProgressTab` | `components/lifting/` | Cross-video trend charts |
| `InjuryRiskFlags` | `components/lifting/` | Form deviation warnings |

### 11.2 Enhanced Video Detail Page

Current: Video player + metadata + processing status.
Enhanced: Tabbed layout:
1. **Video** — player + trim controls
2. **Form** — form analysis card
3. **Velocity** — velocity panel
4. **Timing** — rest + consistency panels
5. **RPE** — estimated vs actual RPE comparison
6. **Progress** — historical trends

### 11.3 Enhanced Video Bank Page

Add filters:
- Filter by form score range
- Filter by velocity range
- Sort by consistency score
- Show form score badges on video cards

---

## 12. Celery Task Changes

### 12.1 Enhanced `process_lift_video` Task

```python
@celery_app.task(name="app.tasks.scheduler.process_lift_video")
def process_lift_video(video_id: str, analysis_depth: str = "full") -> dict:
    # ... existing setup ...
    
    result = process_video_on_modal(
        video_id=video_id,
        r2_key=...,
        r2_presigned_get=...,
        r2_presigned_put=...,
        r2_upload_key=...,
        gemini_api_key=...,
        analysis_depth=analysis_depth,  # NEW
    )
    
    # ... existing DB update + extended fields ...
```

### 12.2 New Weekly Task: `aggregate_video_analyses`

```python
@celery_app.task(name="app.tasks.scheduler.aggregate_video_analyses")
def aggregate_video_analyses() -> dict:
    """Weekly aggregation of video analysis trends per exercise."""
    # For each user, for each exercise with processed videos:
    #   - Compute avg form score, velocity, consistency
    #   - Build trend arrays
    #   - Store in lift_video_analyses table
```

---

## 13. Cost Analysis

### 13.1 Per-Video Cost (Full Analysis)

| Component | Gemini Calls | Est. Cost |
|-----------|-------------|-----------|
| Form analysis (dense frames) | 1-2 calls | $0.002 |
| Velocity tracking | 1-2 calls | $0.002 |
| Rest detection | 1 call | $0.001 |
| Consistency analysis | 1 call | $0.001 |
| Setup analysis | 1 call | $0.001 |
| RPE estimation | 1 call (uses other data) | $0.001 |
| **Total per video** | **~7 calls** | **~$0.008** |

### 13.2 Monthly Cost Projection

| Usage Level | Videos/month | Modal Compute | Gemini Vision | Total |
|-------------|-------------|---------------|---------------|-------|
| Light | 10 | ~$0.01 | ~$0.08 | ~$0.09 |
| Moderate | 50 | ~$0.05 | ~$0.40 | ~$0.45 |
| Heavy | 200 | ~$0.20 | ~$1.60 | ~$1.80 |

All well within Modal's $30/mo free tier and Gemini's free quota.

### 13.3 Optimization: Caching

Gemini responses can be cached by content hash. If the same video is re-processed, skip Gemini calls and return cached results. This reduces cost for retry scenarios.

---

## 14. Implementation Phases

### Phase 1: Foundation ✅ Done (shipped; deviations noted)
- [x] ~~Update Modal image: add `google-genai` to pip_install~~ — **superseded**: the container runs local Mediapipe pose estimation (`modal_client.py:40-55`), so no `google-genai` dep was needed.
- [x] Bump Modal function timeout/memory — shipped beyond plan: `timeout=600, memory=4096` (`modal_client.py:138-139`).
- [x] Add `analysis_depth` parameter to Modal function (`basic`|`full`) — `modal_client.py:85`, threaded through `scheduler.py:3326` + `api/videos.py:252`.
- [x] New columns on `lift_videos` — shipped as migration `051_add_video_form_vbt_analysis_columns` (numbering differs from the planned "050").
- [x] Create migration 051: `rpe_calibrations` table — shipped as `052_create_rpe_calibrations`.
- [x] Create migration 052: `lift_video_analyses` table — shipped as `053_create_lift_video_analyses`.
- [x] Extend `LiftVideo` model with new fields — `models/lifting.py:278-308`.
- [x] Create `RpeCalibration` model — `models/rpe_calibration.py` (table exists; auto-calibration computation itself is still open — Phase 5).
- [x] Create `LiftVideoAnalysis` model — `models/lift_video_analysis.py` (table + model exist; weekly aggregation task is still open — Phase 6).
- [x] Extend `VideoProcessStatus` schema — analysis fields returned in `api/videos.py:283-296`.
- [x] Extend frontend `LiftVideo` type — `lib/api/types/lifting.ts:34-58,99-112`.
- [x] Register new models in `app/models/__init__.py` — `LiftVideoAnalysis`, `RpeCalibration` + `__all__` entries.

### Phase 2: Form Analysis — IPF Standards ✅ Done (pose-estimation engine, not per-lift Gemini prompts)
- [x] Squat/bench/deadlift form prompts + generic accessory prompt — exercise prompt map (`Back Squat`→squat, `Bench Press`→bench, `Deadlift`→deadlift, …) in `video_analysis.py:331-343`, with per-lift scorers `score_squat_form` / `score_bench_form` / `score_deadlift_form` in `pose_analysis.py:753-826`.
- [x] Implement competition validity check (pass/fail per IPF rules) — `competition_valid` column (`models/lifting.py:279`) + depth/lockout/butt-contact checks in `pose_analysis.py`.
- [x] Implement quality score (0-100 with deduction table) — `form_score` (`modal_client.py:522`, `pose_analysis.py:870`).
- [x] Store results in `form_score`, `form_analysis_json`, `competition_valid`, `form_deviations`, `form_coaching_cues` — columns exist (`models/lifting.py:278-280`).
- [x] Add form-score UI — shipped consolidated in `VideoAnalysisPanel` (`FormScoreRing` + deviations + cues) rather than a standalone `FormAnalysisCard`.
- [ ] Add `video_form_trend` chart to CHART_REGISTRY — still open (§10.4).

### Phase 3: Velocity Tracking ✅ Done (engine + storage + consolidated UI)
- [x] Implement frame-pair velocity estimation in Modal function — `pose_analysis.py:1091-1178` (wrist/hip tracking), `video_analysis.py:679-784`.
- [x] Compute per-rep concentric velocity using ROM defaults — `mean_concentric_velocity` + §19 ROM table in use.
- [x] Calculate velocity loss % (first→last rep) — `velocity_loss_pct`.
- [x] Map to powerlifting VBT zones — `_get_vbt_zone()` (`video_analysis.py:418`, `pose_analysis.py:1178`) + `vbt_zone` column.
- [x] Store in `mean_concentric_velocity`, `peak_velocity`, `velocity_loss_pct`, `velocity_profile_json` — columns exist (`models/lifting.py:285-289`).
- [x] Add velocity UI — shipped consolidated in `VideoAnalysisPanel` (per-rep values + VBT zone) rather than a standalone `VelocityPanel`.
- [ ] Add `video_velocity_trend` chart to CHART_REGISTRY — still open (§10.4).

### Phase 4: Rest Timing + Consistency ✅ Done (engine + storage + consolidated UI)
- [x] Implement rest period detection — `rest_periods_json` plumbed through `modal_client.py:534` + `scheduler.py:3413+`.
- [x] Compute rest CV and adherence to target ranges — `avg_rest_seconds`, `rest_cv` columns (`models/lifting.py:292-293`).
- [x] Implement rep consistency analysis — `consistency_score` (`video_analysis.py:288,1001`), `rep_consistency_score` via `modal_client.py:538`.
- [x] Store rest data in `rest_periods_json`, `avg_rest_seconds`, `rest_cv` — columns exist.
- [x] Store consistency data in `rep_consistency_score`, `tempo_consistency_cv`, `rep_timing_json` — columns exist (`models/lifting.py:297-298`).
- [x] Add rest/consistency UI — covered by `VideoAnalysisPanel`; dedicated `RestTimingPanel` timeline + `ConsistencyPanel` waterfall were folded in rather than built standalone.
- [ ] Add `video_consistency_trend` chart to CHART_REGISTRY — still open (§10.4).

### Phase 5: Setup Analysis + RPE — mostly done; calibration open
- [x] Implement setup phase frame extraction — `setup_score` / `setup_duration_seconds` in `pose_analysis.py:884-944`.
- [x] Write setup prompts per exercise — setup prompt block in `video_analysis.py:251-257` (bar position, walkout, contact points).
- [x] Implement RPE estimation — `estimated_rpe` via `video_analysis.py:1041-1126` + `modal_client.py:546`, stored per video (`scheduler.py:3461`).
- [x] Create `rpe_calibrations` table + model — migration `052`, `models/rpe_calibration.py`.
- [ ] Implement RPE auto-calibration (per-user offset calculation) — table exists but no offset computation reads it yet.
- [x] Store setup data in `setup_score`, `setup_analysis_json`, `setup_duration_seconds` — columns exist (`models/lifting.py:302`).
- [x] Store RPE data in `estimated_rpe`, `rpe_confidence`, `rpe_evidence_json` — columns exist (`models/lifting.py:307-308`).
- [x] Add setup + RPE UI — shipped consolidated in `VideoAnalysisPanel` (RPE badge + RIR derivation) rather than standalone `SetupAnalysisCard` / `VideoRpeEstimate`.
- [ ] Add weekly Celery task for RPE recalibration — still open.

### Phase 6: Trends + Intelligence — mostly open (table + model exist)
- [x] Create `lift_video_analyses` aggregation table + model — migration `053`, `models/lift_video_analysis.py`.
- [ ] Weekly aggregation Celery task (`aggregate_video_analyses` — named only in the model docstring; no task registered in `tasks/scheduler.py`).
- [ ] `VideoProgressTab` with cross-video trend charts.
- [ ] Injury risk flagging from form deviations (knee valgus, back rounding, etc.).
- [ ] Generate `HealthAlert` entries for high-severity form issues.
- [ ] Exercise variation auto-detection — partially: the engine already classifies variation (`exercise_variation`: high/low-bar squat, sumo/conventional deadlift, push/strict press — `pose_analysis.py:305-327,1028`) but it isn't surfaced as a feature.

### Phase 7: Training Load Integration — open (unchanged)
- [ ] Lifting TSS estimation from video analysis (volume × intensity × fatigue)
- [ ] Unified training load dashboard (cycling TSS + lifting TSS combined)
- [ ] Deficiency analysis integration (form-based weakness detection)
- [ ] Video-based warmup effectiveness analysis

---

## 15. Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Gemini Vision hallucinates joint angles | Inaccurate form scores | Use relative scoring (good/ok/poor) not absolute degrees; cross-validate with consistency metrics |
| Dense frame extraction creates large temp files | Modal memory pressure | Extract frames as JPEG (small), limit to 1fps, process in batches |
| Multi-pass Gemini calls increase latency | User waits longer | Keep `basic` mode for fast results; `full` mode is async with notification |
| Velocity estimation from 2D video is approximate | Less accurate than VBT devices | Frame as "video-estimated velocity", not ground truth; use for trends not absolutes |
| High video volume increases cost | Budget pressure | Implement analysis depth toggle; default to `basic` for short videos, `full` for PR attempts |
| Gemini API rate limits | Processing delays | Queue-based processing already exists; add retry with backoff |

---

## 16. Testing Strategy

### Unit Tests
- Modal function: mock ffmpeg output, verify frame extraction logic
- Velocity calculation: verify math with known frame pairs
- RPE estimation: verify scoring logic with synthetic data

### Integration Tests
- End-to-end: upload video → process → verify all analysis fields populated
- Form analysis: upload known good/bad form video → verify score ranges
- Cost tracking: verify Gemini call count matches expectations

### Frontend Tests
- FormAnalysisCard: render with mock data, verify score display
- VelocityPanel: render chart with mock velocity data
- RPE estimate: verify confidence indicator display

---

## 17. Decisions (Resolved)

### 17.1 Form Scoring: Hybrid IPF Competition + Relative Quality

**Recommendation**: Two-layer scoring system.

**Layer 1 — Competition Validity (binary pass/fail per IPF rules)**:
- Would this lift get white lights at an IPF meet?
- Objective, well-defined criteria per lift
- Stored as `competition_valid: bool` + `competition_notes: string`

**Layer 2 — Quality Score (0-100, point deductions from 100)**:
- Starting at 100, deduct points for deviations from ideal technique
- Calibrated against IPF standards + coaching best practices
- Stored as `form_score: float`

This gives both "competition ready" (binary) and "how good is it" (0-100).

### 17.2 Exercise-Specific Prompts: Yes, Powerlifting-Focused

Each of the Big 3 gets its own specialized Gemini Vision prompt with IPF-specific criteria. Accessory lifts share a generic compound prompt.

### 17.3 RPE Auto-Calibration: Yes

Track `estimated_rpe` vs user-entered `rpe` on `LiftingSet`. Over time, compute per-user calibration offset and apply it to future estimates. Store in a `user_rpe_calibration` field on the User model or a separate calibration table.

### 17.4 ROM Defaults: IPF Powerlifting Standards

Use competition-standard ROM as the baseline. No user override needed — IPF rules are the gold standard.

---

## 18. IPF Competition Standards (Calibration Reference)

### 18.1 Squat Standards

| Criterion | IPF Rule | AI Detection |
|-----------|----------|--------------|
| **Depth** | Hip joint crease must descend below the top surface of the knee joint | Gemini evaluates hip-to-knee relationship at bottom position |
| **Walkout** | Maximum 1 step back (competitive) | Setup analysis: count foot movements after unrack |
| **Lockout** | Full extension of hips and knees at top | Gemini checks hip/knee extension at completion |
| **Bar position** | Must remain on back (high bar or low bar) | Gemini identifies bar placement |
| **Heels** | Must remain flat on platform | Gemini checks heel contact |
| **Forward lean** | Not regulated but affects depth | Measured as back angle deviation |
| **Knee cave** | Not explicitly penalized but indicates weakness | Tracked as form deviation |

**Depth scoring deduction**:
- Clearly below parallel: 0 deduction
- At parallel (borderline): -5 points
- Above parallel: -20 points (competition fail)

### 18.2 Bench Press Standards

| Criterion | IPF Rule | AI Detection |
|-----------|----------|--------------|
| **Start position** | Bar held at full arm extension, motionless | Gemini checks lockout at start |
| **Descent** | Bar must touch chest (lower chest/sternum area) | Gemini verifies chest contact |
| **Pause** | Bar must be motionless on chest (press command) | Gemini detects pause duration |
| **Press** | Bar must move upward symmetrically | Gemini checks bar path symmetry |
| **Lockout** | Full arm extension at top | Gemini checks elbow extension |
| **Feet** | Must remain flat on floor (IPF 2024+) | Gemini checks foot contact |
| **Butt** | Must remain on bench | Gemini checks hip-bench contact |
| **Head** | Must remain on bench (IPF 2024+) | Gemini checks head position |
| **Grip width** | Maximum 81cm between index fingers (IPF) | Not measurable from video easily |
| **Elbow flare** | Not regulated but affects performance | Tracked as form deviation |

**Pause scoring deduction**:
- Clear pause >0.5s: 0 deduction
- Touch-and-go (no pause): -10 points (competition fail in IPF)

### 18.3 Deadlift Standards

| Criterion | IPF Rule | AI Detection |
|-----------|----------|--------------|
| **Start** | Bar must be stationary on floor before lift | Gemini checks bar stillness |
| **Grip** | Hands must be outside knees (conventional) | Gemini checks grip-knee relationship |
| **Lockout** | Full extension of hips and knees, shoulders back | Gemini checks triple extension |
| **Bar path** | Must move upward in a continuous motion | Gemini tracks bar trajectory |
| **Hitching** | Bar must not be supported on thighs (re-racking on thighs = fail) | Gemini detects bar-thigh contact during lockout |
| **Down signal** | Bar must return to floor under control | Not measurable from video easily |
| **Sumo stance** | Hands inside knees allowed | Gemini detects stance width |

**Lockout scoring deduction**:
- Clean lockout with hips through: 0 deduction
- Soft knees (not fully locked): -5 points
- Hitching/re-racking: -20 points (competition fail)

### 18.4 Setup Standards per Lift

**Squat Setup**:
- Unrack with bar on traps (high or low bar position)
- Maximum 1 step back
- Feet shoulder-width apart, toes slightly out
- Brace before descent
- IPF: no commands, lifter's discretion

**Bench Setup**  
- 5 points of contact: head, upper back, butt, left foot, right foot
- Bar held at full extension, motionless (start command)
- Feet flat on floor (IPF 2024+)
- Retracted scapulae (visible as chest up)

**Deadlift Setup**:
- Bar over mid-foot
- Shoulders slightly in front of bar
- Hips higher than knees (conventional)
- Back neutral/flat before lift
- Bar stationary before pull

### 18.5 VBT Zones for Powerlifting (Specific)

These differ from generic VBT zones — powerlifting focuses on the strength-speed end:

| Zone | Squat (m/s) | Bench (m/s) | Deadlift (m/s) | %1RM | Training Use |
|------|------------|------------|----------------|------|-------------|
| Absolute Strength | <0.35 | <0.30 | <0.35 | 85-100% | Peaking, competition prep |
| Maximum Strength | 0.35-0.50 | 0.30-0.45 | 0.35-0.50 | 75-85% | Primary training zone |
| Strength-Speed | 0.50-0.65 | 0.45-0.60 | 0.50-0.65 | 65-75% | Volume accumulation |
| Power | 0.65-0.85 | 0.60-0.80 | 0.65-0.85 | 55-65% | Dynamic effort |
| Speed-Strength | >0.85 | >0.80 | >0.85 | <55% | Speed work, warm-ups |

**Velocity loss thresholds (fatigue indicators)**:
- <10% loss: well within capacity
- 10-20% loss: approaching fatigue (normal for hard sets)
- 20-30% loss: significant fatigue (set could be terminated)
- >30% loss: excessive fatigue (risk of form breakdown)

### 18.6 RPE Chart for Powerlifting (Modified RIR Scale)

| RPE | Reps in Reserve | Description | Velocity Indicator |
|-----|----------------|-------------|-------------------|
| 10 | 0 RIR | Max effort, could not do another rep | >30% velocity loss, form breakdown |
| 9.5 | 0.5 RIR | Maybe one more rep | 20-30% velocity loss |
| 9 | 1 RIR | Could definitely do one more | 15-25% velocity loss |
| 8.5 | 1.5 RIR | Could do one more, maybe two | 10-20% velocity loss |
| 8 | 2 RIR | Could do two more reps | 8-15% velocity loss |
| 7.5 | 2.5 RIR | Could do two more, maybe three | 5-12% velocity loss |
| 7 | 3 RIR | Could do three more reps | <8% velocity loss |
| 6 | 4 RIR | Could do four more reps | Minimal velocity loss |
| 5 | 5+ RIR | Easy, many reps left | No measurable velocity loss |

### 18.7 Form Score Deduction Table

Starting from 100, deduct per deviation:

| Deviation | Squat | Bench | Deadlift | Deduction |
|-----------|-------|-------|----------|-----------|
| Competition fail (depth/pause/lockout) | Yes | Yes | Yes | -25 |
| Major form breakdown | Yes | Yes | Yes | -15 |
| Significant asymmetry | Yes | Yes | Yes | -10 |
| Minor deviation | Yes | Yes | Yes | -5 |
| Inconsistency between reps | Yes | Yes | Yes | -3 per outlier rep |
| Suboptimal setup | Yes | Yes | Yes | -5 |
| Excessive rest (>5min between sets) | Yes | Yes | Yes | -2 |

**Score ranges**:
- 90-100: Excellent — competition ready
- 75-89: Good — minor improvements possible
- 60-74: Adequate — several areas to work on
- 40-59: Needs work — significant form issues
- <40: Poor — should reduce weight and focus on technique

---

## 19. ROM Defaults (IPF Standards)

| Exercise | Estimated ROM | Notes |
|----------|--------------|-------|
| Back Squat (high bar) | 0.50m | Hip crease to full extension |
| Back Squat (low bar) | 0.45m | Slightly less depth typical |
| Bench Press | 0.40m | Chest to lockout |
| Deadlift (conventional) | 0.45m | Floor to lockout |
| Deadlift (sumo) | 0.40m | Slightly less ROM |
| Front Squat | 0.50m | Similar to high bar |
| Overhead Press | 0.55m | Clavicle to lockout |
| Romanian Deadlift | 0.35m | Knee level to lockout |

These are used for velocity calculation (velocity = ROM × position_delta / time). They represent average ROM for a ~175cm / 80kg male lifter. The system should note these are estimates and velocity trends are more reliable than absolute values.

---

## 20. RPE Auto-Calibration System

### 20.1 Data Collection

Every time a user enters RPE on a `LiftingSet` AND the set has a video with velocity data:
```python
{
    "user_id": UUID,
    "exercise_name": str,
    "weight_kg": float,
    "reps": int,
    "velocity_loss_pct": float,     # from video analysis
    "mean_velocity": float,         # from video analysis
    "form_score": float,            # from video analysis
    "user_rpe": float,              # user-entered
    "ai_rpe": float,                # AI-estimated
    "recorded_at": datetime
}
```

### 20.2 Calibration Model

Per user, per exercise (or aggregate across exercises), compute:
```python
calibration_offset = mean(user_rpe - ai_rpe)  # over last N sets
calibration_scale = std(user_rpe - ai_rpe)    # consistency of offset
```

Apply to future estimates:
```python
calibrated_rpe = ai_rpe + calibration_offset
```

Store calibration data:
```python
class RpeCalibration(Base):
    __tablename__ = "rpe_calibrations"
    
    id: UUID PK
    user_id: UUID FK → users
    exercise_name: String(255)  # NULL = all exercises
    
    # Rolling statistics
    sample_count: Integer
    mean_delta: Float           # avg(user_rpe - ai_rpe)
    std_delta: Float            # std of delta
    last_updated: DateTime(tz)
    
    # Per-exercise breakdown (JSONB)
    exercise_breakdown: String | None  # {"Back Squat": {"count": 10, "mean_delta": 0.3}, ...}
```

### 20.3 Calibration Thresholds

- Minimum 5 sets with both user RPE and AI RPE before applying calibration
- If `std_delta > 2.0`, user's RPE reporting is inconsistent — disable calibration for that exercise
- Recalibrate weekly via Celery task
- Show calibration status to user: "Your RPE is typically X.X points higher/lower than AI estimates"
