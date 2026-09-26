# Relive 3D — Future Work Roadmap

> Status: Phases 0–5 shipped (#84–#98); wet-road / wind / sea shading built locally.
> The viewer works and is live. This plan is the *next* horizon — ambitious, creative, and grounded in data that already exists.

## Where we are (the foundation)

**Live in prod**
- Theater overlay (launcher on the activities page, `?replay=<id>` deep link, Escape to close).
- Bike rig: real 2026 Cube Agree model (150K tris, meshopt + WebP), lean-into-corners, pitch to grade, procedural wheel blur.
- World: sky dome + fog + ACES tone-mapping, time-of-day lighting from the ride's real start time + location (`lib/sun`), terrarium DEM terrain on by default (`lib/terrainTiles`), satellite imagery opt-in (`lib/imageryTiles`).
- Road ribbon with effort colouring (speed/power/HR/grade), km + highlight markers.
- Cameras: orbit / chase / drone / cockpit; highlight auto-tour with chapter bar.
- Shadows + bloom (`EffectComposer`); ghost racing + compare-as-ghost; poster / clip export; keyboard shortcuts; Lite mode.

**Local, uncommitted (this session)**
- Wet-road sheen (asphalt darkens + blue tint with `wetness`).
- Wind HUD (compass arrow + speed, from `weather_*`).
- Sea shading (≤0 m DEM → depth-ramped blue, coastline fade) in `lib/route3d`, threaded to `Route3D` too.
- Robust terrain re-attach (epoch bump so a scene rebuild doesn't orphan the bed).

**Code health note**
- `Replay3D.tsx` is now ~2 060 lines. The deferred `lib/three/useThreeScene.ts` extraction (old Phase E) is now overdue — future work should pull the scene scaffold, terrain, and camera director out of the component before it grows further.

**Data already available (no new endpoints needed unless noted)**
- Streams: `velocity`/`velocity_smoothed`/`enhanced_speed`, `watts`/`power`, `heartrate`/`hr`/`heart_rate`, `altitude`, `cadence`, `time` — each as `{ data: number[], resolution }`.
- `ActivityDetailRead`: `streams`, `encoded_polyline`, `start_date`, `weather_conditions / temperature / wind_speed_kmh / wind_direction / precipitation_mm`, `pacing_analysis` (`{ segments, power_variability }`).
- `RouteHistoryResponse.rides` (other rides on the same route → ghost candidates).
- `Activity.start_date` + `encoded_polyline` lat/lng → solar position (`lib/sun`).
- `pacing_analysis` exposes per-10-percent power segments + variability index.

---

## Tier 1 — Self-contained viewer magic (no backend)

These live entirely in `Replay3D` / libs; the data is already on the client.

### 1. Power & heart-rate "vitals" gauge
Render a compact 3D or HUD gauge that rides with the playhead: current power vs. Coggan zone bands, HR vs. zone, and a live **TSS / intensity** readout. Reuses `powerZoneBounds` + `ftpWatt`s that are already props. A subtle emissive ring around the bike that colour-shifts through zones is the "wow" version.

### 2. Zone-reactive bike / kit
Tint the rider (or a kit decal) by the current Coggan zone in real time — the bike glows blue→green→yellow→red with effort. Cheap (vertex-colour or emissive uniform), high payoff, reads instantly in the chase cam.

### 3. Cinematic camera director
Replace the four static modes with a small **director** state machine: keyframe a dolly path along the route (Catmull-Rom spline through the polyline), add eased transitions, speed-coupled FOV, and gentle roll. An "auto" mode plays the whole ride cinematically without user input. This is the single biggest "this looks like a real video" lever.

### 4. Segment racing (your PR over a climb)
`pacing_analysis.segments` already carves the ride into effort blocks; pair with `ActivitySegmentEffort` (the §3.13 leaderboard, available via `GET /segments/{id}` and route ride history) to fetch a real PR. Align the ghost by *distance along the segment*, show a live delta bar ("−3.2 s", "+28 m"), and flash the PR segment on the road. Data exists; it's a UI + alignment problem.

### 5. Gradient / speed heatmap on the terrain
Right now only the road is coloured. Drape a second colour pass over the DEM bed itself by grade or by the ride's speed at each sample — the hills literally glow with effort. Reuses `terrainTiles` heights + the replay path.

### 6. Audio
Procedural Web Audio (no assets): wind noise scaled by speed + a soft tyre hum, plus a heartbeat layer that strengthens in high-HR zones. Muted by default, toggled in the toolbar. Makes the silent replay feel physical.

### 7. Pedaling animation
Drive a crank/leg oscillation from cadence (already streamed). The current GLB is a single merged mesh, so either (a) rig a simple procedural leg in three.js parented to the bike, or (b) split the model's cranks in the Blender pipeline (`generate.py`). (a) is faster and avoids re-export.

### 8. Day / night time scrubber
The lighting already follows `start_date`. Add a scrubber (separate from playback) that lets the user drag time-of-day and watch golden hour / blue hour / night sweep across the same ride. Cheap given `solarPosition` already exists.

### 9. Weather depth
Rain (done) → snow (white streaks, slower fall, accumulates as a faint ground-cover tint), fog (density tied to `weather_conditions`, shrinks the far plane), and a wind sock / leaf particles that lean with `weather_wind_direction`. All fields already on `ActivityDetail`.

---

## Tier 2 — Data storytelling (small backend additions)

### 10. Power-curve flyout in the Theater
Show the rider's 1 s / 5 s / 1 min / 5 min / 20 min best powers for *this ride* against their all-time curve (the Modal power model already fits CP/W'/Pmax). Clicking a point seeks the replay to that effort. Needs a small `GET /activities/{id}/power-curve` endpoint (pure aggregation of the stored `watts` stream).

### 11. Climb callouts
Use `pacing_analysis.segments` + `ActivitySegmentEffort` to label the road with timed climb badges ("+12% for 400 m, 1:23 at 280 W") that pop as the bike crests them. Combines the highlight tour with richer annotations.

### 12. Decoupling / efficiency readout
`pacing_analysis` already computes decoupling (power-HR drift) and efficiency factor. Surface them as a post-ride card or a live trace: "you held HR steady while power climbed — good aerobic efficiency." Turns the replay into a coaching tool.

---

## Tier 3 — Sharing & social (needs product decisions)

### 13. Branded, shareable poster
Extend `takePoster` to composite a printable frame: route name, date, key stats (distance / elevation / TSS / time), a mini elevation profile, and a QR code linking to the live Theater. Needs a tiny QR lib; the frame is pure canvas/CSS.

### 14. Public share link
A read-only Theater URL anyone can open. Requires a backend endpoint that mints a signed / slugged token for an activity and a minimal auth-free `ReplayTheater` variant. Product decision: public-by-default vs. opt-in.

### 15. Multi-ghost grid
Race 3–5 rides simultaneously, each its own coloured bike, with a live standings strip. Backend: bulk `GET /routes/{id}/history` already returns candidate rides; the rest is front-end alignment + rendering.

### 16. Record & share a "highlight reel"
Auto-stitch the ride's highlights (climbs, sprints, PRs) into a single cinematic clip using `MediaRecorder` + the camera director, export as a shareable `.webm`. A "Generate highlight reel" button.

---

## Tier 4 — The ambitious / stretch ideas

### 17. Live workout / training mode
Pair the 3D route with a `TrainingPlanDay` (structured workout). The bike paces to the planned power for each interval; a target-power ghost shows where you *should* be; post-interval, the actual vs. planned trace overlays the road. Reuses the existing Wahoo-planned-workout push (`plans/wahoo-planned-workout-push.md`) as the data source.

### 18. Weather playback over time
If a ride has a long duration and historical weather at intervals, animate clouds / rain / lighting *during* the replay to match conditions at each moment, not just the start. Needs weather-at-time lookup.

### 19. VR / fullscreen immersive
Export the Theater to WebXR. The three.js scene already renders; it's a camera + input swap. Huge "wow", moderate engineering.

### 20. Personalised "year in review" ride
Concatenate a rider's highlight moments across a year into one cinematic flyover, scored with procedural audio. Needs orchestration backend; the 3D engine is already there.

---

## Recommended order

0. ~~Extract `useThreeScene`~~ → deferred; `Replay3D` is large but stable.
1. ~~Vitals gauge + zone-reactive bike~~ → deferred.
2. **"Race Yourself" multi-ride overview** ✅ (2026-09-26):
   - Phase 1: stacked coloured traces (`lib/raceRides.ts`, `buildRaceRides`) with legend.
   - Phase 2: animated distance-aligned markers + live leaderboard with deltas.
   - Phase 3: speed-coloured traces (vertex colours, `speedColor` ramp).
   - "Race Yourself" toggle in the Theater; traces + markers + standings visible in orbit.
3. Cinematic director (Tier 1.3) — turns everything above into video.
4. Audio + weather depth (Tier 1.6/9) — sensory immersion.
5. Share poster + link (Tier 13/14) — distribution, only once the experience is worth sharing.
6. Training mode / multi-ghost / stretch goals.

Each tier 1 item is shippable independently.
