# Reference — what "good" means for the FitTrack Android app

> Status: Phase 1. Frames for each reference get captured in the lab before the
> first look; until then these are links plus what we intend to steal.

## References

### 1. Hevy — <https://www.hevyapp.com/>

The best lifting logger on Android. Its set row is the whole product: weight and
reps are already filled from the last set, the steppers are thumb-sized, the
keyboard only appears if you tap the number, and the rest timer sits over the
list without hiding it.

**Steal:** prefill as the default state, the set row as the primary object, a
rest timer that never takes the set list away, and a session summary you'd
actually screenshot.

**Do not steal:** the social feed, the template gallery, or the exercise
browsing depth. FitTrack is one athlete's data, not a marketplace.

### 2. Strava — <https://www.strava.com/mobile>

One screen, one action. Its Android back behaviour is predictable, the map hero
never traps the scroll, and segment/PR results are presented as a single
comparison rather than a table.

**Steal:** one dominant action per screen, a hero that does not steal the
gesture, and "you vs you" framing for efforts.

**Do not steal:** the social layer, kudos, or the feed. There is no audience.

### 3. Whoop — <https://www.whoop.com/>

One number, one verdict, one recommendation, on black, with two colours. It is
the closest existing product to FitTrack's "what should I do today" job.

**Steal:** the single-glance verdict, the discipline of one accent colour, and
the refusal to show six metrics when one will do.

**Do not steal:** the subscription funnel, or the recovery score as the only
language for training readiness — FitTrack's verdict is composed from TSB,
sleep, and plan conformity.

### 4. Material 3 — <https://m3.material.io/>

Not a skin. The platform contract: edge-to-edge with insets, 48dp minimum
targets, predictive back, 200ms motion, and typography that scales with the
system font size.

**Steal:** behaviour — insets, targets, back, motion, dynamic type, and
`WindowSizeClass` rather than "responsive CSS".

**Do not steal:** dynamic colour from the wallpaper, expressive type by default,
or Material's default component shapes. The brand is the near-black canvas and
the emerald accent.

### 5. Linear — <https://linear.app/>

The craft benchmark for perceived speed on Android: no spinner where a skeleton
will do, content-first transitions, and consistent motion across a large app.

**Steal:** the "it opened before I lifted my thumb" feel, and restraint in
animation — one duration, one easing, everywhere.

**Do not steal:** its desktop-density layouts.

## Anti-references

### A. Garmin Connect

The failure mode in product form: every metric on one screen, stacked cards,
nested modals, and a settings tree that mirrors the database. It answers "what
data do we have" instead of "what should I do".

**Symptom to watch for in our own frames:** if a frame needs a scroll to reach
its primary action, we have built Garmin.

### B. Our own 390dp lift detail

`prototype/activity/qa/out/detail-lift-mobile.png` — 2,920 px, 3.7 viewports, of
a session already finished. Read-only, dense, and beautiful at desk distance.
It is the exact thing a phone app must not become.

**Measured symptom:** the stat labels render at 2.68:1.

## Gate (from the quality contract)

| | Criterion |
|---|---|
| G1 | Repeat set logged in ≤2 taps from app open, no keyboard |
| G2 | Prefill matches the fixture's last set exactly (90 kg × 4 @7) |
| G3 | Rest timer visible without leaving the set screen |
| G4 | Every text run ≥4.5:1, measured by script on the render |
| G5 | Every target ≥48dp; primary action in the bottom 35% |
| G6 | Today ≤1.3 viewports; Live Lift needs no scroll |
| G7 | ≤5 nav destinations; nothing mid-session behind More |
| G8 | Today + Live Lift render with the network off |
| G9 | All 20 desktop destinations have a named phone destination |
