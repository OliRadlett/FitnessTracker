# Design Spec — Section 6: Superset-Ready Session Ordering (and the identity leak that blocks it)

> **Date**: 2026-10-01 · **Type**: bug fix (data integrity) + enabling refactor · **Surface**: `PATCH /lifting/sessions/{id}/sets/{set_id}`, session read order, live tracker
>
> **Origin**: brainstorm `plans/brainstorm-2026-09-30-open-agenda.md` item **C5** —
> "live-lift supersets/reordering". Re-baselined: supersets are the *symptom*. Reordering is
> impossible because the schema has **no ordering column at all**, and supersets are
> impossible because **`exercise_name` has no write-path invariant** — one `PATCH` forks an
> exercise's entire history.
>
> Plan-mode draft — relocate to repo `plans/` + commit on build mode.

## 1. Problem

### 1.1 `update_set` writes the exercise name raw — forking the exercise's entire history

`LiftingSet.exercise_name` is a **de facto primary key** for the whole lifting domain. It is
the join key in:

| Consumer | Site |
|---|---|
| Six chart-registry entries (volume/PR/1RM/form trends) | `api/charts.py:45,60,98-114` |
| Yearly-dashboard PR grouping | `api/dashboard/yearly.py:144` |
| Video → PR correlation, video filtering | `api/videos.py:66-67,212,237,470` |
| Video form analytics | `services/video_analytics.py:45-50` |
| Volume / e1RM trends | `services/lifting.py:881,970` |
| Deficit + goal metrics | `services/deficiency.py:381`, `services/goal_metrics.py:77-82` |
| CSV export | `api/export.py:106` |

Every write path normalises it **except one**. `create_session` (`:289`) and `add_set`
(`:575-579`) both store `normalise_exercise_name(...)`. But `update_set` (`:627-629`):

```python
update_data = data.model_dump(exclude_unset=True)
for field, value in update_data.items():
    setattr(lifting_set, field, value)
```

A blind `setattr` loop. `LiftingSetUpdate.exercise_name` is a plain `str | None`
(`schemas/lifting.py:29`), so a `PATCH` writing `"bench press"` or `"BenchPress"` persists
the raw string. That single set then forks away from every historical chart, PR, video
correlation and export row for that lift — **permanently**.

It gets worse at `:649-654`: `_recalculate_pr_after_set_change` is then called on the *new
raw* name, so it creates a **second `PersonalRecord` row** for an exercise that has never
existed. One typo in an edit produces a phantom PR.

The surrounding code shows this is an omission, not a design choice — `update_set`
carefully recalculates session volume (`:631-644`) and re-checks PRs against **both** old
and new names (`:649-654`). Every axis of correctness was considered except normalisation.

### 1.2 There is no ordering column, and `created_at` cannot substitute

`LiftingSession.sets` is `order_by="LiftingSet.created_at"` (`models/lifting.py:93`), and
`created_at` is `server_default=func.now()`.

**In PostgreSQL `now()` is the transaction start time.** Every row inserted in one
transaction receives an identical `created_at`. And `create_session` inserts all of a
session's sets in a single flush inside one transaction (`services/lifting.py:286-301`),
committed once by `get_db` at request end.

So for **every manually-entered session** — the main entry path — all sets tie on
`created_at` and the returned order is whatever Postgres happens to produce. Effectively
arbitrary.

`LiftingSetRead` (`schemas/lifting.py:39-44`) exposes no ordering field at all, so the
client cannot even observe the order, let alone control it.

Independent confirmation that the stored order isn't trusted: `api/export.py:106` sorts by
`(exercise_name, set_number)` — **alphabetically by exercise**, discarding any true
performance order. The CSV export is knowingly re-imposing an order because there isn't one
to read.

### 1.3 `set_number` has no defined semantics

`add_set` (`:580`) and `create_session` (`:290`) take `data.set_number` verbatim from the
client. There is no per-exercise scoping, no contiguity requirement, no uniqueness, no
auto-assignment. A session can legitimately contain sets numbered 1, 1, 3 — and nothing
downstream can tell "set 1 of bench" from "set 1 of squat".

`set_number` is exactly the column a superset UI needs (bench 1–3, then row 1–3, paired by
position), and right now it carries no enforced meaning.

### 1.4 User-defined exercises round-trip loss

Two normalisers exist:

- `exercise_db.normalise_exercise_name` (`exercise_db.py:317`) — **static**, alias map in
  the module.
- `exercise.normalise_exercise_name` (`services/exercise.py:158`) — **async, DB-backed**,
  honours `Exercise.aliases` JSONB and the user's own `Exercise` rows, falling back to the
  static one.

The write path uses the **static** one (`services/lifting.py:29` imports from `exercise_db`).
So the exercise picker offers the user their own exercises and custom aliases — and the
write path then discards that identity. `Exercise` has a `(user_id, name)` unique
constraint and a full CRUD API (`api/lifting.py:342-383`), and nothing in the set-write path
ever consults it.

## 2. Design

The superset feature is **downstream of all four fixes**. Do them in this order.

### 2.1 Close the identity leak

`update_set` normalises `exercise_name` before assignment, exactly as the other two write
paths do. Cheap, and it is the one that makes the rest of this section safe.

Add a **defence in depth** check: after any set write, assert the persisted
`exercise_name` round-trips through `normalise_exercise_name` unchanged. If it does not,
something bypassed the write path (a raw migration, a future endpoint) and should be caught
in tests rather than silently forked.

### 2.2 An explicit ordering column

Add `LiftingSet.order_index: int | None` — additive, nullable, new forward migration
(**never edit an applied one**, pitfall 24). No `JSONB`, so pitfall 22's dialect trap does
not apply.

- `order_by` becomes `(LiftingSet.order_index, LiftingSet.created_at, LiftingSet.id)` —
  the tiebreaks make the result **deterministic** even for rows where `order_index` is still
  null, which is what fixes §1.2 for existing data without a blocking backfill.
- Backfill `(set_number, created_at, id)` grouped by `(session_id, exercise_name)` so each
  exercise's sets get 1..n and runs land in their existing order. Idempotent, re-runnable.
- Assign `order_index` on insert: `max(order_index) + 1` within the session, so live-tracked
  sets append in logging order regardless of timestamp ties.

Expose it on `LiftingSetRead` so the client can observe order.

### 2.3 Give `set_number` real meaning

Enforce, within `(session_id, exercise_name)`, that `set_number` runs 1..n contiguous:

- `add_set` with no `set_number` → assign `max + 1` for that exercise.
- `delete_set` → renumber that exercise's remaining sets down.
- `update_set` changing `exercise_name` → renumber both the old and new exercise groups.

This is what makes a superset expressible as data: "bench 1–3 then row 1–3" is now a
statement about contiguous per-exercise numbering plus session order, rather than a hope.

### 2.4 Reorder endpoint

`PATCH /lifting/sessions/{session_id}/reorder`, body `{"set_ids": [...]}` — the complete
ordered list of the session's sets.

- Validate the list is **exactly** the session's set ids: no additions, no omissions, no
  duplicates. Mismatch → 422. A partial reorder is never silently accepted.
- Write `order_index` positionally. Idempotent — re-PUTting the same order is a no-op.
- **Touch nothing else.** Volume is order-independent, and PRs must not move: a reorder is a
  presentation change, not a training change.
- Only the owning user may reorder (join `LiftingSession` and check `user_id`, as
  `update_set` does at `:612-619`).

Path shape (`/{id}/reorder`) cannot be shadowed by `/{session_id}`, but register it above
the dynamic handlers anyway per pitfall 13, and assert decorator index order in tests.

### 2.5 Supersets as adjacency, not a new entity

**Decision: derive superset pairing from adjacent runs of distinct exercises. No
`superset_group` column, no `Superset` table.**

Once `order_index` exists, the session is an ordered sequence. Group it into maximal runs
of identical `exercise_name`; a superset is an **adjacent pair of runs**, which is what a
user means by "bench then rows" in practice. Pairing two runs and reading three is a display
concern, computed client-side from data that is already ordered.

Rationale: a superset has no lifecycle of its own — it is not independently created,
referenced, or deleted. A new table would need its own CRUD, its own cascade behaviour, and
would immediately disagree with the set ordering it claims to describe. If explicit
grouping is ever needed (a non-adjacent pairing, or a 3-way chain), a nullable
`superset_group` integer is the additive follow-on — a one-column migration at that point,
rather than speculative complexity now.

**Sequencing note**: §2.1 and §2.2 are the real work and stand alone. Supersets (§2.5) is
thin once ordering is correct, and can ship separately if the ordering migration is delayed.

### 2.6 Use the DB-aware normaliser on writes

Switch `services/lifting.py`'s write paths to the async DB-backed
`normalise_exercise_name` (`services/exercise.py:158`) so user-defined exercises and custom
aliases survive a round trip.

**Hot-path constraint**: this makes normalisation an `await` per set, and
`create_session` loops over sets. Resolve the user's exercise/alias map **once per
request** and pass it in — do not issue one query per set.

## 3. Traps

### 3.1 `now()` is a transaction timestamp

This is the root of §1.2 and the easiest thing to get wrong when "fixing" it. Any attempt
to derive order from `created_at` — including `now() - created_at` tricks, or assuming
microsecond resolution distinguishes rows — fails, because all rows in a transaction are
byte-identical. The fix is an explicit column, not a cleverer timestamp.

### 3.2 Backfill must be deterministic and re-runnable

Ordered by `(set_number, created_at, id)` and scoped per `(session_id, exercise_name)`.
`id` as the final tiebreak makes it total, so a re-run produces the same result rather than
reshuffling. Guard with `WHERE order_index IS NULL` so it cannot clobber post-migration
writes.

### 3.3 Fix the normaliser before adding the ordering column

If `order_index` lands while §1.1 is open, a session can end up with backfilled ordering
computed from a name that a `PATCH` later forks — leaving two interleaved orderings under
one session. §2.1 first, then §2.2.

### 3.4 `update_set`'s blind setattr is a general hazard

The fix in §2.1 must **not** special-case `exercise_name` inside the loop. Any field added
to `LiftingSetUpdate` is now a raw-write vector. Restrict the loop to an explicit allowlist
of mutable fields, so the next schema addition fails loudly at review rather than silently
bypassing a write-path invariant.

### 3.5 Reorder must not trigger PR recalculation

`update_set` re-checks PRs because changing weight/reps/exercise can legitimately change a
record. Reordering cannot. Wiring reorder through the same service would churn
`PersonalRecord` rows on a pure presentation change — and §2.4's whole point is that it
touches nothing else.

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Backfill misorders existing sessions | Deterministic total order with `id` tiebreak; snapshot session order before/after on a copy of real data and diff |
| Changing `order_by` alters live-tracker append order | New sets assign `order_index = max + 1` explicitly, so append order is independent of the tiebreaks |
| DB-aware normaliser adds latency to set writes | Resolve the alias map once per request (§2.6), not per set |
| Superset adjacency misreads a genuinely non-adjacent pairing | Accepted for v1; `superset_group` is the additive escape hatch (§2.5) |
| Reorder races a concurrent `add_set` | Validate the set-id list against the DB inside the same transaction; a 422 prompts a refetch rather than a silent partial write |

## 5. Testing

- **§2.1 regression (the core one)**: `PATCH` a set's `exercise_name` to a lowercase alias
  and assert the persisted value is the canonical form.
- **§1.1 fork regression**: log "Bench Press", `PATCH` a set to a non-canonical spelling,
  then assert the volume trend, PR lookup, and video correlation for that exercise all still
  resolve to **one** exercise — and that no second `PersonalRecord` row appeared.
- **§1.2 ordering**: a session created with N sets in one request returns them in insertion
  order. **This test fails on current code** — that is the point of it.
- **§2.2 tiebreak determinism**: rows with null `order_index` in a single transaction still
  return in a stable order across repeated reads.
- **§2.4 reorder**: full-list reorder persists `order_index`; a list missing a set id → 422;
  re-sending the same order is a no-op; another user's session is rejected.
- **§2.4 neutrality**: `total_volume_kg` and all `PersonalRecord` rows are unchanged after a
  reorder.
- **§2.3 numbering**: two sets of one exercise with no `set_number` get 1 then 2; deleting
  set 1 renumbers the survivor to 1.
- **§2.6 round trip**: a user-defined `Exercise` with a custom alias is logged and reads back
  as itself.
- **§2.5 superset derivation**: sets ordered bench,bench,row,row pair into one superset;
  bench,bench,curl,curl pair into two.

## 6. Defers (explicit)

- **`superset_group` column / non-adjacent pairings** — additive one-column follow-on if
  adjacency proves ambiguous (§2.5).
- **Exercise rename / merge across history.** If a user corrects an exercise name, nothing
  today rewrites the historical sets. A merge tool (retarget sets, PRs and videos from old
  canonical name to new) is the natural companion to §2.1 and is deliberately separate.
- **Exercise as a real FK.** Replacing `exercise_name` with `exercise_id` is the correct
  long-term model and would fix identity at the schema level — but it touches every one of the
  ~6 consumers in §1.1 plus the CSV export. Too wide to bundle here; §2.1 + §2.6 make the
  string safe in the meantime.
- **Drag-to-reorder UI** — frontend only, lands on top of §2.4.
- **Reordering warmup sets separately** from working sets.

## 7. AGENTS pitfalls honored

- **24** — new forward migration for `order_index`; no applied migration is edited.
- **22** — additive nullable `Integer`. No `JSONB`, so no dialect-import trap; if a partial
  index is added, `sa.text(...)` is spelled out.
- **13** — `/reorder` registered above dynamic handlers; the test asserts decorator
  **index order**, not handler existence.
- **Async everywhere** — the DB-aware normaliser is `async` and awaited; alias resolution is
  hoisted out of the per-set loop.
- **14** — no new model class, so no `models/__init__.py` change; `LiftingSet` is already
  registered.
- **23** — tests run host-side from `backend/` with `python -m pytest tests/ -q`.