# 3D Ride View Enhancements — Plan & Roadmap

> Status: Phases A–E (synced compare) done (2026-09-10). Source: deep-dive audit of
> `Route3D.tsx`, `Replay3D.tsx`, `lib/route3d.ts`, `lib/replay.ts`,
> `lib/terrain.ts`, `CompareActivitiesModal.tsx`, `CompareRoutesModal.tsx`.
> Parent spec: `plans/future-enhancements.md` §3.16.

## Goals (agreed)

Balanced across **relive experience + analytical tool + route planning**.
Replay terrain is **opt-in** (button, off by default) to keep the activities
page light. Full phase plan (A–E) + vision roadmap below.

## Phase A — Fixes + quick wins ✅ in progress

| # | Item | Files | Notes |
|---|------|-------|-------|
| A1 | Power stream spelling fallback (`watts` Strava vs `power` FIT) | `CompareActivitiesModal.tsx`, `activities/page.tsx` | Backend confirmed both spellings in DB (`strava_client.py:126` writes `watts`, `fit_parser.py:169` writes `power`). Callers try `watts` → `power`. Charts had the reverse bug (`power` only → empty for Strava rides). **Post-release find (2026-09-10): same class of bug for velocity — Strava sync stores `velocity_smooth`, FIT imports store `velocity`; the replay gate demanded exactly `velocity`, so NO Strava ride ever showed 3D. Fixed with the same fallback in both replay callers.** |
| A2 | Diverging grade ramp (descents no longer flat green) | `lib/route3d.ts`, `Route3D.tsx` legend | `pointColor` maps `slopePct` ∈ [−GRADE_SCALE, +GRADE_SCALE] → blue (downhill) → green (flat) → red (climb). Legend low label becomes `−12%`. |
| A3 | Docstring + dead-code cleanup | `Replay3D.tsx` | "camera fly-through" → "ride replay" (camera never moves until Phase B); remove unused `camController` field. |
| A4 | Speed legend + live HUD chip | `Replay3D.tsx` | Gradient legend (slow→fast km/h) + chip showing speed/power/HR at playhead (data already in `ReplayPoint`). |
| — | Investigated, no change | — | Replay stride decimation: distance-uniform resampling would break time-indexed `elapsed`/scrubber mapping — stride kept. `buildTerrainMesh` frame: `lat0/lng0` consistently from `projectPolyline` — no bug. `OrbitControls` legacy import path still shipped by three 0.185 — migrate only with a three bump (Phase E). |

## Phase B — Replay relive (M) ✅ Done (2026-09-10)

- Chase / cockpit camera modes (smoothed `1-exp(-dt*4)` follow, look-ahead heading, `camera.up` flips to +Z in follow modes; orbit retargets to rider on return; rider hidden in cockpit). Mode buttons with `aria-pressed`, 44px targets.
- **Opt-in terrain button** in `Replay3D` header (`off|loading|on|failed`): lazy-imports `@/lib/terrain` + `@/lib/route3d`, `computeGrid(decodePolyline)` → `fetchTerrainResult` → `buildTerrainMesh` aligned via new `ReplayBuildResult` frame fields (`lat0/lng0/altMin/zScale`); swaps `GridHelper` for DEM bed, refetches if the scene rebuilds while on, Copernicus attribution footer. Flat rides (no altitude stream) base the bed on the DEM minimum so the path rests on it. Zero activities-page cost until clicked; reuses SW DEM cache.
- Rider arrow (cone oriented by heading via look-ahead sample) + km-marker dots with canvas-sprite labels (5/10/25 km intervals by ride length, capped ≈20).
- Screenshot button stays P3 (needs `preserveDrawingBuffer` review).

## Phase C — Route planning (M) ✅ Done (2026-09-10)

- Climb/segment callouts from live §3.13 data: orange span overlays + start dots + name labels per segment (`start_dist_m`/`end_dist_m` → `distKm`), summit marker + elevation label, "Frame top climb" button (falls back to "Frame steepest km" via new pure `steepestKm()` when the route has no segments).
- Exaggeration slider (auto or 1–15×, camera pose preserved across rebuilds) with × readout + Auto reset.
- In-scene scale bar (1/2/5 nice length in world units — truthful at any camera distance) + north arrow (+Y in path frame) with labels.
- `Route3D` side-by-side in `CompareRoutesModal` (two lazy instances, stacked on mobile) — closes the deferred §3.16 item.
- Terrain quality: `MAX_GRID_POINTS` 100 → 200 (still 1 request, ~3.7 kB URL), `cellM` floor 120 m → 80 m for short routes.
- 2D/3D hover sync: `ElevationProfile` wires its previously-declared `onHover` (now km-based) + `height` prop; 3D mode shows a compact profile under the canvas and drives a cyan hover marker in `Route3D` (`highlightDistKm`, no scene rebuild).

## Phase D — Telemetry analytical (S–M) ✅ Done (2026-09-10)

- Path colour by metric: `speed | power | HR | grade` segmented control with per-mode legend (intensity blue→red normalized by max; grade uses the diverging ±12 % ramp). Missing samples render as slate gaps, never false zeros; modes without data are disabled with an auto-fallback to speed. Recolour is a buffer update — no scene rebuild.
- `ReplayPoint` carries `cadence` (new `ReplayBuildOptions.cadence`, plumbed from `cadence` streams in both replay callers) and `grade` (stride-averaged altitude ÷ distance, null-safe). Frame fields from Phase B unchanged.
- Full `TelemetryStrip`: HR/power always (when present) + expandable speed/cadence/altitude rows (altitude auto-scaled, true metres via `elevationBase`; rows with no data hidden), live per-row values at the playhead in the footer. HUD chip gains cadence + signed grade.
- Shared playhead: `Replay3D` accepts `onElapsed` (10 fps); the expanded activity view shows a live `3D ▸ m:ss` chip in the stream header (reset per activity).
- Deferred with rationale: power zone bands need cycling-profile FTP in the expanded view (new query — follow-up); full bidirectional 2D-chart linking needs `ReferenceLine` support in the shared `Chart`/`ChartData` plus Phase E's lifted clock — both land naturally with synced-compare work.

## Follow-ups ✅ Done (2026-09-10)

### Incident: "Invariant failed" on ride expand (prod, same day)

The 3D→chart `reference_line` shipped without `yAxisId`, but every YAxis in the shared `Chart` uses explicit ids (`left`/`right`) while Recharts defaults graphical children to id `0` → `Invariant failed: Could not find yAxis by id "0"`. Crashed the expanded activity view for any cycling ride with streams. Fixed with `yAxisId="left"` + a regression test that fails without it (verified by reverting). Lesson: the Chart test suite's documented invariant class applies to every new Recharts graphical child — render it in `Chart.test.tsx` first.

- **Power zone bands**: `TelemetryStrip` shades Coggan zone backgrounds behind the power row when `ftpWatts` is provided (pure `powerZoneBounds()` in `lib/replay.ts`, unit-tested); `Replay3D` passes it through; the expanded activity view reuses the shared `['cycling-profile']` cache (no new endpoint, one query gated to cycling).
- **3D→chart playhead marker**: `ChartData.reference_line` + `ReferenceLine` render in the shared `Chart` (line charts only, additive — no existing chart affected); the expanded view attaches a `3D`-labelled marker at the selected stream's sample index, quantized to 2 fps so the chart doesn't re-render at the 10 fps replay tick (chip stays 10 fps). Reverse direction (chart hover → 3D) deliberately omitted — it would fight the replay clock.
- **OrbitControls** now imports from `three/addons` (same class, supported export path) in both viewers.
- **`Line2` fat lines**: hero paths (replay path + trail, route drape) render at constant pixel width (3px path/drape, 5–6px translucent trail halo) instead of 1px device lines; resolution synced on resize; trail growth via `instanceCount`; recolour via `setColors` with no rebuild. Runtime API pinned by `line2.test.ts` so the next three bump fails loudly instead of blanking canvases. Thin 1px accents (climb overlays, scale bar, grid) unchanged.
- **Replay readability + camera usability (from prod screenshot review)**: ground grid rotated flat into the path frame and scaled to the ride (was a fixed 2-unit helper — invisible); camera far plane scales with ride size (long rides used to clip); default view is aerial 3/4 instead of edge-on; rider cone/dots/labels slimmed down, km labels staggered with units and deduped on out-and-backs; zoom bounded (`size*0.05…6`), slower rotate, zoom-to-cursor, double-click/double-tap to focus the orbit pivot, Reset / Top / Rider view presets; path colour normalises by p95 (`replayMetricScale`, unit-tested) so one GPS spike no longer flattens contrast; rider marker is a slim dart that reads as direction from any angle.
- **Playback perf**: `onElapsed` fires only on half-second-quantum changes (silent when paused, ≤2fps in flight); stream chart element memoized so identical data bails out of Recharts re-renders.
- **Tour speeds**: fixed 1/4/8× replaced by ride-length-aware `TOUR_PRESETS` (whole ride in ~2m / ~1m / ~30s, default 1m, unit-tested `tourRate()`); same presets drive the compare master clock (span-based).

## Phase E — Synced compare (M) ✅ Done, scoped (2026-09-10)

- **Shipped: linked playback.** `Replay3D` accepts an optional `link: ReplayLink | null` (master `t` in absolute seconds + `span`, `onScrub/onToggle/onRate`, `rate/playing`). Linked children render `min(t, ownTotal)` — rides start together in real time, shorter ones freeze at their finish; scrub/play/rate delegate to the parent; per-instance transport collapses to a "Linked" badge. `CompareActivitiesModal` owns the master clock (rAF, auto-pause at span end, restart-from-0 on replay) with a Linked/Independent toggle (default linked), master transport + span scrubber. Prop-only design — no refs, safe through `next/dynamic`. Deliberately %-free: absolute seconds keep both rides truthful.
- **Deferred with rationale:**
  - `useThreeScene` extraction — the two scaffolds differ enough (lights, markers, loop bodies) that a shared hook risks over-abstraction; revisit if a third viewer appears.
  - `Line2` wide lines — needs resolution handling + dynamic-colour port with no headless way to verify rendering; do with a manual visual check.
  - `OrbitControls` `three/addons` import — trivial, bundle with the next three bump.
  - Backend per-point surface/quality arrays — needs migration + backfill; tracked as future work.

## Vision (beyond A–E)

Ghost racing (dual-path single scene + delta readout) → effort-aware terrain
(`Activity.context` §1.3 as 3D paint) → route scouting (hillshade texture,
wind arrows, surface paint) → share (clip export, poster thumbnails).

## Verification per phase

`npx vitest run src/__tests__/replay.test.ts src/__tests__/route3d.test.ts`
+ `tsc --noEmit` + manual check (one cycling activity, one route, compare
modal both ways). Update this file + `frontend/src/CODEMAP.md` §3.16 notes.
