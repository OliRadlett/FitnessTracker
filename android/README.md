# FitTrack for Android

Native Kotlin + Jetpack Compose client. v0.1 is the gym flow: today's session,
live set logging with a rest timer, and a summary computed from what you logged.

It is **not** a port of the web UI. The design decisions come from
`prototype/android/` (frames, gate, parity matrix); the code was written fresh
against those decisions.

## What works

- Five-tab shell — Today, Train, Ride, Body, You. Only Ride says "not built
  yet" now: Today has the day, Train the sessions/progress/week, Body the
  bodyweight trend, You the account.
- **Body**: bodyweight — the latest weigh-in, its 30-day change, the 7-day
  rolling average as a line, and the weigh-ins behind it with their source.
  Logging one upserts by date; only a manual entry can be deleted.
- **Today is the dashboard**: the plan (or "Rest day") and one action at the top,
  then the website dashboard's review underneath — **load** (CTL/ATL/TSB, the
  form in words, the 7-day change), **this week** and 28 days across lifts and
  rides, **today so far** (TSS, volume, distance, time), **readiness** with sleep
  debt, **goals** with progress from their starting value, and the **recent**
  lifts and rides merged newest-first. Each section loads independently and fails
  alone.
- **Train**: the training surface in three views — **Sessions** (the log),
  **Progress** and **Week** (the active plan's current week, read-only, with
  completed, partial, missed and rest days marked and today outlined).
- Live: prefilled weight/reps/RPE from the set you just did, ± steppers, RPE
  chips, rest timer, and a per-exercise set list showing what you actually
  logged.
- Live set flags: **Warm-up** logs a ramp-up set (kept and flagged, but it does
  not count towards the plan, the volume or the next prefill, and starts no
  rest), **AMRAP** flags a set as all-out, and RPE is optional and can be a half
  point (6.0–10.0 by 0.5). All three travel to the API as `is_warmup`,
  `is_amrap` and a nullable `rpe`.
- Done: volume, sets, duration and top set, computed from the log — plus the
  session's own RPE and a note, which travel into history and to the API.
- Process death costs nothing: the session is written to disk after every set.
- **Rest and plates**: the rest card states its target (2:30 by default) and
  adjusts in 30-second steps mid-rest, restarting the timer at the new length.
  The weight stepper carries a plate calculator — bar weight (20 kg, tap for the
  15 kg bar) and the per-side plates, including what cannot be made up.
- **History**: finishing a session (early or complete) writes it to
  `history.json`, capped at 200. Today then shows "Last time 92.5 × 4 @7 · today"
  and a 7-day volume strip; the next session prefills from what you actually
  lifted, not from the plan.
- **The log**: Train → **Sessions** lists finished sessions by week with sets and
  volume; tapping one opens the full session. It filters on free text (focus,
  note, exercise names), focus, exercise, a date window and the classifier's type
  and class, with a result count and a "No sessions match" state.
- **Progress**: Train → **Progress** shows personal bests per exercise (by
  estimated 1RM), the best set in each rep range, and a per-exercise e1RM line
  over the last 20 sessions. Computed from the cached history, so it works
  signed out and without a signal.
- **Analytics**: also on Progress — eight weeks of volume as bars, where the work
  went (volume by focus, with an "Other" tail) and the lifts trained most.
  Computed from the same history: no `/charts` calls, warm-ups excluded.
- **Records**: the server's `GET /lifting/prs` list, including the manual PRs
  that have no session behind them, shown above the computed bests with a
  "manual" badge; `+ Add` types one in. The finish summary also lists the records
  the session just set — a lift you have never logged counts, an equal estimate
  does not, and warm-ups or bodyweight sets never do.
- **Today's verdict**: the server's `/dashboard/today` headline and its reasons,
  with TSB and recovery, as the first card on Today. No verdict is no card.
- **AI analysis**: the session detail reads the cached analysis and can ask for
  a fresh one, showing the model that wrote it.
- **Week**: Train → **Week** lists the active plan's current week with
  completed/partial/missed/rest and today marked. A strength day carries its
  prescription, and tapping it starts that session with last time's load.
- **Session detail**: every set, grouped by exercise, with warm-ups flagged,
  AMRAP badges, per-set notes, the session note and the session's own RPE.
  Tapping a set edits it inline (weight, reps, RPE, warm-up/AMRAP, note); a set
  can be deleted, and so can the whole session. `+ Set` adds a missed set,
  `+ Add exercise` adds a whole exercise, and `Edit` moves the date (by whole
  days), renames the focus and edits the session note. Synced rows are written
  back with `PATCH`/`POST`/`DELETE` and revert with a reason if the server
  refuses; local-only rows edit in place.
- **Repeat a session**: "Repeat this session" starts today from a finished one —
  the same exercises, the same number of working sets, and last time's load and
  reps as the target. Warm-ups are not copied.
- **History sync (pull)**: once signed in, lifting history is fetched from
  `GET /api/v1/lifting/sessions` and merged into the local log, so "last time"
  reflects what you actually lifted. Fail-open: no signal means no sync, never a
  blocked workout. Warm-up sets are kept and flagged — they show on the session,
  but never prefill a working set, never count towards the plan and never add
  volume.
- **Push**: a finished session is uploaded to `POST /api/v1/lifting/sessions`
  in the background, so finishing never waits on the network. `live_key` carries
  the phone's session id, which makes the retry idempotent — and on success the
  local id is rewritten to the server's, so the next pull cannot duplicate it.
  Offline sessions stay pending and go up on the next sync.
- Account: Google Sign-In through Credential Manager, verified server-side
  ([docs/ANDROID-AUTH.md](../docs/ANDROID-AUTH.md)). You → **Continue with Google**.

## What does not work yet

- **Offline plan**: today's session comes from the training plan when signed in
  (`GET /training/plans`). Signed out — or before the first sync — the app
  prescribes the seeded push day from `data/SessionStore.kt › SeedPlan`.
- **Lifting parity is in progress** — the phase list P0–P9 in
  [`plans/android-lifting-parity.md`](../plans/android-lifting-parity.md) is
  complete and has been run on a real phone (OnePlus 11, 360×804 dp) against
  prod. Still on the matrix: manual PRs (a PR with no session behind it).
- No widgets, Health Connect, background sync or notifications.
- Sign-in is not a gate — the gym flow works before you authenticate. Logging a
  set must never wait on a network round trip.

## Build

```
cd android
gradle :app:assembleDebug          # APK
gradle :app:testDebugUnitTest      # engine tests + real-Activity screenshots
```

Toolchain: JDK 17, Android SDK 35, Gradle 8.11.1.

The screenshot tests launch the real `MainActivity`, tap Start and Log, and
write `app/build/shots/app-{1-today,2-live,3-rest}.png` at 412×915dp.

## Layout

| Path | What |
|---|---|
| `domain/Session.kt` | Plan, log, and `SessionEngine` — all the gym rules, no Android |
| `data/SessionStore.kt` | JSON-file persistence for the session in progress |
| `AppViewModel.kt` | One session at a time, rest timer, persistence |
| `ui/AppRoot.kt` | Navigation graph and tab switching |
| `ui/today`, `ui/live`, `ui/done` | The three screens of the flow |
| `ui/Common.kt` | Tokens, bottom nav, action deck, buttons |
