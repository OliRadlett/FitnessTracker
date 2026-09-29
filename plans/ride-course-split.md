# Ride / Course Split — Linkage Model Redesign

> Status: **in progress** (2026-09-29).

## Executive summary — what changed today

| Task | Result |
|---|---|
| Re-export full dataset (routes + activities) | ✅ 95 routes (all road-matched), 518 activities, 358 with polyline |
| Characterise 46 Course rides | ✅ 100% single-pass (lap_est 1.04–1.34); the course holds section-repeats, not whole-circuit laps |
| Fix 28 mislabelled activities (26 strength + 2 walks as cycling) | ✅ migration 086 (provenance-based, not `source='wahoo'`) + `sport_type` in `_MERGE_FIELDS` to prevent recurrence |
| Activity road-match columns | ✅ migration 086; `Activity.road_match` / `road_embedding` / `road_match_version` |
| Activity road-matching task | ✅ `map_match_activities` (beat: Sun 3:00 AM, after routes)
> Companion to [`route-merging-overhaul.md`](route-merging-overhaul.md) (Phase 1)
> and [`route-matching-phase2.md`](route-matching-phase2.md) (Phase 2).
> Supersedes the identity half of [`route-laps-and-variants.md`](route-laps-and-variants.md)
> (that doc's lap-detection detail remains valid; its model is folded in here).

## 1. The problem

`Route` currently does two jobs at once:

| Job | Meaning | Example |
|---|---|---|
| **Ride** | one effort — time, laps, power, HR, date | *Tuesday: 5 laps, 52 min* |
| **Course** | the reusable roads/circuit | *Cycle Path Loop* |

They coincided while every ride was unique. They diverge the moment a course is
ridden repeatedly, which is exactly the usage in this database.

### Evidence from production (2026-09-29, single user, 348 rides / 82 routes)

- **Lap variants are real and abundant.** Four home loops (9.6 / 10.2 / 13.4 /
  16.1 km) are each recorded as 1–5 *separate routes*, all starting within ~50 m
  of home, with length ratios of **×1.997, ×2.000, ×2.022, ×4.001, ×5.005**.
  The system stores 16 routes where the rider has 4 courses.
- **`Route` already behaves like a course set** — 15 routes carry 147/170 linked
  rides; 44 of 82 routes are orphaned with zero activities.
- **Route names carry no identity** — 41 of 82 are "Cycling" / "Afternoon Ride" /
  "Evening Ride" (auto-derived from the first synced ride).
- **Half the rides are unlinked** — 170/348 have `route_id`; **all 130 Wahoo
  rides are unlinked** and carry no geometry at all.
- **No ride-level history exists** — no per-route PR table; `segment_efforts.is_pr`
  is `false` on all 37 rows; `routes.estimated_time_seconds` is a physics
  estimate, not a PB. Nothing to migrate, so the model can be designed cleanly.

### Hard constraint

**No full GPS track is stored.** `activity_streams.latlng` = 0 rows;
`raw_data.map.polyline` = 0. Available: Strava's decimated `summary_polyline`
(177 rides), altitude/distance/time streams (217 rides), and nothing geometric
for Wahoo. Linkage must therefore work from **shape (decimated)** + **start/end
+ distance + elevation**, and must degrade honestly where geometry is missing.

## 2. Decisions (agreed with the user)

| Decision | Choice |
|---|---|
| What `Route` means | **Course** — a named, tolerant geometric identity |
| Lap count lives on | the **Ride** (`Activity`), not the route |
| Same circuit, different laps | **same course**; comparisons grouped by lap |
| Town-detour / different line through town | **same course, shared PR board** |
| Tolerance | system default (see §4), **user-adjustable later** |
| Merge training signal | only `identical` merges (already built — migration 083) |
| Exact edge-set identity | **rejected** — too strict; small deviations must be allowed |

### What `Route` is not

- **Not** "a recorded ride cluster" (today's de-facto behaviour — identity drifts
  per lap count, merges rewrite which rows exist, orphaned routes accumulate,
  and every downstream feature re-solves "same course?" independently).
- **Not** a user-defined named entity as the primary mechanism — manual-first
  does not scale (348 rides, 178 unlinked). User naming/override exists as the
  *correction* path, not the primary one.

## 3. Model

```
Ride      (Activity)  — one effort: date, time, distance, laps, power, HR
   │ ridden on  (many-to-one)
Course    (Route)     — the roads/circuit: "Cycle Path Loop"
   │ ridden at
Lap count (Ride)      — 3-lap / 5-lap forms of the same course
```

- **Ride → Course is many-to-one.** Linking is the act of saying "this ride was
  on that course".
- **Lap count belongs to the Ride.** The Course records which forms it has been
  ridden in (a summary), but the number is a ride property.
- **Course history groups rides by lap count** ("3 laps · 5 rides", "5 laps · 2 rides").
- **Nothing is destroyed**: the Course is the identity; the Ride keeps its own
  distance, time, laps, date.

### 3.1 Tolerated deviations

Three deviations the user makes, all of which must still be the same course:

| Deviation | Example | Test |
|---|---|---|
| Different line through town | left at the roundabout instead of right, rejoining | spine test + detour budget |
| Out-and-back extension | same loop plus a spur to a viewpoint | detour budget |
| Start/end offset | leave from a café instead of home | spine test (both ends within tolerance) |

### 3.2 Two-tier model (no middle tier)

| | Same course | Different course |
|---|---|---|
| Definition | spine + detour tests pass (§4) | either fails |
| Merge | yes, with user approval | no |
| PR board | **shared** | separate |
| Lap variants | same course, grouped by lap for comparison | n/a |

The "course family / corridor" tier was considered and **dropped** — with
tolerant matching plus lap grouping, no case was found that needs it. Corridor
neighbours may still be *surfaced* by similarity score, but never merged.

## 4. Tolerance definition

A ride belongs to a course if, against the course's canonical trace:

1. **Spine test** — ≥ ~90% of the ride's distance lies within ~50 m of the
   course trace, **and**
2. **Detour test** — any single *continuous* divergence is ≤ ~2 km **or** ≤ ~10%
   of course length, whichever is *larger*.

Rationale:

- Test 1 alone would admit a ride that shares the first half then goes elsewhere.
- Test 2 alone would admit a patchwork of short shared segments with a different
  overall shape.
- Together: the ride must mostly follow the course, *and* no single departure
  may be large. A different line through town (~1 km) passes both; a "same
  start, different ride" fails test 2.
- **Scaling is proportional, not absolute** — a 2 km detour on a 10 km loop is a
  different ride; the same detour on a 100 km ride is noise.

Both tests are computable from stored data: the spine test uses the existing
dense-coverage code in `route_matching.py`; the detour test is a small extension
(longest continuous run of uncovered points), not new infrastructure.

**PR-fairness consequence (accepted):** a detour could in principle shorten a
ride slightly. The detour budget bounds this (~2 km), and observed deviations
are lateral (rejoining), not shortcuts. Per-line PR boards are explicitly
**not** built now; revisit only if it becomes a real problem.

User-adjustable tolerance (strict / normal / loose) is **deferred** — system
default now.

## 5. Phasing

Ordered by dependency. Ph. 0 unblocks everything else.

### Ph. 0 — Groundwork: verify and reconcile *(first, small)*

- Confirm what is actually deployed. The merge-kind Deploy reported **skipped**,
  so the classification work may not be live.
- Resolve the **duplicate `083` migration** (`083_route_merge_kind` vs another
  session's `083` for `LiftVideo.camera_json`). Same class of bug as the earlier
  `078` collision; CI uses `create_all` so it will not be caught there, and the
  prod Deploy runs `alembic upgrade head` and will fail.
- Reconcile the similarity-count discrepancy: an earlier report said 134 review
  pairs; the DB holds **9**. Establish which is correct before designing on it.

### Ph. 1 — Forward linking (rides → courses at sync time)

- New rides **with geometry** get a course assignment using the existing
  similarity engine plus the §4 tolerance tests.
- Confidence tiers: **auto-link** (high) / **review queue** (uncertain) /
  **leave unlinked** (low).
- A wrong link must be correctable — the link is a *suggestion* until confirmed,
  mirroring the merge-review pattern.
- Engine runs at sync; uncertain results queue rather than auto-applying.

### Ph. 2 — Backfill the 178 unlinked rides

- **Strava (48 unlinked)**: shape-linkable now via `summary_polyline`.
- **Wahoo (130)**: no streams, no polyline, no geometry. **Fix ingestion
  (capture GPS) first, then link.** Linking on distance + start-point alone is a
  guess that would later need unpicking. Until then these rides stay explicitly
  un-linked (surfaced as such, not silently ignored).
- Review surface for uncertain links, same as Ph. 1.

### Ph. 3 — Orphaned routes (44 of 82)

- Quarantine from matching so they cannot pollute results.
- Attempt re-link; otherwise archive.
- Some are lap-variant twins that the new model absorbs naturally once lap
  counts move to rides.

### Ph. 4 — Course identity with tolerance *(the core)*

- Implement §4 (spine + detour tests) in the matching engine.
- Review UI gains a **"diverges for X km around Y"** summary alongside the
  existing overlaid map preview (`CompareRoutesMap`).
- The single review question becomes **"is this deviation acceptable?"** rather
  than "are these identical?".

### Ph. 5 — Lap-aware history / PRs *(detail deferred)*

- `lap_count` on the ride, inferred from **distance ratio against the base loop**
  (proven by the data: ×1.997, ×2.000, ×4.001).
- Course history groups by lap count; town variants within tolerance share the
  board.
- No new PR table until the groupings are validated.

## 6. Out of scope

- **Exact GPS-track lap detection** — no `latlng` streams are stored; detection
  is distance-ratio based. See [`route-laps-and-variants.md`](route-laps-and-variants.md) §3.1
  for the limitations (GPS gaps, out-and-back false positives, figure-eights;
  `1 lap` is indistinguishable from "ridden once").
- **Per-line PR boards** — accepted impurity; revisit only if needed.
- **"Course family" middle tier** — dropped (§3.2).
- **Wahoo geometry ingestion** — separate integration task, prerequisite for the
  Wahoo half of Ph. 2.

## 7. Open questions

1. **Orphaned routes**: archive vs keep as courses vs re-link? (Ph. 3 — user input.)
2. **Tolerance control**: is the system default (§4) acceptable as the PR-fairness
   boundary until adjustable tolerance ships?
3. **Wahoo ingestion**: is capturing GPS from Wahoo in scope as a prerequisite,
   or should those rides remain permanently linked-by-distance-and-flagged?

## 8. Relationship to the merge system

The merge system is the current, crude implementation of course-dedup. Under this
plan:

- **Merges become course consolidations** — which is what the user's existing
  merges already were in practice.
- **`merge_kind` (`identical` / `variant`)** remains the training guard: only
  `identical` merges train the embedding metric — variant merges stay merged but
  excluded so they never widen matching.
- Under the Ride/Course split, **"identical vs variant" becomes the course-identity
  question the matcher answers** (§4), rather than an attribute the user must
  supply per merge.
- The user's existing 6 merges were largely loop variants and should be reset and
  re-judged via the merge-history UI once deployed.
