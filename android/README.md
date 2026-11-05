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
- Done: volume, sets, duration and top set, computed from the log.
- Process death costs nothing: the session is written to disk after every set.

## What does not work yet

- No auth. No API client. No sync. The plan is a seeded constant
  (`data/SessionStore.kt › SeedPlan`).
- No history: the week strip and load numbers are absent rather than fake.
- No widgets, Health Connect, background sync or notifications.

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
