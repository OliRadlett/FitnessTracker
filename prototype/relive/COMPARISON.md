# Old Replay3D vs New Google 3D — Lake Geneva

## Method

- **Same ride:** Strava `afcfb024…`, Lake Geneva loop, 174.8 km, 10k samples
  with `latlng`.
- **Old:** the real `Replay3D` dev harness with the real fixture, normalized to
  noon/clear (the ride started in fog at 09:33 local; the old low sun is very
  dark), full-quality harness (hardware renderer string + steady 60 fps clock so
  the headless perf budget does not drop it to the reduced profile). Cameras:
  orbit, chase, drone.
- **New:** Google 3D Maps JS API, same ride. Cameras: overview, Lausanne, climb.
- **Caveat:** the old viewer's terrain/imagery did not fully load in the headless
  real-fixture run — the orbit shot is a floating slab. Its synthetic visual
  baseline (`frontend/e2e/replay-visual.spec.ts-snapshots/replay-hilly-full-chromium-win32.png`)
  shows the intended look: a green heightfield and a road ribbon, with no
  buildings, trees, or place. The old route uses the summary polyline; the new
  route uses `latlng`. This is a qualitative comparison, not a pixel match.

Old vs new (image not committed)

## Scorecard

| Dimension | Old Replay3D | New Google 3D | Edge |
|---|---|---|---|
| **World / place** | Procedural DEM + road ribbon; no buildings/trees; real-fixture headless shot is a floating slab; synthetic baseline is a green hill + ribbon | Photoreal buildings, trees, terrain, lake, mountains; Lausanne, Montreux, and the climb are recognizable | **New** |
| **Rider** | Real 3D bike model (small; no rider animation), visible in chase | 2D marker; no 3D bike | **Old** |
| **Route** | Floating pink line/ribbon; coarse summary polyline | Gold line follows the road; `latlng` | **New** |
| **Camera** | 7 modes + auto + cinematic director | 6 presets + tween + follow | Old on breadth; new on framing |
| **Data / story** | Telemetry strip, course profile, highlights, ghost, tour, weather, poster/clip export | Telemetry, timeline, weather, course profile, highlights, ghost picker (production route-history snapshot); tour open | **Old** (tour/export) |
| **UX** | 7-camera cockpit, HUD, many toggles | Minimal presets/timeline/follow | **New** |
| **Performance** | Heavy; headless perf mode; 3D world | Google renderer; demo key; 60 fps target | **New** |

## What the old did better

- **A real 3D bike.** The new rider is a marker. This is the old viewer's one
  clear visual win, and the reason the rider is still the open gap.
- **The data/story layer.** Telemetry, course profile, highlight detection,
  ghost racing, the tour/director, weather, and export are genuinely good. They
  are the roadmap, not the thing to throw away.
- **Camera breadth.** Seven modes and an auto-director; the new world has six
  presets, a tween, and follow.

## What the new does better

- **The world.** Photoreal buildings, trees, terrain, lake, and mountains; the
  place is recognizable. The old world is a heightfield with a ribbon.
- **The route.** It follows the road instead of floating over a slab.
- **The UX.** One artifact, six presets, follow, a timeline; not a cockpit.
- **The process.** Real fixture, contact-sheet gate, decision log, source
  bake-off. The old viewer was built blind and declared complete without a
  visual pass.

## Verdict

**Replace the world layer; keep the data/story layer; solve the rider
separately.**

The new world is the foundation. The old viewer's feature depth is the roadmap.
The mistake would be to throw away the old data/story work because the old world
was weak — or to keep the old world because the features were rich.

## What to carry forward

1. Telemetry strip (HR/power/speed/cadence) on the new world. **Ported**
   (HR/speed/grade; the ride has no power/cadence stream).
2. Course profile scrubber. **Ported** (full sync; `?sync=0` fallback).
3. Highlight detection (climbs, descents, sprints, fastest km). **Ported**
   (chapters from the fixture highlights).
4. Tour/director (the v1 chase/film).
5. Ghost racing. **Ported** (production route-history snapshot picker: 2
   same-lap Arthur's Seat ghosts, PB marked; live API open).
6. Data-driven route colour (speed/power/HR/grade).
7. Poster/clip export.

The story layer is ported and verified after the demo key's daily quota reset
(2026-11-02). Timeline and chapter seeks move the map by default; `?sync=0` is
the data-only fallback.

## What to leave

- The procedural DEM/ribbon world.
- The 7-camera cockpit as the default surface.
- The 3,500-line monolith.

## Next

The story layer is ported. The remaining old features are the tour/director,
data-driven route colour, and poster/clip export. Ghost racing is ported with a
production route-history snapshot picker (2 same-lap Arthur's Seat ghosts, PB
marked); the live picker is still open. The tour is the v1 film.
