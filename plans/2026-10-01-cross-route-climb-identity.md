# Design Spec — Section 3: Cross-Route Climb Identity (`geo_cluster_id`)

> **Date**: 2026-10-01 · **Type**: feature (data model + UI) · **Surface**: `/segments`, route detail
> **Origin**: brainstorm `plans/brainstorm-2026-09-30-open-agenda.md` item C2b, re-baselined
> against the code. Chosen scope: **3B** (persist `geo_cluster_id`) over read-time
> clustering, so a hill leaderboard can be a single indexed query.
>
> Plan-mode draft — relocate to repo `plans/` + commit on build mode.

## 1. Problem

`Segment` is unique on `(route_id, start_dist_m, end_dist_m)` (`models/segment.py:30-34`)
and `sync_route_segments` is **delete-and-recreate per route** (`services/segments.py:606-609`).
The same hill ridden on three routes is therefore three rows with three PRs and three
`times_ridden` counts. The rider's actual best on that hill is invisible, and the
`/segments` page — which groups by route (`segments/page.tsx:44`) — cannot show it.

### 1.1 `cluster_id` is not a geographic identity

`_extract_segment_features` (`integrations/segment_intelligence.py:117-142`) builds its
DBSCAN feature vector from **gradient / length / gain shape only — no coordinates**:

```python
return [avg_grad/15.0, length_km/10.0, gain_m/500.0,
        max_grad/25.0, gain_per_km/100.0, shape]
```

So `cluster_id = 3` means "climbs that look statistically alike" — a *training analogue*,
correct for the job `_predict_segment_effort` uses it for, and the wrong primitive for
identity. Notably the scheduler **sends** `start_lat/lng/end_lat/lng` to Modal
(`scheduler.py:2202-2205`) and `analyze_segments` never reads them: the coordinates are
transmitted and discarded. `geo_cluster_id` is a **new, separate** column — `cluster_id`
keeps its meaning and its consumer.

### 1.2 The intelligence layer is computed and invisible

Every Sunday 6:15 `analyze_segments_intelligence_weekly` runs Modal and fills columns the
frontend never renders (verified by grep — matches only in the TS type and one test fixture):

| Field | Rendered? |
|---|---|
| `climb_type` | yes — `SegmentRow.tsx:49` |
| `difficulty_score` | yes — `SegmentRow.tsx:54` |
| `predicted_vam` | **no** |
| `predicted_time_seconds` | **no** |
| `prediction_confidence` | **no** |
| `sustainedness` | **no** |
| `cluster_id` | **no** |

Surfacing these is near-zero-risk and makes the existing weekly task visibly pay off.
It ships in this section because the hill leaderboard is where they are most useful.

## 2. Design

Four parts: a forward migration, the clustering (a pure function), carry-over across
recompute (a precondition — §2.4), and the read/UI surface.

### 2.1 Migration (forward, additive, nullable)

`segments.geo_cluster_id UUID NULL` + `ix_segments_geo_cluster`.

- **Forward migration only.** Never edit an applied revision (AGENTS pitfall 24).
- Nullable + additive, so no backfill is required for correctness: existing rows read as
  `geo_cluster_id = NULL` and the weekly task fills them on its next run.
- `sa.UUID()` is valid at SQLAlchemy top level; **no JSONB**, so pitfall 22's dialect trap
  does not apply. Still assert the new revision is reachable from `head` after writing.
- No new model class → pitfall 14 (`app/models/__init__.py` import + `__all__`) does not
  apply; the column lives on the already-registered `Segment`.

### 2.2 Clustering — pure function, no Modal

New `services/geo_clusters.py`:

```python
def geo_cluster_segments(segments: Sequence[dict]) -> dict[uuid.UUID, uuid.UUID]:
    """Group segments that are the same physical hill across different routes.

    Two segments merge when their endpoints are geographically close AND their
    geometry agrees:
        haversine(start_a, start_b) <= START_TOL_M      # 150 m
        haversine(end_a,   end_b)   <= END_TOL_M        # 150 m
        abs(distance_a - distance_b) / max(...) <= 0.10  # length within 10%
        abs(grad_a - grad_b)          <= 1.0            # percentage points

    Endpoints are matched as an **unordered pair** so a hill ridden in the
    opposite direction still merges (its start and end are swapped).

    Returns segment_id -> cluster_id. The cluster key is the lexicographically
    smallest member segment id, so labelling is deterministic within a run.
    """
```

- **Pure, stdlib-only, no DB, no Modal.** Unit-testable directly — which is the reason
  this is not dispatched to `segment_intelligence.py`: it needs no compute, and keeping it
  out of the Modal image avoids pitfall 16 (module-scope config import) and pitfall 17
  (`add_local_file` mounting) for zero benefit.
- Grid-bucket by start point to keep candidate generation sub-quadratic if a user ever
  accumulates thousands of segments; correctness must not depend on the bucketing.
- **Key stability is explicitly not required.** Read-time aggregation groups by the
  *current* `geo_cluster_id` value, so a key that shifts when membership changes simply
  re-groups — it is a display grouping, not a foreign key anything hangs off. This is why
  the "DBSCAN labels are unstable" objection does not apply here (and does still apply to
  the unused `cluster_id`).

Called from `analyze_segments_intelligence_weekly` in the **same transaction** as the
existing intelligence write, so the label and its inputs are never inconsistent:

```python
geo = geo_cluster_segments([
    {"id": s.id, "start_lat": s.start_lat, "start_lng": s.start_lng,
     "end_lat": s.end_lat, "end_lng": s.end_lng,
     "distance_m": s.distance_m, "avg_gradient_pct": s.avg_gradient_pct}
    for s in segments
])
for seg in segments:
    seg.geo_cluster_id = geo.get(seg.id)
```

The weekly task already selects every `Segment` for the user, so this adds no query.

### 2.3 Read + leaderboard endpoint

- `SegmentRead` gains `geo_cluster_id: uuid.UUID | None` and
  `geo_cluster_size: int = 1` (count of members, computed in `_segment_read`).
- `SegmentDetail` unchanged.
- **New** `GET /segments/climbs/{geo_cluster_id}` → `ClimbDetail`:
  ```python
  class ClimbDetail(BaseModel):
      geo_cluster_id: uuid.UUID
      name: str                       # canonical: the most-ridden member's name
      route_count: int
      segments: list[SegmentRead]     # member segments, across routes
      efforts: list[SegmentEffortRead]  # ALL members' efforts, ranked
  ```
  Service `get_climb_leaderboard(db, user_id, geo_cluster_id)` mirrors the existing
  `get_segment_leaderboard`: select members by `geo_cluster_id`, then their efforts with
  `selectinload(SegmentEffort.activity)`, ordered.
- ⚠️ **Pitfall 13 — corrected during the build.** This section originally claimed
  `/climbs/{geo_cluster_id}` "must be registered above `/{segment_id}` or the dynamic route
  swallows it and the request 422s". **That is wrong for this route.** Pitfall 13 is about
  *colliding path shapes*: `/tags` vs `/{param}` are both one segment, so registration order
  decides. This route is two segments and the dynamic one is one:

  ```
  /{segment_id}            ->  ^/(?P<segment_id>[^/]+)$
  /climbs/{geo_cluster_id} ->  ^/climbs/(?P<geo_cluster_id>[^/]+)$
  ```

  `[^/]+` cannot span a slash, so `/{segment_id}` is never a candidate for `/climbs/<uuid>`
  and the order is irrelevant. Verified empirically by building a router in the wrong order
  and getting a 200 from the specific handler. The build therefore asserts the **path
  shape** rather than the decorator order, and adds a test showing the *single-segment*
  variant (`GET /climbs`, no parameter) **is** shadowed — which is the shape the rule is
  actually for. An ordering assertion here would have locked the over-caution in permanently
  while checking nothing.

### 2.4 Carry-over across recompute (precondition)

Delete-and-recreate drops every non-geometry column. Since a persisted column that dies on
every recompute is not meaningfully persisted, `sync_route_segments` must carry the
derived fields across the rebuild, keyed on the existing unique constraint
`(route_id, start_dist_m, end_dist_m)`:

1. Before the delete, snapshot `{ (start_dist_m, end_dist_m) -> Segment }`.
2. Re-insert geometry as today.
3. For each new row whose key matches the snapshot, copy `geo_cluster_id`, `cluster_id`,
   `climb_type`, `sustainedness`, `difficulty_score`, `predicted_*`,
   `prediction_confidence`, `intelligence_analyzed_at` verbatim.

Geometry is unchanged for a matching key, so a copied prediction is still valid. A key
that changed (route geometry edited) correctly falls back to NULL until the next weekly
run — and the page shows `intelligence_analyzed_at`, so staleness is visible rather than
silent.

**Also in this function**: `SegmentEffort.is_pr` is never assigned anywhere in the
backend — grep finds it only in the model, schema, and read path — so the PR badge at
`SegmentRow.tsx:130` never renders. Set `is_pr=True` on the `min(elapsed_seconds)` effort
while `pr_seconds` / `has_pr` are already being computed (`segments.py:699-708`).

### 2.5 Frontend

- **`/segments` page** — add a "Group by" control alongside the existing Filters card:
  `Climb` (default) / `Route`. Climb grouping renders one row per `geo_cluster_id`:
  canonical name, `Cat N`, steepest gradient, **merged best VAM**, `sum(times_ridden)`
  passes, and a line like *"also on 2 other routes"*. Route grouping is today's behaviour,
  unchanged.
- **`SegmentRow`** — surface the invisible intelligence: `predicted_time_seconds` as
  `pred 5:12`, `predicted_vam` as `~900 VAM`, `sustainedness`, and `prediction_confidence`
  rendered as a low/med/high hint (confidence < 0.4 is routinely low — `_predict_segment_effort`
  floors at 0.2 with no similar efforts, so a bare number would read as a failure).
- **Hill row expanded** — `['climb-detail', geo_cluster_id]` query, one request, renders
  the merged effort list. **Ranks by VAM**, with elapsed seconds shown but labelled
  window-dependent (see §3).
- `SegmentsCard` (route detail) keeps rendering per-route segments and the Recompute
  button; its query is invalidated as today.

## 3. The measurement caveat that shapes the leaderboard

Different routes detect the same hill with slightly different windows (900 m vs 950 m
depending on elevation sampling). **Elapsed seconds across differing windows are not
comparable** — ranking a merged list by seconds would be quietly wrong, and the merged
"best" would not be a time anyone actually rode.

**VAM is window-robust** (metres gained per hour), so:

- The hill leaderboard **ranks by `effort_vam`**, falling back to elapsed seconds only
  when no member effort carries VAM.
- Elapsed seconds remain visible, explicitly labelled window-dependent.
- Merge tolerance is tightened to **length ±10%, gradient ±1.0 pt** to keep windows
  comparable enough for the secondary display.

This is the honest version of the feature. Ranking by seconds is what makes a
cross-route leaderboard feel authoritative while being wrong.

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Over-merging two distinct nearby hills | Four independent gates (2 geographic + 2 geometric), plus unordered endpoint matching so reverse-direction pairs still merge. Unit tests cover the adjacent-hills-must-not-merge case. |
| `sync_route_segments` snapshot adds memory/query cost | One extra `select` over a user's segments for a single route; segments per route are tens. |
| Copied intelligence is stale after a route edit | Key match is on the unique geometry range, so an edit changes the key and the fields fall back to NULL. `intelligence_analyzed_at` is rendered, so staleness is visible. |
| `/climbs/{uuid}` shadowed by `/{segment_id}` → 422 | Pitfall 13; order-asserting test. |
| Migration drift (model vs applied revision) | Additive nullable column; `alembic upgrade head` then `downgrade -1` verified, and `tests/test_migration_dialect_types.py` re-run. |

## 5. Testing (host-side — pitfall 23)

`tests/test_geo_clusters.py` (new, pure):
- Same hill on two routes → same key. **Ridden in reverse** → same key.
- Two adjacent but distinct hills → **different** keys (the false-positive gate).
- Distance 11% apart → different keys; gradient 1.1 pt apart → different keys.
- Singleton → key is its own id; empty input → `{}`.
- Determinism: same input, same output, across two calls.

`tests/test_segments.py` / `test_segment_intelligence.py`:
- `sync_route_segments` preserves `geo_cluster_id` + intelligence across a recompute with
  unchanged geometry; drops them when the key changes.
- `SegmentEffort.is_pr` is True on exactly the fastest effort.
- `GET /segments/climbs/{id}` returns members across routes, efforts ranked VAM-first,
  `route_count` correct; unknown/absent id → 404; owned-by-other-user → 404.
- Route-ordering test: `/climbs/{...}` is registered **before** `/{segment_id}`.

`backend/tests/integration/test_segment_recompute.py` — no regression in per-route
leaderboards.

## 6. Defers (explicit)
- **Renaming a hill / user-defined names.** Grouping is derived; names come from the most-ridden
  member. A `Climb` entity with its own identity and a user-editable name is the natural
  follow-on once the grouping proves its worth — deliberately not built now.
- **Persisting denormalized cluster-level PR.** Aggregates are computed at read time, because
  segment identity is not durable across recomputes (§2.2).
- **Streaks / segment PR history as a first-class chart.** `ClusteredHillChart` deferred.
- **Feeding `geo_cluster_id` into the prediction job.** `_predict_segment_effort` borrows
  efforts by shape cluster; geographic borrowing is a different (and probably better) prior,
  but it would change existing prediction numbers — separate spec.

## 7. AGENTS pitfalls honored
- **13** — `/climbs/{geo_cluster_id}` registered above `/{segment_id}`; order-asserting test.
- **14** — no new model class, so no `app/models/__init__.py` change; column added to the
  already-registered `Segment`.
- **16/17** — clustering stays out of the Modal module entirely (pure, local, stdlib-only).
- **22** — no JSONB; `sa.UUID()` only; re-run `tests/test_migration_dialect_types.py`.
- **23** — backend tests run host-side from `backend/`, never via `fittrack.py exec backend`.
- **24** — forward migration only; nothing applied is edited.
- **11** — `enabled: !!token` preserved on the new `['climb-detail', …]` query.