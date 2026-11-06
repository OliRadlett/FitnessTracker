# FitTrack Android app (`android/`)

> Moved out of [`AGENTS.md`](../AGENTS.md) on 2026-11-06. `AGENTS.md` keeps a
> short summary and points here. Paths below are relative to this file.

Native Kotlin + Compose client, v0.1 — the gym flow. It is **not** a port of the
web UI: its decisions come from [`prototype/android/`](../prototype/android/README.md)
(frames, gate, parity matrix), and the code was written fresh against them.

- **Build**: from `android/`, `gradle :app:assembleDebug`. Tests and screenshots:
  `gradle :app:testDebugUnitTest` — JVM only, no emulator (Robolectric draws the
  real `MainActivity`).
- **Rules belong in [`SessionEngine`](../android/app/src/main/java/uk/oli/fittrack/domain/Session.kt)**:
  prefill, current exercise, volume, completion. Pure and unit-tested; screens
  must not re-derive them.
- **State**: one session at a time in [`AppViewModel`](../android/app/src/main/java/uk/oli/fittrack/AppViewModel.kt),
  persisted as JSON by [`SessionStore`](../android/app/src/main/java/uk/oli/fittrack/data/SessionStore.kt)
  after every set, so process death mid-workout costs nothing.
- **Sign-in**: Google via Credential Manager → `POST /api/v1/auth/mobile/google`,
  which verifies the ID token against Google's JWKS before minting a JWT
  ([`services/google_id.py`](../backend/app/services/google_id.py)). Setup and the
  failure table live in [`docs/ANDROID-AUTH.md`](ANDROID-AUTH.md). Sign-in is
  **not** a gate: the gym flow works before you authenticate.
- **History sync**: `GET /lifting/sessions` on sign-in, mapped in
  [`net/LiftingApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/LiftingApi.kt)
  from a captured live payload and merged into the local log. Warm-up sets are
  **kept and flagged** (`is_warmup`), never dropped: the detail screen shows them
  as the website does, while `SessionEngine.workingSets` keeps them out of
  prefill, volume and set counts. Finishing uploads via
  `POST /lifting/sessions` with `live_key` = the phone's session id, which makes
  the retry idempotent; on success the local id becomes the server's, so the next
  pull cannot duplicate it. Fail-open: no signal means no sync, never a blocked
  workout.
- **Editing history**: [`SessionDetailScreen`](../android/app/src/main/java/uk/oli/fittrack/ui/log/SessionDetailScreen.kt)
  shows every set grouped by exercise (W/AMRAP badges, per-set notes, session
  note and RPE); tapping a set edits it inline, `+ Set` adds a missed set,
  `+ Add exercise` adds a whole exercise, and `Edit` changes the session's date
  (by whole days), focus and note. A synced row calls `PATCH`/`DELETE`/`POST`
  and **reverts with a reason** if the server refuses, so a failed edit never
  silently diverges from the website. Local-only rows edit in place. `PATCH`
  bodies use `LiftingPatchJson` (`encodeDefaults` + `explicitNulls`) so a cleared
  RPE is sent as `null` rather than omitted; a day move uses `plusDays` on a
  zoned time so an 18:00 session stays 18:00 across a DST boundary. "Repeat this
  session" starts today from a finished one (`SessionEngine.planFrom`), copying
  working sets only.
- **Lifting parity target**: [`plans/android-lifting-parity.md`](../plans/android-lifting-parity.md)
  holds the website-versus-app matrix and the phase list (P0–P19, device pass at
  the end).
- **Progress**: Train's Progress view computes PRs, best-by-rep-range and a
  per-exercise estimated-1RM line from the cached history
  ([`domain/Progress.kt`](../android/app/src/main/java/uk/oli/fittrack/domain/Progress.kt)),
  with no network in the path. Warm-ups never count; empty rep ranges are shown
  as empty rather than omitted. The chart defaults to the exercise with the
  longest **session** record, not the strongest lift — a one-off PR has no line
  to draw.
- **Browsing the log**: Train's **Sessions** view filters on free text (focus,
  note, exercise names), focus, exercise, a date window and the classifier's
  TYPE (split) and CLASS
  ([`domain/HistoryFilter.kt`](../android/app/src/main/java/uk/oli/fittrack/domain/HistoryFilter.kt)),
  all pure and unit-tested. Week grouping is deliberate: a phone reads weeks
  better than the website's months.
- **Train tab**: [`ui/train/TrainScreen.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/train/TrainScreen.kt)
  holds Sessions · Progress · **Week** (the active plan's current week from
  `GET /training-plans/{id}/week/{n}`, Monday-numbered from the plan's start,
  with completed/partial/missed/rest and today marked). A strength day carries
  its prescription, so tapping it starts that session (load = last time's) —
  `AppViewModel.startFromDay`, refused while one is already in progress. The
  header pages between weeks (`‹ week N ›` plus "This week"); the number is
  Monday-based from the plan's start and clamped to its extent by `PlanWeeks`.
  Today is today-only; the two tabs stay different things.
- **Labels, templates, links**: the session detail shows the classifier's
  split/lift/class chips and any linked Strava activity (link/unlink through
  `/sessions/{id}/linkable-activities` and `PUT /sessions/{id}/link`); the Live
  screen offers saved warm-up templates (`/lifting/warmup-templates`) that log
  their steps as flagged warm-ups for the current exercise, locally, with no
  signal — plus `×` to delete one and "Save these N warm-ups as a template" to
  capture the ramp you just did (`POST`, steps numbered by position). Renaming
  and editing a template stays on the website's Templates tab.
- **Names are trimmed at the boundary**: the server has held both `Legs` and
  `Legs `, and an untrimmed name silently splits a lift's history in two. The
  decoder trims, and every grouping/comparison trims, so one lift is one row.
- **Finishing**: the summary asks for the session's own RPE and a note, and
  `SessionEngine.finished()` turns the session in progress into history with
  both. A blank note is null, not an empty string. It also shows the session's
  **new records** (`ProgressEngine.sessionRecords` against the history *before*
  the session): a lift you have never logged counts, an equal estimate does not,
  and warm-ups/bodyweight sets never do.
- **Today's session comes from the training plan**: `GET /training-plans` → the
  plan whose dates bracket today → `GET /training-plans/{id}` → today's
  `sport == "strength"` day, mapped in
  [`net/PlanApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/PlanApi.kt)
  (focus as the title, prescribed sets/reps, last time's load as the weight).
  A rest day shows "Rest day." and "Start anyway"; a failed request leaves the
  current plan alone rather than inventing a rest day. `SeedPlan` is only the
  fallback when signed out or offline, and the phone's plan editor is hidden
  while a server plan is showing.
- **Today's verdict**: `/dashboard/today` → the unified verdict card at the top
  of Today ([`net/TodayApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/TodayApi.kt)):
  the server's headline, up to three reasons, and TSB/recovery. It shows the
  server's sentence rather than composing one, keeps an unavailable engine in
  the list as "unavailable", and renders nothing at all when there is no verdict.
- **Today is the dashboard**: [`ui/today/DashboardCards.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/today/DashboardCards.kt)
  renders the website's dashboard on the phone — LOAD (CTL/ATL/TSB + form in
  words + 7-day delta, `/cycling/training-load`), THIS WEEK (from the log and
  rides, with a 28-day line), TODAY SO FAR (`/dashboard/today`), READINESS +
  sleep debt (`/metrics/readiness`, `/metrics/sleep-debt`), GOALS (`/goals`,
  progress from the starting value) and RECENT (lifts and rides merged). Data
  comes from [`net/DashboardApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/DashboardApi.kt),
  four independent fetches that each fail alone. The plan and the verdict stay
  **above** the review — the opposite of the website, because Today's job is to
  say what you are doing.
- **AI analysis**: the session detail asks for the cached analysis (`GET
  /lifting/sessions/{id}/ai-analysis`, JSON `null` before one exists) and can
  generate one (`POST`, on a 120 s client because a model is reading the
  session). The text is cached per session in the view model; `501` is surfaced
  as the reason on the button.
- **Records**: `GET /lifting/prs` is read ([`net/PrApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/PrApi.kt)),
  including the manual PRs that have no session behind them, and `POST
  /lifting/prs` types one in. Progress lists them above the computed bests with
  a "manual" badge — a typed number and a proven one must not look the same.
- **Analytics**: [`domain/Analytics.kt`](../android/app/src/main/java/uk/oli/fittrack/domain/Analytics.kt)
  computes eight Monday-based weeks of volume, volume by focus (with an "Other"
  tail) and the most-trained lifts from the cached history — no `/charts` calls,
  no network, warm-ups excluded. Same rule as Progress: it cannot disagree with
  the log it is drawn from.
- **Body tab**: bodyweight from `GET /metrics/weight?days=90`
  ([`net/BodyApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/BodyApi.kt),
  [`ui/body/BodyScreen.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/body/BodyScreen.kt)):
  latest weigh-in, 30-day change, the **7-day rolling average** as a line, and
  the weigh-ins with their source. `POST` logs one (the API upserts by date) and
  `DELETE` removes only a `manual` entry. 20–400 kg is enforced before sending.
- **Ride tab is the cycling page**: [`ui/ride/RideScreen.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/ride/RideScreen.kt)
  replicates the website's `/cycling` — seven-day tiles with the server's trend
  arrows (`GET /cycling/metrics-summary`: TSS, rides, km, time, elevation, FTP and
  W/kg), the power curve and its CP/W'/Pmax fit (`/cycling/power-curve`,
  `/cycling/power-model`), time in zones (`/cycling/power-zones?days=30`), FTP
  history with the change and VO2max (`/cycling/ftp-history`, `/cycling/vo2max`),
  then the rides from `GET /activities`. Data comes from
  [`net/CyclingApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/CyclingApi.kt):
  six independent fetches that each fail alone, so a rider with no power meter
  still gets the summary and the list. Read-only — a ride comes from Strava or
  Komoot, and the phone is not where it gets edited.
- **Goals page**: [`ui/goals/GoalsScreen.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/goals/GoalsScreen.kt)
  replicates `/goals` — every goal with progress from its starting value, a
  check-in form and history per goal, status changes (achieved/archived/
  reactivate), delete, and a create form whose metric chips come from
  `GET /goals/metrics` (a metric that needs a filter is not offered, because the
  phone cannot fill one in). Data and writes live in
  [`net/GoalsApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/GoalsApi.kt).
  Reached from You and from the dashboard's GOALS card. **One goal model**:
  [`domain/Goals.kt`](../android/app/src/main/java/uk/oli/fittrack/domain/Goals.kt)
  `Goal` is what both the dashboard card and this page use, so their percentages
  cannot disagree.
- **Routes page**: [`ui/routes/RoutesScreen.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/routes/RoutesScreen.kt)
  replicates `/routes` as a **shape-led atlas**: every route is drawn from its
  own `preview_polyline` ([`domain/Polyline.kt`](../android/app/src/main/java/uk/oli/fittrack/domain/Polyline.kt)
  decodes Google's format, `normalise` keeps the aspect at the route's latitude),
  because a shape is what tells one route from another and it needs no tiles, no
  key and no signal. Filters (All / Loops / Unridden / Favourites), favourites
  first then longest, and tapping one shows locality, loop/point-to-point,
  surface, quality and whether it is starred. Data from
  [`net/RoutesApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/RoutesApi.kt).
  Reached from You → Routes. The web's map, segments and duplicate-maintenance
  screen are deliberately not here.
- **Editing a plan day**: Train › Week rows carry `edit` for any day the server
  gave an id to, opening [`ui/train/PlanDayEditScreen.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/train/PlanDayEditScreen.kt):
  sport, focus, the exercise list (name / sets / reps / kg, add and remove) and
  notes, saved as **one** `PATCH /training-plans/{id}/days/{day}` through
  `PlanApi.saveDay`. Only the changed fields go in the body, so a focus edit
  cannot rewrite the prescription. A refusal (409 — the date already holds
  another session of that sport) is shown verbatim above the button; success
  reloads the week and today and pops the screen. This is the phone's only
  writing surface into a plan: the website keeps the full editor, program matrix
  and block tools.
- **Health and calendar**: [`ui/health/HealthScreen.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/health/HealthScreen.kt)
  holds both. **Health** is four answers, not ten charts: recovery (score/HRV/RHR
  from `/metrics/readiness`, shared with the dashboard), sleep debt
  (`/metrics/sleep-debt`), sleep timing (`/metrics/sleep-consistency` — its score,
  spread and average bedtime) and breathing rate (`/metrics/respiratory-rate`,
  with the change against the baseline). **Calendar** is a Monday-first month
  grid from `GET /activities/calendar?start_date=&end_date=`: a lift dot, a ride
  dot and a recovery tint per cell, month paging (`‹ This month ›`), and tapping
  a day opens its entries plus recovery/sleep/HRV/RHR/strain. Data lives in
  [`net/HealthApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/HealthApi.kt),
  which reuses the dashboard's readiness and sleep debt rather than fetching
  them twice under a different key. Reached from You.
- **Activities page**: [`ui/activities/ActivitiesScreen.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/activities/ActivitiesScreen.kt)
  is the feed and one activity. The feed filters by sport (All / Rides / Lifts)
  and window (30d / 90d / 1y / All) and reads "Today · Ride · 55.6 km · 3h 12m ·
  400 m · TSS 118" with the two label axes (purpose, ride type) under it; a lift
  borrows its focus for the sport. The detail draws `encoded_polyline` through
  the same decoder the routes atlas uses, then distance/time/climb,
  power/HR/TSS/speed, the route name, any linked lift and whether streams exist
  — the replay itself stays on the website, which the screen says. Data in
  [`net/ActivitiesApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/ActivitiesApi.kt);
  reached from You → Activities. The website's comparison mode and replay
  theatre are deliberately absent.
- **Notifications page**: [`ui/notifications/NotificationsScreen.kt`](../android/app/src/main/java/uk/oli/fittrack/ui/notifications/NotificationsScreen.kt)
  lists what the server wants to tell you, unread first and raised, read ones
  flat and muted, with the type in words ("Health", "Record", …) and an age that
  reads as a clock time today, "Yesterday", a weekday, then a date. Tapping one
  marks it read locally and on the server; "Mark all read" becomes "Refresh"
  when nothing is unread. Data in
  [`net/NotificationsApi.kt`](../android/app/src/main/java/uk/oli/fittrack/net/NotificationsApi.kt)
  (`/notifications`, `/summary`, `PATCH /{id}/read`, `POST /read-all`). The
  website's type filters and preference grid stay on the website — a phone reads
  a notification, it does not configure one. Reached from You, which shows the
  unread count.
- **Not built yet**: nothing is a placeholder any more. The lifting matrix is
  complete (phase list P0–P20 in
  [`plans/android-lifting-parity.md`](../plans/android-lifting-parity.md)), the
  device pass has run, and plan *editing* is deliberately left to the website.
