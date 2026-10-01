# Design Spec — Section 1 (REVISED): Unified Daily Verdict on `/today`

> **Date**: 2026-10-01 · **Type**: architectural (scope narrowed, no new endpoint) · **Surface**: `/today`
> **Origin**: original Section 1 (`plans/2026-10-01-unified-daily-recommendation.md`)
> was built on a **stale premise** — that `/today` was a client-side POC verdict
> engine (`lib/brief.ts`). Re-baseline showed `/dashboard/today` + `_suggest_rest_days`
> already produce a **server-side verdict**, and `/today/page.tsx` already renders it
> (with a `computeVerdict` client fallback). The real gap: that verdict consumes only
> recovery+TSB+sleep-debt, ignores 3 of 5 engines, has no forward look, and duplicates
> itself across server + client. The fix is **not** a new endpoint — it is enriching
> the existing one.
>
> Plan-mode draft — relocate to repo `plans/` (overwriting the stale original) + commit on build mode.

## 1. Problem (re-baselanced)

`/today` already exists and is mostly built. It ships because:

- `GET /dashboard/today` (`api/dashboard/today.py:64`) computes current
  CTL/ATL/TSB (cached `_today_load_values`, 5 min), latest recovery/HRV/sleep,
  active-alert count, and `rest_day_suggestion` via `_suggest_rest_days`
  (`api/dashboard/__init__.py:155`).
- `/today/page.tsx` renders `RestDayBanner` from `rest_day_suggestion`, falling
  back to `computeVerdict` (`brief.ts`) when it's absent.

But it does **not** consume, for a single "what should I do today" verdict:

- `adaptive` suggestions (`generate_adaptive_suggestions`, `GET /plans/{id}/suggestions`)
- `deficiency` (`GET /deficiency`)
- `cross_domain` (`GET /cross-domain`)
- forward projection (`compute_tsb_projection`, Section 2)

So the **five-engine disjunction** from the original brainstorm is real; it is just
not solved by adding a surface — it is solved by enriching the verdict that already
exists. Two smells remain:

1. `computeVerdict` (client, recovery+TSB+sleep-debt) vs `RestDayBanner` (server)
   are **two verdicts**; the page picks the server one and discards the client one
   when present.
2. Cross-domain still 404/null-when-empty (`GET /cross-domain` 404s), so its
   signal vanishes from the verdict by default — and it is FitTrack's unique thesis.

## 2. Design

**Decision:** enrich the **server-side verdict** to compose all engines + the 7-day
projection, with a `consensus[]` provenance field so agreement/disagreement is
visible. No new top-level route. Shape A3 (inline `/today` surface) is the only
shape — the re-balance shows `/today` already *is* the daily surface, so inventing
alternatives is moot.

### 2.1 Backend

- New thin service **`services/today.py::compute_today_verdict(db, user_id, plan_id=None) -> TodayVerdict`**
  composes the engines (all best-effort, fail-open):
  - `_today_load_values` / `compute_training_load` → current TSB (existing).
  - `analyze_deficiencies(db, user_id)` → top critical/high weakness (existing).
  - `generate_adaptive_suggestions(db, user_id, plan_id)` → stance + summary
    (existing, already blends TSB/recovery/conformity/alerts/deficiency/cross-sport).
  - `get_cross_domain_insights` → degrade to "analyzed X / due Sun" when 404 (the
    **key fix**: no longer null-when-empty — folded into `consensus` as
    `available:false`).
  - `compute_tsb_projection(db, user_id, plan_id, days_ahead=7)` (Section 2) →
    `projected_load[]` for the forward look.
  - `HealthAlert` active count + severity (existing).
- `services/today.py` houses the verdict logic (service layer, not the API layer —
  `_suggest_rest_days` currently lives in `api/dashboard/__init__.py`, a mild smell
  the refactor corrects). `_suggest_rest_days` becomes a thin wrapper around / is
  replaced by `compute_today_verdict`.

**`TodayVerdict` payload:**
```jsonc
{
  "should_rest": true,
  "headline": "Take it easy — recovery low and legs loaded yesterday.",
  "reasons": ["Recovery 38% (<40 threshold, 2 days)", "Yesterday squat 5x5 @ 180kg loaded legs for the ride"],
  "consensus": [
    { "engine": "rest_day_suggestion", "stance": "rest", "confidence": "high", "analyzed_at": "…" },
    { "engine": "adaptive",            "stance": "cut",   "confidence": "medium", "analyzed_at": "…", "note": "recovery-low vote" },
    { "engine": "deficiency",          "available": false, "reason": "no critical weaknesses" },
    { "engine": "cross_domain",        "available": false, "reason": "analysis runs weekly; next run Sun 03:15 UTC" }
  ],
  "projected_load": [{"date":"…","ctl":…,"atl":…,"tsb":…}]  // Section 2
}
```
Confidence is each engine's own; `should_rest`/headline are driven by the strongest
rest signal (recovery, TSB<−25, consecutive-days≥6, active alert, scheduled rest,
or an adaptive cut vote).

### 2.2 Schema

- Extend `RestDaySuggestion` (`schemas/dashboard.py`): add `headline`, `consensus`,
  `projected_load`. Keep `should_rest/reasons/current_tsb/...` (back-compat —
  `RestDayBanner` + `DashboardSummary` keep working).
- `TodaySummary` gains `verdict: TodayVerdict | None` (the enriched envelope).
  `rest_day_suggestion` retained as the legacy rest-only field during transition.

### 2.3 Endpoint

- `GET /dashboard/today` calls `compute_today_verdict` and attaches `verdict`.
  If the call fails, `verdict=None` and `rest_day_suggestion` degrades to the old
  `_suggest_rest_days` behavior (fail-open; the page keeps rendering).

### 2.4 Frontend

- `today/page.tsx`: render `RestDayBanner` from `todaySummary.verdict` when present
  (showing consensus + projected_load lookahead); only fall back to `computeVerdict`
  when `verdict` is null (no active plan / degraded). **Delete the `computeVerdict`
  import path** once the server always returns a verdict (it has all the same
  inputs; the client copy is pure redundancy). `brief.ts` → kept as the degradation
  formatter only, or removed if the server covers all paths.

### 2.5 Cross-domain specifically (Section 1 #2)

Fold `GET /cross-domain`'s 404 into `consensus` as `available:false, reason:"…"`
— this is the fix for the null-when-empty smell. The `/today` verdict never goes
blind to cross-domain; it shows "last analyzed Sun" and the gap. No UI change to
`CrossDomainInsightsCard` needed (it still lives on the dashboard Weekly tab);
`/today` just no longer silently drops the signal.

## 3. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| `compute_today_verdict` adds latency to `/dashboard/today` (was cheap) | All inputs already cached/written weekly; projection reuses the 5-min CTL cache; React Query staleTime 60s. One new `TrainingPlanDay` scan for the active plan only. |
| `computeVerdict` client removal hides edge-case verdicts | Keep `computeVerdict` as the *server* of last resort: the service returns `verdict=null` only on total failure; page renders the old `RestDayBanner`/`computeVerdict` fallback transparently. |
| Cross-domain degrade-to-unavailable looks like a regression vs "no card" | It is — but it is an *honest* regression: the consensus row shows "analyzed Sun, due Sun" so the user knows it's scheduled, not broken. |
| Active-plan resolution duplicates `dashboard_today`'s plan lookup | Section 3 (below) centralizes "the user's active plan" — see note. For now, `/dashboard/today` passes the resolved `plan_id` into `compute_today_verdict`. |

## 4. Testing (host-side — pitfall 23)

- `tests/test_today_verdict.py`: pure `consensus`/`should_rest` assertions —
  (a) recovery low + adaptive cut → should_rest=true with both engines in consensus,
  (b) cross-domain 404 → `available:false` in consensus, verdict still renders,
  (c) projection present only when active plan exists,
  (d) no active plan → `verdict=null`, `rest_day_suggestion` fallback intact.
- API: `/dashboard/today` 200 with `verdict` for a user with an active plan (event
  or not); 200 with `verdict=null` + legacy `rest_day_suggestion` for a user with no
  plan.
- Frontend: `/today` renders `RestDayBanner` from verdict; shows consensus; falls
  back to `computeVerdict` only when `verdict` is null.

## 5. Defers
- **`/dashboard/today` projection ownership:** Section 2 wires
  `TodaySummary.projected_load`; Section 1's verdict *consumes* it. To avoid two
  projection calls, the service should call `compute_tsb_projection` once and both
  fields point at it. Locked only when Sections 1 + 2 ship together (see §3 Risks).
- **`/training` WeeklyView TSB-strip relabel** (Race→Projected) ships with Section 2;
  Section 1 doesn't touch WeeklyView.

## 6. AGENS pitfalls honored
- **13** — no new route (enriches existing `GET /dashboard/today`).
- **19** — verdict service is local Python calls, not a Modal worker (no `app.config`
  at module scope).
- **22/24** — no migration / no `sa.JSONB()`.
- **23** — host-side pytest.
- **11** — React Query `enabled: !!token` on `['dashboard','today']` preserved.

## 7. Resequence
This revision **depends on Section 2** (projection generalization). Order:
Section 2 → Section 1 (this). Sections are staged to temp; repo commit deferred to
build mode so both land together and the `projected_load` dedup in §3 holds.
