# Relive 3D — Production Plan

> **Status**: **shipped** — the Google 3D viewer landed in #339 (`574972ac`, 2026-11-04) and is on `main`/`prod`; the plan below is the delivered record. Originally a draft for approval (2026-11-03). The standalone prototype is
> verified; this plan covers the production integration, cost/terms, data
> contracts, migration, quality gates and rollout.
>
> **Inputs**: [`prototype/relive/README.md`](../prototype/relive/README.md),
> [`COMPARISON.md`](../prototype/relive/COMPARISON.md),
> [`DECISIONS.md`](../prototype/relive/DECISIONS.md),
> [`plans/relive-prototype-v2.md`](relive-prototype-v2.md).
>
> **Audience**: the personal FitTrack deployment first; multi-user is a
> deliberate later step. The app is currently a single-user, allowlisted
> fitness tracker.
>
> **Rule**: no production code until the P0 gate (standard key, budget/cap,
> terms, scope) is signed off. The key/budget/cap were verified 2026-11-03;
> terms/audience sign-off is still pending.

---

## 1. Executive summary

**Recommendation:** ship the **Google 3D world + story layer + live ghost
picker** as the next Relive, behind a feature flag, with the **marker** as the
rider. Keep the old viewer until the new one passes the quality gate and the
tour/export decision is made. Do **not** ship the 3D rider; it is parked.

The prototype has already proved the hard parts:

- A photoreal Google 3D world with six camera poses, route, presets, follow,
  timeline and telemetry.
- A story layer (course profile, HR/speed/grade sparklines, highlight chapters,
  full-sync seeks).
- A real ghost picker driven by the production route-history contract
  (`GET /routes/{id}/history`), with same-lap filtering and PB marking.
- A repeatable Playwright QA harness (11/11 at the last full run) and a contact
  sheet.

The remaining work is **production engineering and product decisions**, not
world discovery: the standard Google key/cost, the live data path, the
fallback, mobile/accessibility, migration and the quality gate.

**The biggest risk is not code.** It is the **Google 3D Maps API** (the
prototype used its beta channel) plus its **cost/terms** and the **demo-key
daily quota** (hit twice in the prototype). For a **single user** the expected
Google bill is **$0/month** within the 5,000 free Immersive Maps loads; the
standard key, billing account and terms still need P0. The P0 runbook is
[`relive-3d-p0-runbook.md`](relive-3d-p0-runbook.md): a standard key restricted
to the Maps APIs and HTTP referrers, the **`no spend` spend-cap budget** (0 GBP,
project + Maps service, `spendCap` configured), an app cap, and a map-load test.
The 3D Map loads metric has no consumer-quota limits endpoint, so the spend cap
is the hard cap; the key is in the main project and the spend cap is scoped to
Maps. P0 must settle the terms and audience before the integration starts.

---

## 2. Scope

### In scope (first production release)

| Area | Decision |
|---|---|
| World | Google 3D Maps JavaScript API, photoreal; standard billing key. |
| Route | Activity polyline/streams, draped on the 3D world. |
| Camera | Six presets, 900 ms tweens, Follow, seek-to-rider. |
| Story | Course profile, sparklines, chapters, playhead, full-sync seeks. |
| Ghost | Live route-history picker, same-lap filter, PB, time-aligned delta. |
| Rider | Marker (the 3D bike is parked; opt-in lab only). |
| Data | Existing activity/streams/weather/route history; one replay aggregate. |
| Deep links | `?replay=<activityId>&t=<seconds>`, `?ghost=<activityId>`. |
| Fallback | 2D/static route poster + story if the 3D map fails/quota. |
| Platforms | Desktop first; mobile responsive with a documented fallback. |
| Rollout | Feature flag; old viewer retained; personal user first. |

### Out of scope (phase 2+)

- 3D rider/bike (parked; marker; see §3.2).
- Tour/director film.
- Route colour by metric.
- Poster/clip export.
- Weather visuals beyond the title line.
- Offline replay.
- Multi-user scaling beyond the existing auth model.

### Success measures

- A replay opens and reaches the first meaningful frame without a blank map.
- The story panel is usable on desktop and mobile.
- A ghost can be selected from the real route history and the delta is correct.
- No uncaught page errors in the QA suite; the map error path falls back.
- Map-ready budget: **< 5 s desktop / < 8 s mobile** on the reference hardware.
- Cost stays inside the approved monthly ceiling.
- A 5-person evaluation prefers the new viewer to the old one for the world and
  story, and does not prefer the old one for anything in scope.

---

## 3. Product decisions

### 3.1 World: Google 3D Maps JavaScript API

**Decision:** use the Google 3D Maps JavaScript API with a **standard billing
key** and a **referrer-restricted** browser key. Keep MapLibre as the fallback
world for low-end devices and for the error path; Cesium is rejected.

**Evidence:**

- Google 3D is the only candidate that delivered the photoreal lake, shore,
  city, mountains and a route that follows the road
  ([`COMPARISON.md`](../prototype/relive/COMPARISON.md)).
- MapLibre + OpenFreeMap was flat/cardboard at overview/close and the route was
  not draped.
- Cesium ion had a flat green ground, untextured OSM boxes and no bike.

**Trade-offs accepted:**

- The prototype uses the **beta** channel of the 3D Maps API; confirm the
  GA/channel at P0. It saw intermittent
  `Cannot read properties of undefined (reading 'keys'/'get')` errors and
  “Oops” overlays, usually tied to readiness/camera jumps or quota.
- The world is vendor-hosted; terms and cost apply.
- The map is opaque: the rider overlay needed a Three.js camera sync. The rider
  is parked, so production has **one** WebGL context, not two.

**Fallback:** if the 3D map fails, times out, or the key/quota is unavailable,
render a **static route poster** (the route + story panel + “3D unavailable”)
and, where possible, the MapLibre 2D map. Never show a blank canvas.

### 3.2 Rider: marker, not a 3D bike

**Decision:** ship the **marker** for the first production release. The 3D bike
is parked as an opt-in lab (`?rider=3d`, `/rider-studio.html`) and is not part
of the production surface.

**Why:**

- `gmp-model-3d` fetches the GLB but renders nothing; the Three.js overlay works
  but adds a second WebGL context, a camera sync and a bike asset.
- The available asset is the **Cube Agree C62 bike**, not a human rider. The
  non-drive-side CUBE decal is mirrored by the old GLB UVs; the drive side is
  correct. A production rider needs a corrected model/UVs and, if wanted, a
  human.
- The user is happy without a rider for now.

**Revisit:** after the production viewer ships, or when a corrected rider asset
and a GPU budget exist.

### 3.3 Story: full-sync by default

**Decision:** port the story layer as-is: course profile, HR/speed/grade
sparklines, highlight chapters, playhead, readout. Timeline/chapter seeks move
the map by default; `?sync=0` is the data-only fallback.

**Evidence:** the story panel is the old viewer’s strongest data feature and it
is already ported and verified. It is the reason the world reads as a ride, not
a map.

### 3.4 Ghost: live route history, not synthetic

**Decision:** production ghosts come from the **live** route history
(`GET /api/v1/routes/{route_id}/history`) and the selected ghost’s activity
detail. Use a **same-lap filter** (distance within 1 km of the current ride),
exclude the current activity, mark the personal best, and time-align by elapsed
time. **Do not ship the synthetic 15 s ghost** in production; it was a
prototype fallback for Lake Geneva, which has only one activity.

**Why the filter:** the Arthur’s Seat route history has four rides; the 9 Sep
2026 ride is a 23.8 km longer ride on the same route, not a fair 1-lap ghost.
The 8 Nov/8 Aug
rides are on a different 19.2 km route and are not candidates. The old picker
would show all route-history rides; the new one should be fair.

**Evidence:** the prototype’s snapshot picker uses the production payload
shape and produces 25 Jul 2026 (PB) and 27 Jan 2025 for the 16 Sep main ride.

### 3.5 Integration: new component, old viewer retained

**Decision:** add the new viewer as a **client component** in the existing
Next.js app, behind a flag. Keep `Replay3D`/`ReplayTheater` until the new viewer
passes the quality gate and the tour/export decision is made. Do not build a
separate app for production; the standalone `prototype/relive` is the lab.

---

## 4. Cost and terms

### 4.1 The demo key is not production

The prototype used the **Maps Demo Key**. It is free and daily-limited; it hit
its daily Maps JavaScript 3D quota on 2026-10-30 and again on 2026-11-03. A
demo key is for prototyping and cannot be the production key.

**P0 must provide:**

- A Google Cloud project with **billing enabled** (`fitness-tracker-505713`).
- The **3D Maps** product/SKU enabled for the project.
- A **standard API key** restricted to `maps-backend.googleapis.com` +
  `tile.googleapis.com` and to HTTP referrers (production, dev and local).
- The **`no spend` spend-cap budget** on the billing account: **0 GBP**, scoped
  to the project + Maps service, `spendCap: CONFIGURED`, alerts at 50/80/100%.
  The 3D Map loads metric (`maps-backend.googleapis.com/3d_billable_default`)
  has no consumer-quota limits endpoint, so no 100/day API quota override
  exists; the spend cap is the hard cap.
- An **app-side cap** (500 map opens/month) + fallback. A kill switch is not
  used because the key is in the main project and detaching billing would break
  Gemini/NextAuth; the spend cap is scoped to the Maps service. If the key moves
  to a dedicated project later, add the kill switch there.
- A terms review for the Google Maps Platform Terms and the 3D Maps product
  terms, including EEA-specific terms if applicable.

### 4.2 Cost model

**The 3D Maps price (checked 2026-11-03):** Google’s core pricing list
(`developers.google.com/maps/billing-and-pricing/pricing`) lists **Immersive
Maps** — the SKU the 3D Maps FAQ says 3D Maps is billed through — at:

- **5,000 free map loads/month**
- **$7.00 per 1,000** map loads for the 0–100,000 tier
- **$5.60 / $4.20 / $2.10 / $0.53 per 1,000** at the higher tiers

The **Immersive Maps – Per User** variant has the same 5,000 free / $7 per
1,000 headline. Confirm the billable event and which SKU applies in the Cloud
console; the demo key’s daily limit is not the production quota.

For a **single user**, the expected bill is **$0/month**: 20–40 replay opens is
20–40 map loads, far below 5,000. Even 100 opens/day (~3,000/month) is still
free. Only above 5,000 map loads/month does usage cost
`(S − 5,000) × $0.007`:

| Scenario | Map loads/month | Expected Google cost |
|---|---:|---:|
| Personal | 20–40 | **$0** |
| Heavy personal | 100–200 | **$0** |
| Small multi-user (100 × 8–12) | 800–1,200 | **$0** |
| Above the free cap | 6,000 | **$7** |
| Above the free cap | 10,000 | **$35** |

**Do not confuse the SKUs:**

- **Dynamic Maps** ($7/1,000, 10,000 free) is the ordinary 2D map load.
- **Photorealistic 3D Tiles** (1,000 free root tile requests, $6/1,000) is the
  raw Map Tiles product, not the 3D Maps JavaScript API.
- **Immersive Maps** is the 3D Maps SKU.

The production formula is:

```
monthly = max(0, S - 5,000) × $0.007 + fixed
  S = 3D map loads per month
  fixed = existing hosting, egress, monitoring (no new Google fixed fee)
```

**Guardrails (must ship with the feature):**

- Load the 3D map **only when the replay opens**; no preloading on the
  activities list.
- One map instance per open; dispose on close.
- Cache activity/story data; never refetch streams for a re-open.
- Per-user rate limit for map opens (e.g. 10/min) and a monthly cap.
- The **`no spend` spend-cap budget** is the hard cap; no API quota override is
  available. If the cap is hit, show the fallback, not an error page.

### 4.3 Terms checklist

- [ ] Google Maps Platform Terms of Service accepted for the project.
- [ ] 3D Maps product terms reviewed (channel/availability, attribution).
- [ ] Demo key removed from all production environments.
- [ ] Standard key restricted by HTTP referrer and API.
- [ ] No map-tile caching, scraping, offline storage or redistribution.
- [ ] Google attribution visible (the `Google Maps` logo/labels).
- [ ] EEA terms checked if the billing address is in the EEA.
- [ ] Privacy notice updated: activity/location data is sent to Google for map
      rendering; no additional third-party sharing.
- [ ] Strava API terms unchanged (the app already syncs activity data).

### 4.4 Never-spend cap (P0)

The no-spend guarantee is three layers:

1. **Spend-cap budget** on the billing account: the existing **`no spend`**
   budget is scoped to project `1001764393180` + `services/29E7-DA93-CA13`
   (Maps), amount **0 GBP**, thresholds 50/80/100%, and
   **`spendCap: CONFIGURED`**. It is the hard no-spend cap for the Maps
   service; Gemini/NextAuth are outside its scope. The 3D Map loads metric
   (`maps-backend.googleapis.com/3d_billable_default`) exists, but its
   consumer-quota `limits` endpoint returns 404, so no 100/day API quota
   override is available.
2. **Key restrictions**: `MapsKey` is restricted to
   `maps-backend.googleapis.com` + `tile.googleapis.com` and to HTTP referrers
   (production, dev, local). The browser key is public, but only usable from
   the app origins.
3. **App-side cap**: a server-side Redis counter per user/month (e.g. 500 map
   opens) and a fallback; the client refuses to mount the 3D map over the cap.
   A malicious client can bypass the client, but not the spend cap.

**Why not a dedicated project/kill switch:** the key lives in
`fitness-tracker-505713`; a billing kill switch would detach Gemini/NextAuth
too. The spend cap is scoped to the Maps service, so it cannot affect the rest
of FitTrack. If the key moves to a dedicated project later, add the kill switch
there.

**P0 test:** open the viewer; confirm the map renders, the key referrer works,
and Billing → Reports shows only free usage / **£0**; no charge. The spend-cap
budget is the hard cap. Full steps:
[`relive-3d-p0-runbook.md`](relive-3d-p0-runbook.md).

---

## 5. Architecture

### 5.1 Shape

```
Browser (Next.js client)
  Relive3D (new, behind flag)
    Google3DWorld (World adapter)
    StoryPanel
    GhostPicker
    Controls (presets, play, follow, speed, data)
    authFetch ──────────────┐
  Google Maps JS API 3D ────┼──> Google (tiles, map)
                            │
FastAPI ────────────────────┘
  GET /api/v1/activities/{id}/replay   (new aggregate; cached)
  GET /api/v1/routes/{id}/history      (existing)
  GET /api/v1/activities/{id}          (existing; ghost detail)
Postgres (activities/streams/routes) · Redis (cache)
```

- The **browser** loads the Google map directly; the backend does not proxy
  tiles.
- The map key is a **public browser key** in
  `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (or a viewer-specific env), restricted by
  referrer. It is not a backend secret.
- `authFetch` + React Query remain the data path; no new auth system.

### 5.2 Frontend components

| Component | Responsibility |
|---|---|
| `Relive3D` | Page/overlay shell; flag; deep links; error boundary. |
| `Google3DWorld` | Map lifecycle, route, markers, camera, presets, follow, `dispose`. |
| `StoryPanel` | SVG profile/sparklines, chapters, playhead, readout. |
| `GhostPicker` | Route history query, same-lap filter, PB, selection. |
| `useReplayData` | Activity replay query; loading/error; cache. |
| `WorldFallback` | Static poster/2D map + story when 3D fails. |

**Rules:**

- One `<canvas>`/map; the render loop is outside React; no per-frame React
  state.
- `Google3DWorld.mount()` waits for a steady map before adding children or
  setting the camera; the prototype’s readiness lesson.
- `dispose()` removes the map, listeners and RAF; React StrictMode must not
  create two maps.
- Keep the `World` interface so MapLibre/static remains a real fallback.

### 5.3 Backend replay endpoint

Add one aggregate endpoint to avoid a waterfall:

```
GET /api/v1/activities/{activity_id}/replay
→ {
    activity: { id, name, start_date, timezone, stats, weather },
    ride: {
      streams: { t, d, lat, lng, alt, v, hr, grade, watts?, cadence? },
      bounds, keyPoints, highlights
    },
    route: { id, name } | null
  }
```

- Reuse the existing stream normalizer (`buildReplay`/`replayDistanceAt` and the
  old data helpers) so the old and new viewers share one data contract.
- Decimate to **≤ 5,000 samples** for the map/story; keep enough for grade and
  highlight fidelity.
- Compute grade/highlights server-side and cache in Redis (activity id +
  updated_at). No new DB tables.
- Return 404/403 consistently; the viewer shows a fallback.

### 5.4 Data contracts

- `Ride` is the prototype schema: `streams`, `stats`, `weather`, `bounds`,
  `keyPoints`, `highlights`, `poseLabels?`.
- `RouteHistory` is the existing endpoint shape: `route_id`, `route_name`,
  `total_rides`, `personal_best`, `rides[]`.
- `GhostRide` = a `Ride` plus `activityId`, `date`, `duration`, `distance`,
  `isPersonalBest`.
- Time alignment: elapsed from each ride’s first sample; clamp at the end.
- Delta = `ghostDistance − riderDistance`; positive = ghost ahead. Show the
  sign and the date; colour is secondary.

### 5.5 Caching and performance

| Layer | Policy |
|---|---|
| Activity replay | React Query `staleTime` 10 min; Redis 24 h. |
| Route history | React Query 10 min; Redis 1 h. |
| Ghost detail | React Query 10 min; Redis 24 h. |
| Map tiles | Google’s cache only; do not cache/redistribute. |
| Map instance | One per open; dispose on close; no preload. |

**Budgets:**

- Map ready: < 5 s desktop, < 8 s mobile (reference hardware).
- Route decimation: ≤ 5k samples; no > 50 ms main-thread task during playback.
- Story SVG: one render on data load, not per frame.
- Memory: one WebGL context; no rider overlay in production.

---

## 6. UX and accessibility

### 6.1 Desktop

- Full-screen map; title card; story panel above the preset bar; telemetry.
- Presets `1–6`; `P` play; `F` follow; `D` data; `G` ghost.
- Seeks move the map; `?sync=0` data-only.
- Ghost picker: `Off`, same-lap rides with date and PB; delta in the telemetry.
- Error: “3D map unavailable” + poster + story; retry.

### 6.2 Mobile

- Map fills the viewport; story panel collapsible; presets horizontally
  scrollable; timeline above the safe area.
- Touch: drag/zoom/rotate; pinch; no hover-only affordances.
- Quality: cap DPR; `qualityMode`/memory budget; if the device is low-end or
  the map fails, use the static/2D fallback.
- Reduced motion: no tweens/auto-play; instant camera; the story still works.

### 6.3 Accessibility

The map is visual; the **data equivalent** is the story panel and a text
summary.

- Keyboard: all controls reachable; focus visible; timeline arrow keys.
- Screen reader: a summary of the ride (distance, time, climb, fastest km,
  ghost delta); the map is `aria-hidden` with a labelled description.
- No colour-only status: the ghost delta has `+`/`−` and words.
- Contrast: the panel/text on the photoreal map; the story panel has a solid
  background.
- Reduced motion honoured.
- The fallback is fully usable without WebGL.

### 6.4 First-look checkpoint

Before polishing, show the production component with the hero ride and the
Arthur’s Seat ghost to the user. The first look is about the world, story and
ghost, not the code.

---

## 7. Migration and rollout

### 7.1 Feature flag

- `RELIVE3D` (user setting or env) selects the new viewer.
- The old `ReplayTheater` remains the default until the flag is enabled.
- Deep links `?replay=`/`?t=` work in both; the new one adds `?ghost=`.
- Rollback: disable the flag; no data migration.

### 7.2 Feature parity

| Feature | Old Replay3D | New Relive3D | Plan |
|---|---|---|---|
| World | Procedural DEM/ribbon | Google 3D photoreal | Replace. |
| Route | Ribbon/draped | Google polyline | Replace. |
| Story | Profile, telemetry, highlights | Ported | Port. |
| Ghost | Real route history | Live picker (plan) | Port. |
| Tour/director | Yes | No | Phase 2; old viewer retained. |
| Export | Yes | No | Phase 2; old viewer retained. |
| Weather visuals | Yes | Title only | Phase 2. |
| Rider | 3D bike | Marker | Parked; accepted. |
| Deep links | `?replay=`,`?t=` | Same + `?ghost=` | Port. |
| Mobile/a11y | Partial | Gate | Must pass. |

### 7.3 Rollout stages

1. **Internal/personal**: flag on for the owner; compare old/new on the same
   rides; fix blockers.
2. **First look**: the user signs off the world/story/ghost.
3. **Default for the owner**: new viewer opens by default; old viewer remains
   reachable via a “classic” link for one release.
4. **Retire old world**: only after tour/export parity or an explicit decision
   to drop them; keep the old code until then.

No production DB migration is required; the new endpoint is additive.

---

## 8. Quality gate

### 8.1 Automated

- **Unit**: stream normalization, decimation, grade/highlights, same-lap
  filter, ghost time alignment, delta.
- **Integration**: replay endpoint (auth, 404, cache), route history, activity
  detail.
- **E2E (Playwright)**: six poses, story, ghost picker, fallback, deep links,
  mobile viewport, keyboard, reduced motion.
- **Visual**: contact sheet and story/ghost screenshots reviewed by the user.
- **Performance**: map-ready budget; long-task check; memory.
- **A11y**: axe on the panel/controls; screen-reader summary; contrast.

### 8.2 Manual

- 5-person evaluation: world, route, story, ghost, mobile.
- First-look checkpoint with the user.
- Error-path drill: invalid key, quota, offline, WebGL unavailable.
- Cost drill: spend cap and fallback.

### 8.3 Release criteria

- [ ] P0 key/budget/cap verified 2026-11-03; terms/audience pending; demo key retired.
- [ ] Replay endpoint returns a valid `Ride` for the hero and Arthur’s Seat.
- [ ] New viewer passes the six-pose/story/ghost QA; no uncaught errors.
- [ ] Fallback works with the 3D map blocked.
- [ ] Mobile and a11y gates pass.
- [ ] Performance budgets met on reference desktop/mobile.
- [ ] 5-person evaluation passes.
- [ ] Rollback flag tested.
- [ ] Spend cap verified; over-cap falls back; no charge.
- [ ] Cost is inside the approved ceiling.

---

## 9. Milestones

Estimates are relative; the user has unlimited time. Gates are quality, not
dates.

| Milestone | Deliverable | Gate |
|---|---|---|
| **P0 — Key, budget, terms** | Standard key in `fitness-tracker-505713` restricted to Maps APIs/referrers, **`no spend` spend-cap budget** (0 GBP, project + Maps service), app cap, terms, audience/scope. | Key/budget/cap verified 2026-11-03; map test passes; terms/audience pending. |
| **P1 — Replay data** | `GET /activities/{id}/replay`; typed contract; tests. **Done 2026-11-03**: service/schema/endpoint, 4 pure tests; server-side monthly map budget (2 tests); Redis cache keyed on `activity.updated_at` (2.5 s cold → 72 ms warm) with a cache-hit integration test; 31 integration tests pass against the compose test database (replay, `claim_map=0`, ghosts). | Hero + Arthur’s Seat fixtures match. |
| **P2 — Viewer shell** | New component behind flag; world, route, presets, timeline, story. **Started 2026-11-03**: `/dev/relive3d` React shell + Google 3D adapter; production API hook/adapter/page behind `NEXT_PUBLIC_RELIVE3D`; client + server map budget; attribution visible. **Camera fixed**: poses now drive the map's documented `center`/`range`/`tilt`/`heading` (the beta's `camera-position` attribute fights the stored `center`, which produced a 72 km range and a look-at 30 km below sea level — the “sometimes wrong framing”); overview now fits the ride's bounds instead of hard-coding a lake; fixture-id branching removed. Six-pose QA passes for both fixtures. | Six poses + story pass; no errors. |
| **P3 — Live ghost** | Route history, same-lap filter, PB, ghost detail, delta. **Done 2026-11-03**: `GET /activities/{id}/ghosts` (same `route_id`, newest first, 8 candidates, `reason` when empty, `pb_activity_id` = quickest ride on the route *including the current one* so the badge survives beating your own best); ghost replay fetched with `claim_map=0` so a ghost costs no map budget; production picker in the dock with a `PB` chip; `Ghost ±N m` delta tracks time. Verified end-to-end against the compose backend (7/7 checks, 6 integration tests). | Real ghosts; no synthetic; tests. |
| **P4 — Fallback, mobile, a11y, perf** | Static/2D fallback; responsive; axe; budgets. **Done 2026-11-03**: blocking `maps.googleapis.com` still renders the route poster with a “3D map unavailable — …” badge and working presets/data toggle (5/5 checks); iPhone-13 layout has no horizontal overflow, 38 px dock targets, and single scrollable rows for ghost/chapter chips (4/4 checks); telemetry/hint/budget pill are hidden on phones where they collided with the title card. Replay payload cached (2.5 s cold → 72 ms warm). Axe not run (not installed) — keyboard/labels reviewed by hand. | All gates pass. |
| **P5 — Rollout** | Flag on for owner; classic link; rollback. **Done 2026-11-03**: with `NEXT_PUBLIC_RELIVE3D=1` the `/replay` list opens the new viewer and keeps a per-card “Classic 3D” link to the old Theater; rollback is unsetting the flag (the page then shows “not enabled” and `/replay` reverts to the old links). **Landed 2026-11-04**: PR #339 → `main` (574972a) → `prod` (2a3f78b) → Deploy 41748232419 succeeded. Production verified with the saved owner session: map mounts on `oliradlett.co.uk` (so the key's referrer rules accept it), server budget badge reads `2/500`, story/presets render, `/replay` offers the new viewer (7/7 checks). `NEXT_PUBLIC_RELIVE3D=1` is a **repo variable** and the key a **repo secret** (`GOOGLE_MAPS_API_KEY`) — both are consumed as Docker build args, because Next inlines `NEXT_PUBLIC_*` at build time and a Droplet `.env` change would do nothing. | First look + 5-person. |
| **P6 — Tour/export/weather** | Decide and build, or keep old viewer. **Decided 2026-11-03**: keep the old viewer for tour/export — the new viewer is a single-ride experience and the old Theater already owns the tour/audio pipeline; weather stays as the title-card line (no new weather UI). | Scope decision. |

---

## 10. Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Google 3D Maps API (beta channel) instability (`keys`/`get`, “Oops”) | Medium | High | Readiness gate, error boundary, fallback, flag, monitoring. |
| Demo-key quota / cost overrun | High (observed) | High | Standard key, spend cap, app cap, lazy load, fallback. |
| Terms/attribution non-compliance | Low–Medium | High | P0 legal/terms review; key restrictions; no tile caching. |
| Mobile GPU/heat/low-end | Medium | Medium | Quality mode, DPR cap, static/2D fallback, test devices. |
| Old viewer parity (tour/export) | High | Medium | Keep old viewer; phase 2; explicit scope. |
| Ghost fairness/route matching | Medium | Medium | Same-lap filter, PB, test with real route history. |
| Rider expectation | Medium | Low | Marker; rider parked; documented. |
| Privacy/location data | Low | Medium | Privacy notice; no extra sharing; auth. |
| EEA terms differ | Low | Medium | Check at P0. |
| Key leakage | Low | Medium | Referrer/API restrictions; no secret in repo; monitor. |

---

## 11. Open questions (P0)

1. **Audience**: personal single-user first, or multi-user from day one?
2. **Budget**: the **`no spend` spend-cap budget** (0 GBP, project + Maps
   service) is configured; is that cap acceptable?
3. **Key**: the standard key is created and restricted in
   `fitness-tracker-505713`; is keeping it there acceptable, or should it move
   to a dedicated project so a billing kill switch can be added?
4. **Quota**: the 3D Map loads metric has no consumer-quota limits endpoint, so
   no 100/day API quota exists. Is the app-side **500 opens/month** cap enough
   alongside the spend cap?
5. **Beta**: is a beta Google 3D dependency acceptable, given the fallback?
6. **Scope**: is tour/export required in the first release, or can the old
   viewer keep them?
7. **Mobile**: is mobile a first-release target or a follow-up?
8. **Rider**: keep the marker for production, or revisit the 3D bike after
   launch?
9. **Data retention/privacy**: any change needed for location/map data?

---

## Appendix A — Prototype evidence

- Six-pose contact sheet:
  `prototype/relive/qa/out/contact-sheet-google3d.png` (not committed)
- Story panel:
  `prototype/relive/qa/out/google3d-story.png` (not committed)
- Real Arthur’s Seat ghost:
  `prototype/relive/qa/out/arthurs-ghost.png` (not committed)
- Production picker:
  `prototype/relive/qa/out/arthurs-ghost-picker.png` (not committed)
- Prototype QA: 11/11 Playwright tests at the last full run; typecheck clean.
- Rider lab: [`prototype/relive/rider-studio.html`](../prototype/relive/rider-studio.html)
  (parked; no production surface).

## Appendix B — References

- Google Maps Platform pricing: <https://mapsplatform.google.com/pricing/>
- Google 3D Maps product: <https://mapsplatform.google.com/maps-products/3d-maps/>
- Maps Demo Key: <https://mapsplatform.google.com/maps-demo-key/>
- Maps JavaScript API 3D overview:
  <https://developers.google.com/maps/documentation/javascript/3d/overview>
- Old viewer: `frontend/src/components/activities/Replay3D.tsx`,
  `ReplayTheater.tsx`, `frontend/src/lib/replay.ts`, `frontend/src/lib/bike.ts`.
- Route history endpoint: `backend/app/api/routes.py` (`GET /{route_id}/history`).
- Existing frontend data path: `authFetch` + React Query.
