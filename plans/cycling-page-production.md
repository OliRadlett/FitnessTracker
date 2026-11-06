# Cycling page — production plan

> **Status: SHIPPED (2026-11-06)** — the Form · Rides · Power page is on `main` and `prod`; the HELD condition below is moot. Original note: HELD (2026-11-05, owner decision). The plan is approved; implementation waits for the
> `/health` overhaul to land, because step 1 moves `WeightPanel` into a page another session is
> currently rewriting. **Unblock condition:** `plans/health-page-production-plan-2026-11-04.md`'s
> weight surface is merged to `main`, and this checkout is fast-forwarded to `origin/main` (it is
> 78 commits behind — the shipped cycling page carries `WahooZonesCard`, which this tree lacks).
>
> **Source**: `prototype/cycling/` (lab, not committed; gate passed 17/17, 2026-11-05) ·
> contract: `cycling-page-overhaul-2026-11-05.md` (not committed)
> **Target**: `frontend/src/app/(app)/cycling/page.tsx` on `origin/main` (`5fd4061`).
> **Port decisions, not shortcuts.** No lab file is copied into `frontend/`; the lab is deleted
> when this ships.

---

## 1. What ships

`/cycling` becomes three modes over one dataset — **Form · Rides · Power** — with URL state
(`?tab=`, `?ride=`, `?more=1`). It is a **review-only** surface: no prescriptions (planning is
`/training`), no device or protocol setup (that is `/settings`), no weight logging (that is
`/health`).

Landing (`?tab=form`) must answer, without scrolling at 1440 and in one screen at 390: **how fit am
I, which way is it moving, and what did I do this week.**

## 2. Architecture

| Concern | Decision |
|---|---|
| Route | Keep `app/(app)/cycling/page.tsx` as the only entry. No new routes. |
| Modes | Three components under `components/cycling/`: `FormMode`, `RidesMode`, `PowerMode`, plus a page shell that owns the tab state. |
| Tab state | `SegmentedControl` (arrow-key nav, 44 px; already used by `/activities`, `/analytics`, `/lifting`, `/segments`) + `useDeepLink()` (already used by `/activities`, `/health`, `/journal`, `/lifting`, `/routes`) — **not** the lab's hand-rolled `history.replaceState`. |
| Data | One `useCyclingData()` hook (React Query) in `lib/cycling/`, splitting per-mode query groups so a tab mounts only its own queries. **Reuse the app's existing cache keys** (`['cycling-profile']`, `['cycling-metrics']`, `['training-load', days]`, `['activities', …]`, `['power-curve', days]`) so data are shared with `/dashboard`, `/training` and `/activities`, not duplicated. |
| Selectors | The lab's pure selectors move to `lib/cycling/selectors.ts` unchanged (`ctlChange`, `weekStats`, `weeklyBuckets`, `durationRows`, `weatherRows`, `tsbWord`), with unit tests. They take data in, return view models — no React, no fetching. |
| Charts | Four small SVG components in `components/charts/` (`LineSeries`, `BarSeries`, `StackBar`, `Spark`) rendering the page's six chart surfaces, ported from the lab. They are page-local until a second consumer exists; the shared `Chart` renderer is **not** touched here (see §7). |
| Shell | The real `(app)` layout. Deletes the page's own `TimeRangeProvider` wrapper (the provider stays for analytics/dashboard/health). |

### Files

```
frontend/src/app/(app)/cycling/page.tsx        rewritten  (≈150 lines, was 952)
frontend/src/lib/cycling/selectors.ts          new
frontend/src/lib/cycling/selectors.test.ts     new
frontend/src/lib/cycling/useCyclingData.ts     new
frontend/src/components/cycling/FormMode.tsx   new
frontend/src/components/cycling/RidesMode.tsx  new
frontend/src/components/cycling/PowerMode.tsx  new
frontend/src/components/charts/LineSeries.tsx  new   (fitted domains, culled ticks,
frontend/src/components/charts/BarSeries.tsx   new    direct end labels, no legend)
frontend/src/components/charts/StackBar.tsx    new
frontend/src/components/charts/Spark.tsx       new
frontend/src/components/cycling/CODEMAP.md     new   (one screen: the three modes + hook)
```

## 3. Endpoints and data contracts

13 requests across all three modes, **5 on landing** (today: 64 on mount, ~20 of them dashboard
data the page never renders because `useDashboardData()` was the load strip's source).

| Mode | Endpoint | Fields consumed |
|---|---|---|
| Form | `GET /cycling/profile` | `ftp_watts`, `weight_kg` |
| Form | `GET /cycling/metrics-summary` | `recent_*`, `*_trend`, `best_20min_power`, `power_to_weight`, `ctl_benchmark` |
| Form | `GET /cycling/training-load?days=90` | `data[]` (`date`, `ctl`, `atl`, `tsb`), `current_*` |
| Form | `GET /charts/ramp_rate?weeks=13` | `labels`, `series[0].data` |
| Rides · Form | `GET /activities?limit=100&include_context=true&sort_by=start_date` | `id, start_date, distance_meters, moving_time_seconds, elevation_gain_meters, average_power, tss, ride_type, has_streams` |
| Power | `GET /cycling/power-curve?days=90` and `?days=365` | `data[].duration_label/seconds/best_power_watts`, `ftp_watts` |
| Power | `GET /charts/power_duration_percentile?days=90` | `labels`, series `You` / `50th %ile` |
| Power | `GET /cycling/power-zones?days=90` | `zones[].zone_name/time_seconds/percentage/lower_bound_watts/upper_bound_watts` |
| Power·more | `GET /cycling/decoupling?days=90&min_duration=60` | `data[].date/decoupling_pct` |
| Power·more | `GET /cycling/power-model` | `critical_power.{cp,w_prime,p_max,model_r_squared}` |
| Power·more | `GET /cycling/vo2max?days=90` | `vo2max, vo2max_ci_low/high, all_estimates[], classification` |
| Power·more | `GET /cycling/weather-analysis` | `power_vs_temp`, `hr_vs_temp`, `power_vs_wind` + their `r_squared`/`data_points` |

**Server-side asks** (this page is honest today only by working around each):

| # | Ask | Blocking? | Consequence if not fixed |
|---|---|---|---|
| 1 | `power-curve` returns `date_achieved: null` on every row although it is in the response model | **Done 2026-11-05** — the curve reports the winning activity and the endpoint fills the date | The record table states when each best was set. |
| 2 | Reconcile the three record pipelines (`power_curve`, `lifetime_pbs`, `cycling_power_records`) | No — the page renders **one** pipeline | Lifetime bests stay off the page until it is settled. **Measured 2026-11-06 — see §Record pipelines below.** |
| 3 | `ride_type` / `if` missing on the newest rides (3 of 35) while older ones have them | No | Those rows render `unclassified`; the page states the count rather than inventing a type. |
| 4 | `daily_tss` returns ride dates, not calendar days | No — the page no longer uses it | The defect still affects `/analytics`; file it separately. |
| 5 | Weather coefficients have no sample-size guard in the API | No — gated in the UI at R² 0.2 | Any future consumer can publish R² 0.03 as a percentage again. |

**No migration, no model change, no new endpoint.** If any of 1–3 is treated as blocking, the page
ships smaller (drop the record table, or drop the Rides mode) rather than waiting.

## 4. Port map: what survives from the lab, what does not

| Lab artifact | Production |
|---|---|
| `data.ts` selectors | → `lib/cycling/selectors.ts`, plus tests, **minus** the fixture import |
| `charts.tsx` (fitted `1/2/5` domains, culled ticks, end-tick priority, collision-offset labels, no legend, no brush) | → four `components/charts/*` components with props only; no fixture knowledge |
| `ui.tsx` primitives (Hero, Metric, Delta, Chip, Bar, Tabs) | re-implemented on the app's `Card`/`PageHeader`/`SegmentedControl`/`Button`; **not** copied |
| `LabShell` (static sidebar + bottom nav) | **dropped** — the real `(app)` layout renders |
| `readState`/`writeState` | **dropped** — `useDeepLink()` |
| Fixture + `fixture/` | **dropped** — React Query against the real endpoints |
| `cycling-*.json` | stays in the lab only; never enters `frontend/` |
| Fixture-derived "median of 35 rides" | computed from the live `activities` payload (same formula) |

Behavioural parity checks after the port: 35 rides listed for this account, form `21.1` / `−17.8`,
20-min `214 W`, one duration table, zero legends over axes.

## 5. The cut, and the order it must happen in

Five of these are **moves, not deletions**, and two of them are load-bearing elsewhere. The order is
not optional.

| Step | Item | Destination | Why the order matters |
|---|---|---|---|
| **1** | `WahooZonesCard` (510 lines, on `main`) + `/cycling/wahoo-zones` wiring | `components/settings/WahooZonesCard.tsx`, rendered under Settings › **Integrations** | It is a working device feature. If the page cuts it first, pushing zones has no UI at all. |
| **2** | `WeightPanel` (weight logging) | `/health` | ⚠️ `(app)/health/page.tsx:428` currently says *"logging lives in the full WeightPanel on /cycling"*. **Deleting it without moving it removes the app's only weight-entry surface.** Land the move first. |
| **3** | Stream backfill · TSS recalculate · FTP-history backfill | Settings › **Data Management** | Repair actions; each is a POST that today sits in the reading path. |
| **4** | `NextSessionCardAuto` (Suggested Session) | already on `/training` — just stop rendering it here | It contradicted the page's own data. Leave `NextSessionCard.tsx` intact; only the cycling import goes. |
| **5** | Body-composition chart, second weight card | `/health` (health's own overhaul owns the layout) | Two weight surfaces on one cycling page today. |
| **6** | Lifetime PBs + Power PRs tables, power-curve table, HR zones, ride-mix area chart, nine emoji headings | deleted | Folded into the one record table / power zones / the rhythm strip / lucide. |

Then: **delete `components/cycling/`** once nothing imports it. Verified importers today: every file
in that directory is imported **only** by `app/(app)/cycling/page.tsx`, except
`FuelPlanCard` and `RideAnalysisCard` (imported by `app/(app)/activities/page.tsx` — they cannot be
deleted), `LlmAnalysisCard` (`dashboard/WeeklyTab.tsx` — keep), and `WahooZonesCard` (moved in step 1).

## 6. Mobile, accessibility, and the shell

- **Mobile is a layout, not a reflow.** Single column; hero first; the empty-week rhythm and the
  stacked zone bar are the only two-column-adjacent blocks. No inner-page vertical scroll except the
  ride list, which is bounded by `max-h` and scrolls inside its card.
- **Tabs** are `SegmentedControl` (role=tablist, arrow keys, 44 px) and carry `?tab=`, so a tab is
  linkable and back/forward works.
- **Targets** ≥ 44 px (the lab's 32 px filter chips were caught by the gate and fixed; keep that
  check).
- **Type floor** 12 px; the app's 11 px is reserved for timestamps. The lab audit asserts it.
- **Contrast**: run an automated pass on the ported surface (axe or a Playwright getComputedStyle
  sweep). The lab judged contrast by eye only.
- **Degradation is already global**: `SyncHealthBanner` lives in `(app)/layout.tsx`, so the page does
  not draw its own sync badge (the before-page had one *and* the banner). Lab frames have no shell,
  so the banner is absent there — that is the only visual difference a reviewer will see.
- **Empty states**: an account with no rides, no power zones or no VO₂max gets the honest line the
  lab already writes ("no ride matches that filter", "requires per-ride streams"), never a blank card.

## 7. The shared chart defect — a separate PR, not this one

The legend/axis collision, the 30 px brush on every series > 20 points, and the 0-based domains are
in `components/charts/Chart.tsx` + `chartTheme.ts` and affect **every page** (46 surfaces on cycling
alone). Fixing it here would change 40+ charts inside a page rewrite and make the diff unreviewable.

**Separate PR, immediately after**: raise the X-axis label out of the tick band, move the legend
above the plot, and stop mounting `Brush` by default. Gate: the same frames on `/dashboard`,
`/analytics`, `/health`, `/cycling`, before/after, one contact sheet. This is a shared-component
change, so it needs its own visual evidence — not a typecheck.

## 8. Performance

| Metric | Before | Target |
|---|---|---|
| Requests to render landing | 64 | **5** |
| Requests, whole page, all modes | 64 | 13 |
| Page height (desktop / mobile) | 13,267 / 18,578 | 1,480 / 2,534 (lab-measured) |
| Chart library on this route | Recharts (46 surfaces) | 6 SVG components |

Rules: no `IntersectionObserver` gating for anything the landing needs (`AGENTS.md` Critical Pitfall
#12 — that bug is why the old page sometimes rendered no power data); tab-gating is by user intent,
not visibility; no new dependency; no `useDashboardData()` on this route.

## 9. Sequence (five PRs, each independently verifiable)

1. **Moves**: `WahooZonesCard` → Settings; `WeightPanel` → Health; maintenance actions → Settings ›
   Data Management. Nothing on `/cycling` changes yet. Verify: the three destinations work, the old
   page still renders.
2. **Selectors + charts**: `lib/cycling/selectors.ts` + tests, `components/charts/{LineSeries,
   BarSeries,StackBar,Spark}.tsx`. The dev lab is still on disk until step 5, so it is the demo
   surface for the primitives. Verify: `tsc`, unit tests, and one screenshot.
3. **Page rewrite**: three modes, `useCyclingData`, `useDeepLink`, real shell. Cuts applied.
   Verify: the nine-frame gate (below) on the **dev server against the real API**, then the same
   nine frames on a preview deploy.
4. **Delete `components/cycling/`** (except the moved files) and the now-unused `/cycling` query
   keys. Verify: `rg 'components/cycling'`, `tsc`, the mocked e2e suite, and a prod-shots sweep of
   every route that touched those keys.
5. **Delete the lab** (`frontend/src/app/dev/cycling-lab/`, `frontend/e2e/cycling-lab/`,
   `prototype/cycling/`). One commit; nothing production depends on it.

Docs updated in the same PRs: `AGENTS.md` (Overview/Active Planning), `frontend/src/CODEMAP.md`,
`components/cycling/CODEMAP.md`, and `docs/review-vs-act.md` (move `/cycling` from "candidate" to
"done", noting the three-mode gate).

## 10. Quality gate on the production surface

The lab gate does not prove the production build. Re-run the same nine frames **against the real
endpoints**, and require:

1. The nine frames exist at 1440×900 / 390×844 with the same states and URL params.
2. `scrollWidth − clientWidth = 0` at 390/768/1024/1440 for all three modes.
3. 0 leaf text nodes < 12 px; 0 interactive targets < 44 px; 0 console errors.
4. One value per quantity: FTP, W/kg, VO₂max, 20-minute power each appear once, and no rendered
   value contradicts another.
5. No hardcoded window strings; every chart title matches its query.
6. Weather renders no percentage without its R² and n; VO₂max shows its interval.
7. Rides: the live activity count equals the rows rendered, and no row truncates a number.
8. A recorded flow: land → switch tab → open a ride → open "more analysis" → back, on a 390
   viewport, with no layout jump.
9. The before/after sheet is regenerated from **prod** (prod-shots) after the release, not from
   localhost.

Command shape: `node frontend/e2e/cycling-lab/capture.mjs` stays as the harness, pointed at the
production route (`LAB_BASE`) with the QA token, exactly as the other page labs do.

## 11. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Weight logging disappears (Health move not landed first) | Medium | Step 1 is a hard prerequisite; the health page's comment is the tell. |
| Wahoo zone push breaks (moved component) | Low | The component keeps its own queries and mutations; only its mount point changes. Verify a push in staging before release. |
| The health overhaul lands a different weight entry point mid-flight | Medium | Coordinate with the `/health` session before step 2; if it lands a logger, delete `WeightPanel` instead of moving it. |
| Hand-rolled charts drift from the app's chart language | Medium | Build the four components from `chartTheme` tokens; the shared-`Chart` PR (§7) then has a single reference implementation. |
| Record table looks empty without dates | High (cosmetic) | The card states why, and ask #1 is filed. Drop the table entirely if the owner prefers. |
| Deeper `useDashboardData` dependencies than the badge | Low | Grep for the hook's keys on the page after the rewrite; the lab proved the page needs none of them. |

## 12. Rollback

The page is one route and one directory. Rollback = `git revert` of the rewrite commit; the deleted
components come back with it. No migration, no data change, no schema, so there is nothing to undo
in production. The moved components (steps 1–2) are additive and stay.

## 13. Not in this release

Ride maps, 3D replay, fuel plans, LLM narrative, light theme, PDF/share, route or segment surfaces,
the `/dashboard` and `/health` overlaps beyond the moves above, any new backend field (asks are
filed, not built), and the shared `Chart` fix (separate PR, §7).

## 14. Record pipelines — measured, 2026-11-06

Three producers report "your best power at duration D" and they do not agree. Pulled live from prod
(`/cycling/power-curve`, `/cycling/lifetime-pbs`, `/cycling/prs`) and then recomputed from the ride's
own streams (`/activities/{id}/streams`):

| duration | `power_curve` (90 d) | `lifetime_pbs` (10 y) | `prs` (stored) | recomputed, time-weighted | recomputed, sample-counted |
|---|---|---|---|---|---|
| 5 s | 880 · 10 Aug | 931.6 · 9 Feb | **931.6 · 9 Feb** | — | — |
| 1 min | 489.9 · 23 Aug | 489.9 · 23 Aug | **489.9 · 23 Aug** | — | — |
| 5 min | 326.5 · 9 Sep | 326.5 · 9 Sep | **326.5 · 9 Sep** | — | — |
| 20 min | 213 · 9 Sep | 226.1 · 21 Apr | **261.5 · 21 Apr** | **226.2** | 231.1 |
| 60 min | 181.4 · 11 Sep | 213.6 · 21 Apr | **239.9 · 21 Apr** | **188.9** | 213.9 |

What that says:

1. **The stored PR pipeline is wrong, and it is the one that prints 261.5.** The 21 Apr ride has 5,729
   samples and a time axis; a time-weighted best 20 min is 226.2 W and a sample-counted one is 231.1 W.
   No method reproduces 261.5. The 60-min record is worse: 239.9 stored against ~189–214 recomputed.
   `cycling_power_records` is written by `prs.py`; the writer is the defect.
2. **`lifetime_pbs` is right at 20 min (226.1 ≈ 226.2) and wrong at 60 min** (213.6 vs a time-weighted
   188.9, matching the sample-counted 213.9). Its 60-min value looks like the *fallback* branch, i.e. a
   window counted in samples rather than seconds.
3. **The definitional split matters more than either bug**: `timeaxis.resample_1hz` interpolates across
   stops, so a "60-minute best" there means 60 minutes of *elapsed* time including stopped seconds,
   while a time-weighted integral over moving samples means 60 minutes of *moving* time. Those are
   different questions (Strava reports moving-time power; TrainingPeaks reports elapsed). The app must
   pick one and label it.
4. **`/cycling` is unaffected by 1 and 2**: it renders `power_curve`, which is the only one of the three
   whose 20-min value is reproducible from the streams.

Next step, in order: fix `prs.py` so a stored record is the moving-time best from the stream it points
at; state the convention in the endpoint docstrings; then decide whether `lifetime_pbs` should be shown
on the page at all (its dates already come from the PR rows, which is how it reported "21 Apr" for a
number that ride's streams do not support).
