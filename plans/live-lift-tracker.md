# Live Lift Tracker (Phase: Live Strength Sessions)

> **Status: IMPLEMENTED (2026-08-24).** Migration `028` (verified down/up), API smoke-tested, Whoop match rule unit-tested, frontend build clean.
> Locked decisions:
> - Weight entry: smart prefill from last logged set of that exercise; stepper step size configurable in settings
> - Rest tracking: **count-up pill since last set** — informational only, no countdown/enforcement, no setting needed
> - Nav: "Live Lift" sidebar item + Start Session button on lifting page
> - Warmup templates: included in v1 (`is_warmup=true` sets)
> - Per-exercise "last session" reference line (e.g. `Last session: 100kg × 5 × 3 @ 8`)
>
> Reliability requirements (not nice-to-haves):
> - Local-first: on-screen set log is source of truth during session; localStorage write BEFORE network call; queued API writes flush on reconnect; never block logging on a spinner/error
> - Timer from `started_at` timestamp (survives backgrounding); Wake Lock re-acquired on visibilitychange
> - Resume/Discard prompt after crash/refresh (state persisted every mutation)
> - Confirm sheet + beforeunload guard on finish/back during active session
> - Debounce Log Set to prevent duplicates
> - Friction budget: straight set = 1 tap; new weight = steppers only (no keyboard); exercise switch = 1 tap via recent chips

Track strength sessions in FitTrack as they happen, mobile-first. Single-entry: sets/reps live only in FitTrack; Whoop provides physiological enrichment via time-overlap matching. No duplicates — Whoop workouts never create standalone activities (existing behaviour in `sync_whoop_workouts`).

## Overview

| Piece | Where |
|-------|-------|
| Live lift page | `frontend/src/app/(app)/lifting/live/page.tsx` |
| Session state hook | `frontend/src/lib/lifting/useLiveSession.ts` |
| Backend: session lifecycle | extend `backend/app/api/lifting.py` + `services/lifting.py` |
| Backend: Whoop time-match | extend `services/whoop.py::sync_whoop_workouts` |
| Migration | add `started_at` / `ended_at` / `whoop_*` columns to `lifting_sessions` |

## Data model changes

`LiftingSession` needs precise times for Whoop matching (`session_date` alone can't do overlap):

```
started_at: Mapped[datetime | None]   # timezone-aware, set when live session starts
ended_at:   Mapped[datetime | None]   # set on finish
whoop_strain:      Mapped[float | None]
whoop_avg_hr:      Mapped[int | None]
whoop_max_hr:      Mapped[int | None]
whoop_kilojoules:  Mapped[float | None]
whoop_workout_id:  Mapped[str | None]  # dedup key, mirrors ActivitySource pattern
```

Migration: next sequential number after current head (024 chain — see AGENTS.md pitfall #8). Verify with `alembic downgrade <prev>` + `upgrade head`.

## Page states

### 1. Pre-session
- Program name (optional), focus picker (chips: squat / bench / deadlift / overhead press / accessories)
- Optional warmup template launch (existing `WarmupTemplateStep` data)
- Big **Start Session** button. On tap: `POST /sessions` with `started_at=now`, enter active mode.

### 2. Active session
Layout (mobile-first, thumb-zone optimised, min 44px tap targets):

```
┌──────────────────────────────┐
│ ⏱ 42:17   6,240kg · 18 sets │  ← sticky header, elapsed timer
│                              │    (Date.now() − started_at, survives
├──────────────────────────────┤    backgrounding/screen lock)
│ SQUAT                    ▾   │  ← exercise selector
│ Last: 100kg × 5 @ 8          │  ← last-set echo
│ ┌──────┐ ┌──────┐ ┌───────┐ │
│ │− 2.5 │ │100.0 │ │ + 2.5 │ │  ← weight stepper (inputMode=decimal)
│ └──────┘ └──────┘ └───────┘ │
│ ┌──────┐ ┌──────┐ ┌───────┐ │
│ │ − 1  │ │  5   │ │  + 1  │ │  ← reps stepper
│ └──────┘ └──────┘ └───────┘ │
│ RPE ○ ○ ● ● ○ ○ ○ ○ ○ ○     │  ← optional, defaults off
│ ┏━━━━━━━━━━━━━━━━━━━━━━━━━━┓ │
│ ┃       LOG SET            ┃ │  ← bottom-anchored primary action
│ ┗━━━━━━━━━━━━━━━━━━━━━━━━━━┛ │
├──────────────────────────────┤
│ Recent: Bench · Deadlift · … │  ← one-tap exercise switch chips
│ This exercise:               │
│ ✓ 60×8  ✓ 80×5  ✓ 100×5 @8  │  ← set log, tap = undo w/ confirm
└──────────────────────────────┘
```

Behaviour:
- **Rest timer** auto-starts on log (default 3 min, configurable); shown as countdown pill replacing timer slot in header.
- **ExerciseAutocomplete** (existing component) for new exercises; recent exercises cached as chips.
- **Undo last set**: DELETE endpoint needed (`DELETE /sessions/{id}/sets/{setId}`).
- **Wake Lock API** while session active; re-acquire on visibilitychange.
- **Crash/offline resilience**: entire in-progress session persisted to `localStorage` on every mutation; on load, offer Resume/Discard. Sets are POSTed optimistically; failures queue locally and flush on reconnect.
- PR detection reuses existing PR logic on each `addSet` → surface inline "PR!" badge (reuse `PRCelebration` styling, subtler).

### 3. Finish flow (bottom sheet)
- Duration, total volume, set count, PRs hit
- Session RPE slider, notes textarea
- **Finish** → `PATCH /sessions/{id}` with `ended_at`, `rpe_session`, `notes`, `duration_seconds`
- Post-finish card: "Whoop will enrich this session after your next sync (~30 min)" + Whoop-matched status once available

## Backend endpoints (additions)

| Method | Path | Purpose |
|--------|------|---------|
| `PATCH` | `/api/v1/lifting/sessions/{id}` | finish/edit: `ended_at`, `duration_seconds`, `rpe_session`, `notes`, `program_name`, `focus` |
| `DELETE` | `/api/v1/lifting/sessions/{id}/sets/{set_id}` | undo last set |
| `GET` | `/api/v1/lifting/sessions/active` | resume check — latest session with `ended_at IS NULL` |

`createSession` payload gains optional `started_at`.

## Whoop time-match enrichment

In `sync_whoop_workouts`, currently unmatched strength-sport workouts (`sport_id` ∈ {123, 45, 59, 48}) are skipped. New branch before skip:

1. Query `LiftingSession` where `user_id` matches, `started_at/ended_at` bracket the workout window (overlap ≥ 50% of either), `whoop_workout_id IS NULL`.
2. Match found → write `whoop_strain/avg_hr/max_hr/kilojoules/whoop_workout_id`.
3. No match → unchanged (skip, as today).

Unmatched-session warning: lifting sessions with `ended_at` older than ~3h and `whoop_workout_id IS NULL` → small banner on lifting page: "No Whoop workout matched — logged in Whoop?" (shows exact start/end times to back-fill manually in Whoop app; next sync then matches by time.)

## Frontend wiring

- `lib/api/lifting.ts`: `updateSession()`, `deleteSet()`, `getActiveSession()`
- Sidebar nav item **Live Lift** near Lifting (prominent accent styling)
- Lifting page: banner linking to `/lifting/live` when an active session exists

## Out of scope / later

- Push notifications for rest timer end (needs PWA work)
- Planned-exercise pre-fill from TrainingPlanDay
- Apple Watch / Wearable companion entry
