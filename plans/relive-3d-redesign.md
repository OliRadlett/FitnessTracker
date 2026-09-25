# Relive — 3D Ride Viewer Redesign

> **Status**: In progress — Phase 0 done, Phase 1 underway (2026-09-24).
> **Supersedes**: `plans/archive/3d-ride-view-enhancements.md` (Phases A–E shipped the
> technical scaffold; this plan replaces the *experience*).
> **Parent spec**: `plans/future-enhancements.md` §3.16.
> **Files**: `frontend/src/components/activities/Replay3D.tsx`,
> `frontend/src/lib/replay.ts`, `frontend/src/lib/route3d.ts`,
> `frontend/src/lib/terrain.ts`, `frontend/src/app/(app)/activities/page.tsx`,
> `frontend/src/components/activities/CompareActivitiesModal.tsx`,
> `frontend/public/models/cube-agree-c62-2026.glb`.

## Why (diagnosis of the current viewer)

The Phase A–E work produced a *technically correct* viewer that reads as a CAD
tool, not a ride:

1. The "rider" is a white cone — the bike GLB is unused.
2. The world is a grey `GridHelper`; terrain is opt-in and built from a ≤200-point
   Open-Meteo DEM (~1 km cells over a typical ride), so peaks smear and the path
   floats.
3. No sky/sun/shadows/atmosphere/tone-mapping — flat `MeshBasic/Lambert`.
4. The path is a floating coloured line; there is no road for the bike to be on.
5. 300 px canvas, aerial default framing, no sense of speed.
6. No story — no highlights, cueing, or "wow" moments.

The shipped asset is also far heavier than documented: **41.7 MB, 748,665 tris,
17.5 MB PNG textures, no compression** (CODEMAP's "74K faces / 10.4 MB" is stale).

## North star

**"Relive" — your actual bike, riding your actual route, through a believable
world, directed like a highlight film, with a coach's telemetry overlay.**

## Decisions (locked 2026-09-24)

| Decision | Choice |
|---|---|
| Scope | Full vision, phased |
| World style | Styled dark procedural by default + optional imagery drape |
| Asset pipeline | `gltf-transform` in-repo (no Blender dependency) |
| Wheels | Procedural motion-blur (no model re-split) |
| Surface | Full-screen Theater overlay, `?replay=<id>` deep link |
| Activities page | Launcher only — no inline canvas |
| Advanced | Ghost racing **and** auto-highlight tour both in scope |

## The Theater (new UX surface)

The inline `Replay3D` in the activities expanded detail is removed. Cycling
activities get a **3D launcher** (card affordance + a button in the detail) that
opens a **full-screen Theater overlay** (portaled edge-to-edge, no app chrome),
addressed by `?replay=<id>` so refresh/deep-link works.

- Canvas fills the screen; a **director bar** (camera modes, tour, ghost, colour
  metric), a **scrubber/transport**, and a collapsible **telemetry rail**
  (reuses `TelemetryStrip`) that overlays rather than pushes layout.
- Mobile: same overlay, auto **Lite mode** (no shadows/bloom/imagery, lower DEM),
  44 px controls.
- The compare modal's "3D side-by-side" becomes **one scene with two bikes
  (ghost race)**.

## Architecture

| Area | Change |
|---|---|
| Asset | `frontend/scripts/optimize-bike.mjs` + `bike:optimize` npm script (`@gltf-transform/cli`): `simplify` ~748K→~150K tris, textures→2048 WebP, `quantize`+`meshopt`. Target ≤5 MB, committed to `frontend/public/models/`. |
| `lib/replay.ts` | Extend `buildReplay`: dense render samples + time index; per-point `lat/lng`, `heading`, `yawRate`, `curvature`. Pure + unit-tested. |
| `lib/terrainTiles.ts` (new) | Keyless **terrarium** DEM tiles (AWS Open Data, ~30 m) → multi-tile heightmap mesh in the existing path frame; in-memory + SW cache. |
| `lib/road.ts` (new) | GPU ribbon mesh along the path (asphalt + dashes), vertex-colour by metric for the "effort road". |
| `lib/bike.ts` (new) | GLTF load (decode once, `MeshoptDecoder`), orientation/scale normalisation, lean/pitch rig, procedural wheel blur, ghost material variant. |
| `lib/sun.ts` (new) | Solar position from `start_date` (UTC→local tz) + lat/lng; drives sun, shadows, sky, golden hour. |
| `lib/replayDirector.ts` (new) | Camera director (chase/cockpit/drone/flyby) + highlight-tour keyframes. |
| `lib/three/useThreeScene.ts` (new) | Extracted scene scaffold (deferred in Phase E; now justified by 3 renderers). |
| `components/activities/ReplayTheater.tsx` (new) | Full-screen overlay orchestrator (lazy `ssr:false`). |
| `components/activities/Replay3D.tsx` | Reduced to a thin scene; all inline usage removed. |
| `components/routes/Route3D.tsx` | Phase 5: new terrain, sun/lighting, optionally the bike. |
| `public/sw.js` | Add terrarium/imagery hosts to the tile rule; bump `CACHE_NAME`. |

**Backend**: none required. Ghost reuses `GET /api/v1/routes/{id}/history`
(`RouteHistorySection.tsx:15`) + existing stream/polyline endpoints. A slim
`GET /activities/{id}/similar` is a fallback only if route history proves
insufficient.

## Phases

Each phase ends green: `vitest` + `tsc --noEmit` + a manual check.

### Phase 0 — Asset + rig (S)
- Optimize the GLB with `gltf-transform`; commit the ≤5 MB model.
- `lib/bike.ts`: load/decode once, normalise orientation (model nose `+Z`, up
  `+Y` → replay frame ground `XY`, alt `Z`), scale to metres.
- Place the bike on the path with heading, lean-into-corners (clamped from yaw
  rate), pitch to grade, procedural wheel blur that fades in with speed.
- Integrate into `Replay3D`, replacing the cone. Visible win.

### Phase 1 — Core scene (L)
- Theater surface: launcher, overlay, `?replay=<id>` deep link; remove inline 3D.
- Sky/sun/fog/shadows/ACES tone-mapping; sun from ride time+location.
- Terrarium terrain; `lib/road.ts` asphalt ribbon.
- Camera director + speed feel (FOV, shake); Lite mode; WebGL fallback.

### Phase 2 — Effort + HUD (M)
- Effort-road colouring; on-road markers (km, climbs, segments, PRs).
- HUD/telemetry rail; retain 2D↔3D playhead sync.

### Phase 3 — Realism (M)
- Optional imagery drape (satellite/OSM) on terrain; weather-driven sky/wind from
  `Activity` weather fields; SW caching + attribution.

### Phase 4 — Story (M)
- **Auto-highlight tour**: climb/sprint/fastest-km detection → cinematic shot
  sequence with labels.
- High-res poster + clip export (`MediaRecorder`).

### Phase 5 — Ghost + 3D compare (M)
- Ghost bike from a chosen ride (align by elapsed or same-route distance) with
  live delta.
- Compare modal opens the Theater in ghost mode.
- Bring the new engine to `Route3D`.

## Progress log

### Phase 0 — done (2026-09-24)
- **Asset**: `scripts/optimize-bike.mjs` + `npm run bike:optimize` (gltf-transform
  devDep). Full-res source → shipped GLB: **41.75 MB / 748,665 tris → 2.27 MB /
  149,724 tris** (WebP textures ≤2048, quantization, EXT_meshopt_compression).
  Source kept locally at `bike_model/*.glb` (gitignored); visually verified in
  Blender (paint/logos/spokes/drivetrain intact).
- **Rig**: `lib/bike.ts` — cached load (MeshoptDecoder), orientation basis
  (model nose +Z/up +Y → rig forward +X/up +Z), `bikePoseQuaternion` (heading +
  lean, handedness verified), `leanFromCurvature` (v·ω/g, clamped ±24°),
  procedural wheel motion-blur. 8 unit tests.
- **Integration**: `Replay3D` renders the bike (replacing the cone), interpolated
  between samples, leaning into corners, wheels blurring with speed. Chase/cockpit
  cameras moved to real-scale distances; orbit minDistance lowered so you can zoom
  to the bike. Callers raise `maxSamples` 800 → 4000 for smooth motion.

### Phase 1 — in progress (2026-09-24)
- **Theater**: `components/activities/ReplayTheater.tsx` — full-screen portal
  (edge-to-edge, `Escape` to close, locks + `inert`s the app shell). The activities
  page now shows a **launcher** instead of an inline canvas; `?replay=<id>`
  deep-links straight into the Theater.
- **Scene**: gradient sky dome (follows the camera), distance fog, ACES tone
  mapping, hemisphere + warm key light, **road ribbon** (`lib/road.ts`, asphalt +
  dashed centre line under the bike), default camera is now **chase**.
- **Cameras**: chase / drone (elevated) / cockpit / orbit.
- **Lite mode**: auto-on for small screens (no MSAA, pixel ratio 1).
- Remaining: terrarium DEM terrain.

### Phase 2 — started (2026-09-24)
- **Effort road**: the ribbon is now vertex-coloured by the selected metric
  (speed/power/HR/grade), recoloured live when the metric changes (no rebuild).
  `buildRoadRibbon` gained a flat per-point `colors` input (6 tests).

### Phase 3 — lighting started (2026-09-24)
- **Sun / time-of-day**: `lib/sun.ts` (solar position + daylight phase, pure,
  6 tests). The scene is lit for the ride's actual start time — golden hour gets
  a warm horizon + key light, night goes dark/cool. `startDate` plumbed from the
  activity into `Replay3D` (Theater + compare).
- **Shared sky**: `lib/sky.ts` (gradient dome + palette) now used by both the
  replay and `Route3D`, which also gained ACES tone-mapping + fog.
- Remaining: optional imagery drape, SW tile caching, weather-driven fog/wind.

### Phase 4 — done (2026-09-24)
- **Highlights**: `lib/highlights.ts` detects climbs, descents, best sustained
  power and fastest km from the path (grade×distance gains, hysteresis runs;
  8 tests).
- **Auto-tour**: a Tour toggle seeks to the first highlight and drives the camera
  per highlight kind (climb → drone, else chase) with a caption overlay; a
  chapter bar lists highlights for one-tap jumps.
- **Export**: PNG poster + 6-second webm clip (`MediaRecorder`).

### Phase 5 — done (2026-09-24)
- **Ghost picker**: the Theater lists other rides on the same route
  (`GET /routes/{id}/history`) and fetches the chosen ride's detail (polyline +
  streams) to build a second replay.
- **Ghost bike**: a translucent blue-tinted rig, time-aligned with the rider
  (both start together; shorter rides freeze), with a live **delta** readout in
  the HUD (+m ahead / −m behind). `replayDistanceAt` added to `lib/replay.ts`
  (+2 tests).
- **Compare = ghost race**: the compare modal's 3D tab is now one scene with B
  as the ghost (was two side-by-side canvases).
- **Route3D**: shared sky + ACES + fog for visual consistency.

### Phase 1 — terrain done (2026-09-24)
- **High-res DEM**: `lib/terrainTiles.ts` fetches keyless **terrarium** tiles
  (AWS Open Data; SRTM + UK LiDAR, ~30 m) and samples them into a dense
  (≤256×256) grid — the terrain now reads as real relief instead of the ~1 km
  Open-Meteo grid. Falls back to Open-Meteo on failure. Pure tile/decode math
  unit-tested (7 tests).

### Phase 3 — imagery done (2026-09-24)
- **Satellite drape**: `lib/imageryTiles.ts` stitches keyless **Esri World
  Imagery** tiles into one canvas, UV-mapped onto the DEM mesh (toggle shown
  when terrain is on). Attribution shown in the footer.
- **SW caching**: `public/sw.js` caches terrarium + Esri tiles (stale-while-
  revalidate, `CACHE_NAME` bumped to v6).
- Sun/time-of-day lighting + shared sky (`lib/sun.ts`, `lib/sky.ts`) as above.

### Debug & polish pass (2026-09-24, local iteration)
Driven by a local harness (`/fittrack/dev/replay`, real prod fixtures) + headless
Playwright screenshots. Fixed:
- **Bike never loaded** — `BIKE_MODEL_URL` was missing the `/fittrack` basePath
  (404). Every other public asset already used `/fittrack/…`.
- **Wrong bike paint** — the shipped GLB was the old yellow spec; rebuilt it with
  the pipeline's 2026 white/black texture (`BaseColor_flipped_2026.png`, has the
  mirrored CUBE region the UVs expect) by swapping the base-colour image in the
  GLB (Blender) → re-optimized (2.45 MB).
- **Giant "road wedge"** — the ribbon was drawn for the whole 20-50 km route, so
  the distant/return leg (out-and-back) projected into a screen-filling band.
  Fix: draw only a ±120-segment window of road around the rider (`setDrawRange`).
  (Ribbon geometry was verified correct: 5 m wide, max tri edge 27.5 m.)
- **Altitude exaggeration** — `zScale` capped 10 → 3 and the profile smoothed
  (grade kept raw), so the road no longer climbs off-screen.
- **Noise in follow cams** — hide the full-route line (doubles back visually) and
  fade the road with tight mode-dependent fog (near 60 / far 1400) instead of a
  hard cut.
- **Chase → Orbit** — revolve around the rider instead of a stale scene-centre
  `controls.target`.
- **Terrain/satellite** — imagery now unlit (`MeshBasicMaterial`) so it isn't
  muddy; terrain baseline anchored to the path start (+1.2 m clearance) so the
  road sits on the bed; per-tile 8 s timeout so a slow PNG falls back instead of
  hanging.
- Km-marker dots/labels shrunk for the close camera; chase tightened to 7 m/2.6 m.

Tooling added: `scripts/optimize-bike.mjs` (already), `frontend/public/dev-fixtures/`
(gitignored), `frontend/scripts/_*.mjs` Playwright helpers (gitignored), and the
local `dev.oliradlett.co.uk` Caddy TLS + hosts setup.

### Terrain default + enhancement (2026-09-25)
- **On by default** in the Theater (`terrainDefault`, compare modal opts out) and
  the terrain/imagery toggles are remembered in `localStorage`
  (`relive:terrain`, `relive:imagery`).
- **Resolution**: DEM tiles 25 → 36, grid 65K → 110K points for sharper relief.
- **Shading** (`buildTerrainMesh`): per-vertex slope darkening (steep faces
  darken so relief reads in flat light) + an outer-border fade so the slab edge
  dissolves into the horizon instead of ending abruptly. Benefits `Route3D` too.

### Roadmap completion pass (2026-09-25)
- **Course profile scrubber** — an elevation area chart above the transport with a
  playhead; click/drag anywhere to seek (distance-mapped). `CourseProfile` in
  `Replay3D`, uses `replayDistanceAt`.
- **On-road markers** — climbs/descents/sprint/fastest drawn on the road (coloured
  dots + screen-constant labels via `sizeAttenuation:false`, faded by distance).
  Km labels made screen-constant too.
- **Real shadows + bloom** — `renderer.shadowMap` (PCFSoft) with a small
  directional shadow frustum that follows the bike; bike `castShadow`, road +
  terrain `receiveShadow`; road switched to `MeshLambertMaterial` so shadows land
  on it. `EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass`
  (skipped in Lite mode).
- **Weather-driven world** — `weather` prop tints the sky/fog/lighting for
  overcast/rain/snow/fog (from `Activity.weather_*`; Theater + compare).
- **Route3D parity** — the routes-page 3D now uses the same high-res terrarium DEM
  (with Open-Meteo fallback), inheriting the slope shading + edge fade.

### Remaining
- Optional: weather **effects** (rain streaks/wet road/wind sock), not just sky.
- Terrain vertical alignment is approximate (road held above the bed rather than
  draped onto it).

## Risks / guardrails

- **Decimation quality** — verify visually; keep fork/logos crisp (Blender
  pipeline as fallback).
- **Imagery ToS** — keep dark procedural the default; imagery opt-in with
  attribution.
- **Mobile perf** — Lite mode + pixel-ratio cap + progressive terrain; always
  keep the 2D map fallback.
- **Ghost alignment semantics** (time vs distance) — make it explicit in the UI.

## Verification per phase

`npx vitest run src/__tests__/replay.test.ts src/__tests__/route3d.test.ts` +
`npm run typecheck` + manual check (one cycling activity, one route, compare).
Update this file + `frontend/src/CODEMAP.md` §3.16 + `AGENTS.md` Planned/Incomplete
+ `lib/changelog.ts` as phases land.
