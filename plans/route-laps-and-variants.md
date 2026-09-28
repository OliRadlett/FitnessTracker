# Laps, Loop Variants & Route Identity — Design Plan

> Status: **draft for discussion** (2026-09-29). Not yet implemented.
> Companion to [`route-merging-overhaul.md`](route-merging-overhaul.md) (Phase 1)
> and [`route-matching-phase2.md`](route-matching-phase2.md) (Phase 2).
>
> Prompted by real usage: several merges were **loop variants** on one cycle
> path (3 laps vs 5 laps of the same circuit). The user wants these merged into
> one route library entry, but **not** to teach the matcher that different lap
> counts are "the same route".

## 1. The core tension

Two questions are conflated today:

| Question | What it means | Correct answer |
|---|---|---|
| **Is this the same road/circuit?** | routing / identity | laps don't matter |
| **Is this the same ride/effort?** | training load, PRs, comparison | laps matter a lot |

A 3-lap and a 5-lap ride on one circuit are **the same route** (same roads,
same circuit) but **not the same ride**. The current system merges them (fine)
and would train the matcher on that merge as "same route" (not fine).

## 2. What already exists

- **Ordered edge sequence** from the Phase-2 map-match (`road_match.edges`) —
  a repeated circuit shows up as periodicity in this sequence.
- **`lap_ratio`** in `ScoreBreakdown` — currently just the nearest integer
  ratio of route lengths, used as an informational badge. Not a real lap count.
- **`route_merge_log`** — every merge, now with a planned `merge_kind`
  (`identical` / `variant`) so the training signal can exclude variants.
- **`is_loop`** on `Route` — boolean, no lap count.

Nothing today records **how many laps** a ride completed.

## 3. Proposal

### 3.1 `lap_count` as a route attribute

Detect laps during map-matching and store on the route
(`route_laps` JSONB or a small int column + confidence).

Detection sketch (approximate by nature):

1. Take the ordered edge sequence from `road_match.edges`.
2. Find the smallest period `p` such that the sequence `≈` repeats
   (`seq[i] ≈ seq[i+p]` for most `i`) — via autocorrelation or prefix matching.
3. `lap_count = round(len(seq) / p)`; confidence from how well it repeats.
4. Guard rails: require `lap_count >= 2` and a closed circuit
   (start ≈ end) to claim laps at all.

**Honest limitations** (why confidence matters):

- GPS gaps drop edges → period breaks.
- Out-and-back (retracing a road) looks like a 2-lap repeat but isn't.
- Figure-eights and lollipop routes break naive periodicity.
- A route ridden once is indistinguishable from "1 lap" — so `lap_count=1` is
  the neutral default and carries no information.

### 3.2 Matching semantics with laps

| Situation | Roads | Laps | Behaviour |
|---|---|---|---|
| Exact duplicate | same | same | auto-merge (as today) |
| Same circuit, different laps | same | differ | **merge into one entry, link as variant** |
| Different circuit | differ | any | separate routes |

So the matching key becomes **(road circuit identity, lap count)**, and the
*merge* stays as today (unify the library entry) while the *training signal*
records the lap difference so variants are never taught as duplicates.

### 3.3 Riding history & PRs

This is the part that needs the most care. Once 3-lap and 5-lap rides share a
route entry, per-route stats become misleading:

- **Total distance / time** — fine, sum across all rides.
- **Best time / PR** — **not** comparable across lap counts. A 5-lap PR and a
  3-lap PR are different efforts.
- **Average speed** — comparable-ish but lap count affects stop/start density.

Proposal: route history groups rides by `lap_count` for any
performance comparison (PRs, best time, speed), while still showing them
together as "your Cycle Path Loop". The route detail's History tab gains a lap
filter ("3 laps · 5 rides", "5 laps · 2 rides").

### 3.4 Training signal

- `train_metric_from_history` uses **only `merge_kind = identical`** merges as
  positives.
- A merge where `lap_count` differs materially is **auto-classified `variant`**
  (exclusion only — never auto-promote to `identical`).
- Effect: the embedding metric learns *same-roads-same-laps* similarity and is
  never taught that lap variants are duplicates.

### 3.5 UI

- Route card / detail: `Cycle Path Loop · 5 laps · 20 km` when laps known.
- Duplicate queue: a lap-variant pair (same roads, different laps) shows a
  distinct action — **"Link as variant"** rather than **Merge**, with copy
  explaining they share a circuit but differ in laps.
- Route detail: a "Variants" section listing other lap counts of the circuit.
- Merge history: reclassify a merge as identical/variant (already planned).

## 4. Open questions

1. **Do lap variants share one `Route` row or become linked routes?**
   - *Shared row*: simplest, matches "one library entry". But per-ride lap count
     must live on the **activity/ride**, not the route, and PR grouping moves to
     ride level.
   - *Linked routes*: a `RouteVariant` join (or a `variant_of` FK) keeps each
     lap count a first-class route, and merging is replaced by linking.
   - Leaning **shared row + per-ride lap count**, since the user explicitly
     wants these merged into one entry.
2. **Where does lap count belong — route or ride?** Genuinely a property of the
   *ride*; the route only has an *expected* lap count. This leans toward
   storing it on `Activity` (computed at sync/stream-processing time) and
   deriving the route's "usual laps" as a summary.
3. **Should lap variants affect the auto-merge threshold at all**, or always be
   a manual link?
4. **PR/leaderboard semantics** for a circuit at multiple lap counts — separate
   boards per lap count, or one board with lap-adjusted normalisation?

## 5. Suggested phasing

- **Ph. 0 (now, independent):** `merge_kind` on the merge log; trainer uses
  `identical` only; reset existing merges for reclassification. *(Being built.)*
- **Ph. 1:** lap detection in the OSM matcher (ordered-edge periodicity) →
  store on ride; surface in route UI.
- **Ph. 2:** "Link as variant" relationship + queue action; variants excluded
  from training automatically.
- **Ph. 3:** lap-aware ride history / PRs (group comparisons by lap count).

## 6. What this plan deliberately does NOT do

- Claim exact lap detection from GPS (it is heuristic; confidence is surfaced).
- Change today's merge behaviour (merging loop variants stays allowed).
- Retro-fit historical rides with lap counts without a backfill decision.
