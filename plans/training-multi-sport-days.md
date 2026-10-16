# Multi-Sport Days — Plan

> **Status**: v1 — in scope, **its own phase** (after Phase 1). Companion to [`training-redesign-plan.md`](training-redesign-plan.md) and [`training-plan-mode-spec.md`](training-plan-mode-spec.md).
> **Goal**: a single plan date may hold **more than one session** (e.g. a morning ride + an evening lift). Rare, but supported.

---

## 1. Model

`TrainingPlanDay` already **is a session** — one `sport` per row, with sport-specific fields (`planned_power_watts`/`zone`/`route` for cycle; `planned_exercises`/`focus`/`rpe` for strength). So multi-sport needs **no new table**: it means more than one `TrainingPlanDay` row per `(plan_id, day_date)`, distinguished by `sport`.

This is possible today — **there is no UNIQUE `(plan_id, day_date)` constraint** (verified while building the swap endpoint). The "one row per date" rule lives only in service logic.

**Invariants**
- Sessions on a date are distinct by **sport**, with one deliberate carve-out: a *completed* row does not block an arriving row of the same sport, so a missed ride may land on a day that was already ridden. Two **uncompleted** rows of one sport are never allowed.
- `rest` is exclusive: a rest row may not coexist with other sessions (a date with any session is not a rest day).

---

## 2. What Phase 1 must do now (so this stays additive)

The cheapest way to avoid a rewrite later is to make Phase 1 **session-scoped** rather than date-scoped:

1. **Key the editor by day id (row), not date.** `DayEditor` already receives a `TrainingWeekDay` with an `id`, and `usePlanDayOps` already operates on ids — keep it that way.
2. **Day grid renders a list per date.** `DayCell` should take a date → `TrainingWeekDay[]` and render 1..N session chips. One session looks exactly as it does now.
3. **Week payload consumption builds `Map<date, TrainingWeekDay[]>`** (not `Map<date, day>`). Small change now, big payoff.
4. **Ops stay session-scoped**: Move / Swap / Delete act on a session id — already true for the three endpoints.

---

## 3. Changes when this phase is built

**Backend (small, no migration)**
| Change | Detail |
|---|---|
| `reschedule` 409 | Only when an uncompleted non-rest day **of the same sport** occupies the target date — moving a ride onto a lift day becomes legal. |
| `add_plan_day` 409 | Only when the **same sport** already exists at that date. |
| `save_plan_days` / `_validate_days` | Key/dedupe by `(day_date, sport)` instead of `day_date`. (The UI stops using the full-array path in Phase 1 anyway.) |
| `substitute` / day `PATCH` | A change to an existing row's **sport** is checked against the date's other sessions — same rule, same 409. |

**Frontend**
- `DayCell` renders N session chips + an "Add session" affordance (pick the missing sport).
- `DayEditor` header shows the session's sport; "Add session" adds the other sport on the same date.
- Week bar grows with session count (cap: 2 chips + a "+1" overflow). The cap is only reachable if a third sport becomes addable, since `ADDABLE_SPORTS` offers just cycle and strength, so a date holds at most two sessions today.

---

## 4. Edge cases

- **Two sessions, same sport, one date** → rejected.
- **A sport changed on an existing row** (day `PATCH`, `substitute`) → same rule, so a second row of that sport or a `rest` beside a session is a 409. The editor's Sport select shows it as a toast.
- **A swap that would double a sport** → 409, the same rule as a move. `swap_plan_days` exchanges two rows' dates and excludes the pair from its own check, so it only collides when a *third* session sits on one of the two dates — which this phase makes possible.
- **Rest + session on a date** → rejected; "Mark as rest" is disabled when other sessions exist (and clears a lone session).
- **Rest-swap action on a two-session date** → not offered. The autoregulation action's intent is to rest a *day*, which is ambiguous where two sessions sit on it, and resting the whole date needs a capability the action does not have — deferred, not guessed at. `_actions_for(force_rest=True)` emits nothing for such a date.
- **`link_activities`** already matches by date **and** sport (cycle→activity, strength→session), so two rows on a date link their own actuals — verify the matcher doesn't cross-link.
- **Conformity** scores per row (sport + its own linked actual) — already correct.
- **Weekly `planned_tss`** sums both sessions — desired.

---

## 5. Decisions

| Question | Decision |
|---|---|
| Model | **Multiple `TrainingPlanDay` rows per `(date, sport)`** — not a child-sessions table. |
| Phase 1 constraint | Editor + grid keyed by **session id**; grid maps **date → list**. |
| Placement | **After Phase 1** — the editor is session-scoped by then. |
