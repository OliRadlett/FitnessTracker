# RMI-08 Audit: CrossDomainInsight duplicate accumulation

**Task:** t1 [audit] — verify the duplicate-accumulation bug and assess the
unique-constraint + upsert fix.
**Worktree:** `C:\Projects\fitness-tracker-upsert` (branch `fix/cross-domain-insight-upsert`)
**Verdict:** Bug **confirmed** for `sleep_performance` and `cross_sport`.
Approach **sound** for those two types; `race_retrospective` needs an explicit
design decision (see §4).

---

## 1. Sites that touch `CrossDomainInsight`

### CREATE — the only production write path
`backend/app/tasks/scheduler.py` → `analyze_cross_domain_weekly` (the Sunday 07:00 UTC
Celery beat task; `app.tasks.scheduler.analyze_cross_domain_weekly`).

Loop over the three insight types at **L2744–2789**:

```python
for insight_type in ["sleep_performance", "cross_sport", "race_retrospective"]:
    insight_data = results.get(insight_type)
    if not insight_data:
        continue
    ...
    insight = CrossDomainInsight(
        user_id=uid,
        insight_type=insight_type,
        results=insight_data,
        insights=insight_data.get("insights", []),
        data_quality=data_quality,
    )
    db.add(insight)          # L2786 — blind insert, no lookup
    analyzed_count += 1
    await db.commit()        # L2789
```

- `sleep_performance` / `cross_sport`: gated **only** on
  `data_quality.sufficient` (L2774–2777). When sufficient, a brand-new row is
  `db.add()`-ed and committed. **No dedup lookup. → one new row every weekly run.**
- `race_retrospective`: additionally gates on `race_event_id` being set and the
  result being non-empty (L2755–2772). It is also pre-filtered by
  `_build_race_retrospective_args`.

Dedup for `race_retrospective` lives in **L2408–2419** of `_build_race_retrospective_args`:
it selects existing `race_retrospective` rows and bails when one already has
`results["event_id"] == str(event.id)`. So a *given event* is stored once; a
*new* event yields a *new* row.

### MODEL
`backend/app/models/cross_domain.py` (L17–52): `CrossDomainInsight`,
`__tablename__ = "cross_domain_insights"`. Columns: `id` (UUID PK),
`user_id` (FK users.id ON DELETE CASCADE, indexed), `insight_type` (String(50)),
`period_start`/`period_end`, `results`/`insights`/`data_quality` (JSONB),
`created_at` (server_default now()). **No `__table_args__`, no `UniqueConstraint`.**

Relationship back-reference declared in `backend/app/models/user.py` L101:
`User.cross_domain_insights: Mapped[list["CrossDomainInsight"]]`.

### TABLE ORIGIN / DB-LEVEL UNIQUENESS
`backend/alembic/versions/059_create_cross_domain_insights.py`: created the table
and a **plain (non-unique)** index
`ix_cross_domain_insights_user_type` on `(user_id, insight_type)`. No unique
constraint exists at the database level — the bug is structural, not just
application-level.

### READERS
- `backend/app/api/cross_domain.py`
  - `GET /cross-domain` (L15–64): fetches up to **30** rows ordered by `created_at`
    desc, then **groups by type and returns only the latest per type** (L47–62).
    This is the "latest-per-type workaround" that masks accumulation from the UI.
  - `GET /cross-domain/{insight_type}` (L67–101): returns the single latest row
    (`order_by(created_at desc).limit(1)`). Also masks accumulation.
- `backend/app/services/today.py` → `_cross_domain_row` (L168–196): reads the
  single latest row (limit 1, order created_at desc); emits `available: false`
  with "runs weekly on Sundays" when absent. Masks accumulation; consumes only the latest.
- `backend/app/services/data_export.py` → `build_full_export` (L187–190):
  `_query_user_rows(db, CrossDomainInsight, user_id)` returns **every** row, **no
  limit**. This is the one reader that surfaces accumulated duplicates to the user
  (GDPR portability export).

### TESTS (no expected breakage)
- `tests/integration/test_race_retrospective.py` L101–119
  (`test_existing_retrospective_dedups`): pre-inserts a single `race_retrospective`
  row and asserts `_build_race_retrospective_args` returns empty. Tests the
  event_id dedup, not the scheduler insert. Survives the constraint.
- `tests/integration/test_today_verdict.py` L98–119: inserts a single
  `sleep_performance` row. Survives.
- `tests/integration/test_account_and_export.py` L92 & L132: seeds one row, asserts
  `len(coll["cross_domain_insights"]) >= 1`. Survives.
- No test invokes `analyze_cross_domain_weekly` end-to-end (Modal-gated), so the
  blind-insert path is not covered by tests today — a gap the fix should close.

---

## 2. Bug scope — verified

`analyze_cross_domain_weekly` runs **once a week** per user with sufficient data
(≥14 sleep + ≥14 performance days for `sleep_performance`; ≥7 lift + ≥7 cycle
sessions for `cross_sport` — see `analyze_sleep_performance` and
`analyze_cross_sport_fatigue` in `integrations/cross_domain.py`).

| insight_type | Weekly gate | Dedup today? | Accumulation |
|---|---|---|---|
| `sleep_performance` | `data_quality.sufficient` (≥10 paired points) | **No** | ✅ one new row every week |
| `cross_sport` | `data_quality.sufficient` (≥10 combined pairs) | **No** | ✅ one new row every week |
| `race_retrospective` | new eligible event (event_id check) | **Yes**, by event | bounded by #raced events (not weekly) |

After N weekly runs a qualifying user has N rows each for `sleep_performance`
and `cross_sport`; the API/export just keeps returning/overwriting the latest.
Growth is linear in weeks and unbounded — the bug is real and unguarded.

---

## 3. Recommended fix structure

1. **Model** — add a uniqueness guarantee mirroring the existing pattern used by
   e.g. `Exercise`, `PushSubscription`, `SleepLog` (`__table_args__` +
   `UniqueConstraint`):
   ```python
   from sqlalchemy import UniqueConstraint
   __table_args__ = (
       UniqueConstraint("user_id", "insight_type",
                        name="uq_cross_domain_insight_user_type"),
   )
   ```
   This both documents the invariant and blocks new blind inserts at the DB layer.

2. **Migration** (new revision — see §5 on numbering) — clean existing duplicates
   first, then add the constraint:
   - For each `(user_id, insight_type)`, keep the newest row by
     `(created_at DESC, id DESC)` and **delete the rest**. This is required because
     the table currently has many duplicate `(user_id, insight_type)` rows in
     production (one per past weekly run).
   - Replace the **non-unique** `ix_cross_domain_insights_user_type` index (from
     migration 059) with a **unique** one (or drop + recreate as unique).

3. **Scheduler upsert** — in `analyze_cross_domain_weekly`, replace
   `db.add(insight)` + `db.commit()` with an upsert keyed on `(user_id, insight_type)`:
   - Select the existing row; if present, update its `results`/`insights`/
     `data_quality`/`period_start`/`period_end` in place and commit; else insert.
   - Or, cleaner: a single `postgresql.insert(CrossDomainInsight)
     .on_conflict_do_update(indexes=("user_id", "insight_type"), set_={...})`
     (SQLAlchemy 2.0 / Postgres native upsert). The constraint added in step 1 is
     exactly the conflict target.

4. **Readers stay correct** — the API and `today.py` already read "latest only",
   so once the table holds one row per `(user_id, insight_type)` they keep
   returning the right thing; `data_export` will simply stop emitting
   duplicates (improved, correct export shape). No reader changes required for
   correctness, though the API's `limit(30)`/`latest-per-type` grouping becomes
   redundant and can be simplified later.

---

## 4. Soundness: the `race_retrospective` tension (DECISION REQUIRED)

The proposed `UniqueConstraint(user_id, insight_type)` applies to **all three**
types — including `race_retrospective`, whose **current** design stores one row
per raced **event** (deduped by `results.event_id`, not by `(user_id, type)`).

- Under a strict `(user_id, insight_type)` constraint, a **new** race event would
  UPSERT over the row for an **older** event → historical retrospectives are
  overwritten, and the duplicate-cleaning migration would **delete** older
  `race_retrospective` rows outright.
- That is data loss **and** a behavior change, **but** every current reader
  already consumes only the latest (`api/cross_domain.py` L83–84,
  `today.py` L176–181). Only `data_export.py` currently emits all retrospective
  rows. So collapsing to latest is consistent with observed read behaviour and with
  the task's stated single-row-per-type intent.

**Options for the team:**
- **A (recommended, matches the task spec):** one row per `(user_id, insight_type)`
  for *all* types — latest wins for `race_retrospective` too. Keep the
  `_build_race_retrospective_args` event_id check as a *performance* optimisation
  (skips the Modal call for an already-stored event) even though the hard
  uniqueness now lives in the DB upsert. The migration keeps the newest
  `race_retrospective` row per user and drops older events' retrospectives.
- **B (preserve history):** keep `race_retrospective` out of the constraint, e.g.
  a **partial** unique index `WHERE insight_type != 'race_retrospective'`, or a
  full unique `(user_id, insight_type, event_id)`. The latter is awkward because
  `event_id` lives inside the JSONB `results` column — it would need a dedicated
  `event_id` nullable column on the model (plus its own migration). Option B is
  larger scope and contradicts the "latest per type" read path; flag only.

> **For task t1 (audit): this is a finding, not a blocker.** Option A is sound and
> matches the fix as specified; it should be confirmed by the captain before the
> model/migration/upsert tasks proceed so the migration writer deletes duplicates
> with the right retention (newest per type) and the upsert task knows the
> conflict target.

---

## 5. Migration-numbering caution (pitfall 34)

The worktree's latest migration is **096**. The next free sequential revision is
**097**. AGENTS.md documents that this repo has suffered a revision-number
collision between a long-lived branch and `main` shipping the same number
(`KeyError: '092'` from `get_heads()` blocks every alembic command). Before
creating the migration, confirm `097` is not also claimed on `origin/main`
(`git ls-tree origin/main backend/alembic/versions/097*.py`) and renumber the
new file **to your own number** rather than editing trunk revisions. A failed
`alembic upgrade head` leaves a half-applied migration (per-migration transaction
rollbacks), and `prod` must never carry an unrecoverable head.

---

## 6. Summary

- **Bug confirmed:** `sleep_performance` and `cross_sport` accumulate one
  `CrossDomainInsight` row per weekly scheduler run per qualifying user with no
  dedup. Confirmed at the single create site `scheduler.py:2779`–`2789`; the model
  (`cross_domain.py`) and DB (migration 059) enforce no uniqueness.
- **Readers mask it:** both API endpoints and `today.py` read only the latest row;
  only `data_export.py` emits every duplicate.
- **Fix is sound** for `sleep_performance`/`cross_sport` (unique constraint on
  `(user_id, insight_type)` + duplicate-cleaning migration + scheduler upsert).
- **Decision point:** the same constraint also redefines `race_retrospective` from
  per-event to latest-only (Option A) — confirm before implementing.
- **No existing test breaks** (no test asserts duplicate rows; none runs the weekly
  task end-to-end).
