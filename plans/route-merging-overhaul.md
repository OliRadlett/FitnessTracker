# Route Merging Overhaul — Modal-Assisted Route Matching

> Status: **Phase 1a + 1b implemented** (2026-09-26) — pure engine + tests,
> config tiers, non-destructive merge + merge log + undo, Modal similarity
> graph + weekly Celery task, cache-backed duplicates/undo/similar APIs,
> review-queue UX. Rebased onto `main` (migration **079**). Pending: Phase-2
> road snapping / embeddings.
> Scope: replace the fragile 50-point shape sampler, make merges non-destructive,
> and add a Modal-backed matcher that runs on the ambiguous cases.

## 1. Problem

Route dedup is the single weakest part of the route pipeline:

- `route_service.find_duplicate_route()` (`backend/app/services/route_service.py:185`)
  scores `proximity ×0.20 + distance ×0.20 + name ×0.10 + shape ×0.50`.
- `shape ×0.50` is `polyline_utils.shape_similarity()` (`:179`): 50 evenly-spaced
  points compared **index-aligned** (sample[i] vs sample[i]) by average Haversine.
  It is direction-sensitive, start-offset-fragile, and cannot see lap-count
  differences (3 laps vs 5 laps of the same circuit) or small town detours.
- The Modal "route intelligence" worker (`backend/app/integrations/route_intelligence.py`)
  already contains a Fréchet matcher, terrain classifier, effort predictor and a
  similarity graph — but the only caller passes `compute_similarity=False`, so the
  matcher is dead code (audit RMI-06). `compute_frechet_score` is also broken
  (`range(a)` — RMI-05).
- `merge_routes()` (`route_service.py:576`) only moves `RouteSource` rows and deletes
  the duplicate. Because of FK rules this **silently unlinks activities and training
  plan days** (`ON DELETE SET NULL`) and **destroys tags, collections, segments and
  quality** (`ON DELETE CASCADE`).

## 2. Locked decisions

| Decision | Choice |
|---|---|
| Scope | Route↔route dedup **and** activity→route linking (one shared engine) |
| Execution model | **Hybrid** — cheap local candidate pre-filter at sync; Modal batch-scores the uncertain band; local fallback when Modal is unset/down |
| Tolerance | Near-identical, start-point offset, same broad route (minor town detours, **lap-count differences**) |
| Direction | **Direction-sensitive everywhere** — reversed routes never merge and reversed rides never link |
| Auto-merge | Auto-merge high confidence; everything else → review queue |
| Merge semantics | **Non-destructive** — remap activities/plan days, union tags/collections, move segments/quality, merge-log for undo |
| Matching tech | Geometric first; learned embeddings **Phase 2** |
| Road snapping | Platform feature (routes + merges) → **Phase 2** |
| Similarity surface | Lightweight read-only "Similar routes" in `RouteDetailPanel` + route-diversity insight |

## 3. Matching algorithm

New pure module `backend/app/services/route_matching.py` (stdlib only — no numpy, no
DB, no FastAPI, importable inside the bare Modal image). One engine, two consumers.

Per pair:

1. **Simplify + resample** — decode polylines, drop stationary GPS jitter
   (points < 3 m from the previous), Douglas–Peucker at ~5 m, then resample by
   cumulative distance to `N` points (default 120). Scale/point-density invariant.
2. **Discrete Fréchet** `frechet(A, B)`. Discrete Fréchet's monotone coupling can
   rescale one sequence onto the other, so it *naturally* handles **lap-count
   differences** (3 laps ↔ 5 laps) and tolerates short detours, while remaining
   order- and direction-sensitive.
3. **Direction check** — compute `frechet(A, B_reversed)`. If the reversed distance
   is materially smaller (`< REVERSED_RATIO × forward`), the route is reversed →
   score 0 (direction-sensitive by decision).
4. **Symmetric coverage** — fraction of A's resampled points within
   `tol = max(25 m, 0.6 × spacing)` of any B point, and vice versa. `min(cov_ab, cov_ba)`
   rejects **sub-sections** (a 20 km route inside a 100 km route covers one way but
   not the other) while accepting laps and town detours (both fully covered).
5. **Endpoint proximity** — loop-aware start/end Haversine (cheap; also used by the
   local pre-filter).
6. **Composite** `0.45 × min_cov + 0.40 × frechet_sim + 0.15 × endpoint`, gated to
   0 when reversed, when `min_cov < 0.55`, or when coverage/coupling is degenerate.
   Returns a `ScoreBreakdown` (every component + `reversed` + `lap_ratio` →
   `min_approx` for each metric) for explainability and the review queue.

Tiers (new config keys, `config.py`):

- `route_match_auto_threshold` (~0.82) → auto-merge
- `route_match_threshold` (0.55, existing) → review floor
- `route_match_gate` (~0.45) → below this, no candidate at all

**Local pre-filter** (sync time, no Modal): bounding box + length-ratio band +
endpoint proximity. Clear-no → discard; clear-yes → auto-merge; uncertain band →
collect for one batched Modal call per sync run.

## 4. Modal integration

Extend `backend/app/integrations/route_intelligence.py`:

- Fix `_compute_frechet_distance` `range(a)` → `range(len(a))` (RMI-05).
- New public `score_route_pairs_on_modal(pairs) -> {pair_key: ScoreBreakdown}`
  and `compute_route_similarity_graph_on_modal(routes) -> graph`.
- **Chunking + failure short-circuit** (RMI-13): score/graph in bounded chunks;
  stop after N consecutive Modal failures; fall back to local scoring.
- Fix elevation-schema parity so Komoot `{"elevations"}` classifies (RMI-04).
- Keep the worker module-global and stdlib-only at module scope (AGENTS pitfalls
  #33/#34). Any new module it imports must be added to the Modal image mount list
  in `app/integrations/modal_client.py::_get_modal_image`.

## 5. Non-destructive merge

Rewrite `route_service.merge_routes()`:

1. Move `RouteSource` rows.
2. `UPDATE activities SET route_id = primary` (currently `SET NULL`).
3. `UPDATE training_plan_days SET planned_route_id = primary` (currently `SET NULL`).
4. Union `route_taggings` / `route_collection_items` (skip PK collisions).
5. Move `segments` (skip `(route_id, start_dist_m, end_dist_m)` collisions; weekly
   `recompute_ride_segments` rebuilds).
6. Reassign/replace `RouteQuality`; `is_favorite = A or B`; `quality_score = max`;
   reset `terrain_classification` / `predicted_effort` to force recompute (RMI-10).
7. Keep the higher-fidelity polyline/elevation profile.
8. Write a `RouteMergeLog` row (snapshot + moved child ids) so the merge is undoable.
9. Guard with a Redis `redis_lock`; re-check the duplicate still exists.

## 6. Schema / migrations

Migration **`079`** (`down_revision = "078"`, the Wahoo-push revision).
Upstream 074-078 already landed Pmax, activity-weather columns,
route_sources user-scoping, the `predicted_effort` drop and Wahoo push, so
this revision only adds the two new tables.

- `route_merge_log` — `id`, `user_id`, `primary_route_id`, `merged_route_id`,
  `score`, `breakdown` JSONB, `snapshot` JSONB, `moved` JSONB, `created_at`,
  `undone_at`.
- `route_similarity` — cached pairwise scores for the duplicates page and
  "Similar routes" (avoids the current synchronous O(n²) scan).
- User-scope `RouteSource` identity — add `user_id` + unique
  `(user_id, provider, provider_route_id)` (RMI-09).

## 7. Trigger points & tasks

- **Sync** (`strava/sync.py`, `komoot.py`, `wahoo.py`, `api/routes.py` upload):
  local pre-filter; batch uncertain pairs to Modal once per run.
- **New weekly Celery task** `recompute_route_similarity` — full Modal similarity
  graph per user → upsert `route_similarity`; auto-merge high confidence.
- **`backfill_activity_route_links`** — reuse the engine, batched through Modal.
- `GET /routes/duplicates` becomes **cache-backed** instead of the synchronous
  O(n²) sweep.

## 8. API & frontend

- `DuplicatePair` gains `breakdown` + `recommendation` (`auto` / `review`).
- `POST /routes/merge` returns the merge-log id; new
  `POST /routes/merge/{log_id}/undo`.
- `GET /routes/{id}/similar`.
- Review queue (`frontend/src/app/(app)/routes/duplicates/page.tsx`): show *why*
  (coverage / Fréchet / reversed / lap ratio), tiered auto-merge, per-pair merge,
  and undo (replacing the localStorage "dismiss").
- `RouteDetailPanel`: small "Similar routes" block.

## 9. Testing

- `backend/tests/test_route_matching.py`: near-identical → auto; start-offset →
  auto; 3-lap vs 5-lap circuit → match; town detour → match; reversed → **no match**;
  sub-section → no match; different roads → no match; GPS-jitter robustness.
- Merge test: activities/plan days remapped, tags/collections unioned, segments
  moved, undo restores.
- `tests/test_modal_workers.py`: worker modules import without `app.config`/pydantic;
  Fréchet regression (identical → 1.0).
- Verify migration up/down; `ruff check`; run frontend `vitest` + `tsc` for UI.

## 10. Phasing

- **Phase 1a (done)**: pure engine + tests, config tiers, non-destructive merge +
  merge log + undo, migration 079.
- **Phase 1b (done)**: Modal pair-scoring + similarity graph, weekly task,
  cache-backed duplicates endpoint, review-queue UX, merge undo API, Similar routes.
- **Phase 2 (todo)**: OSM road-graph map-matching (platform-wide + merges) and
  self-supervised route embeddings trained on accumulated merge decisions.

### Implementation map

| Area | Files |
|---|---|
| Engine | `backend/app/services/route_matching.py`, `backend/tests/test_route_matching.py` |
| Service | `backend/app/services/route_service.py` (`_compute_match_score`, `find_duplicate_route`, `merge_routes`, `undo_route_merge`, `find_potential_duplicates`) |
| Modal | `backend/app/integrations/route_intelligence.py` (`compute_route_similarity_on_modal`, `_score_route_graph_modal`) |
| Task | `backend/app/tasks/scheduler.py` (`recompute_route_similarity`, Sunday 03:05 UTC) |
| Schema | `backend/app/models/route.py` (`RouteMergeLog`, `RouteSimilarity`), `backend/alembic/versions/079_route_merging_overhaul.py` |
| API | `backend/app/api/routes.py` (`POST /merge` → `MergeResult`, `GET /merges`, `POST /merges/{log_id}/undo`, `GET /{route_id}/similar`), `backend/app/schemas/route.py` |
| Frontend | `frontend/src/lib/api/routes.ts`, `types/routes.ts`, `app/(app)/routes/duplicates/page.tsx`, `components/routes/SimilarRoutesSection.tsx`, `components/routes/RouteDetailPanel.tsx` |


## 11. Risks

- Lap normalisation on messy GPS is approximate; road snapping (Phase 2) will
  sharpen it. Confidence tiers surface uncertainty in the UI.
- Modal cost/latency on large corpora — mitigated by the local pre-filter, chunking
  and weekly batching.
- Historical lossy merges are not repaired (out of scope; possible one-off task).
