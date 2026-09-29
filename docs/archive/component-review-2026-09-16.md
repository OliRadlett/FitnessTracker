# FitTrack — Frontend Component Review

> **Date**: 2026-09-16  
> **Scope**: `frontend/src/components/` (95 components) + `frontend/src/lib/` utility-level components + `frontend/src/app/(app)/**/page.tsx` pages  
> **Method**: Static analysis — full directory enumeration, cross-reference grep for imports/usages, dynamic-import detection, side-by-side comparison of structurally similar files
> **Status**: Findings documented. Remediation completed for all High-priority items and most Medium-priority items. Remaining: low-priority moves (`WeatherBadge`/`ActivityAiAnalysisCard` directory moves), `helpers.tsx` full split (partially done).

---

## Executive Summary

The frontend component tree is generally well-organized with domain-specific subdirectories (`cycling/`, `lifting/`, `health/`, `routes/`, `training/`, etc.). However, **4 components are fully dead code** (never imported anywhere), **2 files have file-name/component-name mismatches**, **1 component is co-located in a utility file**, **1 directory contains a mixed concerns file**, and **5 AI analysis cards duplicate ~80% of their logic**. No components need to be extracted to new top-level pages, though 2 dead components (`CompareRoutesModal`, `MapBrowseView`) were intended as features and should either be wired in or removed.

---

## 1. Dead / Orphaned Components (Never Imported)

These components are defined but have **zero references** anywhere in the codebase — not in pages, not in other components, and not via dynamic imports.

| Component | File | Issue |
|-----------|------|-------|
| `StatsView` | `components/activities/StatsView.tsx` | The CODEMAP (line 152) documents it as "Stats tab view — monthly distance bars, sport breakdown pie, weekly TSS trend" for the activities page's "List/Week/Stats view toggle" (line 11 of CODEMAP). However, the activities page (`app/(app)/activities/page.tsx:360`) declares `viewMode` as `'list' | 'week' | 'timeline' | 'patterns'` — there is **no `stats` view**. The view toggle buttons render only List/Week/Timeline/Patterns (lines 743-777). **Status: DEPRECATED.** The same metrics (Monthly Distance, TSS trend) already exist on the dashboard (WeeklyTab renders "Monthly Distance (km)" — line 770), and the activities page evolved to use Timeline/Patterns views instead. No equivalent for "Sport Breakdown" pie chart, but that alone doesn't justify keeping a dead component. |
| `MapBrowseView` | `components/routes/MapBrowseView.tsx` | The CODEMAP (line 135) documents it as "Leafport map with route markers for browse mode." It is a **stripped-down predecessor** of `RoutesMapView` — shares identical Leaflet initialization, marker creation, popup rendering, and bounds-fitting logic. The only differences: `RoutesMapView` adds quality-score badges on markers, heatmap overlay support (activity density via `leaflet-heat`), and a home-area heatmap query. **Status: DEPRECATED.** The `lib/routeUtils.tsx` docstring (line 3) explicitly says the utilities "replace scattered helpers in routes/page, CompareRoutesModal, MapBrowseView, and ElevationProfile" — indicating `MapBrowseView` was known to be superseded. `RoutesMapView` fully covers its use case. |
| `CompareRoutesModal` | `components/routes/CompareRoutesModal.tsx` | The CODEMAP (line 134) documents it as "Side-by-side route comparison — overlaid elevation profiles, surface breakdown, stats delta table." The component is fully built (272 lines, including lazy-loaded `Route3D` for 3D side-by-side). The routes page CODEMAP (line 19) mentions "compare checkboxes (pick 2 → overlaid elevation profiles + stats delta modal)" as a feature, but **no checkboxes or modal import exist in `routes/page.tsx`**. **Status: USEFUL BUT UNWIRED.** This is a complete, working component that was built per the documented roadmap but never connected to the routes page UI. It should be either wired in (add compare checkboxes to the list/grid/map views → open this modal) or removed. |
| `ProviderBadge` (function) | `components/ui/ProviderBadge.tsx` | This file exports three things: `ProviderIcon`, `ProviderBadge`, and `PROVIDER_COLORS`. Every consumer (`ActivityCard`, `RoutesGridView`, `VirtualRouteList`, `RouteDetailPanel`) imports **only `ProviderIcon` and `PROVIDER_COLORS`** — never `ProviderBadge`. The `ProviderBadge` function (lines 25-31) is a tiny wrapper that renders a badge with an icon + provider name, but every consumer builds its own badge markup inline instead. **Status: DEPRECATED/MARGINAL.** An alternative pattern that was never adopted — consumers need slightly different styling/structure for each badge. |

**Recommendation**: Delete `StatsView` and `MapBrowseView` (deprecated, superseded). Remove the `ProviderBadge` function (marginal, never adopted). For `CompareRoutesModal`, either wire it into the routes page (add compare checkboxes → modal) or remove it — it is the only dead component that is genuinely useful.

**Status: COMPLETED (2026-09-16)** — `StatsView.tsx` and `MapBrowseView.tsx` deleted. `ProviderBadge` function removed from `ui/ProviderBadge.tsx`. `CompareRoutesModal` wired into the routes page via compare mode toggle + compare checkboxes in list/grid/map views (see §4 below).

---

## 2. File-Name vs Component-Name Mismatches

| File | Exported Component | Issue |
|------|-------------------|-------|
| `components/routes/VirtualRouteList.tsx` | `RoutesListView` | The file is named `VirtualRouteList` but exports `RoutesListView`. The routes page imports `{ RoutesListView }` from `@/components/routes/VirtualRouteList` — the import works because it matches the named export, but the file name is misleading (there is nothing "virtual" about this list; it is a straightforward mapped card list). Should be renamed to `RoutesListView.tsx` or the component to `VirtualRouteList`. |
| `components/lifting/VideoEmbed.tsx` | `VideoEmbed`, `VideoChip` | Two distinct concerns — an R2 `<video>` player and a small "📹 N" count badge — are co-located in one file. `VideoChip` is imported from `@/components/lifting/VideoEmbed` by the lifting page (line 33) and tested separately (`__tests__/video-embed.test.tsx` line 4). They should be split into separate files (`VideoEmbed.tsx` + `VideoChip.tsx`) for clarity. |

---

## 3. Components in Wrong / Questionable Directories

### 3a. `HealthAlertsSection` — in `dashboard/` but health-specific

`components/dashboard/HealthAlertsSection.tsx` renders AI health alerts (recovery/HRV/respiration decline, respiratory-rate elevation). It is:
- Imported **only** by `components/dashboard/WeeklyTab.tsx` (line 33)
- Never imported by `app/(app)/health/page.tsx`
- A health-domain concern that lives in the `dashboard/` directory

The health page already imports health-specific components from `components/health/HealthAiAnalysisCard` (line 22 of `health/page.tsx`). `HealthAlertsSection` should be moved to `components/health/`.

### 3b. `cycling/WeatherBadge` — used on activities page, not just cycling

`components/cycling/WeatherBadge.tsx` renders a tiny inline weather indicator (`🌧️ 12°C 💨 25km/h`) for activity rows. Despite living in `cycling/`, it is imported by:
- `components/activities/ActivityCard.tsx` (line 6) — for cycling activity rows in the activity list
- `app/(app)/activities/page.tsx` (line 23) — for the expanded activity detail

It is not cycling-specific — it renders weather data for any activity. It should live in `components/activities/` or `components/ui/`.

### 3c. `cycling/ActivityAiAnalysisCard` — used on activities page, not cycling page

`components/cycling/ActivityAiAnalysisCard.tsx` is a per-activity AI ride analysis card. Despite living in `cycling/`, it is imported **only** by `app/(app)/activities/page.tsx` (line 21). It does not appear on the cycling page. Given that it renders AI analysis for any cycling activity and is used contextually in the expanded activity detail, it would be more accurately placed in `components/activities/`.

### 3d. `cycling/LlmAnalysisCard` — used on dashboard, not cycling page

`components/cycling/LlmAnalysisCard.tsx` renders an overall cycling LLM performance analysis summary. Despite living in `cycling/`, it is imported **only** by `components/dashboard/WeeklyTab.tsx` (line 28). It has never been used on the cycling page.

### 3e. `dashboard/DeficiencyCard` — shared across dashboard and lifting

`components/dashboard/DeficiencyCard.tsx` shows weakness/deficiency analysis (lifting/cycling weaknesses). It is imported by:
- `components/dashboard/WeeklyTab.tsx` (dashboard weekly view)
- `app/(app)/lifting/page.tsx` (line 41, lifting sessions page)

It is a cross-cutting analytical component, not a dashboard-specific one. It would be better in `components/ui/` or a new `components/analysis/` directory.

---

## 4. Organizational Issues

### 4a. React component in a `lib/` utility file

`lib/routeUtils.tsx` is a `.tsx` file (not `.ts`) that contains:
- `DifficultyLevel` type
- `computeDifficulty()` utility
- `DIFFICULTY_STYLES` constant
- `DifficultyBadge` — a **React component** (lines 31-39)
- `fmtElevation()`, `fmtDurationShort()`, `haversineDistance()` — pure utilities

The JSDoc comment at the top (line 1-4) even says "Shared route difficulty, elevation, and distance utilities. Single source of truth — replaces scattered helpers in routes/page, CompareRoutesModal, MapBrowseView, and ElevationProfile." The `DifficultyBadge` component is a UI concern that does not belong in a `lib/` utility file. It should be extracted to `components/routes/DifficultyBadge.tsx` (or `components/ui/`), and `routeUtils` should be renamed to `routeUtils.ts` (pure utilities only).

### 4b. Mixed concerns in `dashboard/helpers.tsx`

`components/dashboard/helpers.tsx` is simultaneously:
- A **re-export barrel**: `export { formatDuration, formatDistance, MetricCard }` (line 19) — re-exports from `lib/utils` and `ui/MetricCard`
- A **pure utility**: `getGreeting()` (line 21)
- A **component library**: `TrendArrow`, `WhoopWeeklyCard`, `RespiratoryRateCard`, `ActivityRow`, `SessionRow`, `ListSkeleton`

This file is imported by:
- `app/(app)\dashboard/page.tsx` — imports `getGreeting` (line 27)
- `app/(app)/health/page.tsx` — imports `MetricCard` and `RespiratoryRateCard` (line 21) — **the health page depends on dashboard internals**
- `components/dashboard/TodayTab.tsx` — imports `MetricCard`, `RespiratoryRateCard`, `ActivityRow`, `SessionRow`, `ListSkeleton` (line 11)
- `components/dashboard/WeeklyTab.tsx` — imports `MetricCard`, `WhoopWeeklyCard`, `RespiratoryRateCard`, `ActivityRow`, `SessionRow`, `ListSkeleton` (line 15)
- `components/dashboard/MonthlyTab.tsx` — imports `MetricCard` (line 9)

**Specific sub-issues:**
- `RespiratoryRateCard` is health-specific but lives in `dashboard/helpers.tsx` and is imported by the health page via `@/components/dashboard/helpers` — the health page should source this from `components/health/`
- `WhoopWeeklyCard` is health/Whoop-specific but lives in `dashboard/helpers.tsx`
- `ActivityRow` and `SessionRow` are reusable link-row components used only by the dashboard tabs but could be shared
- `TrendArrow` is a generic small component that could live in `ui/`
- `ListSkeleton` could live in `ui/Skeleton.tsx` alongside the existing skeleton primitives
- `getGreeting` is a pure function that belongs in `lib/utils.ts`, not a component file

---

## 5. Functional Duplicates & Near-Duplicates

### 5a. Five nearly-identical AI Analysis Cards

| Component | File | Endpoint | Pattern |
|-----------|------|----------|---------|
| `ActivityAiAnalysisCard` | `cycling/ActivityAiAnalysisCard.tsx` | `GET/POST /api/v1/activities/{id}/ai-analysis` | Self-fetching (`useQuery` + `useMutation`) |
| `SessionAiAnalysisCard` | `lifting/SessionAiAnalysisCard.tsx` | `GET/POST /api/v1/lifting/sessions/{id}/ai-analysis` | Self-fetching |
| `HealthAiAnalysisCard` | `health/HealthAiAnalysisCard.tsx` | `GET/POST /api/v1/metrics/health-ai-analysis` | Self-fetching |
| `EventAiAnalysisCard` | `training/EventAiAnalysisCard.tsx` | `GET/POST /api/v1/events/{id}/ai-analysis` | Self-fetching |
| `LlmAnalysisCard` | `cycling/LlmAnalysisCard.tsx` | Passed as prop | **Externally-fed** (no internal fetch) |

The first four are **structurally identical** — same `useQuery` + `useMutation` boilerplate, same query staleTime (30 min), same error/loading/empty/analyzing state rendering, same card structure, same use of `renderAnalysisText` + `relativeTime` from `analysisRenderer`. The only differences are:
1. Query key prefix (e.g. `['activity-ai-analysis', id]` vs `['session-ai-analysis', id]`)
2. API endpoint path
3. Title text (e.g. "🤖 AI Ride Analysis" vs "🏋️ AI Session Analysis")
4. Button label and aria-label
5. Empty-state text

`LlmAnalysisCard` is the **exception** — it takes `analysis`, `isLoading`, `onRefresh`, `isRefreshing` as props and does no data fetching itself. It is used by `WeeklyTab` which fetches the analysis externally. This is actually the better design (separation of concerns), and the other four cards should be refactored toward this pattern.

**Recommendation**: Extract a single `AiAnalysisCard` component in `ui/` (or `components/analysis/`) that handles the shared rendering (loading/empty/analyzing/content/error states + button + header), and have the four self-fetching cards become thin wrappers or are refactored to use the externally-fed pattern like `LlmAnalysisCard` already does.

### 5b. `MetricCard` duplicate

| File | Usage |
|------|-------|
| `ui/MetricCard.tsx` | Generic metric card supporting simple trend strings (dashboard) and complex MetricTrend/benchmark (cycling). Used by `dashboard/helpers.tsx` (re-exported), imported by health page, settings page, TodayTab, WeeklyTab, MonthlyTab. |
| `cycling/MetricCard.tsx` | Cycling-specific metric card with trend indicator. Used only by `app/(app)/cycling/page.tsx`. |

This is an **intentional** duplicate — the two have different props and rendering. The `ui/MetricCard` is a general-purpose card; the `cycling/MetricCard` has cycling-specific styling. The CODEMAP already acknowledges this. No action needed, but the naming collision (same component name, different import paths) is a minor source of confusion.

### 5c. `MapBrowseView` vs `RoutesMapView`

`MapBrowseView` (see §1) is a deprecated predecessor of `RoutesMapView`. Both render Leaflet maps with route markers and popups. `RoutesMapView` adds quality badges, heatmap layers, and activity-density points. `MapBrowseView` is dead code — see §1.

---

## 6. Components That Could Be Extracted to New Pages

### 6a. `CompareRoutesModal` → potential `/routes/compare` page

If the route-comparison feature were to be implemented, the side-by-side 3D comparison (with `Route3D`, elevation profile overlay, surface breakdown, and stats delta) is complex enough to warrant a dedicated page (`/routes/compare?a=<id>&b=<id>`) rather than a modal. The modal form would become unwieldy on mobile with two full 3D canvases and tabbed content.

### 6b. `WorkoutPlanner` → potential `/training/planner` page

`components/training/WorkoutPlanner.tsx` (579 lines) is a full workout-planning tool rendered at the bottom of the training page. It fetches workout zones, plan suggestions, and route matches, and renders `RouteMap` inline. While it currently fits at the bottom of the training page, it is a substantial standalone feature. Extracting it to `/training/planner` would reduce the already-large training page (527 lines) and give it proper routing/URL state.

### 6c. `StatsView` → wire into activities OR remove

If `StatsView` were to be used, it should be wired into the activities page as a 5th view mode (`'stats'`) alongside the existing `'list' | 'week' | 'timeline' | 'patterns'`. A separate page is not warranted since it depends on the same activity list data.

**No components currently need to be extracted to new pages.** The existing 13 pages (`dashboard`, `cycling`, `activities`, `calendar`, `routes`, `routes/duplicates`, `lifting`, `lifting/live`, `lifting/videos`, `health`, `goals`, `notifications`, `settings`, `training`, `wiki`) cover all current functionality.

---

## 7. Summary of Component Inventory by Directory

| Directory | Count | Key Components |
|-----------|-------|---------------|
| `ui/` | 19 | Shared primitives (`Card`, `Modal`, `Badge`, `Skeleton`, `Chart`, etc.) — well-organized |
| `charts/` | 3 | `Chart`, `ChartCard`, `ChartBody` — clean, single-purpose |
| `dashboard/` | 9 | Today/Weekly/Monthly tabs + helpers + sub-components. **See §4b for `helpers.tsx` concerns.** |
| `cycling/` | 14 | Power curves, zones, FTP, VO2max, weighting, analysis cards. `WeatherBadge` and `ActivityAiAnalysisCard` are used outside cycling — see §3b/§3c |
| `lifting/` | 12 | Session management, live workout, video embed/chips, warmup, PR forms. Well-contained |
| `health/` | 1 | `HealthAiAnalysisCard` only. `HealthAlertsSection` and `RespiratoryRateCard` are misplaced in `dashboard/helpers` — see §3a, §4b |
| `routes/` | 16 | The largest domain. Includes `CompareRoutesModal` (dead), `MapBrowseView` (dead), `VirtualRouteList.tsx` misnamed (exports `RoutesListView`) — see §2, §1 |
| `training/` | 10 | Plan builder, weekly view, conformity, events, weather. Well-contained |
| `goals/` | 3 | Creation/detail modals. Well-contained |
| `settings/` | 5 | Sub-settings cards. Well-contained |
| `maps/` | 3 | `RouteMap`, `ElevationProfile`, `SurfaceBreakdown` — clean, single-purpose |
| `calendar/` | 2 | Well-contained |
| `activities/` | 8 | Activity list components. `StatsView` is dead — see §1 |
| `sync/` | 1 | `SyncHealthBanner` — cross-cutting, correctly in own dir |
| `onboarding/` | 2 | Well-contained |
| Root `components/` | 3 | `Providers`, `PwaRegister`, `Sidebar` — layout-level, correctly at root |

**Total: ~95 components** (matches the audit report count on 2026-08-29), now reorganized across `ui/` (20 incl. `TrendArrow`), `analysis/` (1 new), `charts/` (3), `dashboard/` (7), `cycling/` (13), `health/` (4 incl. 2 moved + `HealthAlertsSection`), `routes/` (17 incl. `RoutesListView` renamed + `DifficultyBadge` extracted), `training/` (10), `goals/` (3), `settings/` (5), `maps/` (3), `calendar/` (2), `activities/` (7 — `StatsView` removed), `sync/` (1), `onboarding/` (2), root (3).

---

## 8. Quick Action List

| Priority | Action | Status | Files Affected |
|----------|--------|--------|---------------|
| **High** | Delete dead components: `StatsView`, `MapBrowseView` | ✅ **DONE** | `components/activities/StatsView.tsx` (deleted), `components/routes/MapBrowseView.tsx` (deleted) |
| **High** | Remove dead `ProviderBadge` function from `ui/ProviderBadge.tsx` | ✅ **DONE** | `components/ui/ProviderBadge.tsx` |
| **Medium** | Wire in `CompareRoutesModal` to routes page | ✅ **DONE** | `app/(app)/routes/page.tsx`, `RoutesGridView.tsx`, `VirtualRouteList.tsx`, `RoutesMapView.tsx`, `routesStore.ts` |
| **Medium** | Split `VideoChip` out of `VideoEmbed.tsx` into its own file | ✅ **DONE** | New `components/lifting/VideoChip.tsx`; removed from `VideoEmbed.tsx`; updated `lifting/page.tsx` + test imports |
| **Medium** | Rename `VirtualRouteList.tsx` → `RoutesListView.tsx` | ✅ **DONE** | `components/routes/VirtualRouteList.tsx` → `RoutesListView.tsx`, `routes/page.tsx` import |
| **Medium** | Extract `DifficultyBadge` from `lib/routeUtils.tsx` to `components/` | ✅ **DONE** | New `components/routes/DifficultyBadge.tsx`; `lib/routeUtils.tsx` → `routeUtils.ts` (re-exports for backward compat) |
| **Medium** | Refactor 4 self-fetching AI analysis cards toward the `LlmAnalysisCard` externally-fed pattern | ✅ **DONE** | New `components/analysis/AiAnalysisCard.tsx`, new `lib/hooks/useAiAnalysis.ts`; refactored all 5 cards |
| **Low** | Move `HealthAlertsSection` from `dashboard/` to `health/` | ✅ **DONE** | Moved to `components/health/`, updated `WeeklyTab.tsx` import |
| **Low** | Split `dashboard/helpers.tsx` into separate files | ✅ **DONE** | Moved `RespiratoryRateCard`→`health/`, `WhoopWeeklyCard`→`health/`, `TrendArrow`→`ui/`, `getGreeting`→`lib/utils.ts`. `ActivityRow`, `SessionRow`, `ListSkeleton` remain in `helpers.tsx` as dashboard-only helpers. Re-exports removed. |
| **Low** | Move `WeatherBadge` from `cycling/` to `activities/` | ✅ **DONE** | Moved to `components/activities/`; updated `ActivityCard.tsx` + `activities/page.tsx` imports |
| **Low** | Move `ActivityAiAnalysisCard` from `cycling/` to `activities/` | ✅ **DONE** | Moved to `components/activities/`; updated `activities/page.tsx` import |
| **Low** | Move `DeficiencyCard` from `dashboard/` to `ui/` (shared by dashboard + lifting) | ✅ **DONE** | Moved to `components/ui/`; updated `WeeklyTab.tsx` + `lifting/page.tsx` imports |
