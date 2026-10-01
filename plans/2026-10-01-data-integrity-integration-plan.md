# Design Spec — Section 9: Integration Plan (sequencing, cross-section conflicts, closing the inventory)

> **Date**: 2026-10-01 · **Type**: plan · **Surface**: all
>
> **Origin**: "plan the rest of the features". This section does three things the eight
> prior sections could not do individually:
>
> 1. **Decides the three remaining inventory items** — CSV import, the `exercise→FK`
>    migration, offline reads — closing them rather than deferring a fourth time.
> 2. **Finds the conflicts between sections.** Four of them, three of which change the order
>    sections ship in. None were visible while writing any single spec.
> 3. **Fixes the sequencing**, including one inversion that matters: §1 must not ship before
>    §5, because §1 makes an incomplete number look authoritative.
>
> Plan-mode draft — relocate to repo `plans/` + commit on build mode.

## 1. The three remaining items, decided

### 1.1 CSV import — rejected, and the framing was wrong

The observation that triggered it: `api/export.py` exposes **six** export formats (JSON,
lifting CSV, activities CSV, single-activity GPX, PRs CSV, plus weekly/monthly/event PDF
reports) and there is **no import counterpart for any of them**. So CSV import looks like an
obvious missing half.

It isn't. The framing error is assuming CSV import serves the same need as FIT/GPX import:

- **FIT/GPX import** covers *rides*. The high-fidelity path exists, and §5 fixes the two
  defects that made it ineffective.
- **CSV import** would cover *lifting* history from a printed gym log or a third-party app.
  But the app already has a **better** lifting entry path than CSV — the live tracker with
  offline durability (Section 7's subject) and manual session entry.

So CSV import is a feature for a problem that isn't being had. Rejected. The export/import
asymmetry is real but not a defect: export serves data portability, import serves onboarding,
and those are different concerns that happen to share a direction.

### 1.2 `exercise→FK` migration — rejected on risk/benefit

Deferred twice as "the correct long-term model, too wide". Closing it with the arithmetic:

- **Cost:** every one of the §6.1 consumers (~6 subsystems: chart registry, yearly dashboard,
  videos, form analytics, volume/e1RM trends, deficiencies, goals) **plus the CSV export
  format**, which becomes a breaking change for any data already exported. Plus a migration
  that rewrites historical rows' identity — and per pitfall 21, identity is exactly the thing
  that must not be rewritten casually.
- **Benefit:** identity safety. Which §6.1 (normalise on *every* write path, including the
  one that currently leaks) and §6.6 (DB-aware normaliser honouring `Exercise.aliases`)
  **already deliver**.
- **Context:** one user, a seeded catalog, no concurrent writers.

The migration converts a string invariant that two functions now enforce into a schema
constraint, at the cost of touching every read path and the export format. That is a bad
trade for a single-user app. **Rejected.** If the app ever gains a second user or the
exercise count outgrows the seed, revisit — the invariant in §6.1 is the thing that makes
that migration safe later, so §6.1 is not wasted either way.

### 1.3 Offline reads — deferred, but on a *trigger*, not a vagueness

Not premature — a real feature, since the PWA and service worker already exist. What's
missing is a **staleness decision**, not engineering: what does the dashboard show with no
network, and how wrong is acceptable? That's a product judgement, so it waits.

**Trigger to revisit:** the first time reads are genuinely needed without signal (planning a
session in a basement gym, reviewing history on a flight) — not the first time writes are,
which Section 7 already handles. When it happens, the work is React Query persistence plus an
explicit staleness banner, and it must keep API calls network-only per pitfall 10.

### 1.4 Inventory status

| Item | Status |
|---|---|
| §1 unified recommendation | Spec'd, **ship last** (§4.1) |
| §2 TSB projection | Spec'd, Wave 0 |
| §3 cross-route climb identity | Spec'd, Wave 2 |
| §4 activity timeseries (S2+S3) | Spec'd, Waves 0 + 2 |
| §5 historical import | Spec'd, Waves 0 + 1 + 2 |
| §6 superset-ready ordering | Spec'd, Waves 0 + 1 |
| §7 live-session flush liveness | Spec'd, Wave 0 |
| §8 undo as compensation | Spec'd, Waves 1 + 3 |
| CSV import | **Rejected** (§1.1) |
| `exercise→FK` | **Rejected** (§1.2) |
| Offline reads | **Deferred on a trigger** (§1.3) |

## 2. Cross-section conflicts

These are the actual output of this section. Each is invisible from inside any one spec.

### 2.1 §1 must not ship before §5 — and this inverts the original plan

The original decision (§1 vs §2) was "**Section 2 must ship before Section 1**". That is still
true and still not sufficient.

§1's substance is a single verdict across five engines **with provenance and consensus**. The
training-load engine reads CTL/ATL, which derives from daily TSS. §5 established that
imported activities have `tss = None` and that `services/analytics.py:217` *skips* them.

So before §5, a user's pre-Strava history contributes **zero load** — CTL/ATL decay as though
no training occurred, and §1 would compute a confident verdict on top of that.

The sharp version of the argument is not "the number is wrong" but: **§1 adds provenance and
consensus, which makes the verdict look more authoritative.** "CTL: 45 · from training-load
engine" reads as settled fact. Shipping it over an incomplete load history makes a wrong
number *more* persuasive than the unadorned one it replaces. That is strictly worse than
shipping §1 late.

**Resolution:** §5's §2.1 (TSS on import + the backfill task) moves to **Wave 0** as its own
small, independent unit — one `auto_compute_tss_for_activity` call and one idempotent task.
The rest of §5 stays in Waves 1–2. §1 ships last, over complete data.

### 2.2 §5 §2.4 (FIT time axis) gates §3's leaderboard

Already noted in §5 and §3: `geo_cluster_id` clusters by length/gradient and the leaderboard
ranks by VAM, and VAM depends on `SegmentEffort` windows. Today those windows fall back to
`res = max(1, dur // len(values))` for imported rides (`activities.py:917`) — one uniform
spacing for a multi-rate file.

**Resolution:** §5 §2.4 lands before §3. A leaderboard that ranks imported hills on
fabricated effort data is worse than no leaderboard, because it looks authoritative.

### 2.3 §6.1 (identity leak) gates §6.2 (order_index) — and §8.3

Already stated in §6 §3.3, confirmed here as load-ordering rather than advice: backfilling
`order_index` while a `PATCH` can still fork `exercise_name` produces a session with two
interleaved orderings under one session key.

§8.3's `UndoLog` restorers re-insert `LiftingSet` rows and therefore re-derive their
`order_index`; restoring a forked name into a correctly-ordered session is the same class of
corruption.

**Resolution:** §6.1 is Wave 0. §8.3 is Wave 3, after §6.2 — noted in §8's plan file.

### 2.4 §4 S3 and §5 both feed the same aggregates — and §5 must land first

§4's S3 extracts `monthly_breakdown` into `services/charts.py` as the single owner of
dense-fill and of the `Activity.source != "wahoo"` guard, with a cross-consistency test
asserting it agrees with `activity_timeseries` exactly.

That consolidation is worth doing *because* it removes nine hand-written grouped queries
(§4 §6). But its output is only correct if the rows it's aggregating are complete. §5 changes
which rows those are — imported activities gain a `tss`, and post-§5.6 a non-null one.

**Resolution:** §4 S2 (kill the fabricated zero) is Wave 0 because it fixes wrong data on
screen *today*. §4 S3 (`monthly_breakdown`) is Wave 2, after §5, so the snapshot test in
§4's testing section is taken against the post-§5 row population. Snapshotting before §5
would bake a known-incomplete baseline into a test.

### 2.5 Not a conflict, but shared machinery worth building once

| Machinery | Built in | Also needed by |
|---|---|---|
| Notification dedup/retraction | §8.2 | §6 (a renamed exercise should not leave a PR notification) |
| Dense-bucket / aggregate primitive | §4 S3 | §5 (post-import aggregates), §3 (monthly VAM) |
| Local queue with per-item state + dead-letter | §7.2 | §8.3 (undo requested offline), §5.3 (bulk import per-file results) |
| Contiguity/idempotency-aware `undone_at` claim | §8.4 | §4.2 (bulk batch undo) |

None of these need a separate spec. Each is a note to the implementer: **when building the
first one, write it as the shared one**, not as a local helper that the second consumer
duplicates. §4 S3 is the clearest case — it is explicitly a consolidation, so adding a private
helper there would defeat its own purpose.

## 3. Sequencing

Five waves. Every item is independently shippable; nothing requires a coordinated release.

### Wave 0 — Unblockers (5 items)

Small, independent, and each one removes a reason for a later wave to be wrong.

| # | Item | From | Why first |
|---|---|---|---|
| 0.1 | TSS on import + backfill task | §5.2.1, §5.2.6 | Gates §1 (§2.1). Small: one call, one task |
| 0.2 | Normalise `exercise_name` in `update_set` | §6.2.1 | Gates §6.2 and §8.3 (§2.3). One function |
| 0.3 | TSB projection, lift the `event_id` gate | §2 | Unblocks §1's forward input. Small |
| 0.4 | `GET /activities/timeseries` + delete the fabricated zero | §4 S2 | Wrong data on screen **today**; a note currently claims the opposite |
| 0.5 | Live-session flush liveness | §7 | Independent; highest user-visible severity (a typo costs a workout) |

0.1 and 0.3 are both small and both unblock §1, which is why they lead. 0.4 and 0.5 are
independent and can proceed in parallel by different people.

### Wave 1 — Foundations (3 items)

| # | Item | From | Depends on |
|---|---|---|---|
| 1.1 | `order_index` + reorder + `set_number` discipline | §6.2.2–§6.2.4 | 0.2 |
| 1.2 | PR notification compensation | §8.2 | 0.2 (same file) |
| 1.3 | Two-tier dedup + bulk import w/ per-file commit | §5.2.2, §5.2.3 | 0.1 |

### Wave 2 — Data completion (3 items)

| # | Item | From | Depends on |
|---|---|---|---|
| 2.1 | FIT time axis end to end | §5.2.4 | — |
| 2.2 | `monthly_breakdown` consolidation | §4 S3 | 0.4, **0.1** (§2.4) |
| 2.3 | `geo_cluster_id` + hill leaderboard + surface `predicted_*` | §3 | **2.1** (§2.2) |

### Wave 3 — Generalisation (1 item)

| # | Item | From | Depends on |
|---|---|---|---|
| 3.1 | `UndoLog` shape + typed restorers + migrate `RouteMergeLog` | §8.3 | 1.2 (compensation pattern proven), 1.1 |

### Wave 4 — The verdict (1 item)

| # | Item | From | Depends on |
|---|---|---|---|
| 4.1 | Unified daily recommendation across 5 engines + `consensus[]` | §1 | 0.3, **0.1** (§2.1) |

**§1 is last deliberately.** It is the section that presents the app's conclusions to the
user, so it should ship over the most complete and most correct data the other sections
produce — not first, on partial data, adding authority to numbers that are about to change.

## 4. Migration inventory

Four migrations across all eight sections. Sequenced by wave so `alembic upgrade head` is
never run against a half-built feature.

| Wave | Migration | Table | New columns | Notes |
|---|---|---|---|---|
| 0.1 | `add_activity_import_fingerprint` | `activities` | `import_fingerprint String NULL` | Partial unique index `(user_id, import_fingerprint) WHERE import_fingerprint IS NOT NULL`. `sa.String` — top-level, safe |
| 1.1 | `add_lifting_set_order_index` | `lifting_sets` | `order_index Integer NULL` | `sa.Integer` — top-level, safe. Backfill in a second step (§6.2.2) |
| 2.3 | `add_segment_effort_geo_cluster` | `segment_efforts` | `geo_cluster_id UUID NULL` | `sa.UUID` is a valid top-level SQLAlchemy 2.0 export (pitfall 22). Plus a plain btree index |
| 3.1 | `create_undo_log` | `undo_log` | new table | **`payload JSONB` → `postgresql.JSONB()` with `from sqlalchemy.dialects import postgresql`.** See below |
| 3.1 | `migrate_route_merge_log` | `route_merge_log` → `undo_log` | data migration | Mechanical; `kind="route_merge"` |

**Pitfall 22 applies to exactly one of these** — `UndoLog.payload`. It is the only JSONB column
being introduced anywhere in the eight sections, and it is precisely the shape that broke
`alembic upgrade head` before (§87 shipped `sa.JSONB()` and reverted the entire migration via
transactional DDL). `tests/test_migration_dialect_types.py` AST-walks the whole chain and will
catch it, but the import must be written correctly regardless.

**Pitfall 24 applies to the backfills in 1.1 and 0.1**: both are data migrations on tables
that `create_all()` may already have populated, so they must be idempotent, guarded
(`WHERE order_index IS NULL`, `WHERE tss IS NULL`), and re-runnable. Never edit an applied
migration.

**Pitfall 14 applies to `UndoLog`**: new model, so it must be in **both** the import and
`__all__` in `app/models/__init__.py`, or `create_all()` never sees it.

**Pitfall 13 applies to three new routes**, all needing tests that assert decorator **index
order**, not handler existence:

| Route | Must sit above |
|---|---|
| `POST /activities/import-bulk` | `/{activity_id}/…` (`activities.py:944`) |
| `GET /segments/climbs/{geo_cluster_id}` | `/{segment_id}` |
| `PATCH /lifting/sessions/{id}/reorder` | (distinct shape; register above anyway) |

## 5. Cross-cutting gates

Every wave ends with the same four checks. Cheap, and each one has a precedent failure in this
repo's history.

| Gate | Check | Precedent |
|---|---|---|
| **Migrations** | `alembic downgrade <prev>` + `upgrade head` round-trip, **and** `git log` to confirm nothing already applied was edited | Pitfall 24 |
| **Dialect types** | `python -m pytest tests/test_migration_dialect_types.py -q` before claiming a migration is sound | §87 shipped with `sa.JSONB()`; transactional DDL reverted the whole thing |
| **Backend tests** | Host-side: `cd backend && python -m pytest tests/ -q` with CI env vars. **Not** `fittrack.py exec backend pytest` | Pitfall 23 — the container has no volume mount, so it silently cannot see new test files |
| **Route order** | Tests assert decorator index order for the three routes in §4 | The `/orphans` 422: the endpoint existed, the docs said the order was right, and the request still 422'd |

Plus, once per wave, `git status` before touching a file — four of the files in this plan
(`activities.py`, `lifting.py`, `services/charts.py`, `useLiveSession.ts`) are large, central,
and have a history of careful in-place fixes (`B2`/`B4` markers, the `or 200` sentinel, the
`created_at` ordering assumption). A clean working tree is the only `git checkout --` rollback.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Five waves feels slow for a single-user app | Each wave is independently shippable. Wave 0 alone fixes three live defects. Nothing waits on coordination |
| §5's TSS backfill touches many rows | `WHERE tss IS NULL AND source='manual'` — bounded to previously-stranded imports, idempotent, re-runnable |
| The §1 dependency (§2.1) is invisible from §1's own spec file | Recorded here and cross-referenced from §1's plan file. §1's header already names §2; it should also name §5 |
| Deadlines / one person | Wave 0 is the correct stopping point. It contains the three highest-severity findings (fabricated zeros, a wedge-able workout, invisible imports) and nothing else is blocked on it |
| The rejected items resurface later | §1.1–§1.3 state the reasoning and, for offline reads, an explicit trigger. Re-deriving this is cheaper than re-arguing it |

## 7. AGENTS pitfalls honored

Consolidated for the plan as a whole; each spec carries its own list too.

- **21** — provenance over mutable fields (§5.2.2's `ActivitySource`, §6.1.2's
  `import_fingerprint` as content-derived, §1.2's rejection of rewriting historical identity).
- **22** — exactly one JSONB column introduced; dialect import written out (see §4).
- **24** — four new forward migrations, nothing applied is edited; backfills idempotent.
- **13** — three new routes, tests assert decorator **index order**.
- **14** — `UndoLog` registered in `models/__init__.py` import **and** `__all__`.
- **23** — host-side backend tests throughout; never `fittrack.py exec backend pytest`.
- **10** — ServiceWorker keeps API calls network-only; offline reads are deferred (§1.3), so
  no query cache is persisted.
- **Rules 1/2/11/12/13/14** (git discipline, file ownership, verify-before-destructive-writes)
  — §5 of this document exists because the touched files are central and hand-patched.