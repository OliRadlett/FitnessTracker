# Design Spec — Section 8: Undo as Compensation (the PR notification that can never be retracted)

> **Date**: 2026-10-01 · **Type**: bug fix (data integrity) + design system · **Surface**: PR notifications, `delete_set`, route merge undo, live tracker undo
>
> **Origin**: brainstorm `plans/brainstorm-2026-09-30-open-agenda.md` inventory item
> "undo". Deferred twice as "a design problem, not an implementation one". **That was
> correct, and this section is the design work** — deferred a third time it would have been
> a dodge.
>
> **Re-baselined twice over.** Undo is not missing: `RouteMergeLog` +
> `POST /routes/merge/{log_id}/undo` is a working, shipped undo, and it already encodes the
> hard part of the problem. The gap is that **one destructive path has an out-of-band side
> effect that cannot currently be undone at all** — and that effect is a user-facing lie.
>
> Plan-mode draft — relocate to repo `plans/` + commit on build mode.

## 1. Problem

### 1.1 Undo already exists, and it is the right shape

`RouteMergeLog` (`models/route.py:112-153`) plus
`undo_route_merge` (`route_service.py:861`) is a complete undo implementation:

- `snapshot: JSONB` — "enough to recreate it" (the merged row is hard-deleted).
- `moved: JSONB` — what was re-pointed, so restore can put it back.
- `undone_at: DateTime | None` — **idempotency guard**, enforced by the read query
  (`routes.py:985`, `.where(RouteMergeLog.undone_at.is_(None))`).
- `merged_route_id` deliberately **not** a FK, because the row is gone — a design note
  explaining why, rather than a broken constraint.
- `api/routes.py:994` returns `merge_log_id` on the merge response, so the UI can offer undo
  immediately.

So the mechanism is not the problem, and this section must not invent a second one.

### 1.2 The precedent already contains the hard insight

`models/route.py:141-144`:

> *"Only `identical` merges train the embedding metric; variants must never teach the
> matcher that distinct routes are duplicates."*

A merge has an **out-of-band effect**: it trains a learned matcher. Undoing the row while
leaving that signal intact means the matcher still believes the two routes are duplicates and
will re-propose the merge. The codebase handles this by **not creating** the signal for
`variant` merges in the first place — prevention, not compensation.

That is the governing lesson: **a destructive operation's undo is only complete if it also
retracts what the operation taught or announced outside its own rows.** Row restoration is
the easy half.

### 1.3 The concrete defect: a PR notification outlives the record, and is then un-reissuable

Trace `delete_set` (`services/lifting.py:660-689`) on a set that held a PR:

1. `:670-679` — volume decremented. Correct.
2. `:681` — **the `LiftingSet` row is hard-deleted.**
3. `:686` — `_recalculate_pr_after_set_change`.
4. `services/lifting.py:836-841` — no sets remain for that exercise → **`db.delete(existing_pr)`**,
   return `None`. **No notification is issued.**

The user is left with a "🎉 Bench Press PR — 100.0 kg × 5 — e1RM 110.0 kg" notification in
their history for a record that **no longer exists**. Nothing retracts it; `notifications.py`
has no delete path at all.

Then the trap closes. `_notify_pr` (`:695-714`) sets
`dedup_key = f"pr:{pr.exercise_name}:{pr.achieved_date}"`, and `notify` enforces it at
`:90-98`:

```python
if dedup_key:
    dup = await db.execute(
        select(Notification.id).where(
            Notification.user_id == user_id,
            Notification.dedup_key == dedup_key,
        )
    )
    if dup.scalar_one_or_none() is not None:
        return None
```

Unbounded — no time window, no recency bound. So if the user later **re-logs the same lift on
the same date**, `_check_and_record_pr` → `_notify_pr` → the stale notification row matches
the dedup key → **returns `None`**.

The failure is symmetric and permanent in both directions:

| | State |
|---|---|
| PR retracted | Notification still claims it happened |
| PR genuinely re-earned | **Silence** — the dedup row from the retracted record suppresses it |

So one delete produces a notification that is simultaneously stale and blocking. This is the
sharpest instance of the §1.2 principle in the codebase: the out-of-band effect (an announced
claim) is the part that can't be undone.

### 1.4 The asymmetry is documented, which makes it an omission

`services/lifting.py:855-857`:

> *"Only notify when this recalculation genuinely improved the PR (a set deletion that lowers
> it must not fire a 'new PR' notification)."*

The **downgrade** case was thought about and is correctly handled. The **retraction** case —
`:836-841`, the PR row is deleted outright — was not. Same function, adjacent branches, one
handled and one not.

### 1.5 There is no soft delete anywhere

Grep across `backend/app` for `deleted_at` / `is_deleted` / `soft_delete` / `trash` /
`undelete` / `restore` returns **no soft-delete infrastructure** — only the route-merge undo
and the quarantine stamp. So "undo" in this app cannot mean a trash can, and a spec that
proposes one would be proposing a different product.

### 1.6 The live tracker's undo is local-only

`useLiveSession.undoLastSet` (`:518-532`) removes the last set from local state and queues the
remote id for deletion. It is single-level (no redo), local-only (no server snapshot), and
adjacent to the deep problem: an undo that races the sync engine. §3.3 covers the interaction
with Section 7's dead-letter machinery.

## 2. Design

The core decision: **do not build a trash can.** Undo here means *compensating an operation's
out-of-band effects*, and only some operations have any worth compensating.

### 2.1 Classify destructive operations by compensability

| Class | Examples | Undo needed |
|---|---|---|
| **1 — No out-of-band effects** | Editing notes, `WeightLog` edits, deleting a warmup template | Row restore suffices. No log needed. |
| **2 — In-band derived state** | `delete_set` (→ volume, PR recalculation), `update_set` | Already compensated by existing recalculation. Undo = re-insert + re-run the same recalculation. |
| **3 — Out-of-band side effects** | Route merge (→ embedding metric), **PR notification**, bulk import batch (§5), session discard | **Undo log required.** This is the class that needs design. |

Only class 3 earns machinery. §1.3 is the cheapest live instance of class 3.

### 2.2 Compensate PR retraction — the concrete fix

Make the retraction branch (`:836-841`) announce its own reversal:

- **Delete the notification row** matching `dedup_key = f"pr:{exercise}:{date}"` when the PR
  is retracted, so the stale claim disappears **and** the dedup key is freed for a genuine
  re-earn. One delete fixes both halves of §1.3.
- Emit a **compensating notification** (`type="pr_revoked"`, `severity="info"`) stating that
  the record was retracted — because the original claim was *pushed* to devices (see §3.1),
  so silence would leave the user believing a PR they no longer hold.
- This makes `_notify_pr`'s existing dedup behaviour correct by construction: dedup exists to
  suppress *duplicate* notifications for one achievement, not to suppress the re-earn of an
  achievement that was properly retracted.

Add `revoked_at` (nullable) to `PersonalRecord`? **No** — the row is deleted, so the
notification delete is the whole compensation. Keep it minimal.

### 2.3 Generalise the log's *shape*, not the mechanism

Do **not** add a generic trash/`SoftDeleteMixin`. Do extract the two things genuinely
duplicated by every future class-3 undo:

```python
class UndoLog(Base):
    user_id, kind, payload(JSONB), undone_at, expires_at, created_at
```

- `payload` is the operation's snapshot — same role as `RouteMergeLog.snapshot` + `.moved`.
- `undone_at` is the replay guard (`:985`'s pattern).
- `expires_at` is the **one genuinely cross-cutting policy**: how long a destructive
  operation stays undoable. Centralising it is the real reason for the table — without it,
  every future undo invents its own retention rule.
- **Restore logic stays typed per kind**, registered in a `RESTORERS: dict[str, Callable]`
  dispatch. A single table must not become a JSONB-shaped hole where each operation's restore
  is untyped string manipulation against a payload whose shape nothing enforces.

Migrate `RouteMergeLog` onto it, keeping its existing richer columns (`merge_kind`,
`breakdown`, `score`) as kind-specific detail — or keep both tables if the migration is not
worth it. **Decision: migrate.** Two undo logs with different retention policies is exactly
the inconsistency a cross-cutting policy table exists to prevent, and the migration is
mechanical (existing rows become `kind="route_merge"`).

### 2.4 Undo window, single-level, server-authoritative

- **Single-level.** No redo, no multi-level stack. Matches `RouteMergeLog` and the live
  tracker's existing one-level undo. A stack implies ordered re-application, which implies
  replay semantics nobody needs in a single-user app.
- **Window:** 30 days, enforced by `expires_at`. Undo claims in the UI are computed against
  it, and a sweep task prunes expired rows (they are only audit data afterwards).
- **Server-authoritative.** The undo endpoint checks ownership *and* that `undone_at IS NULL`
  in the same query, so a double-clicked undo is a no-op rather than a double-restore.

### 2.5 Reuse the existing restore

For class-2 undo of a set delete, there is nothing to build: re-insert the `LiftingSet` with
its captured columns and call `_recalculate_pr_after_set_change` — the same compensation the
delete already performs, run in reverse. §2.2 makes that idempotent with respect to
notifications.

## 3. Traps

### 3.1 A delivered web push cannot be unsent

`notify` dispatches best-effort to the user's devices inside the transaction
(`notifications.py:113-129`), and it is already committed to the device by the time a
retraction could run. **This is an irreducible limit, not a bug.** A retraction notification
is the only available compensation, which is exactly why §2.2 emits one rather than
deleting silently. State this honestly in the code comment so nobody later "optimises" the
compensating notification away as redundant.

### 3.2 Notification delete and PR delete must be in the same transaction

`db.delete(existing_pr)` and the notification delete must commit together. If the
notification delete commits and the PR delete rolls back, the user loses the notification for
a PR they still hold **and** the dedup key with it — permanently silenced. Both or neither.

### 3.3 Undo re-enters the live sync machinery

An undone set re-enters the local queue with a `client_id` that must **not** collide with the
original (Section 7 §2.2 dead-letter). If the undone set reuses the original `client_id`,
`add_set`'s idempotency check (`services/lifting.py:563-572`) returns the **deleted** set's
idempotent match — or nothing, depending on whether the row is truly gone — and the undo
either no-ops or double-creates. Mint a fresh `client_id` on undo.

### 3.4 `undone_at` must be set by the update, not by the restorer

`routes.py:1093-1094` sets `undone_at` with a bulk `update()`. Preserve that ordering: claim
the log row (conditional `WHERE undone_at IS NULL`, assert `rowcount == 1`) **before**
performing the restore. Claim-after means two concurrent undos both restore.

### 3.5 Do not resurrect rows the server has since deleted

A `DELETE`-and-`INSERT` restore can resurrect a row that a provider re-sync removed for its
own reasons (e.g. the activity purge in pitfall 21). The restorer must re-validate that each
captured parent still exists; a restore whose parent is gone should fail loudly rather than
re-insert an orphan.

## 4. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| A "PR revoked" notification feels noisy | Only fires on genuine retraction (PR deleted outright), which is rare and user-initiated. `severity="info"`, not success |
| Retraction emit feels redundant given the delete | §3.1 — the push already went out. Documented so it survives review |
| `RouteMergeLog` migration loses data | Mechanical; existing rows become `kind="route_merge"`. Test round-trip one real merge undo after migration |
| JSONB payload shape drift between kinds | Typed restorers (§2.3) validate the payload on entry; a kind with no registered restorer is rejected, not silently ignored |
| Undo log grows unbounded | 30-day `expires_at` + prune task (§2.4) |
| Retracting a PR that a *different* set also earned | `_recalculate_pr_after_set_change` only deletes when **no sets remain** (`:836`), so the compensation is scoped to true retraction. Keyed by exercise **and** date, matching `_notify_pr` exactly |

## 5. Testing

- **§1.3 core regression**: log a PR set → assert a notification exists; delete the set →
  assert (a) the `PersonalRecord` is gone, (b) the notification row is gone, (c) a
  `pr_revoked` notification exists.
- **§1.3 re-earn**: after the retraction, re-log the same lift on the same date → assert a
  **new** PR notification is issued. This test fails on current code and is the whole point.
- **§1.4 downgrade untouched**: deleting a *non*-PR set still fires no notification (guards
  the existing `:857` behaviour against regression).
- **§2.2 transaction atomicity**: force a rollback after the notification delete → assert both
  the PR and its notification survive (§3.2).
- **§2.4 idempotency**: undoing the same `merge_log_id` twice is a no-op the second time;
  a second concurrent undo restores exactly once (§3.4).
- **§2.4 expiry**: an `UndoLog` past `expires_at` is rejected; the prune task removes it.
- **§3.3**: undoing a set creates a row with a **different** `client_id`; re-syncing it does
  not collide with the deleted set.
- **§3.5**: undoing a set whose parent session was deleted fails loudly, leaving no orphan.
- **Migration**: after moving `RouteMergeLog` onto `UndoLog`, one real merge → undo round-trip
  still restores the route and its moved activities.

## 6. Defers (explicit)

- **Multi-level undo / redo stack.** Deliberately rejected in §2.4 — implies replay semantics
  a single-user app does not need.
- **A trash can / soft delete.** Explicitly rejected (§2.5). Would be a different product and
  a permanent cost on every query (pitfall-adjacent: the `source != "wahoo"` filter family
  of "every read must now exclude deleted rows" — the exact class of bug Section 4 §3.2 is
  about).
- **Undo for activity deletion / bulk operations.** Class 3 in principle; each needs its own
  side-effect inventory first. §5's bulk import already reports per-file outcomes, which is a
  natural starting inventory.
- **Undo across offline periods.** An undo requested while offline needs the same queue as
  Section 7's; share that machinery rather than building a second one.
- **Cross-section integration pass** over all eight specs — see the sequencing note in the
  session summary, not a separate spec.

## 7. AGENTS pitfalls honored

- **24** — new forward migrations for `UndoLog` and the `route_merge_log` migration. Nothing
  already applied is edited.
- **22** — `payload` is `JSONB`, so `from sqlalchemy.dialects import postgresql` is spelled
  out explicitly (`postgresql.JSONB()`), and guarded by `tests/test_migration_dialect_types.py`.
- **14** — `UndoLog` is a new model: added to **both** the import and `__all__` in
  `app/models/__init__.py`, or `create_all()` will not see it and runtime raises
  `UndefinedTableError`.
- **13** — `POST /routes/merge/{log_id}/undo` already exists above the dynamic route handlers;
  any new undo route registers above `/{param}` and its test asserts decorator **index
  order**.
- **Async everywhere** — restorers are `async` and awaited; `routes.py:1108` already awaits
  `undo_route_merge`.
- **21** — provenance over mutable fields: the undo log records **what was captured**, and
  restoration re-derives current state rather than trusting a mutable snapshot.
- **23** — tests run host-side from `backend/` with `python -m pytest tests/ -q`.