# Health page production — 2026-11-04

> Shipped on `main`/`prod` with the health-page overhaul. This is the
> production record; the lab diagnosis and contact sheets live in the
> `prototype/health-page` working folder used for the bake-off.

## What changed

`/health` now answers three questions in order: **am I ready today**, **is
anything wrong now**, and **what changed**. The old one-scroll catalogue of 17
equal cards (759 LOC, ~19 requests, 4.7 desktop / 9.5 mobile screens) is
replaced by three tabs:

- **Now** — recovery score + verdict + one-line why; four drivers (HRV,
  resting HR, sleep, strain) with 30-day/7-day baselines; a read-only six-signal
  health check; sleep summary (last night, 7d debt, consistency, bedtime);
  coverage (Whoop, respiratory, weight, training-load link).
- **Trends** — the shared REVIEW `TimeRangePicker`; five charts (recovery, HRV,
  resting HR, sleep duration, strain) with baseline/reference bands, one unit
  per axis, no brush; correlations as text with n (n < 10 says "too few"); the
  shared weight card.
- **History** — month-grouped alerts (old active rows are **Unverified**, newly
  cleared rows are **resolved**), and a dated, collapsed AI analysis with an
  explicit "refresh before acting" warning.

`LoadSummary` (CTL/ATL/TSB/week TSS/FTP) is no longer on Health; it is a link to
Cycling. The training-load numbers keep their homes on Training/Cycling.

## Service changes (same release)

1. **`GET /api/v1/metrics/health-check`** — runs the six deterministic signals
   read-only (no alert writes, no notifications) and returns
   `{checked_at, analysis_results}`. The Now page can show a current check on
   load; `POST /health-alerts/analyze` remains the explicit action.
2. **Auto-resolve** — `upsert_alert()` now calls `resolve_alert()` when a signal
   returns `severity: none`, marking active rows `resolved`. This runs from the
   scheduler and the explicit check; a cleared condition cannot stay "active"
   forever.
3. **`alerts_generated`** counts only alerts actually created; a clear check
   returns 0.
4. The page's own `/connections/` query is token-gated and uses the canonical
   trailing-slash path; a failed status query renders "Sync status unavailable",
   never "Whoop not connected" or "never synced".

## Files

- `frontend/src/app/(app)/health/page.tsx` — route, tabs, deep links, skeleton,
  pull-to-sync, page header.
- `frontend/src/components/health/HealthPageView.tsx` — Now/Trends/History
  composition.
- `frontend/src/components/health/HealthCharts.tsx` — ring, sparkline, baseline
  line chart.
- `frontend/src/components/health/HealthUi.tsx` — tabs, pills, cards, sync line,
  error/empty states.
- `frontend/src/components/health/healthView.ts` — view model, drivers,
  baselines, insight parsing, date helpers.
- `frontend/src/components/health/useHealthPageData.ts` — React Query data
  composition; core queries first, charts/check deferred 600 ms.
- `frontend/src/components/health/usePullToSync.tsx` — mobile signature.
- `backend/app/api/metrics.py` — GET health-check, POST analyse refactor.
- `backend/app/services/health_analysis.py` — `collect_health_signals`,
  `resolve_alert`, `none` auto-resolve.
- Tests: `backend/tests/integration/test_health_api.py`,
  `backend/tests/integration/test_health_analysis_service.py`,
  `frontend/src/__tests__/health-view.test.ts`.

## Data and performance

- Now first paint: readiness + sleep debt/consistency/bedtime + alerts + weight +
  connections; charts and the six-signal check are deferred. The check does not
  gate the hero — it has its own loading state.
- Charts are cached per range; the activity-stream correlation chart is loaded
  only on Trends.
- No new model or migration. `status` already existed; `resolved` is a new value.

## Verification

- `npx tsc --noEmit` clean.
- `vitest run` — 765 existing + 3 new helper tests pass.
- Backend targeted suite — 82 pass, including read-only check, resolve-on-clear,
  and zero generated count.
- Production-surface capture (real local stack, session stub): desktop 1440×900
  and mobile 390×844; Now/Trends/History, no console errors, first viewport
  answers ready/wrong/next.
- `next build` compiles `/health` (17.9 kB route); the only local trace-copy
  failure is the worktree's node_modules junction, not the code.

## Follow-ups (not in this release)

- The legacy `hrv_drop` / `sleep_decline` / `respiratory_rate_elevated` alerts
  are not part of the six-signal check; they can remain `active` until the
  scheduler's legacy branch re-evaluates them. History labels them Unverified
  once older than 14 days.
- If `/health-check` latency becomes a problem, persist a per-user
  `last_checked_at` snapshot and serve that instead of recomputing on load.
- Reconcile `/sleep-debt` with `sleep_logs` before reintroducing nightly bars;
  the page deliberately uses one source.
- The AI card's full prose uses the shared `renderStructuredAnalysis`; if the
  renderer regresses, the "no raw markdown" test is the guard.
