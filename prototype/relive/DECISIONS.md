# Decisions — Relive prototype v2

## 2026-10-29 — Hero ride

**Chosen:** Strava activity `afcfb024-fd01-45aa-ba04-0bfab7428747` — "Cycling",
27 Oct 2026, Lake Geneva full loop.

- 174.8 km, 7h 44m moving / 9h 36m elapsed, 675 m gain.
- Start/end Geneva; north shore (Nyon, Rolle, Morges, Lausanne, Vevey,
  Montreux, Villeneuve) and south shore (Evian, Thonon, Yvoire).
- 10,000 samples at ~3.5 s spacing; `latlng` fetched from Strava at the same
  resolution; no power or cadence stream (HR + speed + grade only).
- Weather: fog, 16.8 °C, wind 3.6 km/h from 270°.
- Fixture: `data/hero-ride.json` (0.53 MB).

## 2026-10-29 — MapLibre + OpenFreeMap candidate: **rejected**

**Evidence:** `qa/out/contact-sheet.png` (six fixed poses).

What failed:

1. **Overview** is a flat 2D map. At 10.7 zoom the terrain is a hillshade, not
   a world; there is no sense of place or scale.
2. **Lausanne / Montreux** are a flat blue lake with a cartoon cyclist marker.
   The shore is a map, not a place.
3. **Climb / Summit** are extruded building boxes with map labels. It reads as
   a 3D map, not a ride.
4. **Close** is a giant building box; the 5 m illusion test fails completely.
5. **The route overlay is invisible.** MapLibre line layers are not draped on
   terrain, so the route sits at sea level under the terrain.
6. **The rider is a 2D marker**, not a 3D rig; it cannot survive the close pose.

**Conclusion:** this is the ceiling of the keyless vector-map source, not a bug
to polish. Do not spend more time on MapLibre for v0. Keep it only as a
fallback/reference.

**Next:** Google Photorealistic 3D Tiles via CesiumJS. Google's free Maps Demo
Key needs no credit card; CH and FR both show Map Tiles 2D/3D coverage at the
country level. Verify the Lake Geneva bbox with the key before committing.

## 2026-10-30 — Google demo key is blocked for the Map Tiles API

The Cesium + Google 3D Tiles adapter is built and typechecks, but the supplied
Maps Demo Key returns:

```
403 API_KEY_SERVICE_BLOCKED
google.maps.tile.v1.ThreeDTilesService.GetRootTileset
```

The demo key covers the **3D Maps** product (Maps JavaScript / Android / iOS),
not the raw **Map Tiles API** that Photorealistic 3D Tiles uses. The key is not
a valid credential for `tile.googleapis.com`.

Options:

1. **Standard Google key** — billing account + Map Tiles API enabled; the
   prototype should sit inside the monthly free tier. Best quality.
2. **Cesium ion free token** — World Terrain + Bing aerial + OSM Buildings; no
   billing, lower quality, same Cesium adapter (`?tiles=ion`).
3. Try to enable Map Tiles API on the demo key's project
   (`1057343642084`) and allow it in the key's API restrictions. If the demo
   key is managed by Google, this will not be editable.

## 2026-10-30 — Google 3D Maps JavaScript API: **world gate passed**

The demo key **does** work with the Maps JavaScript API 3D (`maps3d` library,
`gmp-map-3d`). It does not work with the raw Map Tiles API. The prototype now
defaults to this world (`?world=google3d`).

Evidence: `qa/out/contact-sheet-google3d.png`.

**Passed:**

- Photoreal buildings, trees, terrain, roads, lake, and mountains.
- Lausanne and Montreux are recognizable places; the lakefront reads.
- The climb frame is a believable road/lake/mountain scene.
- The route polyline follows the road (CLAMP_TO_GROUND) and is visible.
- The Google Maps 3D camera (`cameraPosition` + heading/tilt) gives precise
  low-altitude framing.
- The demo key has no billing; attribution is shown.

**Open:**

- **The rider is a `gmp-marker-3d` placeholder** (red pin with a cyclist
  emoji). The `gmp-model-3d` element is defined but does not fetch/load a model
  (tested with a local box GLB and a public HTTPS GLB; no request, no error).
  The 5 m rider illusion is not solved.
- The close pose is road detail with no rider (the marker is culled/out of
  frame at close range).
- The summit pose is an aerial of Thonon (the ride's high point is a town, not
  a scenic summit).
- The overview has a water foreground and a visible tile seam; it reads as a
  lake panorama, not a route map.
- The Google 3D world is a rendered map, not a custom engine; the camera and
  marker API is the ceiling for bespoke content.

**Next decision:** accept the marker for v0 and move to the explore/film
experience, or spend a spike on a 3D rider (Cesium ion free token + bike model,
a custom overlay, or Google model support). The world is no longer the blocker.

## 2026-10-30 — Explore loop v0 (option 1)

Built on the Google 3D world:

- Six presets (Overview, Lausanne, Montreux, Climb, Summit, Close).
- 900 ms camera tween between presets (camera position/heading/tilt
  interpolation; no dependence on Google's `flyCameraTo`).
- **Follow** mode: the camera chases the rider at 60 m / 18 m / 68° while the
  ride plays; selecting a preset turns it off.
- Timeline seek, play/pause, 60×/120×/300× speed, telemetry chip, keyboard
  (`1–6`, `P`, `F`, `D`).
- The rider remains a marker; the close pose is road detail.

## 2026-10-30 — Cesium ion rider spike (option 2): **rejected**

The free Cesium ion token loaded Cesium World Terrain and OSM Buildings, but the
world is far below the Google 3D bar:

- The ground is a flat green plane; Bing aerial imagery did not render on the
  free token (the Cesium credit shows "Upgrade for commercial use").
- Buildings are untextured white boxes.
- The bike GLB did not render (likely the meshopt-compressed asset or its
  placement); no rider was visible.
- The scene reads as a CAD model, not a place.

A real 3D bike is not worth this world drop. The Google 3D world remains the
default; the rider stays a marker for v0. Revisit the rider only via a
Google-native model/map ID, a custom overlay on the Google camera, or accept
the marker. Do not merge the Cesium world.

## 2026-10-30 — Rider: marker accepted for v0

Decision: **accept the `gmp-marker-3d` rider for v0.** The Google 3D world is
the hard part and it is good; the Cesium world is not a viable substitute, and
the Google `gmp-model-3d` element does not load models. The close pose is road
detail, not a 5 m rider shot. A 3D rider is deferred to v1; the remaining
options are a Google-native model/map ID or a custom Three.js overlay on the
Google camera.

v0 is therefore: Google 3D world + six poses + explore loop (presets, tween,
follow, timeline, telemetry), with the rider marker as a known gap. The 5-person
evaluation and mobile/accessibility pass are still open.

## 2026-10-30 — Old vs new comparison

Compared the real old `Replay3D` against the new Google 3D world on the **same
Lake Geneva ride**, normalized to noon/clear and run through a full-quality
headless harness. Evidence:
[`COMPARISON.md`](COMPARISON.md),
`qa/out/compare-old-vs-new.png` (not committed).

- **Old:** floating terrain slab in the real-fixture run; dark plane with a tiny
  3D bike in chase; ribbon + floating route in drone. The synthetic baseline
  shows the intended look: a green heightfield + road ribbon, no buildings,
  trees, or place.
- **New:** photoreal lake, shore, city, and mountains; route follows the road.

Verdict: **replace the world layer, keep the old data/story layer, solve the
rider separately.** The old viewer wins on the 3D bike and on telemetry, course
profile, highlights, ghost, tour, weather, and export. The new world wins on
place, route, UX, and performance. The next feature should port the story layer
onto the new world, not rebuild the old renderer.

## 2026-10-30 — Story layer ported; full sync verified after quota reset

Ported the old data/story layer onto the new world:

- Course profile (altitude area) with highlight markers and a playhead.
- HR/speed/grade sparklines.
- Highlight chapters (climb, descent, fastest km, high point).
- Data readout at the playhead.

The story panel is **full-sync by default**: timeline and chapter seeks move the
map to the rider. `?sync=0` keeps the data-only fallback. Full sync was verified
after the demo key's daily Maps JavaScript 3D quota reset on 2026-11-02.

The demo key reached its daily quota on 2026-10-30; it reset and the map + story
were verified. A standard key with billing is still recommended for
uninterrupted work.

Next: the remaining old features are the tour/director, data-driven route
colour, and poster/clip export. Ghost racing is ported with a production
route-history snapshot picker (2 same-lap Arthur's Seat ghosts); the live picker
is still open. The tour is the v1 film.

## 2026-11-02 — Ghost racing ported (production route-history picker)

Ported ghost racing onto the new world, with two modes:

- **Real ghosts (Arthur's Seat):** `?ride=arthurs&ghost=1` reads the production
  route-history payload for route `034bac3e…` (4 rides), excludes the current
  16 Sep ride, and keeps same-lap rides (distance within 1 km): **25 Jul 2026
  (PB)** and **27 Jan 2025**. The 9 Sep 2026 23.8 km longer ride and the
  8 Nov/8 Aug rides on the different 19.2 km route are not offered as 1-lap
  ghosts.
- A **picker** in the preset bar selects the ghost; PB is marked; the telemetry
  shows the date and the delta, green when ahead / red when behind. At the
  summit the 25 Jul lap is **335 m behind**; the 27 Jan lap is +1.1 km ahead.
- **Synthetic fallback (Lake Geneva):** `?ghost=1` uses a 15 s-lead clone,
  because there is one Lake Geneva activity.
- A second marker (label `G`); full sync with seeks and chapters.
- The multi-ride refactor (`RIDES`/`GHOST_RIDES`; helpers take a `Ride`) and
  `data/arthurs.json` make the fixture ghosts possible.
- The picker reads a **snapshot** of the production route-history payload
  (`data/arthurs-history.json`), matching the endpoint shape; the live
  authenticated fetch is open.
- Tested: 11/11 QA tests, including the production picker.

Open: the live `GET /routes/{id}/history` fetch (auth) is still open; the Lake
ride remains synthetic.

## 2026-11-03 — Rider: Three.js overlay path (parked)

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








