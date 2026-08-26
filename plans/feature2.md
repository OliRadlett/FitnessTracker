# Feature 2 — Surface Existing Intelligence (Core)

> **Status**: Approved — not started
> **Type**: Core
> **Dependencies**: none (feature1 independent)
> **Own plan**: this document. Work is discrete — do not bundle with other features.

## Goal

Two already-computed, already-stored datasets are invisible in the UI. Surface them cheaply:

1. **Sleep intelligence** — the backend computes `sleep-consistency`, `sleep-debt`, `optimal-bedtime`, and `respiratory-rate`, but only the consistency chart is rendered (Monthly tab). Sleep debt (directly training-relevant) and the recovery-correlated optimal-bedtime suggestion are never shown.
2. **Projection / forecast lines** — `projections.py` computes metric-trend projections for all 13 metrics, but only the goal-detail modal uses it. The FTP / VO2max / weight / 1RM charts have no "where is this heading" extension.

This is read-only surfacing of existing endpoints — deliberately the cheapest, highest-visibility win in the programme.

## Scope

- Sleep cards on the **Dashboard Today tab**: sleep debt (hours + days below target), bedtime consistency, optimal-bedtime suggestion, respiratory-rate trend — each wiring an existing endpoint to a card + chart with drill-down.
- **Read-only projection lines** on the FTP, VO2max, weight, and 1RM charts (cycling + lifting pages), labelled "based on last N weeks".
- **Out of scope:** interactive what-if projections (that is Feature 6), the dedicated Health page (that is Feature 4), any new analytics.

## Backend

No new endpoints required — all data exists:

| Endpoint | Returns |
|---|---|
| `GET /api/v1/metrics/sleep-debt?target_hours=&days=` | `debt_hours`, `avg_sleep_hours`, `days_below_target` |
| `GET /api/v1/metrics/sleep-consistency?days=` | `consistency_score`, `avg_bedtime`, `std_minutes`, `days_analyzed` |
| `GET /api/v1/metrics/optimal-bedtime` | suggestion object (recovery-correlated) |
| `GET /api/v1/metrics/respiratory-rate` | `current_rr`, `recent_avg_rr`, `baseline_avg_rr`, `trend` |
| `GET /api/v1/projections/metric/{metric}?window_days=` | per-metric historical + projected series |

**Check first**: confirm the projection endpoint's exact route/params in `app/api/projections.py` and that it supports `ftp`, `vo2max`, `weight`, and the lifting 1RM metric (may need a small addition to map a lifting-1RM metric — acceptable within this feature).

## Frontend

- New dashboard components (Today tab): `SleepDebtCard`, `SleepConsistencyCard`, `OptimalBedtimeCard`, `RespiratoryRateCard` — consistent with existing `WhoopWeeklyCard`/`RespiratoryRateCard` patterns. Reuse `MetricCard`/chart primitives; skeleton loaders.
- **Projection overlay**: extend the FTP, VO2max, weight (`chart-weight-trend`), and 1RM chart queries to also fetch the projection series and render as a dashed continuation line. Label with sample window.
- New API client functions in `lib/api/` (metrics + projections) if not already present; add types.

## Tests

- Component tests (Vitest) for the four cards where practical.
- Backend: if a projection metric mapping is added for lifting 1RM, add a unit test for it.

## Acceptance

1. All four sleep cards render on the Today tab with real data and drill-down.
2. FTP / VO2max / weight / 1RM charts show a clearly-labelled forecast line.
3. Nothing existing regresses (dashboard + cycling + lifting pages).
4. Lint + tests pass.