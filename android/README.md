# FitTrack for Android

Native Kotlin + Jetpack Compose client. v0.1 is the gym flow: today's session,
live set logging with a rest timer, and a summary computed from what you logged.

It is **not** a port of the web UI. The design decisions come from
`prototype/android/` (frames, gate, parity matrix); the code was written fresh
against those decisions.

## What works

- Five-tab shell — Today, Train, Ride, Body, You. Only Today has content; the
  other four say so plainly.
- Today: the plan, six exercises, one action. Resumes an unfinished session.
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
- **The log**: Today → **Log** lists finished sessions by week with sets and
  volume; tapping one opens the full session. It filters on free text (focus,
  note, exercise names), focus, exercise and a date window, with a result count
  and a "No sessions match" state.
- **Progress**: Today → **Progress** shows personal bests per exercise (by
  estimated 1RM), the best set in each rep range, and a per-exercise e1RM line
  over the last 20 sessions. Computed from the cached history, so it works
  signed out and without a signal.
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
