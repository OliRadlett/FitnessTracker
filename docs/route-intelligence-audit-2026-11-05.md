# Route intelligence audit — quality, terrain, surface

**Date:** 2026-11-05 · **Scope:** the three route intelligence fields the Routes
atlas hides, plus the OSM path behind them · **Data:** local production-shaped
DB, 1 user, 86 routes, 118 provider sources · **Owner:** feature lead.

## TL;DR

- **Terrain and quality were not broken — they were never run.** Both are
  weekly-only jobs (`classify_route_terrain` Saturday 02:30,
  `compute_route_quality_scores` Sunday 03:00) with no on-sync or on-demand
  bulk trigger. The stack in this environment had been up < 1 day, so neither
  had executed. Running them locally classified **50/50 eligible routes** and
  scored **86/86 routes**.
- **Surface was broken — a parser bug, not missing data.** Komoot payloads
  already stored `summary.surfaces` as a list of
  `{"type": "sb#asphalt", "amount": 1.0}`. The ingestion path only accepted a
  dict, and the parser read `percentage/share/value` and kept the `sb#` prefix,
  so every tour returned `None`. Fixing the parser and backfilling from the
  stored payloads took surface from **0/86 → 50/86** with no API calls.
- **`quality_score` is not a route-quality measure.** It is a data-richness
  score: completeness (25%) + surface (20%) + terrain (15%) are all "do we have
  metadata", popularity is 15%, effort match 25%. Komoot-sourced routes score
  **70.6** vs **45.4** for Strava-only routes, even though the Komoot group is
  *less ridden* (popularity 5.1 vs 13.1). Do not present it as "quality".
- **OSM map tiles are fine in production.** The OSM **road-graph map-matching**
  is a separate, optional pipeline: `road_match` is 0/86, and the road graph
  does not retain `surface` tags, so OSM cannot supply surface today even if
  matching ran.

## The systems

| | Quality | Terrain | Surface |
|---|---|---|---|
| Stored in | `route_quality` + `routes.quality_score` | `routes.terrain_classification` | `routes.surface_profile` |
| Producer | `compute_route_quality_scores` (weekly) | `classify_route_terrain` (weekly) | Komoot sync + backfill pass |
| Schedule | Sunday 03:00 | Saturday 02:30 | on each Komoot sync |
| On route sync/import | **no** | **no** | yes (as of this change) |
| On demand | `POST /routes/quality/recompute` (all) | `POST /routes/{id}/classify-terrain` (one) | none |
| Needs | profile, surface, ride stats, FTP | elevation profile + polyline | a Komoot source |
| Read by | quality badge/filter/sort, collections rules | terrain filter, collections rules, quality | surface filter, quality, effort estimate |

## Baseline (86 routes)

| Field | Rows | Note |
|---|---|---|
| `surface_profile` | **0** | JSON `null` on 70, SQL `NULL` on 16 |
| `terrain_classification` | **0** | SQL `NULL` |
| `quality_score` / `route_quality` | **0** | table empty |
| elevation profile (real) | 50 | 31 × `{elevations}`, 19 × `{distance,elevation}` |
| Komoot sources | 50 | 36 routes are Strava-only |
| `road_match` | **0** | OSM map-matching never produced a row |

## Root causes

### 1. Weekly-only execution, no refresh after data changes

Both jobs run once a week and only touch rows that need work. Nothing
recomputes after a route sync, an import, a merge, or a profile backfill. A
fresh deployment, a paused stack, or a missed window leaves the fields empty
indefinitely — and the UI then renders no badges rather than "not computed".

### 2. Surface parser mismatch (the important one)

Stored Komoot payload:

```json
{"summary": {"surfaces": [
  {"type": "sb#compacted", "amount": 0.0025},
  {"type": "sb#paved",     "amount": 0.2390},
  {"type": "sb#asphalt",   "amount": 0.7586}
]}}
```

- Ingestion required `summary.surfaces` to be a **dict** → the list was skipped.
- `_extract_surface_profile` read `percentage | share | value`, not `amount`
  → even the API fallback produced `0.0` values.
- Types kept the Komoot prefix (`sb#asphalt`) and were never mapped to the
  app's vocabulary (`paved`, `compacted_gravel`, …), so filters and the quality
  surface ranking could not match them.

Fix (in `services/komoot.py`): accept list/dict/summary shapes, read `amount`,
strip `sb#`/`sf#`, skip `wt#` (way type) and `sf#unknown`, map aliases
(`asphalt→paved`, `compacted→compacted_gravel`, `cobbles→cobblestone`, …), and
normalise to fractions summing to 1. The sync backfill now reads the stored
payload before calling the API, so existing rows self-heal on the next sync.
Six unit tests pin the real payload shape (`tests/test_komoot_surface.py`).

### 3. Terrain is capped by who supplied the geometry

The classifier is pure and handles both profile shapes, but it needs an
elevation profile. Only Komoot writes one; Strava route sync stores
`elevation_gain_meters` only (no profile). Ceiling today: **50/86**. The other
36 routes cannot be classified until a profile exists (Strava route detail or
server-side DEM sampling).

### 4. Quality measures metadata, not the ride

Weights: completeness 0.25, surface_quality 0.20, terrain_quality 0.15,
popularity 0.15, effort_match 0.25.

- **60% is "do we have data"** (completeness + surface + terrain).
- **Surface quality is a paved-vs-technical preference**, not a quality signal.
- **Popularity is always counted**, so an unridden route is capped at 85 and
  typically loses ~13 points. Removing it raises the mean by **9.6 points**
  (60.1 → 69.7) and the range from 42–81 to 49–92.
- When terrain is missing the weights renormalise silently — correct
  arithmetic, but it hides that 36 routes are scored on fewer components.

### 5. OSM road matching is unconfigured, and the graph has no surface tags

- `road_match_enabled` defaults to true, but the weekly task needs Modal plus a
  `great-britain` OSM graph built into the `fittrack-osm` volume
  (`scripts/osm_bootstrap.py --build`). Without both it is a graceful no-op →
  0/86.
- Even when it runs, `RoadEdge` keeps way id/geometry only. `surface` is an OSM
  way tag that is not retained, so matching cannot produce `surface_profile`.
  OSM-derived surface is a feature, not a switch.

## Measured after running the pipelines locally

### Surface — 50/86 (all Komoot routes)

```
paved 0.86 + cobblestone 0.02 + unpaved 0.05 + compacted_gravel 0.08
paved 0.996 + cobblestone 0.004
… 50 routes, every Komoot source
```

`unpaved` and `alpin` are Komoot keys outside the current filter vocabulary;
they are kept as-is rather than mislabelled. `cobbles` is mapped to
`cobblestone`. The backfill re-extracts **every** Komoot route (not only null
ones), so a vocabulary change normalises existing rows too.

### Terrain — 50/50 eligible

| terrain_type | routes |
|---|---|
| rolling | 21 |
| mountainous | 16 |
| flat | 11 |
| hilly | 2 |

Average terrain component: **80.2**. No `unknown` results were persisted (by
design, so they retry).

### Quality — 86/86

| Metric | Value |
|---|---|
| mean / median | 60.1 / 64.95 |
| range | 42.1 – 81.3 |
| completeness | 65.3 |
| popularity | **8.5** |
| surface | 76.9 |
| effort match | 69.0 |
| terrain (n=50) | 80.2 |

| Group | n | overall | completeness | popularity | surface | terrain |
|---|---|---|---|---|---|---|
| Komoot-sourced | 50 | **70.6** | 83.6 | 5.1 | 96.2 | 80.2 |
| Strava-only | 36 | **45.4** | 40.0 | 13.1 | 50.0 (neutral) | — |

The "best" routes are unnamed Komoot imports with complete metadata; the
user's actually-ridden Strava routes score lower. That is the score working as
designed, and the design measuring the wrong thing.

## OSM clarification

- **Map tiles:** the atlas uses keyless OSM (`lib/mapTiles`), attributed and
  loaded over HTTPS. Production works; no key or vendor is required. The dark
  look is a client-side CSS invert of the tile pane, not a dependency.
- **Road graph:** optional Modal/OSM infrastructure for matching and
  embeddings. It is not needed for the map, and it is currently dark (0/86).
- **Surface from OSM:** would need the graph to retain `surface` tags and an
  aggregation step over matched ways — a new feature, not a repair.

## Recommendations (ordered)

1. **Ship the surface parser fix + payload backfill** (in this branch). Verify
   on the next Komoot sync; the backfill pass fills every existing route.
2. **Add an on-sync refresh.** After route sync/import/merge, enqueue one
   `refresh_route_intelligence(user)` job that runs terrain → quality. Keep the
   weekly jobs as a backstop. Today a new route can sit unclassified for a week.
3. **Stop calling `quality_score` "quality".** Either:
   - rename it to **data completeness** and show it as such (it honestly is
     that), or
   - redesign the score: drop popularity, treat surface/terrain as neutral
     characteristics, and add route-character signals (climb density, surface
     mix, loop/point) — then it can mean "how well does this match what I want".
   - the atlas already shows the raw facts; showing a composite score that
     rewards metadata is worse than showing none.
4. **Fill Strava elevation profiles** (route detail or DEM sampling) so terrain
   can cover more than the Komoot half.
5. **Backfill jobs for all users**, not just this account: surface from stored
   payloads, terrain for eligible routes, quality afterwards — one idempotent
   task each, safe to re-run.
6. **OSM surface (optional):** extend the road graph to keep `surface` (and
   `highway`) tags, aggregate by matched distance, and only then use it as a
   fallback for non-Komoot routes.

## Evidence

| What | Where |
|---|---|
| Real payload probe (surface keys) | `prototype/routes/qa/_komoot_probe.py` |
| Surface backfill (stored payloads) | `prototype/routes/qa/backfill_surface.py` |
| Terrain run (local classifier) | `prototype/routes/qa/classify_terrain.py` |
| Quality summary / counterfactual / source split | `prototype/routes/qa/quality_summary.py`, `quality_counterfactual.py`, `quality_groups.py` |
| Parser tests | `backend/tests/test_komoot_surface.py` |
