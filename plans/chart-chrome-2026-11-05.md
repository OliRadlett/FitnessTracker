# Chart chrome — shared chart fix (2026-11-05)

> **Status**: shipped in this PR. Diff: 1 component (+33 −12) + 1 cleanup (`legendWrapperStyle`
> deleted). The measurement harness and its frames stayed local, like every other lab in this repo;
> they are one request away if a reviewer wants to re-run them.
> **Blast radius**: every Recharts surface in the app — 40+ charts across `/dashboard`,
> `/analytics`, `/health`, `/lifting`, `/cycling`, `/training`, `/activities`.

## Why this is not part of the cycling overhaul

The cycling page's worst frames were chart chrome, but the chrome lives in the **shared** renderer.
Fixing it inside a page rewrite would have put every chart on every page in the same review, and
the cycling port is held pending the `/health` overhaul anyway
([`cycling-page-production.md`](cycling-page-production.md)). This change is independent, small,
and verifiable on its own.

## The defect, measured

| Symptom | Measurement (before) |
|---|---|
| X-axis title drawn inside the tick band | present on **every** chart that sets `x_label` — 16 of 16 on three real pages |
| Axis title buried under the zoom brush | **314 px² per chart**, on 4 of the 6 lab payloads |
| Legend colliding with the axis title / ticks | **5** collisions across 16 charts on `/dashboard`, `/health`, `/lifting`; 1 in the lab |
| 5-series legend clipping | `maxHeight: 32–36 px` on the wrapper, so long legends were cut, not wrapped |

Root cause, in one line: `label: { position: 'insideBottom', offset: -5 }` on the X axis and a
bottom-aligned `<Legend>`, both fighting for the same 30–48 px band under the plot.

## The change

1. **No X-axis title.** The Y-axis label (with its unit) stays.
2. **Legend rendered as HTML under the chart**, from `data.series` (or `data.labels` for pie),
   marked `data-chart-legend` for the harness. It wraps; it cannot collide with the plot.
3. **`legendWrapperStyle` deleted** — its only consumer was Recharts' `<Legend>`.

## Gate (met)

| Criterion | Result |
|---|---|
| Lab, 6 payloads × 2 viewports: no axis title in the tick band | **0/9 frames** (was 9/9) |
| Lab: no axis title under the brush | **0 px²** (was 4 × 314) |
| Lab + real pages: zero legend ↔ label/tick overlaps | **0** (was 1 + 5) |
| Real pages: 0 horizontal overflow at 1440 and 390 | **0** on 6 frames |
| Real pages: no new console errors | 11 → 11, identical messages |
| Pie / heatmap / scatter / single-series paths still render | `Chart.test.tsx` 15/15; full frontend suite **748/748** |
| `tsc --noEmit` | clean |

## How it was measured

Two harnesses (kept out of the repo because the frames are 3 MB and the fixture is real data):

1. A dev-only route rendering the production `Chart` with six real `ChartData` payloads from the
   2026-11-05 cycling prod export — line/91 pts/3 series/brush, line/105 pts/5 series, bar/18,
   area/4 series, bar/7 long category labels, line/13 pts/1 series.
2. The same measurement on real pages (`/dashboard`, `/health`, `/lifting`) driven by a minted QA
   session against the local backend.

Each run wrote `metrics.json` per frame: whether an X-axis title exists, the intersection area
between the legend and every `.recharts-label` / axis tick, brush height, sub-12 px text, horizontal
overflow, console errors. The `before` numbers came from `git checkout --` on the two source files
and re-running both harnesses.

## Rollout

1. Squash-free merge to `main`, then `main` → `prod` (the repo's release flow).
2. `npm run test:prod-shots` after the deploy for the prod before/after of the same pages: the lab
   proves the component, prod proves the release.
3. The harness can be resurrected from `prototype/chart-chrome/` in the session that built it; the
   frames are the artifact.

## Rollback

`git revert` of one commit. No data, no schema, no API. Every page returns to its previous chrome.

## Deferred (each now measurable with the same harness)

1. **The always-on brush — done 2026-11-06.** 30 px of zoom slider appeared on any series over 20
   points (5 charts on `/health`, 7 on the old cycling page). The brush is now opt-in via
   `ChartData.zoomable`; nothing sets it, so the control is gone everywhere and a chart that genuinely
   needs to zoom a dense window can ask for it. Verified on prod: `brushes: 0` on `/dashboard`,
   `/health`, `/lifting`, `/cycling`.
2. **The duplicated chart title.** `data.title` renders as an `<h4>` inside the card that usually
   already has a `CardTitle`. Fix at the call sites, not in the renderer.
3. **Y-domains.** Recharts still derives them from data, so flat series render flat at the top of
   an empty box. The cycling lab's hand-rolled `fitDomain` (1/2/5 steps, zero anchored only when
   meaningful) is the reference implementation.
4. **The six components that import `recharts` directly** (`dashboard/trends/ChartPanel`,
   `goals/GoalDetailModal`, `health/HealthCharts`, `lifting/VbtPanel`, `maps/ElevationProfile`,
   `routes/CompareRoutesModal`). Audited 2026-11-06: they do **not** carry this defect — none sets an
   X-axis title, so their bottom legends have nothing to collide with, and the health charts draw
   their legend outside the plot by design. Migrating them onto `Chart` would be churn, not a fix;
   the reason to touch them is only if they need a capability `Chart` has.
