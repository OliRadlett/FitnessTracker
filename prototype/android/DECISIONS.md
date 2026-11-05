# DECISIONS — FitTrack Android app (design lab)

> Lab: `prototype/android/`. Deletable in one commit. Prototype code is not
> production code and must not be merged.

## D1 — Parity is the destination, one flow is the artifact

**Decision.** The app will eventually mirror all 20 in-app desktop destinations.
The artifact for this session is *one* flow — Today → Live set → rest → done →
Today after — rendered on a real fixture.

**Why.** "Mirror the website, optimised for phones" is the brief that produced
the current ceiling: 20 screens ported one-for-one become a website in a
Costume. Coverage is tracked in the parity matrix (G9); the method is
structure-per-surface, never layout-per-page.

**Rejected.** "Build all 20 screens as a prototype before agreeing anything" —
unlimited time does not mean unlimited scope, and 20 unvalidated layouts teach
nothing about whether the language works.

## D2 — Kotlin + Jetpack Compose, native

**Decision.** Native Android.

**Why.** The features that justify an app at all — home-screen widget, FCM,
Health Connect, offline writes, predictive back, insets — are unavailable to a
PWA. The PWA already exists and already works; a wrapper would ship the ceiling
we are trying to replace.

**Rejected.** React Native (no reuse of Next.js components, still needs the whole
Android toolchain, weaker platform access) and a TWA wrapper (rejects the
premise).

## D3 — 20 destinations → 5 tabs (decided)

Today (dashboard, today, journal, activities) · Train (plan, calendar, lifting,
live, videos, goals) · Ride (cycling, routes, segments, replay, duplicates) ·
Body (health, analytics) · You (settings, notifications, wiki).

**Why.** Six areas, five slots. Log nests inside Today because "what did I do"
is a view of time and Today owns time.

**Decided 2026-11-05** without a confirmation, because it is a reversible swap
and the four remaining frames were blocked on it. If it is wrong, Log becomes a
tab and Body folds into Today — a swap, not a redesign. Recorded in
`PARITY.md` §open risks.

**Rejected.** Keeping a "More" drawer: it is the second navigation truth that
made the mobile web feel like a site.

## D4 — Render path: Robolectric draws the real Compose tree, no emulator

**Decision.** `qa/shoot.ps1` runs a JVM test that lays out the screen at the
device qualifiers and writes the decor view to PNG.

**Why.** Deterministic, CI-able, no AVD, ~2 min per rebuild for all frames, and
the pixels come from the same Compose code the app runs.

**What it cannot verify** — recorded so it is not mistaken for coverage:
system chrome and real insets, haptics, predictive back, keyboard/resize
behaviour, font fallback for missing glyphs, and performance. Those need a
device pass before production.

**Rejected.** `captureToImage()` — under Robolectric it waits on a window redraw
that never arrives (`ComposeTimeoutException` after 2 s). Emulator-first —
~1.5 GB of system image plus boot time per iteration for no extra design signal.

## D5 — Frame metrics: 412 × 915 dp, xxhdpi

Pixel 8 class. Renders at 1236 × 2745 px. Assumed until the owner's device is
confirmed.

## D6 — Typography: 12 sp floor, Roboto for now

**Decision.** No text below 12 sp; labels 12 sp at 0.7 sp tracking instead of the
web's 10–11 sp at wide tracking.

**Open.** The web brand face is Inter; there is no font asset in the repo
(`frontend` loads it via `next/font` at build time). The lab renders Roboto, so
the frames are *not* showing the brand face. Bundling Inter is a production-plan
item, not a lab blocker — but it must not be forgotten, because the type is a
large part of why the web product feels like itself.

## D7 — Colour: web tokens unchanged, accent reserved

`--background`, `--surface`, `--surface-light`, `--accent`, `--foreground`,
`--muted` are copied verbatim from `frontend/src/app/globals.css`. The accent is
used only for state and the single primary action, never decoration.

## D8 — Contrast is a measured gate, not a judgement

**Decision.** `qa/contrast.ps1` parses the token hex values out of `Tokens.kt` and
asserts every foreground/background pair the screens use.

**Result (current).** Fg 15.57:1 · Muted on Bg 7.58:1 · Muted on Surface 7.00:1 ·
Muted on SurfaceLight 5.83:1 · Accent on Bg 7.66:1 · Accent on Surface 7.08:1 ·
OnAccent on Accent 7.40:1. All pass 4.5:1.

**Why it exists.** The live 390 dp render of the web app measures **2.68:1** on its
stat labels. The token is fine; opacity applied to muted text is what dims it.
Rule: **never apply alpha to text colour.** The gate reads the tokens, so a later
"soften the label" edit fails the build instead of shipping.

## D9 — K1 result: PASS, and five frames since

JDK 17.0.20.1 + Android SDK 35 + Gradle 8.11.1 installed outside the repo
(`%LOCALAPPDATA%\Android`). Each rebuild lays out and rasterises all five frames
in ~2m20s; the blank guard (fewer than 20 distinct colours = fail) is active on
every capture. Outputs in `qa/out/1-today.png` … `5-today-after.png`, assembled
into `qa/out/contact-sheet-flow.png` by `qa/contact_sheet.py`.

Measured, not estimated:

| Frame | Primary height | Primary centre |
|---|---|---|
| 1 Today | 64 dp | 87% of screen |
| 2 Live set | 72 dp | 95% |
| 3 Rest | 72 dp | 95% |
| 4 Done | 64 dp | 95% |
| 5 Today, after | 64 dp | 87% |

## D10 — Placeholders in the current frame (do not mistake for done)

| Visible | Source | Status |
|---|---|---|
| 90 kg × 4 @7, 16 sets, 5,326 kg | production screenshots 2026-11-04 (real account) | real numbers, not yet read from the API |
| 42:18 elapsed, "4 min ago", "1:42" rest | invented to make the frame legible | **placeholder** |
| 6h 27m / 7h 45m week totals | summed from the real rides (3h14 + 3h13, then + 1h18) | derived, real |
| Set 3 / 4 pending rows | the planned 4 × 4 | plan-derived, not invented |
| No status bar / navigation bar | deliberate: drawing fake chrome lies | will appear on a device |
| Roboto instead of Inter | see D6 | **known fidelity gap** |

The fixture capture (headed browser login) is still outstanding. Until it lands,
G2 is verified against the screenshot numbers, not a live payload.

## D11 — What was subtracted

- **Segmented progress bar** — repeated what the four set rows already said.
  Removed rather than restyled.
- **Action bar** — the first render included platform decor ("FitTrack Lab");
  a frame must be the app's own layout.
- **Per-exercise volume table, notes, timers** — none are in this flow.

## D12 — Gate status at this checkpoint

| | Criterion | Status |
|---|---|---|
| G1 | Repeat set logged in ≤2 taps from open, no keyboard | **pass by construction** — Start session, then Log set; both are single taps and no field requires typing |
| G2 | Prefill matches the fixture (90 kg × 4 @7) | **pass on screenshot data**, not live payload |
| G3 | Rest visible without leaving the set screen | pass — frame 3 keeps the list, steppers and RPE in place |
| G4 | Every text run ≥4.5:1 measured | pass — 7 pairs, 5.83–15.57:1 |
| G5 | Targets ≥48dp, primary in the bottom 35% | pass — 64–72dp, centres 87–95% |
| G6 | Today ≤1.3 viewports, Live Lift no scroll | pass — both are single non-scrolling screens |
| G7 | ≤5 nav destinations, nothing mid-session behind More | pass — 5 tabs, live session has no nav at all |
| G8 | Today + Live Lift render offline | **not demonstrated** — frames are static data, which is not the same thing |
| G9 | All desktop destinations mapped | pass — `PARITY.md`, 21 routes, 5 rendered / 16 named |

**Honest gaps.** G8 needs the real app with a cache layer, not a composable.
The contract also asked for a 12-second recording: a recording of static screens
adds nothing, and a real one needs a navigable app. Both come with the
navigable prototype, not with the design sheet. The sheet is the artifact the
design decision rests on; do not read it as a tested build.

## Open questions

1. **D3 reversal is cheap** — say the word and Log becomes a tab, Body folds in.
2. **Device** — model and Android version, for the final look and metric check.
3. **Fixture** — when to run the headed login and commit the payload. G2 depends
   on it, and so does the first-look claim that this is real data.
4. Inter bundling, widget design, FCM permission moment — production-plan items,
   deliberately not built here.
5. The app is untracked: the parent tree has 86 dirty entries from other
   sessions, so this lab needs its own branch before anything is committed.
