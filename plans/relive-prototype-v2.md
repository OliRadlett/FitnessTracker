# Relive 3D — Prototype v2: Explore First

> **Status**: v0 explore + story + ghost built and verified (2026-11-02) —
> Google 3D world, six poses, explore loop, telemetry/profile/chapters,
> full-sync seeking, production route-history ghost picker (2 same-lap ghosts)
> + synthetic Lake fallback. 3D rider overlay is parked (opt-in `?rider=3d`);
> the bike GLB/rig works, the CUBE decal is correct on the drive side and
> mirrored on the non-drive (old GLB UVs). The final map check is blocked by
> the demo key daily quota (2026-11-03). Next: the P0 production gate
> (standard key/budget/terms) — see
> [`plans/relive-3d-production.md`](relive-3d-production.md).
> **Hero ride**: most recent activity around Lake Geneva. May need a production
> Strava sync first (operational only — no code changes on prod).
> **Time**: unlimited; milestone-gated. First evaluable artifact targeted at
> ~2 weeks, then iterate until the gates pass.
> **Supersedes (for this work)**: the renderer/world assumptions in
> [`relive-3d-redesign.md`](relive-3d-redesign.md) and
> [`relive-3d-next-level.md`](relive-3d-next-level.md). Their data plumbing and
> pure-math tests are reusable; their scene/world is not the starting point.
> **Decision**: free explore first, directed chase film later.

## Why this exists

The current viewer is a 3,508-line cockpit over a 30 m DEM and a 5 m road ribbon.
Its own visual baselines show a road on a bare heightfield. The gap is the
**world** and the **loop**, not the camera count.

`AGENTS.md` is optimized for code-complete increments in a mature app. Visual
work needs a reference, a render-and-look loop, and permission to replace the
world. This prototype is a bounded lab to find the quality ceiling before
another production rewrite.

## What we're building

**v0 — Explore.** A standalone app that loads one real Strava ride — the most
recent Lake Geneva activity — and lets you fly around its world in 3D. Real
terrain/buildings/roads where available, a route overlay, a bike/rider on the
route, a timeline, and a small telemetry chip. Camera presets: **Overview,
Route, Rider, Climb, Summit**. Free-fly and orbit.

**v1 — Film.** A "Play film" mode adds the chase/director. Not in v0.

The v0 question is: *does this feel like the place, at every distance, and do I
want to keep exploring?* The film question comes after the world earns it.

## Quality bar

A prototype is done when all of these are true:

1. **Place recognition** — a local rider recognizes the road/climb without labels.
2. **Close-range illusion** — at ~5 m from the rider the world still reads: no
   empty plane, no blurry drape, no floating road.
3. **Exploration** — 3 of 5 testers spend 2+ minutes and find a moment they would
   share.
4. **Performance** — 60 fps at 1080p on the dev machine; first frame < 3 s; no
   jank > 50 ms.
5. **Frame quality** — the 6-pose contact sheet has foreground/midground/
   background detail and a clear subject at every pose.
6. **Preference** — 4 of 5 testers prefer it to the current viewer.

## Scope

**In:** one ride; one world; free camera + presets; route overlay; bike/rider;
timeline/play; telemetry chip; sun/time-of-day; weather tint; title card;
screenshot harness; frame-time overlay.

**Out:** auth/backend; app integration; mobile; ghost racing; director/tour;
audio; export/share; settings; multiple rides; 7 cameras; HUD; production tests.

## Locked decisions

| Decision | Choice |
|---|---|
| Order | Free explore first, chase film later |
| Home | Standalone `prototype/relive/` app |
| Hero ride | Most recent Lake Geneva activity; prod sync may be required |
| Time | Unlimited; milestone-gated, first look ~2 weeks |
| World | Spike Google 3D Tiles vs MapLibre/open vs local open geodata, same 6 poses, pick on coverage/look/fps |
| Key | Check Google 3D Tiles key/billing/coverage before committing |
| Gate | Visual acceptance, not code completeness |

## Phases and gates

| Phase | Output | Gate |
|---|---|---|
| 0 — Setup | Hero ride synced/exported, reference board, 6 camera poses, Playwright shot harness, Google key/coverage check | Contact sheet exists and I can see it |
| 1 — World bake-off | Google 3D Tiles (Cesium) vs MapLibre/open vs local open geodata, same scene and poses | Pick a world; 60 fps; no empty plane at any pose |
| 2 — Explore v0 | Controls, presets, route overlay, bike/rider, timeline, telemetry, grade | 6-pose sheet passes; 2-minute exploration feels good |
| 3 — Eval/polish | 5-person test, fix worst frames, one chase-shot stub | Go/no-go for v1 |

**No hard end date.** The first evaluable artifact is targeted at ~2 weeks; after
that, iterate until the gates pass. Unlimited time is not a reason to skip the
gates — it's a reason to fix the worst frame instead of shipping it.

A **first-look checkpoint** sits after Phase 1: if no world holds up, stop and
rethink the product (stylized world, local data, or a different surface) rather
than polishing a weak base.

## Phase 1 log

### 2026-10-29 — MapLibre + OpenFreeMap: rejected

Hero ride found and exported: Strava `afcfb024-fd01-45aa-ba04-0bfab7428747`,
Lake Geneva full loop, 174.8 km, 10k samples with `latlng`. See
[`prototype/relive/DECISIONS.md`](../prototype/relive/DECISIONS.md).

The keyless candidate fails the six-pose gate
(contact sheet, not committed): flat map at
overview, flat lake at the shore, cardboard boxes at close range, invisible
route (MapLibre line layers are not draped on terrain), cartoon rider.

This is the data source's ceiling, not a bug. **Do not polish it.** Next:
Google Photorealistic 3D Tiles via CesiumJS, pending a free Maps Demo Key.

### 2026-10-30 — Cesium adapter built; demo key blocked

The Cesium + Google 3D Tiles adapter is built (`src/world/cesiumWorld.ts`),
including a Cesium ion fallback (`?tiles=ion`: World Terrain + Bing aerial +
OSM Buildings). Typecheck is clean.

The supplied Maps Demo Key is rejected by the raw Map Tiles API:
`403 API_KEY_SERVICE_BLOCKED` on `ThreeDTilesService.GetRootTileset`. The demo
key covers the 3D Maps product, not the raw Map Tiles API. The raw-tiles path
is blocked; the Maps JavaScript 3D path works (below). See
[`DECISIONS.md`](../prototype/relive/DECISIONS.md).

### 2026-10-30 — Google 3D Maps JS API: world gate passed

The demo key **does** work with the Maps JavaScript API 3D (`maps3d`,
`gmp-map-3d`). The prototype now defaults to `?world=google3d`. Photoreal
buildings, trees, terrain, lake, and mountains; Lausanne/Montreux and the climb
read as places; the route polyline follows the road. Evidence:
contact sheet (not committed).

Open: the rider is a `gmp-marker-3d` placeholder (the `gmp-model-3d` element
does not load models); the close pose has no rider; the summit is an aerial;
the overview has a water foreground/tile seam. **The rider is accepted as a v0
gap; a 3D rider is deferred to v1.**

### 2026-10-30 — Explore v0 (option 1)

Explore v0 is built on the Google 3D world: six presets, 900 ms camera tweens,
Follow mode (60 m / 18 m / 68°), timeline/play/speed, telemetry, keyboard.
The rider is still a marker; the close pose is road detail.

### 2026-10-30 — Cesium rider spike (option 2): rejected

The free Cesium ion token loaded World Terrain + OSM Buildings, but the world
is a flat green plane (no Bing aerial on the free token), white untextured
boxes, and no bike model. It is far below the Google 3D world. A real 3D bike
is not worth this world drop. The Google 3D world remains the default; the
rider stays a marker for v0. Revisit only via a Google-native model/map ID, a
custom overlay, or accept the marker. See
[`DECISIONS.md`](../prototype/relive/DECISIONS.md).

### 2026-10-30 — Old vs new comparison

Compared the real old `Replay3D` against the new Google 3D world on the same
Lake Geneva ride, normalized to noon/clear and run through a full-quality
headless harness. Evidence:
[`COMPARISON.md`](../prototype/relive/COMPARISON.md),
comparison sheet (not committed).

- Old: floating terrain slab in the real-fixture run; dark plane + tiny 3D bike
  in chase; ribbon + floating route in drone. The synthetic baseline shows the
  intended look: a green heightfield + road ribbon, no buildings, trees, or place.
- New: photoreal lake, shore, city, mountains; route follows the road.

Verdict: **replace the world layer, keep the old data/story layer, solve the
rider separately.** The old viewer wins on the 3D bike and on telemetry, course
profile, highlights, ghost, tour, weather, and export. The new world wins on
place, route, UX, and performance. Next: port the story layer onto the new world.

### 2026-10-30 — Story layer ported; full sync verified (2026-11-02)

Ported the course profile, HR/speed/grade sparklines, highlight chapters, and
data readout onto the new world. The story panel is **full-sync by default**:
timeline and chapter seeks move the map to the rider; `?sync=0` is the data-only
fallback. Full sync was verified after the demo key's daily Maps JavaScript 3D
quota reset on 2026-11-02.

The demo key reached its daily quota on 2026-10-30; it reset and the map + story
were verified. A standard key is recommended for uninterrupted work. Remaining
old features: tour/director, route colour by metric, export.

### 2026-11-02 — Ghost racing ported (production route-history picker)

Ghost racing is ported onto the new world, with two modes:

- **Real ghosts (Arthur's Seat):** `?ride=arthurs&ghost=1` reads the production
  route-history payload for route `034bac3e…` (4 rides), excludes the current
  16 Sep ride, and keeps same-lap rides (distance within 1 km): **25 Jul 2026
  (PB)** and **27 Jan 2025**. The 9 Sep 2026 23.8 km longer ride and the
  8 Nov/8 Aug rides on the different 19.2 km route are not offered as 1-lap
  ghosts.
- **Picker** in the preset bar; PB marked; the telemetry shows the ghost date
  and the delta, green when ahead / red when behind.
- **Synthetic fallback (Lake Geneva):** `?ghost=1` uses a 15 s-lead clone.
- A second marker (`G`); full sync with seeks.
- Multi-ride refactor (`RIDES`/`GHOST_RIDES`; helpers take a `Ride`);
  `data/arthurs.json` is the fixture, `data/arthurs-history.json` the
  route-history snapshot.
- Tested: 11/11 QA tests, including the production picker.

Open: the live authenticated `GET /routes/{id}/history` fetch is still open;
the Lake ride remains synthetic.

### 2026-11-03 — Rider: Three.js overlay path (parked)

- `gmp-model-3d` fetches the Cube GLB (HTTP 200) but renders nothing; the
  Astronaut test was blocked by CORS, so the element is not the path.
- The Three.js overlay camera sync works: a sphere at the rider lands on the
  marker; the Cube bike GLB loads and renders (studio and scale-5 debug).
- `?rider=3d` is opt-in: a transparent Three.js canvas above the Google map,
  camera rebuilt from `getCameraPose`, the old wheel-blur/lean rig, and closer
  close/climb/follow/focus framing for the bike. The marker is the fallback.
- The asset is a **bike**, not a human rider; a human needs a new model.
- The GLB and `bike.ts` are the old Relive asset (`cube-agree-c62-2026.glb`,
  SHA-256 `df25d970…`); the white-vs-dark difference is lighting. The studio
  has Daylight / Relive ride / Studio presets; the old chase look is Relive.
- **Parked for now:** the default is the marker. The CUBE down-tube decal reads
  correctly on the drive side; the non-drive side mirrors it (old GLB UVs). The
  studio hero is on the drive side.
- The demo key hit its daily quota again during the spike, so the final map
  visual is unverified until reset or a standard key.





## Technical shape

```
prototype/relive/
  data/ride.ts          # fixture schema + normalize (pure)
  world/World.ts        # mount/setCamera/setTime/setRoute/dispose
  world/cesium.ts       # Google 3D Tiles candidate
  world/maplibre.ts     # open terrain/buildings candidate
  world/local.ts        # optional: swisstopo/IGN open 3D data candidate
  camera/rig.ts         # orbit/fly controls, ground clamp, presets
  route/overlay.ts      # route line/ribbon on the surface
  rider/rig.ts          # bike/rider placement, lean, wheels
  render/loop.ts        # rAF; no React state per frame
  grade/post.ts         # tone mapping, bloom, vignette, grain
  ui/                   # title card, timeline, telemetry, presets
  qa/shots.spec.ts      # ?pose=&t=&freeze=1 -> contact sheet
```

- The `World` interface keeps the bake-off honest and the choice reversible.
- One `<canvas>`. React only for UI chrome; the render loop is outside React.
- Preload the route corridor; cap DPR; no shadows on low-end GPUs.
- Reuse pure data helpers from `frontend/src/lib` only if they survive the
  boundary; otherwise copy and own them.

## Data

### Hero ride

Most recent activity around Lake Geneva. Phase 0:

1. Trigger the existing production Strava sync (operational only; no code
   changes on `prod`).
2. Find the activity by `start_latlng` inside the Lake Geneva bounding box
   (~46.1–46.6 N, 5.9–6.9 E) with a read-only production query.
3. Export the activity + streams to the fixture. If the ride is still missing
   after the sync, ask for the Strava activity URL/id.

### Fixture

Fixture per ride:

- Activity metadata: name, start date, distance, duration, elevation, weather.
- Polyline (decoded).
- 1 Hz streams: `time`, `distance`, `altitude`, `velocity`, `watts`,
  `heartrate`, `cadence`, and **`latlng`**.
- Highlights: climbs, descents, sprints, fastest km, PRs.
- Place names for start/climb/summit (reverse geocode).
- Photos if available; not required.

**Gap to close:** [`strava_client.py`](../backend/app/integrations/strava_client.py)
does not request `latlng`, and the app stores no photos. The fixture script will
request `latlng` for the hero ride; if unavailable, fall back to polyline +
distance mapping (acceptable for v0, weaker at close range).

Commit the fixture (compressed) so the prototype runs offline with no auth and no
backend.

## Visual QA loop

- `npm run qa:shots` renders the 6 poses and writes
  `qa/out/contact-sheet.png`.
- I read the contact sheet with `read_image` after every meaningful change and
  fix the worst frame.
- `REFERENCE.md` holds 8–10 reference frames (Google Earth, Relive, Cesium,
  FATMAP-style) with notes on composition, light, and motion.
- `DECISIONS.md` logs what was tried and rejected.
- Baselines are committed; pixel diff is a regression alarm, **not** the quality
  gate.

The 6 poses:

1. **Overview** — 2 km out, 500 m up; route and place readable.
2. **Approach** — 300 m out, 80 m up; road and surroundings.
3. **Rider** — 12 m behind/side; bike/rider and surface.
4. **Climb** — low side tracking; grade reads.
5. **Summit** — pull-back reveal; place recognizable.
6. **Close** — 5 m; the illusion test.

## `AGENTS.md` prototype lane (proposed)

Do not apply until sign-off. The production rules stay; a declared lab gets
different ones.

- `prototype/` is exempt from "prefer small changes", "no bulk scripted
  rewrites", the 2-attempt stop rule, production dependency/architecture
  conventions, and Review-vs-Act gating.
- It must produce one hero artifact, pass the visual gate, keep `DECISIONS.md`,
  and be deletable in one commit.
- For visual features, "done" requires a rendered, looked-at artifact; tests are
  necessary, not sufficient.
- "New feature planning" must produce a reference board and visual acceptance
  criteria.
- "No external tile/API-key dependency" is a production constraint; prototypes
  may use keys/free tiers with an exit plan.
- Review vs Act gets a flagship-surface exception; the 3D viewer can be an action
  surface.

## Open decisions

1. **Hero ride** — Lake Geneva, most recent. Need prod sync + activity id.
2. **Explore camera** — free-fly + presets (recommended), orbit-only, or
   first-person ride. I'll default to free-fly + presets.
3. **Google 3D Tiles access** — Phase 0 checklist:
   - Google Maps Platform project with billing enabled.
   - 3D Tiles API enabled and a restricted browser key.
   - CesiumJS auth path for Google tiles verified.
   - Coverage at the ride bounding box (urban lakeside vs rural climbs).
   - Terms on caching/offline use; cost for a 2-week prototype.
   If any item fails, MapLibre/open is the fallback; local open data is the
   optional third candidate.
4. **Local open data** — worth a spike if Google coverage is weak: swisstopo
   `swissBUILDINGS3D` + `swissALTI3D` + `SWISSIMAGE` on the Swiss side; IGN
   `BD TOPO` + `LIDAR HD` + ortho on the French side. Licensing and coverage to
   verify before committing.

## Risks

| Risk | Mitigation |
|---|---|
| Production sync is unavailable or the ride is missing | Read-only query first; if missing, ask for the Strava URL/id; sync is operational, no prod code |
| Google 3D Tiles key/coverage/cost blocks the photoreal path | Phase 0 checklist; MapLibre/local data fallback |
| Local open data licensing/processing is heavier than expected | Treat as optional candidate; don't block v0 on it |
| Google 3D Tiles coverage hole at the hero ride | Coverage check in Phase 0; MapLibre or stylized fallback |
| MapLibre reads as a map at close range | Art direction/grade; accept a stylized look; test the 5 m pose early |
| Tile streaming jank | Preload the route corridor; LOD; loading screen |
| Bike/rider looks toy-like at close range | Low-poly rider with pedaling loop; close-up pose is a gate |
| Scope creeps into the film | v0 has no director; only a "Play film" stub |
| Unlimited time becomes scope creep | Milestone gates + one artifact + first-look checkpoint |
| The process reverts to code-complete | Prototype lane + visual gate + one artifact |
