# FitTrack Android — design lab

Phase 1–2 lab for the Android app. It renders five frames of one flow at real
device metrics on the JVM. It is not the app: there is no navigation, no network,
no state, and no production code. Deletable in one commit.

## Run it

```
powershell -NoProfile -ExecutionPolicy Bypass -File prototype/android/qa/shoot.ps1
```

That builds, lays out and rasterises all five frames, copies them to `qa/out/`,
and prints the contrast gate. Then, for the sheet:

```
python prototype/android/qa/contact_sheet.py
```

Toolchain expected outside the repo: JDK 17, Android SDK 35, Gradle 8.11.1 in
`%LOCALAPPDATA%\Android`. `qa/shoot.ps1` finds them if they are there.

## What is in here

| Path | What it is |
|---|---|
| `app/src/main/java/uk/oli/fittrack/lab/ui/` | The screens: `TodayScreen`, `LiveSetScreen`, `SessionDoneScreen`, `NavBar`, `Tokens` |
| `app/src/test/.../FlowShotTest.kt` | Renders frames 1–5 and asserts the primary action's size and position |
| `qa/shoot.ps1` | One command: render, collect, check contrast |
| `qa/contrast.ps1` | Reads tokens out of `Tokens.kt`, asserts every text pair ≥4.5:1 |
| `qa/contact_sheet.py` | Assembles `qa/out/contact-sheet-flow.png` |
| `qa/out/` | The frames and the sheet |
| `DECISIONS.md` | Why each choice was made, what was rejected, what is placeholder |
| `REFERENCE.md` | The five references, two anti-references, and the gate |
| `PARITY.md` | 21 desktop routes → 5 phone tabs, with status |

## What it deliberately does not do

- No auth, no backend, no database, no navigation.
- No emulator and no device: Robolectric rasterises the real Compose tree. That
  means no system chrome, no haptics, no predictive back, no keyboard resize.
- No offline behaviour, despite G8. Static frames are not a cache.
- No tests beyond the render gate — there is no logic to test yet.
