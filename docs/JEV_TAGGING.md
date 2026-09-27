# Jev free-text tagging (TypeSafe "System One")

FitTrack uses TypeSafe **Jev** to interpret free-text fields — starting with
`LiftingSession.notes` — into a small set of typed tags (pain/injury mention,
high fatigue, PR mention, session outcome, energy). Tags feed deterministic
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

The note is capped at 4,000 characters. No account identifiers, streams, health
metrics, or other personal data are sent.

## How it is used

- Tags are stored on the row (`lifting_sessions.ai_tags`); raw responses are
  not stored.
- `pain_injury` / `high_fatigue` can, at most, **escalate an already-nonzero**
  deterministic injury-risk signal — a tag never creates an alert on its own.
- Tags are read-only hints. They are not editable and are not medical advice.

## Turning it off

- **Ops (global)**: unset `TYPESAFE_API_KEY` (or set `JEV_ENABLED=false`). Every
  call site then no-ops and existing rows are untouched.
- **Config**: `TYPESAFE_API_KEY`, `JEV_ENABLED` (kill switch), `JEV_MODEL`
  (pinned version), `JEV_TIMEOUT_S`.

## Behaviour when unset

Nothing is sent, `decide()` returns `None`, and all deterministic behaviour is
unchanged. Tagging is best-effort: it never blocks a write and never raises. A
weekly backfill (`backfill_free_text_tags`) tags missed rows when enabled.
