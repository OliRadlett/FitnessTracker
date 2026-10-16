# Jev free-text tagging (TypeSafe "System One")

FitTrack uses TypeSafe **Jev** to interpret free-text fields — `LiftingSession.notes`
(pain/injury, fatigue, PR, outcome, energy) and `Activity.name` (purpose) — into a
small set of typed tags. Tags feed deterministic
downstream logic; Jev generates no prose and does not replace the numeric
analysis (TSS/CTL/ATL, injury-risk math, PR detection).

## What is sent

Only the note text plus the minimal numeric context it is judged against:

```json
{
  "note": "Squats felt heavy, left knee a bit sore after set 3.",
  "focus": "squat",
  "program_name": "5/3/1",
  "duration_seconds": 3900,
  "rpe_session": 8.5,
  "total_volume_kg": 6400
}
```

For activities, only the workout name + `sport_type` are sent. The note is
capped at 4,000 characters. No account identifiers, streams, health metrics, or
other personal data are sent.

## How it is used

- Tags are stored on the row (`lifting_sessions.ai_tags`); raw responses are
  not stored.
- `pain_injury` / `high_fatigue` can, at most, **escalate an already-nonzero**
  deterministic injury-risk signal — a tag never creates an alert on its own.
- Tags are read-only hints. They are not editable and are not medical advice.

## Strength-session classification

A second use classifies each lifting session from its **sets** (exercise names,
loads, reps, warm-up/AMRAP flags) plus the same metadata and note — so it works
for sessions with **no** note. It writes three typed labels on the row plus a
provenance blob (`lifting_sessions.ai_classification`, migration 100):

- `session_split` — push / pull / legs / upper / lower / full_body
- `session_lift` — squat / bench / deadlift / overhead_press / accessory / none
- `session_class` — max_strength / volume_hypertrophy / speed_power / technique /
  accessory_conditioning / deload / test

A label is asserted only when Jev's confidence is ≥ 0.60; 0.40–0.60 is recorded
provisionally (never asserted); below that it is dropped. A deterministic rule
engine (rep ranges + exercise keywords) runs as a cross-check — a mismatch sets
`disagreement` and never overrides Jev. Tonnage, %e1RM and load stay
deterministic: they are sent as context only and never asked of Jev.

Classification sends the set list (exercise names + loads) in addition to the
state above; no account identifiers, streams or health metrics are sent.

## Turning it off

- **Ops (global)**: unset `TYPESAFE_API_KEY` (or set `JEV_ENABLED=false`). Every
  call site then no-ops and existing rows are untouched. Neither tagging nor
  classification writes anything when unset, so deterministic behaviour is
  unchanged; the rule engine is available on demand via
  `jev_classification.rule_labels()`.
- **Config**: `TYPESAFE_API_KEY`, `JEV_ENABLED` (kill switch), `JEV_MODEL`
  (pinned version), `JEV_TIMEOUT_S`.

## Behaviour when unset

Nothing is sent, `decide()` returns `None`, and all deterministic behaviour is
unchanged. Tagging is best-effort: it never blocks a write and never raises. A
weekly backfill (`backfill_free_text_tags`) tags missed rows when enabled. The
backfill and the session-classification backfill bypass the shared per-user AI
budget guard (`use_budget_guard=False`) — that guard's 5/min cap is for
user-triggered generations and would otherwise stall a bulk backfill after five
rows.
