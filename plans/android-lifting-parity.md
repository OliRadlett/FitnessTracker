# Android lifting parity

**Objective**: the lifting system in the Android app reaches parity with the
website's `/lifting` surface, then a device pass proves it. Parity means
*features*, not layouts: every action and every number the website offers for a
lifting session is available on a phone, designed for a thumb.

The app's own design rules still win where they conflict: logging is offline-first
(no network on the critical path), the instrument fits a 360 × 804 dp screen, and
nothing renders below 12 sp.

## The website, as surveyed (2026-11)

`/lifting` is four tabs — **Sessions**, **Analytics**, **PRs**, **Templates** —
plus `/lifting/live` for the gym. The survey that produced this section read
`frontend/src/app/(app)/lifting/page.tsx` (1450 lines), `LiveWorkout.tsx`,
`SessionBrowser.tsx` and the `components/lifting/*` set; the API half was read
from `backend/app/api/lifting.py` and `schemas/lifting.py`.

What the desktop can do, and where the phone stands:

| Capability | Website | App |
|---|---|---|
| Browse sessions, grouped, with filters (focus, split, class, exercise, date range, free text) | yes | week-grouped list, no filters |
| Session card: focus, program, date, duration, working sets, volume, warm-up count, TSS, quality chip, PR count | yes | date, focus, sets, volume |
| Session detail: every set, warm-ups flagged, AMRAP, per-set notes, session notes, session RPE | yes | **yes (this round)** |
| Edit a set (weight, reps, RPE, warm-up, AMRAP, note) | yes | **yes (this round)** |
| Delete a set | yes | **yes (this round)** |
| Delete a session | yes | **yes (this round)** |
| Edit session fields (date, focus, notes, start/end) | yes | no |
| Add an exercise/set to a finished session | yes | no |
| Repeat a session | yes | no |
| Log warm-ups, AMRAP, per-set notes in the live flow | yes | no |
| Optional / half-point RPE when logging | yes | whole numbers 6–10 |
| Plate calculator | yes | no |
| Editable rest target, count-up since last set | yes | fixed 2:30 countdown |
| Warm-up templates | yes (Templates tab) | no |
| PRs: list, best by rep range, DOTS, deficiency | yes | no |
| Analytics: weekly volume, 1RM history + forecast, exercise progress, strength balance, volume × intensity, session mix, lift frequency, RPE drift, rep-range distribution | yes | no |
| Link a Strava activity | yes | no |
| Session labels (split / lift / class) and AI tags | yes | no |
| Video / pose / bar path / VBT | separate page | **out of scope** |

## Phases

Each phase ends in a runnable app and merged PR; the device pass happens once at
the end, because installing per-fix wastes the only real screen we have.

- [x] **P0 — faithful history.** Warm-ups are kept and flagged rather than
  dropped; `is_amrap`, per-set notes, session notes, session RPE and the server's
  set ids survive the decode; `rpe` is nullable instead of being coerced to 7.
  Volume counts working sets only, matching `calculate_session_volume`.
- [x] **P1 — session detail + set editing.** Every set grouped by exercise, with
  W/AMRAP badges, notes and RPE. Tap a set to edit it inline; delete a set;
  delete the session. Synced rows PATCH/DELETE against the API and revert with a
  reason if the server refuses; local-only rows edit in place.
- [x] **P2 — session fields + add set/exercise.** Edit the session's date (by
  whole days, keeping its clock time across a DST boundary), focus and note via
  `PATCH /lifting/sessions/{id}`. `+ Set` appends to an exercise
  (`POST /sessions/{id}/sets`); `+ Add exercise` appends a whole exercise in one
  go. Local rows appear immediately; a synced session posts each set and swaps
  the row for the server's, so the id an edit needs exists. A partial failure
  keeps what succeeded and says so.
- [ ] **P3 — repeat a session.** Start today from any finished session, with the
  same exercises, the same working-set count and prefilled loads.
- [ ] **P4 — live-flow fidelity.** Warm-up toggle, AMRAP, optional RPE,
  per-set notes, editable rest target, plate calculator.
- [ ] **P5 — progress.** PRs (`GET /lifting/prs`), best-by-rep-range, and an
  exercise-progress view driven by `GET /charts/exercise_progress`; weekly
  volume and estimated-1RM history from `/charts/*` rather than re-derived.
- [ ] **P6 — browse.** Filters (focus, exercise, date range, free text) and
  month grouping over the cached history, since the API has no date-range
  parameter.
- [ ] **P7 — device pass.** Install to the OnePlus 11 over Wi-Fi adb, run the
  whole loop against prod, and capture the screens.

## Notes that future rounds should not have to rediscover

- `GET /lifting/sessions` returns a **bare array** with the total in
  `X-Total-Count`; `GET /sessions/active` returns **`200 null`**, not 404.
- `live_key` and `client_id` are **application-level** idempotency, not unique
  indexes. A retry is safe; a genuine race can still double-create.
- `live_key` is never echoed back, so the phone keeps its own session id until the
  push returns the server id.
- **Never send `order_index`** on create — the server assigns it from array
  position, and compacts `set_number` to 1..n per exercise after add/delete.
- PATCH uses `exclude_unset`: sending `"rpe": null` clears it, omitting it leaves
  it alone. `LiftingPatchJson` therefore sets `encodeDefaults = true` and
  `explicitNulls = true`.
- **Never send `order_index`** on create or append — the server assigns it from
  array position, and compacts `set_number` to 1..n per exercise after
  add/delete. `client_id` is the client's handle on a set it has just appended.
- Moving a session a day must use `plusDays` on a zoned time, not ±86,400,000 ms:
  the ms arithmetic moves an 18:00 session to 17:00 across the autumn DST
  boundary. The server takes `session_date` (local date) and `started_at`/
  `ended_at` with offsets; both are sent so the two never disagree.
- Server-side totals (`total_volume_kg`, PRs, TSS) are **side effects of set
  writes**. The app recomputes volume from the sets it holds and never trusts a
  stale total: one real fixture session reports 12,680 kg against a working-set
  sum of 11,510 kg, because a set was edited after the total was computed.
- `session_date` must be the **device-local** calendar date. The server never
  derives it.
