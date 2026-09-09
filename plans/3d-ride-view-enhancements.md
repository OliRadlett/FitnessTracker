# 3D Ride View Enhancements — Plan & Roadmap

> Status: Phases A–C done (2026-09-10). Source: deep-dive audit of
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
| A1 | Power stream spelling fallback (`watts` Strava vs `power` FIT) | `CompareActivitiesModal.tsx`, `activities/page.tsx` | Backend confirmed both spellings in DB (`strava_client.py:126` writes `watts`, `fit_parser.py:169` writes `power`). Callers try `watts` → `power`. Charts had the reverse bug (`power` only → empty for Strava rides). |
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

## Phase D — Telemetry analytical (S–M)

- Path colour by metric: `speed (today) | power | HR | gradient` + legend (mirrors `pointColor` pattern).
- Full `TelemetryStrip`: cadence + altitude + speed rows (collapsible), power zone-band background (needs FTP), current-value readout. Requires adding `cadence` to `ReplayBuildOptions` + callers (spec promised, implementation dropped).
- Playhead-linked 2D stream charts (shared `elapsed` state in `ActivityExpanded`).

## Phase E — Synced compare + tech debt (M)

- Controlled playback API on `Replay3D` (`forwardRef`/`useImperativeHandle` or lifted `onTick`): master play/pause + rate, linked scrubber (0–100% normalised, durations differ), keep "independent" toggle.
- Extract shared `useThreeScene` hook (renderer/controls/resize/dispose duplicated ~80 lines in both viewers).
- Evaluate `Line2` for >1px hero paths; migrate `OrbitControls` → `three/addons` with three bump.
- Backend (if pursued): per-point surface/quality arrays → new `Route3D` colour modes; ghost-racing single-scene overlay.

## Vision (beyond A–E)

Ghost racing (dual-path single scene + delta readout) → effort-aware terrain
(`Activity.context` §1.3 as 3D paint) → route scouting (hillshade texture,
wind arrows, surface paint) → share (clip export, poster thumbnails).

## Verification per phase

`npx vitest run src/__tests__/replay.test.ts src/__tests__/route3d.test.ts`
+ `tsc --noEmit` + manual check (one cycling activity, one route, compare
modal both ways). Update this file + `frontend/src/CODEMAP.md` §3.16 notes.
