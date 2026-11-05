# Routes atlas — production change (2026-11-05)

Status: **implemented on the feature branch; not merged.** Supersedes the IA in
[`routes-redesign.md`](routes-redesign.md) (which stays as the historical plan).

## Why

The old page was a CRUD console: 100 % chrome above the first route on mobile,
a map with pins and no lines, 7 tabs in a 243 px strip, and intelligence
(quality/terrain/surface/segments) with **0/86 rows** behind it. The evidence,
baseline frames and the lab that proved the replacement live in
[`prototype/routes/`](../prototype/routes/README.md).

## What shipped

### Backend

- `RouteSummary.preview_polyline: str | None` — a **display-only** decimated
  shape (~90 points). Additive, optional; the full `encoded_polyline` stays on
  `GET /routes/{id}` and is the only source for GPX/3D/matching.
- `polyline_utils.preview_polyline()` — uniform resample, endpoints preserved,
  never raises (one corrupt row cannot fail a list).
- The list endpoint populates the field per row.
- **Duplicate scanning moved off the request path.** The flow now lives in
  `services/route_similarity.py` (shared by the weekly task and a new
  on-demand Celery task):
  - `POST /routes/duplicates/refresh` → queues `recompute_user_route_similarity`
    (202; `running` if a scan holds the lock).
  - `GET /routes/duplicates/status` → `never | queued | running | ready | failed`
    plus `started_at`/`finished_at`/`pairs`, backed by Redis with a
    `route_similarity` row-count fallback.
  - `GET /routes/duplicates` **never scans**. It returns the cached pairs and
    adds `X-Scan-Status` / `X-Scan-Generated-At`, so "not scanned" is
    distinguishable from "no duplicates".
  - A Redis lock prevents stacking scans; auto-merge stays gated off.
- Tests: 7 unit (`preview_polyline`, scan-state hash decoding, auto-merge
  gate) and 6 integration cases (list preview, detail full polyline, cached
  queue, no-scan-on-read, status `never`, refresh queues).

### Frontend

- `/routes` is now **Browse / Maintain** (`?mode=maintain`).
  - Browse: `AtlasMap` (every route a line; hover focus; selection fly-to;
    compare amber; optional heatmap) + `RouteList` (shape, distance, climb,
    est. time, ridden, provider chain) + `RouteDetail` (one scroll, deep tools
    behind a disclosure) + `FacetBar` (desktop inline, mobile chip sheet).
  - Maintain: duplicate review, merged routes, unusable geometry, sport
    mismatch, collections. The scan is queued as a background task; the panel
    polls its state and only a finished scan mounts the review queue.
  - Header: mode, Compare, Collections drawer, Heatmap, GPX, Sync; mobile folds
    the secondary actions into a sheet.
  - Every primary control is a **44 px** target (mode switch, search, facets,
    header actions, sheet actions, detail actions) — the lab's 40 px controls
    were bumped before landing.
  - `e2e/routes-mobile.spec.ts` locks the phone contract at 390×844: first route
    visible without scrolling, no page scroll, filters/detail/actions as sheets.
  - Maintain shows the scan state (queued / running / ready / failed), polls
    while it runs, and mounts the review queue only when a scan has finished.
    "Never scanned" and "no duplicates" are different states.
- `lib/routeAtlas.ts`: pure projection, elevation (both stored shapes), hub,
  nearest sort, facet→query mapping, URL param round-trip, formatting. 18 unit
  tests. Facets + sort are **URL state** (`?q=&dist=&climb=&status=&shape=&sport=&sort=`)
  and are written with `replaceState` so they share and survive a refresh
  without clobbering `?route=`/`?mode=`.
- `RouteSummary`/`RouteData` types: `preview_polyline`, and
  `elevation_profile` now admits **both** `{elevations}` and
  `{distance, elevation}`.
- Deleted: `RoutesListView`, `RoutesGridView`, `RoutesMapView`,
  `RouteFilterBar`, `RouteDetailPanel`, `MobileRouteDetailSheet`,
  `QualityBadge` (only those files used it) and its unit test.
  `Route3D`, weather, effort, segments, merged view, similar routes and compare
  are kept and reachable.
- E2E: `routes.spec.ts` rewritten for the atlas (18 tests, including the scan
  states), `routes-organize` updated for the drawer (4), mocks gained real
  preview polylines, a route-history endpoint and scan-state responses.

## Known gaps (deliberate)

| Gap | Why it is not in this change |
|---|---|
| Duplicate scan is still CPU-bound | It now runs in a worker (~15–20 min for 86 routes), not a request. Shortening it needs a validated decimated matcher; not worth changing thresholds blind. |
| Quality / terrain / surface still absent | 0/86 rows; the new page does not render controls for them. Fix the producers or leave them hidden. |
| List is capped at 200 routes | Above that, the map cannot draw the library. Pagination or a bbox-limited map is the next step. |
| Facet/tag/collection state | Facets + sort are in the URL; tag/collection selection still lives only in the Zustand store (a tag is multi-select, so it needs a delimited param before it is shareable). |
| Map style is a CSS invert of keyless OSM | A keyed dark basemap is a vendor decision, not a code one. |

## Follow-ups

1. Duplicate scan: shorten the matcher (validate a decimated scoring path), then
   reduce the 4 s poll interval if the run drops under a minute.
2. Quality/terrain producers: run for every route on sync, expose
   `computed_at`, and only then reintroduce badges/filters (with a “not scored”
   state).
3. >200 routes: paginate the list and clip the map to the visible page or a bbox.
4. Reduce the 3D detail's bundle: it is behind a disclosure, but confirm it is
   still lazy in the production build.
5. Consider deleting the dev lab (`/dev/routes-lab`) and its fixture once the
   branch is merged.

## Verification

```powershell
cd backend
python -m pytest tests/test_route_preview_polyline.py tests/test_route_scan_state.py tests/test_auto_merge_gated.py -q
python -m pytest tests/integration/test_routes_api.py -q
cd ../frontend
npx tsc --noEmit
npx vitest run src/__tests__/route-atlas.test.ts
$env:PLAYWRIGHT_BASE_URL='http://localhost:3000/fittrack'
npx playwright test e2e/routes.spec.ts e2e/routes-organize.spec.ts
```

Screenshots against the real API: `prototype/routes/qa/prod/`.

## Rollback

Revert the frontend commit; the backend field is additive and can stay (it is
ignored by the old page).
