# Android lifting parity

> **Status**: complete — P0–P20 and the device pass are done; plan editing stays on the website.

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
- [x] **P3 — repeat a session.** "Repeat this session" starts today from any
  finished session: the same exercises in the same order, the same number of
  working sets, and the last working set's load and reps as the target
  (`SessionEngine.planFrom`). Warm-ups are not copied — they are something you
  ramp through, not a set the plan owes you. Refused, with the reason on the
  button, while another session is in progress.
- [x] **P4 — set flags and RPE.** A Warm-up toggle logs a set that is kept,
  flagged and excluded from the plan, the volume and the prefill — and starts no
  rest. AMRAP flags a set the same way. RPE is optional (`—`) and can be a half
  point (6.0–10.0 by 0.5) instead of the five whole-number chips. A warm-up is
  pushed with `is_warmup`, an AMRAP set with `is_amrap`, and a set with no RPE
  is sent as `null` rather than the old invented 7.
- [x] **P4b — rest target and plates.** The rest card shows its target and a
  `−30s` / `+30s` pair; a running rest restarts at the new length, and the target
  is persisted with the session (an old `session.json` without the field still
  loads). The weight stepper carries a plate calculator: bar weight (20/15 kg,
  tap to switch) and the greedy per-side loadout on `PlateMath`, including the
  shortfall when the weight cannot be made with real plates.
- [x] **P5 — progress.** A third Today segment ("Progress") computes everything
  from the sets the app already holds: personal bests per exercise (by estimated
  1RM, Brzycki), the best set in each rep range (1 / 2–3 / 4–6 / 7–12 / 12+, with
  empty ranges shown rather than hidden), and a per-exercise e1RM line over the
  last 20 sessions. No network, so it works signed out and cannot disagree with
  the log it is drawn from. Manual PRs — the ones with no session behind them —
  are the one thing that would need `GET /lifting/prs`, which has never been
  captured, so it is deliberately not guessed at here.
- [x] **P6 — browse.** The log filters on the four things the website filters on
  — free text (focus, note, exercise names), focus, exercise and a date window
  (30 d / 90 d / 1 y) — with the search box always visible and the chips behind
  one "Filters" tap. A result count and a "No sessions match" state say what the
  filter did; week grouping stays, because a phone reads weeks better than
  months.
- [x] **P5b — session RPE and note at the finish.** The summary asks "how did it
  feel?" (session RPE, `—` allowed) and takes a note, as the website's finish
  sheet does, and both travel into history — the detail shows them, and a synced
  session carries them to the API. `SessionEngine.finished()` owns the
  conversion, so a blank note stays blank rather than becoming an empty string.
- [x] **P8 — today's real session.** The app fetches the training plan
  (`GET /training/plans` → the plan whose dates bracket today → `GET
  /training/plans/{id}`) and turns today's planned strength day into the plan the
  gym flow starts from: focus as the title, exercises with their prescribed sets
  and reps, and last time's load as the weight (a planned entry carries no load —
  only `pct_1rm`/`rpe` hints). A rest day says "Rest day." with a "Start anyway"
  button instead of prescribing the seeded push day, and a failed request leaves
  the existing plan alone rather than inventing a rest day. The phone's own plan
  editor remains for offline/demo use and is hidden while the server plan shows.
- [x] **P9 — labels, templates and the linked activity.** The three matrix rows
  that were still open:
  - **Session labels**: `session_split`/`session_lift`/`session_class` are
    decoded and shown as chips on the detail, and the log can filter by TYPE
    (split) and CLASS, which is what the website's browser offers. Unlabelled
    sessions match neither rather than leaking through.
  - **Warm-up templates**: `GET /lifting/warmup-templates` on sync, offered on
    the Live screen — one tap logs the template's steps as flagged warm-ups for
    the current exercise. Local-only, so it works with no signal; warm-ups never
    advance the plan.
  - **Linked Strava activity**: the link is decoded and shown on the detail with
    its duration, with Unlink and a picker backed by
    `GET /sessions/{id}/linkable-activities` → `PUT /sessions/{id}/link`. Both
    are optimistic and revert with a reason if the server refuses.
- [x] **P10 — the Train tab.** The tab that said "not built yet" now holds the
  training surface in three views: **Sessions** (the log with every filter),
  **Progress** (PRs, rep ranges, the e1RM line) and **Week** (the active plan's
  current week from `GET /training-plans/{id}/week/{n}`, Monday-based, with
  completed/partial/missed/rest status and today marked). Today is now *today
  only* — one day, one session — which is what makes the two tabs different
  things rather than two paths to the same list. The week is read-only on
  purpose: the editor is the website's job, the phone's is to say what is
  coming.
- [x] **P11 — the records book.** Progress could only show what the phone could
  prove from its own history, which by definition excludes a PR with no session
  behind it. `GET /lifting/prs` is now read (names trimmed, Brzycki filled in
  when the server has no estimate, `manual` when `session_id` is null),
  `POST /lifting/prs` types one in, and Progress shows RECORDS above the
  computed bests with a "manual" badge — kept apart on purpose, because a
  number you typed and a number the log proves should not look the same.
- [x] **P12 — analytics from the log.** The website's Analytics tab, computed
  locally instead of from `/charts/*` (`domain/Analytics.kt`): eight
  Monday-based weeks of volume (zero-filled, because the gap is the point),
  volume by focus with an "Other" tail, and the lifts trained most. Warm-ups
  never count. The same reasoning as Progress — the screen cannot disagree with
  the log it is drawn from, and it works on a dead signal.

- [x] **P13 — templates you can keep.** The Live screen's warm-up list is now a
  manager, not just a menu: `×` deletes a template (`DELETE
  /lifting/warmup-templates/{id}`, optimistic, put back with a reason if the
  server refuses), and once you have logged a ramp **"Save these N warm-ups as
  a template"** posts exactly what you did (`POST /lifting/warmup-templates`,
  steps numbered by position) so next time it is one tap. The website's Templates
  tab owns renaming and editing; the phone keeps what it is good at — capturing a
  ramp you just performed.

- [x] **P14 — analyse a session.** The website can ask Gemini what it thinks of
  a session; the app can now too. `GET /lifting/sessions/{id}/ai-analysis`
  returns the cached analysis (JSON `null` when there is none), and the POST
  generates one on demand — through a longer-timeout client, because a model
  reading the session is not a database query. The detail shows the text with
  its model and a "Run again", and an unset key surfaces as `501` on the button
  rather than a silent nothing.

- [x] **P15 — today's verdict.** `GET /dashboard/today` carries the unified
  verdict (headline, `should_rest`, reasons, per-engine consensus) plus TSB and
  recovery. The app shows it as the first card on Today — the server's sentence,
  not one the phone composed — with up to three reasons and the two numbers.
  A silent engine is reported as "unavailable" rather than dropped (a list that
  omits it reads as agreement), and no verdict at all is no card, so the screen
  falls back to the plan alone.

- [x] **P16 — start a day from the Week.** The Week view carried only a count of
  exercises; now each day carries its prescription, so tapping a strength day
  starts that session — including a day that is not today, which is what a week
  view is *for*. The load is last time's, because a planned entry says sets and
  reps, not kilos. A run/rest/empty day is not clickable, and starting is refused
  while another session is in progress rather than throwing away logged sets.

- [x] **P17 — the summary knows what a record is.** Finishing a session now shows
  NEW RECORD(S) above the volume breakdown: the lifts whose estimated 1RM beat
  everything before them, judged by `ProgressEngine.sessionRecords` against the
  history *before* this session (so the summary is a claim, not a comparison with
  itself). A lift you have never logged counts — the first time is the record —
  an equal estimate does not, and warm-ups and bodyweight sets never do.

- [x] **P18 — the Body tab.** The last placeholder but Ride now has content:
  bodyweight from `GET /metrics/weight?days=90` — the latest weigh-in, the
  30-day change, the **7-day rolling average** as a line (the number that
  actually answers "am I going the right way"), and the weigh-ins themselves
  with their source. `POST /metrics/weight` logs one (upserting by date, so a
  second weigh-in the same day replaces the first) and `DELETE
  /metrics/weight/{id}` removes one — but only a `manual` entry: a scale's
  reading is not ours to delete. A weight outside 20–400 kg is refused before it
  is sent.

- [x] **P19 — page the week.** A week view that cannot look ahead is a list with
  a date on it. The Week header now carries `‹ week N ›` and a "This week" jump
  when you have paged away. The number is counted in Monday-based weeks from the
  plan's own start (`PlanWeeks`), and clamped to the plan's extent, so an arrow
  never asks the API for week 0 or week 999 — and past either end it stays put.

- [x] **P20 — the device pass.** Driven on the OnePlus 11 (360×804 dp) against
  prod, following [`android-device-pass.md`](android-device-pass.md). It found
  four bugs the 180 JVM tests could not:
  1. the **Today tab showed "NOT BUILT YET / Today"** — `switchTab` sent every tab
     through the `tab/{name}` route, and Today is its own destination;
  2. **"Save these N warm-ups…" was invisible**, sitting below a template list
     taller than the space above the action deck;
  3. the **AI analysis rendered as raw markdown** (`###`, `**`) — now stripped by
     `AnalysisText`;
  4. the **week pager lied at the plan's edge** (same week, "This week" shown) —
     `PlanWeek` now carries its extent and the arrows die at the ends.
  Also caught: `android:windowLightNavigationBar` needed API 27 while `minSdk` is
  26 (`:app:lintDebug` now passes), and a completed plan day hid the "today"
  marker.
  Verified live: rest day + verdict, Week (week 11, today, day statuses), Sessions
  volumes, Progress records (including a **manual Deadlift 190×1**) and analytics,
  Body (88.9 kg, −1.0 kg over 30 days, the 7-day line), a full session (warm-up
  template applied, saved and deleted; RPE 8 + note; pushed) and its deletion
  surviving a restart and resync — so the DELETE reached the server. Test data
  was removed.

- [x] **P21 — the Ride tab.** The last placeholder. `GET /activities` is
  unfiltered (it answers every sport), so the app asks for a page and keeps the
  rides by `sport_type` — `Ride`, `VirtualRide`, `EBikeRide`, `cycling`. The tab
  shows the last 7 days as distance, time and TSS, then the recent rides with
  pace, average power/HR and their own TSS. Every number is computed from the
  rides on screen, so the summary cannot disagree with the list beneath it. It
  is read-only: a ride comes from Strava or Komoot, and the phone is not where it
  gets edited.

- [x] **P22 — the dashboard.** The website's `/dashboard` replicated on the
  phone's home. It keeps the verdict and the plan at the top (the action), then
  the review below it — the reverse of the website's order, on purpose.
  - **LOAD** — `GET /cycling/training-load?days=42`: CTL/ATL/TSB, the form in
    words (`formLabel`), the 7-day change with its direction, and a CTL line.
  - **THIS WEEK** — sessions, volume, rides, distance and TSS for the last seven
    days, computed from the log and the rides (never the server's stored
    volume), with a 28-day line beneath it.
  - **TODAY SO FAR** — from `/dashboard/today`: TSS, volume, distance, time and
    how many sessions/activities, hidden when the day is empty.
  - **READINESS** — `/metrics/readiness` (score, HRV, resting HR) plus
    `/metrics/sleep-debt?days=7`; no Whoop means the server's own message, not a
    zero.
  - **GOALS** — `/goals`, up to three active ones, soonest first, progress from
    the starting value (a server percentage wins where it exists).
  - **RECENT** — the last four things done, lifts and rides merged newest-first.
  - Every section is fetched independently and fails alone: a dead endpoint
    costs that card, not the dashboard. Deliberately absent: the weather widget
    (the phone has a weather app) and the website's Year chart (Train › Progress
    already draws eight weeks of volume, and a year chart on a 360dp phone is a
    chart you cannot read).

- [x] **P23 — the cycling page.** The website's `/cycling`, on the Ride tab:
  seven-day tiles with the server's trend arrows (`/cycling/metrics-summary`),
  the power curve with its CP/W'/Pmax fit (`/cycling/power-curve`,
  `/cycling/power-model`), time in zones (`/cycling/power-zones?days=30`), FTP
  history with the change and VO2max (`/cycling/ftp-history`, `/cycling/vo2max`),
  and the rides underneath. Six independent fetches, each fail-open, so a rider
  with no power meter still gets the summary and the list. Deliberately absent:
  the weather analysis, the LLM card and the profile editor — the first two are
  desktop reading, and a phone should not edit an FTP it cannot verify.

- [x] **P24 — the goals page.** `/goals` on the phone: every goal (active first,
  then by target date) with progress measured **from its starting value**, a
  check-in form and the last five check-ins per goal, status changes
  (achieved / archived / reactivate), delete, and a create form whose metric
  chips come from `GET /goals/metrics` — a metric that needs a filter is not
  offered, because the phone cannot fill one in. `Goal` replaced the dashboard's
  `GoalProgress` so one model answers for both surfaces. Reached from You ("N
  active goals") and from the dashboard's GOALS card.

- [x] **P25 — the routes page.** `/routes` as a shape-led atlas: each route is
  drawn from its `preview_polyline` (decoded in `domain/Polyline.kt`, aspect
  corrected at the route's latitude), with filters (All / Loops / Unridden /
  Favourites), favourites first then longest, and an expanded row showing
  locality, loop/point-to-point, surface, quality and favourite state. No map
  tiles, no key, no signal. Reached from You → Routes. The web's duplicate
  maintenance and segment views stay on the website.

- [x] **P26 — editing a plan day.** The phone's one writing surface into a plan:
  from Train › Week, a day's `edit` opens sport, focus, the exercise list
  (name / sets / reps / kg, add and remove) and notes, saved as a single
  `PATCH /training-plans/{id}/days/{day}`. Only the changed fields are sent, so
  a focus edit cannot rewrite the prescription; a 409 (the date already holds
  another session of that sport) is shown verbatim; success reloads the week and
  today. The week now carries `plan_id` and each day's id, and a day without one
  cannot be edited. The website keeps the full editor, program matrix and block
  tools — this is the sentence you change on a phone, not a desk tool.

- [x] **P27 — health and the calendar.** **Health** is four answers rather than
  ten charts: recovery (`/metrics/readiness`), sleep debt
  (`/metrics/sleep-debt`), sleep timing (`/metrics/sleep-consistency` — score,
  spread, average bedtime) and breathing rate (`/metrics/respiratory-rate`, with
  the change against its baseline). **Calendar** is a Monday-first month grid
  from `GET /activities/calendar`: a lift dot, a ride dot and a recovery tint per
  cell, month paging, and a day's entries plus recovery/sleep/HRV/RHR/strain on
  tap. Both reached from You; `HealthApi` reuses the dashboard's readiness and
  sleep debt instead of fetching them under a second cache key. The website's
  chart wall and its health-alert list are deliberately absent — neither answers
  a question a phone asks.

The lifting matrix is now complete: every row the website's `/lifting` surface
has, the app has, except plan *editing* (deliberately the website's job — the
app's Week view is read-only) and template *renaming/editing* (the Templates
tab's job). The end-to-end device checklist that proves it lives in
[`android-device-pass.md`](android-device-pass.md).
- [x] **P7 — device pass.** Installed on the OnePlus 11 (CPH2449, 1080×2412
  @480 dpi = 360×804 dp) over Wi-Fi adb and driven against **prod** end to end:
  34 real sessions pulled, the log with its filters, Progress computed from that
  real history (PRs, rep ranges, the e1RM line), a live set logged with the rest
  card and plate caption, the finish sheet's RPE + note, the detail screen, a
  set edited (360 → 370 kg), and the session deleted — gone after a restart and
  resync, which is what proves the DELETE reached the server and not just the
  local store.

  The pass found two bugs no JVM test could:

  1. Progress defaulted to the *strongest* lift, which was a one-off exercise, so
     the chart said "two sessions and the line appears" on an account with 34
     sessions. It now defaults to the exercise with the longest record, and the
     chips are ordered by sessions rather than sets.
  2. The FOCUS chips showed "Push · Pull · Legs · Legs · Pull": the server holds
     both `Legs` and `Legs ` (a trailing space survives the website's form), and
     the app grouped the raw strings. Focus and exercise names are now trimmed at
     the decode boundary and in every comparison, so one lift is one row.

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
