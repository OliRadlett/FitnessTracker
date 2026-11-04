# Relive Prototype v0

Standalone 3D ride viewer for one real Strava ride: the Lake Geneva loop
(174.8 km, 27 Oct 2026).

## Run

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:5199/?world=google3d](http://127.0.0.1:5199/?world=google3d).
Arthur's Seat real ghost:
[http://127.0.0.1:5199/?ride=arthurs&pose=summit&ghost=1](http://127.0.0.1:5199/?ride=arthurs&pose=summit&ghost=1).
3D rider (experimental): add `&rider=3d` to any Google 3D URL.
Bike studio (no map key): [http://127.0.0.1:5199/rider-studio.html](http://127.0.0.1:5199/rider-studio.html).

`prototype/relive/.env.local` (gitignored) needs:

```
VITE_GOOGLE_MAPS_API_KEY=...
# optional, only for the rejected Cesium spike:
VITE_CESIUM_ION_TOKEN=...
```

## What is here

| Path | Purpose |
|---|---|
| `src/world/google3dWorld.ts` | **Default.** Google Maps JavaScript API 3D: photoreal world, route polyline, rider marker, presets, follow, camera tween. |
| `src/world/maplibreWorld.ts` | Keyless baseline; rejected on world quality. |
| `src/world/cesiumWorld.ts` | Cesium ion/raw-tiles spike; rejected on world quality. |
| `src/ui/overlay.ts` | Title card, presets, timeline, telemetry, Follow, ghost picker. |
| `src/ui/story.ts` | Story layer: course profile, HR/speed/grade sparklines, highlight chapters, data readout. |
| `src/rider/bike.ts` | Cube Agree C62 GLB rig: ground alignment, lean, wheel blur. |
| `src/rider/overlay.ts` | Three.js rider overlay on the Google 3D camera. |
| `src/rider/studio.ts`, `rider-studio.html` | Bike lab, no map key required. |
| `src/data/ride.ts`, `data/hero-ride.json` | Lake Geneva fixture (10k samples, latlng, weather, highlights). |
| `data/arthurs.json` | Arthur's Seat fixture: main (16 Sep) + four real ghost laps (25 Jul 2026, 27 Jan 2025, 8 Nov 2024, 8 Aug 2024). |
| `data/arthurs-history.json` | Production route-history snapshot for the Arthur's Seat route (4 rides; the picker uses 2 same-lap ghosts). |
| `qa/` | Playwright poses, story, ghost and picker; contact sheet. |
| `DECISIONS.md`, `REFERENCE.md` | What was tried/rejected and what "good" means. |

## QA

```bash
npx playwright test qa/shots.spec.ts
```

Then compose the sheet (PowerShell):

```powershell
$env:RELIVE_PREFIX='google3d-'
$env:RELIVE_TITLE='Lake Geneva Loop — Google 3D world'
$env:RELIVE_SUBTITLE='Google Maps JavaScript API 3D · photoreal tiles · demo key · 6 fixed camera poses'
python qa/contact_sheet.py
```

Output: `qa/out/contact-sheet-google3d.png`.

## World decision

**Google 3D Maps JavaScript API** with the demo key: photoreal buildings, trees,
terrain, lake, and mountains; no billing. The raw Map Tiles API is blocked for
the demo key.

- **MapLibre + OpenFreeMap: rejected.** Flat map at overview, flat lake at the
  shore, cardboard boxes at close range, route not draped.
- **Cesium ion: rejected.** Flat green ground (no Bing aerial on the free
  token), white untextured OSM boxes, no bike visible. The world drop is not
  worth a 3D bike.

## Ghost

`?ride=arthurs&ghost=1` opens the **production route-history picker** for the
Arthur's Seat route (`034bac3e…`): 4 rides, the current 16 Sep ride excluded,
and a same-lap filter (distance within 1 km) leaves **25 Jul 2026 (PB)** and
**27 Jan 2025**. The 9 Sep 2026 ride is a 23.8 km longer ride on the same route,
and 8 Nov/8 Aug
are on a different 19.2 km route, so they are not offered as 1-lap ghosts. The
telemetry shows the ghost date and the live delta: green when ahead, red when
behind. The Lake Geneva ride uses a synthetic 15 s-lead ghost because there is
one Lake activity.

The picker reads a snapshot of the production route-history payload
(`data/arthurs-history.json`); the live authenticated
`GET /routes/{id}/history` fetch is still open.

## 3D rider (experimental)

`?rider=3d` swaps the marker for the Cube Agree C62 GLB on a Three.js overlay.
The Google `gmp-model-3d` element fetches the GLB but renders nothing; the
overlay is the path. The overlay camera is rebuilt from `getCameraPose`; the
bike uses the old wheel-blur/lean rig. `?rider=3d` is opt-in; the marker is the
fallback. `/rider-studio.html` shows the bike without the map.

The GLB and `bike.ts` are copied from the old Relive
(`cube-agree-c62-2026.glb`, SHA-256 `df25d970…`), so the texture is the old
asset. The studio has Daylight / Relive ride / Studio lighting and
close/follow/climb/ghost presets; the old chase look is the Relive preset.
The rider is **parked for now**; the default is the marker. The CUBE down-tube
decal reads correctly from the drive side; the non-drive side mirrors it (old
GLB UVs). The studio hero is on the drive side.

## Known gaps

- **Demo key daily limit:** the Maps JavaScript 3D demo key reached its daily
  quota on 2026-10-30, reset on 2026-11-02, and was exhausted again on
  2026-11-03 during the rider spike. A standard key with billing is required
  for uninterrupted work.
- **Story layer is full-sync by default:** timeline and chapter seeks move the
  map to the rider. `?sync=0` keeps the data-only fallback.
- **Production picker is snapshot-backed:** the picker uses the production
  route-history payload for Arthur's Seat, snapshotted into
  `data/arthurs-history.json`; the live authenticated
  `GET /routes/{id}/history` fetch is still open.
- **3D rider is parked:** `?rider=3d` overlays the Cube Agree C62 GLB with
  Three.js; the Google `gmp-model-3d` fetches but does not render. The overlay
  camera sync is validated, but the final map check is blocked by the demo key
  quota. The asset is a bike, not a human rider; a human needs a new model. The
  non-drive CUBE decal is mirrored by the old GLB UVs; the drive side is
  correct. The marker remains the default/fallback.
- Close pose is road detail, not a 5 m rider shot.
- Summit pose is an aerial of Thonon (the ride's high point is a town).
- Overview has a water foreground and a visible tile seam.
- No mobile/accessibility pass; no 5-person evaluation yet.

## Next

- **Production:** [plans/relive-3d-production.md](../plans/relive-3d-production.md)
  — standard key/budget/terms, data contracts, fallback, mobile/accessibility,
  migration, quality gate.
- **v1:** the chase/director film after the production viewer.
