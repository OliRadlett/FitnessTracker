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
- Tests: `tests/test_route_preview_polyline.py` (6 unit) and two integration
  cases in `tests/integration/test_routes_api.py` (list carries it, detail keeps
  the full polyline).

### Frontend

- `/routes` is now **Browse / Maintain** (`?mode=maintain`).
  - Browse: `AtlasMap` (every route a line; hover focus; selection fly-to;
    compare amber; optional heatmap) + `RouteList` (shape, distance, climb,
    est. time, ridden, provider chain) + `RouteDetail` (one scroll, deep tools
    behind a disclosure) + `FacetBar` (desktop inline, mobile chip sheet).
  - Maintain: duplicate review **on demand**, merged routes, unusable geometry,
    sport mismatch, collections. `GET /routes/duplicates` is never auto-called:
    the scan runs full geometry in the request and can take minutes.
  - Header: mode, Compare, Collections drawer, Heatmap, GPX, Sync; mobile folds
    the secondary actions into a sheet.
- `lib/routeAtlas.ts`: pure projection, elevation (both stored shapes), hub,
  nearest sort, facet→query mapping, formatting. 15 unit tests.
- `RouteSummary`/`RouteData` types: `preview_polyline`, and
  `elevation_profile` now admits **both** `{elevations}` and
  `{distance, elevation}`.
- Deleted: `RoutesListView`, `RoutesGridView`, `RoutesMapView`,
  `RouteFilterBar`, `RouteDetailPanel`, `MobileRouteDetailSheet`,
  `QualityBadge` (only those files used it) and its unit test.
  `Route3D`, weather, effort, segments, merged view, similar routes and compare
  are kept and reachable.
- E2E: `routes.spec.ts` rewritten for the atlas (16 tests), `routes-organize`
  updated for the drawer (4), mocks gained real preview polylines and a route
  history endpoint.

## Known gaps (deliberate)

| Gap | Why it is not in this change |
|---|---|
| Duplicate scan still runs in the request | Needs a Celery/Modal job writing `route_similarity` + a poll/202 API. Tracked below. |
| Quality / terrain / surface still absent | 0/86 rows; the new page does not render controls for them. Fix the producers or leave them hidden. |
| List is capped at 200 routes | Above that, the map cannot draw the library. Pagination or a bbox-limited map is the next step. |
| Facet/tag/collection state is not in the URL | Mode + route are; filters are session state. Worth adding when the URL-state pattern is settled. |
| Map style is a CSS invert of keyless OSM | A keyed dark basemap is a vendor decision, not a code one. |

## Follow-ups

1. Async duplicate pipeline → `route_similarity` + `GET /routes/duplicates`
   returns `generated_at` (or 202), with a bounded scan and a timeout.
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
python -m pytest tests/test_route_preview_polyline.py -q
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
