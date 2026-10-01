# Design Spec — Section 2: Generalize TSB Projection to Non-Event Plans

> **Date**: 2026-10-01 · **Type**: scope widening (low risk) · **Surface**: `/training`, `/today`
> **Origin**: re-baselanced during Section 1 re-baseline — `/today` already ships
> `GET /dashboard/today` + `_suggest_rest_days`; its verdict just doesn't consume a
> forward projection. This is the missing input Section 1's verdict needs.
>
> **Status**: decided (7-day horizon for `/today`; optional `projected_load` on
> `TodaySummary`). Plan-mode draft — relocate to repo `plans/` + commit on build mode.

## 1. Problem

`compute_tsb_projection(db, user_id, plan_id, days_ahead=14)` is hard-gated on
`plan.event_id` (`services/projections.py:705-706`) — it raises
`ValueError("Training plan is not linked to an event")`. Consequence:

- `GET /projections/tsb/{plan_id}` returns **400 for any non-event plan**.
- `/today` gets **no forward TSB look-ahead** for ordinary training plans.
- `/training` `WeeklyView`'s `['tsb-projection']` strip is gated on
  `!!plan.event_id` (`WeeklyView.tsx:212`) → invisible for non-race plans.

The pure math (`tsb_projection`, `projections.py:157` taking
`planned_tss_per_day: list[tuple[date, float | None]]`) is **already correct and
unit-tested**. It fills `None` days as rest and returns `{date,ctl,atl,tsb}` per
day. Fix = unblock it for non-event plans.

## 2. Design

**Decision:** generalize `compute_tsb_projection` to work for **any active plan**;
keep full back-compat for event-linked plans. Skip-sensitivity is **out of
scope** (separate spec). No new tables, no migrations (pitfalls 22/24 safe).

### 2.1 `services/projections.py`

```python
async def compute_tsb_projection(
    db, user_id, plan_id, days_ahead: int = 14,
) -> dict:
    # 1. Load plan (ownership still validated).
    # 2. If plan.event_id: fetch Event.event_date (as today).
    #    Else: event_date = None, race_day_tsb = None, freshness_assessment = None.
    # 3..5. unchanged: current CTL/ATL/TSB, planned TSS tomorrow..+N (None=rest),
    #        tsb_projection(), terminal entry when no event.
    # Return: projection[] always populated; race/event fields nullable.
```

- Remove the `ValueError` on missing `event_id`.
- `days_ahead` default stays 14 (existing callers: WeeklyView, PDF report).
- Horizon generalization already supported via `days` param on the API; the
  *default* used by `/dashboard/today` is the call-site choice (7) — see 2.3.

### 2.2 API — `api/projections.py`

- `GET /tsb/{plan_id}?days=N` (N 1..60, default 14): now **200 for non-event
  plans** (was 400). Static route — register before dynamic `/{param}` (pitfall 13).
- `LookupError` (missing plan/ownership) → 404; unchanged.

### 2.3 Consumers

**`/dashboard/today` (`api/dashboard/today.py`):**
- New optional field on `TodaySummary`: `projected_load: list[ProjectionPoint] | None` (see 2.4).
- In `dashboard_today()`: if the user has an **active plan**, call
  `compute_tsb_projection(db, uid, active_plan.id, days_ahead=7)`; attach its
  `projection` list. If no active plan, `projected_load=None`. Cached path: the
  7-day read hits the already-cached `_today_load_values` (5-min Redis) + one
  `TrainingPlanDay` query (already used by the week fetch) — no new latency
  class for the dashboard.

**`/today/page.tsx`:** render a compact 7-day TSB sparkline / a "drifts into fatigue
on Friday" cue from `todaySummary.projected_load`. No new query — reuses
`['dashboard','today']`.

**`/training` `WeeklyView.tsx`:** drop `&& !!plan.event_id` from the
`['tsb-projection']` `enabled` clause; relabel "Race TSB" → "Projected TSB"
(non-event) / "Race TSB" (event-linked) via `t.event_date`.

### 2.4 Schema

- `schemas/projections.py` (`TsbProjectionResponse`): `event_date`, `race_day_tsb`,
  `freshness_assessment` → `Optional` (default `None`). `projection` required;
  `plan_id`/`current_tsb` unchanged. Back-compatible for existing event callers.
- `schemas/dashboard.py` (`TodaySummary`): add
  `projected_load: list[ProjectionPoint] | None = None` (new, optional). No
  existing consumer breaks. Define `ProjectionPoint = {date, ctl, atl, tsb}`
  (reuse the projection dict shape; keep it schema-light).

## 3. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Non-event plans now project → WeeklyView shows a strip it didn't before | Intentional; relabelled "Projected TSB". Regression test asserts event plans still render "Race TSB" identically |
| `days_ahead=7` for `/today` vs default 14 | Call-site default of 7 in `dashboard_today`; service default unchanged so WeeklyView/PDF unaffected |
| Projection lag behind live data staleness (Pitfall 2) | Reuse the 5-min-cached `_today_load_values`; projected_load staleTime = 1 min on the React Query side |

## 4. Testing (host-side — pitfall 23)

`tests/test_projections.py` + `tests/integration/test_tsb_projection_event.py`:
- Non-event active plan → `GET /tsb/{plan_id}` **200**, `projection` populated,
  `race_day_tsb=null`, `event_date=null`.
- Event-linked plan → **unchanged** shape (regression gate).
- `days=7` vs `days=14` horizon respects the param.
- `tsb_projection` pure-function tests untouched.
- `/dashboard/today` returns non-null `projected_load` for an active non-event
  plan, null for a user with no plan.

## 5. Defers (explicit)
- **Skip-sensitivity** ("rest Tuesday → terminal TSB loses 3.2") — multi-scenario
  projection + comparison UI. Separate spec.
- **Confidence/provenance on the projection** — pure fn is deterministic;
  provenance = the `planned_tss` source path. Note only.

## 6. AGENS pitfalls honored
- **13** — `GET /tsb/{plan_id}` is static; ordered before dynamic routes.
- **22/24** — no migration, no `sa.JSONB()`, no stamping-without-running.
- **23** — backend tests host-side (`pytest tests/ -q` from `backend/`).
- **11** — React Query `enabled: !!token` preserved on `['dashboard','today']`.
