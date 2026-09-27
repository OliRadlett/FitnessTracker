# Route Matching Phase 2 — OSM Road-Graph Map-Matching + Route Embeddings

> Status: implemented (2026-09-27) on `feature/route-matching-phase2`.
> OSM data must be bootstrapped once (`python -m app.scripts.osm_bootstrap`) —
> until then `map_match_routes` is a no-op and matching stays Phase-1 geometric.
> Builds on Phase 1 (`plans/route-merging-overhaul.md`): the pure geometric
> engine, non-destructive merges, and the weekly Modal similarity graph.

## 1. Goal

Phase 1 matches routes by geometry (coverage + Fréchet + endpoint). Phase 2 adds
a **road-graph layer** and a **route embedding**, so matching is anchored to the
actual road network rather than GPS traces:

- **Map-match** each route's polyline to OSM road edges (a *road signature*).
- Compare routes by **edge-set Jaccard** — direction/lap/detour robust and
  resistant to GPS noise and re-snapping.
- Derive a fixed-length **route embedding** and a **learned metric** trained
  self-supervised on the merge decisions the app accumulates (`route_merge_log`
  + auto-tier `route_similarity` pairs).

The road signature is also a **platform feature**: it powers "roads shared by
these routes", road-name coverage, and a candidate ranker for the review queue.

## 2. Why it beats pure geometry

| Case | Geometry (Phase 1) | Road signature |
|---|---|---|
| 3 laps vs 5 laps | ok (Fréchet rescale) | **exact** (same edge set) |
| Start offset / re-snap | ok | **exact** |
| Town detour | ok (coverage) | **exact** (shared edges) |
| Parallel road 300 m away | borderline | **distinct edges** |
| Sub-section | gated by coverage | low Jaccard |
| Different GPS noise | sensitive | **stable** |

## 3. Architecture

```
route polylines ─┐
                 ▼
        Modal: OSM PBF (Geofabrik, cached in a Modal Volume)
                 │  pyosmium → bbox subgraph (nodes, edges, names)
                 ▼
    road_graph.snap_polyline()  →  {edges, edge_set, coverage, names}
                 │
                 ├── Route.road_match (JSONB)   ← persisted weekly
                 ▼
    route_embedding.build_features() → f
    route_embedding.embed(f, learned_weights) → vector
                 │
                 ▼
    Route.road_embedding (JSONB)
                 │
                 ▼
    recompute_route_similarity: score_route_pair(..., road_jaccard=…) + embedding cosine
```

- `backend/app/services/road_graph.py` — pure stdlib: graph build, grid index,
  nearest-edge snapping with a light continuity filter, edge Jaccard. Runs
  locally and in Modal.
- `backend/app/services/route_embedding.py` — pure stdlib: feature vector,
  cosine, and a self-supervised contrastive metric (`train_metric`).
- `backend/app/integrations/route_road_graph.py` — Modal worker + Volume
  (pyosmium) with graceful fallback (`{}` when Modal/OSM unconfigured).
- `backend/app/tasks/scheduler.py` — new weekly `map_match_routes` (Sun 02:50 UTC,
  before `recompute_route_similarity`); the similarity task consumes the stored
  signatures.

## 4. Data / migration 080

Add to `routes` (nullable JSONB — no backfill needed):

- `road_match` — `{version, region, coverage, edges: [key…], names: [name…], matched_at}`
- `road_embedding` — `{version, vector: [float…], trained_version}`
- `road_match_version` — integer, bumped to invalidate stale matches

## 5. Matching integration (non-breaking)

`route_matching.score_route_pair(..., road_jaccard=None)`: when a road Jaccard is
supplied (both routes map-matched), the composite becomes
`0.7 × geometric + 0.3 × road_jaccard`; the value is recorded in the
`ScoreBreakdown`. Callers that pass nothing are unchanged (Phase-1 behaviour).

## 6. Config

`road_match_enabled`, `osm_region` (Geofabrik slug, default `great-britain`),
`osm_volume_name`, `road_match_search_radius_m`, `road_match_max_snap_m`,
`road_match_version`.

## 7. Testing

- `road_graph`: snap onto a synthetic grid graph (coverage, edge set, parallel
  roads, sub-section Jaccard, detour).
- `route_embedding`: feature determinism, cosine, learned metric improves
  positive-vs-negative separation on synthetic pairs.
- Modal worker modules import without `app.config`/pydantic (AGENTS pitfall #33).

## 8. Out of scope

- Real-time navigation-grade HMM (order-aware Viterbi) — the edge *set* is
  sufficient for matching; ordered matching can come later.
- Per-country OSM bootstrap is manual (`python -m app.scripts.osm_bootstrap`).
