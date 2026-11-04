# Reference board — what "good" means

The target is not a feature list. It is a set of frames that make you say
"that's the place" and "I'd share that". Each reference names what to steal.

## 1. Relive — the emotional bar

- **Steal:** the ride is a memory, not a map. A short authored sequence, real
  data callouts, music, and a beginning/middle/end.
- **Don't steal:** the low-poly world. Relive gets away with it because the
  edit and the photos carry the emotion.
- **Link:** https://www.relive.cc/

## 2. Google Photorealistic 3D Tiles — the world bar

- **Steal:** real buildings, trees, terrain, and streets at cycling scale. The
  place is recognizable without labels.
- **Don't steal:** the Google Earth "fly anywhere" UI. We want a ride, not a
  globe.
- **Link:** https://mapsplatform.google.com/maps-products/3d-maps/
- **Coverage:** CH / FR both show Map Tiles 2D/3D coverage at country level;
  verify the Lake Geneva bbox with a key.

## 3. CesiumJS Google 3D Tiles demo — the camera/scale bar

- **Steal:** low-altitude camera over real photogrammetry; horizon, sun, fog,
  and scale that read at 5 m and at 2 km.
- **Don't steal:** free-flight controls as the primary interaction. The ride
  should have a spine.
- **Link:** https://sandcastle.cesium.com/

## 4. FATMAP / Komoot 3D — the route legibility bar

- **Steal:** the route reads as a line in the landscape, with grade and
  distance legible at a glance.
- **Don't steal:** the ski-map aesthetic. Lake Geneva is not a resort.
- **Link:** https://www.komoot.com/

## 5. Cycling broadcast — the data overlay bar

- **Steal:** speed/HR/grade as a lower-third, not a cockpit. One hero number at
  a time.
- **Don't steal:** the full TV graphics package. We are not producing a stage.

## 6. The current FitTrack baseline — what we are leaving

- `frontend/e2e/replay-visual.spec.ts-snapshots/replay-hilly-full-chromium-win32.png`
- A road ribbon on a bare heightfield. This is the "before" frame.

## 7. MapLibre + OpenFreeMap — the rejected candidate

- `prototype/relive/qa/out/contact-sheet.png`
- Flat at overview, flat lake at the shore, cardboard boxes at close range,
  invisible route. The keyless vector map is a map, not a world.

## The gate

For each of the six poses, the frame must have:

- a clear subject (rider, road, or place),
- foreground / midground / background separation,
- no empty plane filling the frame,
- no label soup,
- a reason to look at it for more than a second.

The 5 m pose is the illusion test. If the world is cardboard at 5 m, the
candidate is rejected, regardless of how good the overview looks.
