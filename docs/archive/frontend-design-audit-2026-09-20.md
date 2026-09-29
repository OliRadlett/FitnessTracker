# FitTrack Frontend Design & UX Audit — 2026-09-20

**Type:** AUDIT ONLY. No code was changed in this pass.
**Scope:** 14 sidebar destinations, 17 route files, ~130 components. Reviewed hierarchy,
spacing, type scale, contrast, empty/loading/error states, mobile `<sm` + desktop `≥lg`,
consistency (cards, badges, buttons, tabs, modals, toasts, formatting), a11y (keyboard,
focus, touch ≥44px, Recharts Brush), and IA friction (sidebar size, deep-links, filters).
**Assumed direction:** dark, dense-but-scannable, Strava-meets-Whoop.

**Method:** full reads of `frontend/src/CODEMAP.md`, `tailwind.config.js`,
`components/Sidebar.tsx`, `app/(app)/layout.tsx`, shared primitives
(`Card`, `Badge`, `Skeleton`, `EmptyState`, `Modal`, `TabGroup`, `MetricCard`,
`Chart`/`ChartBody`/`ChartCard`, `lib/utils.ts`, `lib/units.tsx`), plus parallel
page-group audits (dashboard, activities+calendar, training+goals, cycling+health,
lifting, routes, settings+wiki+notifications) and a cross-cutting style/a11y sweep.
High-impact P0 claims were re-verified against source before writing.

**Severity key:** `P0` = crash, data loss, or primary-path blocker ·
`P1` = major usability/a11y/consistency defect with a workaround ·
`P2` = polish/drift.

---

## A) Issue Table

### P0

| Sev | Page | Issue | Evidence | Recommended fix |
|---|---|---|---|---|
| P0 | Routes | Compare modal crashes when exactly one route is checked. `compareMode` is true with one route, but the guard is `\|\|` and props are non-null-asserted. | `routes/page.tsx:52` `const compareMode = compareRouteA !== null \|\| compareRouteB !== null;`, `:465` `{compareMode && (compareRouteAData \|\| compareRouteBData) && (`, `:467-468` `routeA={compareRouteAData!} routeB={compareRouteBData!}`; crash at `CompareRoutesModal.tsx:68-69` | Gate on `compareRouteAData && compareRouteBData`; make `routeB` optional with a "pick a second route" panel; remove `!`. |
| P0 | Lifting | Session delete-confirm is a bare boolean, not scoped to the row. Arm delete on A, select B, confirm deletes B. | `lifting/page.tsx:141` `useState(false)`; `:153-156` `handleSelectSession` never resets it; `:708` `onClick={() => deleteSessionMutation.mutate(selectedSessionId)}` | Replace with `confirmDeleteSessionId` and compare `=== session.id`; reset confirm/edit state inside `handleSelectSession`. |
| P0 | Cycling | Weight entry delete fires immediately with no confirmation or undo. | `WeightPanel.tsx:337-344` → `deleteMutation.mutate(entry.id)` | Route through a shared `ConfirmDialog`; disable the row button while pending. |
| P0 | Training | "Clear" race result deletes saved data with no confirmation. | `EventResultPanel.tsx:107-113` `onClick={() => clearMutation.mutate()}` | Inline two-step confirm (match `training/page.tsx:407-425`) or `ConfirmDialog`. |

### P1

| Sev | Page | Issue | Evidence | Recommended fix |
|---|---|---|---|---|
| P1 | Global | Provider logos use absolute paths without `basePath`, so every `ProviderIcon` 404s under `/fittrack`. Settings hardcodes the correct prefix, proving the mismatch. | `ProviderBadge.tsx:12-19` `strava: '/icons/strava.svg'` vs `next.config.js:5` `basePath: '/fittrack'`; `settings/page.tsx:22,64` `${BASE_PATH}/icons/strava.svg` | Central `PROVIDER_ICONS` with `/fittrack` prefix; dedupe with settings integration list. |
| P1 | Dashboard | No query error handling anywhere — outage renders as "no data" with no retry. | `TodayTab.tsx:121` `if (!todaySummary)` → EmptyState; `dashboard/page.tsx` never reads `isError` for its ~15 queries | Add `isError` → error card with `refetch()`; reserve EmptyState for successful empties. |
| P1 | Health | Errors masquerade as permanent loading; readiness errors show skeletons forever. | `health/page.tsx:162` `const sleepingLoading = !sleepConsistency && !sleepDebt && !optimalBedtime;` → `:304 "Loading…"`; `:211-213` readiness `? … : Array.from({length:4}).map(SkeletonMetric)` | Use each query's `isLoading`/`isError`; render error/empty states. |
| P1 | Cycling | Recalc/backfill errors render in **green** success colour. | `cycling/page.tsx:649` `<p className="text-xs text-positive">{recalcResult}</p>` (error set at `:418`); `:679` same | Typed `{kind:'ok'\|'error'}` state; mirror `FtpSection.tsx:64`. |
| P1 | Lifting/live | "Discard session (don't save)" deletes already-synced remote sets immediately; no confirm. "Close it" also discards with a euphemistic label. | `lifting/live/page.tsx:257-261` `onClick={handleDiscard}`; `:503-507` `handleCleanupRemoteActive` | Confirm with pending-set count; rename "Close it" → "Discard session". |
| P1 | Global | 136 form controls have no programmatic label; `focus-visible:` appears **0 times** and all 40 accent buttons lack focus styling. | Sweep: `PlanBuilder.tsx:274…`, `RouteFilterBar.tsx:209-222`, `GoalCreateModal.tsx:84…`, `LiftVideoForm.tsx:151…`; `focus-visible` grep = 0 | Add a shared `<Field>` wrapper (`id`/`htmlFor`) and a global focus ring utility. |
| P1 | Routes | List/Grid rows are clickable `<div>`s with no `role`/`tabIndex`/key handler — keyboard users cannot open a route. | `RoutesListView.tsx:27` `<div className="p-4" onClick={() => onSelect(route)}>`; `RoutesGridView.tsx:44` same | Use `<Card onClick>` (already adds role/tabIndex/Enter/Space) or a real `<button>`; keep compare control as a sibling. |
| P1 | Routes | Compare "label" double-toggles: outer div and inner checkbox both call `toggleCompare` → no-op. | `RoutesGridView.tsx:108-127` both handlers call `toggleCompare(route.id)` | Single `<input type="checkbox" onChange>` with a ≥44px label; drop outer onClick. |
| P1 | Routes | `RouteFilterBar` search debounce loops indefinitely; also "Save as Collection" silently drops the Status filter. | `RouteFilterBar.tsx:45-54` `setFilters({ ...filters, q })` with `filters` in deps; `:84-99` no `is_ridden` written into `rules` | Guard `if (filters.q !== localQ.trim())`; add `rules.is_ridden`. |
| P1 | Routes | Map is destroyed/rebuilt (`map.remove()`) on every selection/compare/heatmap change; popup injects unescaped `route.name` into innerHTML. | `RoutesMapView.tsx:200` deps include `selectedRouteId, compareRouteA…`; `:161` `` `<strong>${route.name}</strong>` `` | Init map once; update markers via a layer group; escape or DOM-build popups. |
| P1 | Routes | `localStorage` read in the render body (SSR crash) and duplicate query lacks `enabled: !!token` + error state. | `routes/duplicates/page.tsx:89-91` `JSON.parse(localStorage.getItem(...))`; `:30-34` no `enabled`/`isError` | Hydrate via `useState`/`useEffect`; add `enabled: !!token` and an error/retry card. |
| P1 | Routes | Detail query has no error path; a stale `?route=` shows the placeholder forever. Empty-state CTA goes to Settings even when filters are the cause. | `routes/page.tsx:120-125` no `isError`; `:414-425` `action={{ label: 'Go to Settings', href: '/settings' }}` | Inline error + Retry, clear bad param; when `activeFilterCount>0` offer "Clear filters". |
| P1 | Training | Day cards clickable but not keyboard-reachable (inconsistent with WeeklyView). Mutations fail silently to console. | `PlanBuilder.tsx:764-785` bare `<div draggable onClick>`; `WeeklyView.tsx:257-296` `console.error('[WeeklyView] Toggle completed failed:', err)` | Add role/tabIndex/key handler; surface inline errors (optimistic toggle has no failure path). |
| P1 | Training | Conformity 60–79% renders the same red as <60%; component scores 0.70–0.90 coloured red. | `WeeklyView.tsx:407-413` `>= 60 ? 'text-warning' : 'text-warning'`; `DayConformityPanel.tsx:86-91` `if (score >= 0.7) return 'bg-warning';` | Introduce a caution/amber token; reserve red for genuine failure. |
| P1 | Settings | Connections loading flag is discarded → all integrations flash "Connect"; export failures console-only; Health/Notification cards return `null` while loading and toggles default optimistically ON. | `settings/page.tsx:116` `const [, setLoading] = useState(true);`, `:185` `console.error('Export failed:', err)`; `NotificationSettings.tsx:85` `?? true`; `HealthAlertSettings.tsx:75` `if (!prefs \|\| !draft) return null;` | Keep loading state + skeletons; add `exportError` banner; gate toggles on `isLoading`. |
| P1 | Settings | Exercise delete is hover-only → impossible on touch (core library management). | `ExerciseManager.tsx:168` `opacity-0 group-hover:opacity-100` | Always visible on `<sm`; 44px hit area. |
| P1 | Lifting | `VideoEmbed` "Trimmed/Original" toggle is a no-op (both URLs come from the same stream call); `LiftVideoForm` uses native `alert()` ×5 (double-fires on upload failure). | `VideoEmbed.tsx:46,58`; `LiftVideoForm.tsx:56,60,78,94,131` | Hide toggle until a distinct `?variant=` exists; replace alerts with the existing `bg-warning/10` inline banner and drop the duplicate `onError`. |
| P1 | Lifting | Live finish sheet is a hand-rolled dialog with no focus trap/Escape/inert/scroll-lock; PR toast has no live region. | `lifting/live/page.tsx:568` `role="dialog"` only; `LiveWorkout.tsx:364` PR toast no `role`/`aria-live` | Render via shared `Modal`; add `role="status" aria-live="polite"` to PR toast. |
| P1 | Global | No toast/feedback system: four mechanisms coexist (native `alert`, native `confirm`, `PRCelebration`, ad-hoc inline state with inconsistent naming/ARIA). | `LiftVideoForm.tsx:131`; `FuelPlanCard.tsx:195`; `PlanBuilder.tsx:690`; `ExerciseManager.tsx:166`; `RouteDetailPanel.tsx:209`; `WeightPanel.tsx:43` | One `useToast` provider + `ConfirmDialog`; retire native dialogs. |
| P1 | Dashboard | Year-in-Review (~215 lines) is copy-pasted into Weekly and Monthly and has already diverged; no Yearly tab. | `WeeklyTab.tsx:625-…` vs `MonthlyTab.tsx:176-…`; no `YearlyReview` component exists | Extract `YearlyReview`; render from both (or add a real `yearly` tab). |
| P1 | Global | Unit/locale preference bypassed by 20+ manual `/1000`, `/3600`, `.toLocaleDateString()` sites, so metric/imperial + 12/24h prefs silently don't apply. | Sweep: `cycling/page.tsx:580,582` `unit="km"`; `lifting/page.tsx:48-49` `toLocaleTimeString([], …)`; `ExerciseGroup.tsx:170` `{set.weight_kg} kg`; `FtpSection.tsx:97,164,229` | Route through `formatDistance`/`formatDuration`/`formatWeight`/`formatDateDMY`/`formatTime`. |
| P1 | Dashboard | Interactive cards expose hover-only tooltips and undersized refresh; page-level `aria-live` wraps the whole subtree. | `MetricCard.tsx:110` `opacity-0 group-hover:opacity-100`; `DashboardRefresh.tsx:82` `w-7 h-7`; `dashboard/page.tsx:233` `aria-live="polite"` | Focusable tooltip trigger; 44px refresh; move live region to status widgets. |
| P1 | Activities | `ActivityCard` supports a `context` prop (`:163`) but no caller passes it, so connections/analytics/health badges never render in the primary list despite `include_context=true`. | `activities/page.tsx:751,1056,1087` call sites omit `context=`; `ActivityCard.tsx:163` `{context?.ride_metrics && (` | Pass per-activity `ride_context`, or drop the prop + payload. |
| P1 | Activities | Typing in Patterns "Custom Range" immediately switches to list view, unmounting the input on first keystroke. | `PatternsView.tsx:137` `onPatternSelect({ min_tss: … })` → `page.tsx:1038` `setViewMode('list')` | Apply on explicit "Apply", or don't change `viewMode` from `onPatternSelect`. |
| P1 | Routes | Map/List/Grid loading always renders a list of `SkeletonRouteCard`, causing large layout shift for map/grid. | `routes/page.tsx:366-371` single skeleton branch | Branch skeleton by `viewMode` (map block / grid / rows). |
| P1 | Notifications | Read rows dimmed with `opacity-60` while body/timestamps already `text-muted/70` at 10–11px → compounded contrast failure. | `notifications/page.tsx:157` `n.read ? 'opacity-60' : ''`, `:179` | Use colour/weight for read state; raise muted opacity. |
| P1 | Global | Command palette re-implements a dialog without focus trap/`inert`, and its listbox is structurally invalid (group headers as listbox children; no combobox roles). | `CommandPalette.tsx:216` no trap vs `Modal.tsx:69-101`; `:244` `role="listbox"` with `:255` `<p>` children | Wrap in `Modal` or copy its trap; add `role="combobox"`/`aria-controls`/`aria-expanded` and proper option nesting. |
| P1 | Health | Alert tabs are hand-rolled instead of the shared `TabGroup`; missing tablist/tab/aria-selected + keyboard nav. | `health/page.tsx:416-428` custom buttons; `TabGroup.tsx` exists | Replace with `<TabGroup>`. |
| P1 | Settings | Preference pills are 11px `~22px` tall; notification toggles are 44×24. | `settings/page.tsx:48` `px-2.5 py-1 text-[11px]`; `NotificationSettings.tsx:98` `w-11 h-6` | Shared `PillGroup`/toggle with 44px hit area. |

### P2 (grouped systemic)

| Sev | Page | Issue | Evidence | Recommended fix |
|---|---|---|---|---|
| P2 | Global | Button variants diverge: `bg-accent/80`, `bg-accent-hover`, `bg-green-600`, `bg-positive`, `text-background` vs `text-white`, `text-surface`; gradients and off-token families widespread. | 9 distinct primary clusters (sweep §1); `PlanBuilder.tsx:683` `bg-green-600`; `AdaptiveSuggestionsCard.tsx:112` `text-surface` | Ship Button variants (see §C); ban raw palette on primary actions. |
| P2 | Global | Loading is inconsistent: 9 spinner literals, `animate-spin` alternatives, raw `animate-pulse` duplicating `Skeleton`, and 13+ `"Loading…"` text placeholders where skeletons exist. | `Chart.tsx:113`, `AiAnalysisCard.tsx:123`, `activities/page.tsx:322`, `health/page.tsx:304`, `PowerModelSection.tsx:19` | Single `<Spinner>` + `<SkeletonText>`; skeleton per view. |
| P2 | Global | No shared confirm/destructive pattern: 5 native `confirm()`, 7 inline two-step, several immediate. | `FuelPlanCard.tsx:195`, `PlanBuilder.tsx:690`, `ExerciseManager.tsx:166`, `RouteDetailPanel.tsx:209`, `duplicates/page.tsx:64` | `ConfirmDialog` + `useConfirm`. |
| P2 | Global | Red (`warning`) used for "caution/medium" semantics; dead colour branches. | `LiftingAnalysisCard.tsx:14-15` both branches `text-warning`; `ConformityBadge.tsx:49`; `WeeklyView.tsx:130-135` non-monotonic TSB | Add `info`/`caution` tokens (see §C). |
| P2 | Global | `<label>` association missing across PlanBuilder/goals/lifting/routes forms; icon-only buttons missing names; tile `text-[9px]`/`text-[10px]` below legible minimum. | `DayConformityPanel.tsx:197` `text-[9px]`; `calendar/page.tsx:55` `text-[9px]`; `WarmupTemplateManager.tsx:217` `×` no aria-label | Label/`Field` wrapper; ≥11px text; aria-labels. |
| P2 | Dashboard | Hand-rolled year bars (recompute `Math.max` per row, no labels); `5`-col grid can orphan a 6th card; `getCurrentMonday` mutates its Date; report uses current month ignoring `selectedYear`. | `WeeklyTab.tsx:772`, `:232`, `:612`; `dashboard/page.tsx:228` | Shared `Chart`; `lg:grid-cols-6`; pure date helper; derive selected month. |
| P2 | Activities | `StatsView` is dead (unimported); Timeline empty state unreachable + mobile loses TSS bar; compare/bulk float bars can overlap; filter-count predicate ≠ `hasActiveFilters`. | `StatsView.tsx:18` (no imports); `TimelineView.tsx:76,114`; `activities/page.tsx:1112/1131`, `:678` vs `:908` | Delete `StatsView`; fix empty-state predicate; render TSS bar on mobile; unify filter predicate; stack bars. |
| P2 | Calendar | `formatStat` duplicated verbatim; calendar `text-[9px]`; mobile agenda missing `aria-label`; lifting history fetched unfiltered then filtered client-side. | `calendar/page.tsx:69` vs `CalendarAgendaView.tsx:17`; `DayDetailPanel.tsx:118-125` | Extract shared util; add date params; ARIA parity. |
| P2 | Training | `STATUS_COLORS`/day-type maps/`toDateStr`/`addDays` duplicated across PlanBuilder + training page + WeeklyView; WorkoutPlanner hand-rolls headings; bespoke spinner. | `PlanBuilder.tsx:82-108` vs `training/page.tsx:28-33` vs `WeeklyView.tsx:75-91`; `WorkoutPlanner.tsx:344,431,558` | Hoist shared constants/date utils; use `CardTitle`/skeleton. |
| P2 | Routes | Quality marker thresholds (70/50/30) diverge from `QualityBadge` (85/70/55/40); Overview and Effort tabs render the same component; detail-tab state duplicated in store (unused); failures swallowed as blank panels; fake readonly compare checkbox in map popup; 200-route cap with no paging. | `RoutesMapView.tsx:128-134` vs `QualityBadge.tsx:13-17`; `RouteDetailPanel.tsx:304,398`; `routesStore.ts:6`; `RouteWeatherCard.tsx:30`, `RouteHistorySection.tsx:34`, `SegmentsCard.tsx:96`; `RoutesMapView.tsx:172`; `lib/api/routes.ts:29-31` | Export shared tier resolver; remove redundant tab; drive from store; error/retry; remove fake control; add "showing 200 of N". |
| P2 | Settings/Notifications | Audit/top-right layering: bell `z-50` same as loading bar, no safe-area; unread badge `bg-red-500` not token; bell popover no `aria-haspopup`; `PageLoadingBar` is fake progress; `ErrorBoundary` retry can loop; landing title says "Fitness Tracker" vs brand "FitTrack". | `NotificationBell.tsx:81,97`; `PageLoadingBar.tsx:19`; `ErrorBoundary.tsx:44`; `app/page.tsx:36` | Token + higher z + safe-area; real progress; reload fallback; rebrand CTA. |
| P2 | Wiki | Sticky section nav is `hidden lg:block` → mobile must scroll ~960 lines; no `scroll-mt`. | `wiki/page.tsx:193`; `:187` `scrollIntoView` | Mobile TOC drawer/select + `scroll-mt-24`. |
| P2 | Dashboard/Cycling | Skeleton/grid mismatch and card padding drift (RespiratoryRate `p-4` vs `Card` `p-6`); `text-muted/50 text-[10px]` unreadable. | `cycling/page.tsx:481` vs `:517`; `RespiratoryRateCard.tsx:14`; `MetricCard.tsx:42` | Mirror grids; use `Card`; ≥11px + `text-muted`. |

**Notes on prior known debt:** WeeklyView has **2 props, not 30+** (verified at
`WeeklyView.tsx:189-192`; prop debt, if any, sits in `DayCard`/sub-panels). The
`Chart.tsx` `<Brush>` is **already compliant** (ariaLabel + startIndex + endIndex +
tickFormatter at `Chart.tsx:280-290`) — exactly one `<Brush>` exists repo-wide.

---

## B) Top 10 Tickets

### T1 — Fix routes compare-modal crash

- **Scope:** `frontend/src/app/(app)/routes/page.tsx`, `frontend/src/components/routes/CompareRoutesModal.tsx`
- **Current:** Opening compare with one route selected throws (`routeB.elevation_gain_meters` on `undefined`).
- **Desired:** Modal only renders when both routes are loaded; one-route state shows a "select a second route" hint; `routeB` optional.
- **Acceptance:** In compare mode, selecting exactly one route → no red screen, modal shows prompt; selecting a second → comparison renders; `git grep "compareRouteBData!"` returns nothing.
- **Out of scope:** Compare UX redesign, 3D side-by-side.
- **Risk:** Low; localized guard change.

### T2 — Shared `ConfirmDialog` + adopt for unconfirmed deletes

- **Scope:** new `frontend/src/components/ui/ConfirmDialog.tsx`, `frontend/src/components/cycling/WeightPanel.tsx`, `frontend/src/components/training/EventResultPanel.tsx`
- **Current:** Weight entry delete and race-result clear execute instantly.
- **Desired:** Both prompt via one accessible dialog (focus trap from `Modal`), disable while pending, cancel is default.
- **Acceptance:** Deleting a weight entry / clearing a result requires explicit confirm; Escape cancels; keyboard-only user can complete both.
- **Out of scope:** Migrating the 5 native `confirm()` sites (follow-up).
- **Risk:** Low.

### T3 — Scope lifting delete-confirm; confirm live discard

- **Scope:** `frontend/src/app/(app)/lifting/page.tsx`, `frontend/src/app/(app)/lifting/live/page.tsx`
- **Current:** Armed delete persists across session selection (can delete wrong session); live discard/close have no confirm.
- **Desired:** Confirm keyed to `session.id`; `handleSelectSession` resets confirm/edit; discard prompts with pending-set count.
- **Acceptance:** Arm delete on A, select B → no confirm visible; confirm deletes A only. Discard shows count and requires confirm.
- **Out of scope:** Reworking `useLiveSession` sync.
- **Risk:** Medium (touches local-first sync UX); keep changes to UI guards only.

### T4 — Restore provider logos (basePath) and dedupe icon map

- **Scope:** `frontend/src/components/ui/ProviderBadge.tsx` (+ optionally import map into `settings/page.tsx`)
- **Current:** `ProviderIcon` renders broken images in production (`/icons/...`).
- **Desired:** Icons resolve under `/fittrack`; single canonical provider→icon map.
- **Acceptance:** On the deployed `/fittrack` app, activity/route cards show provider logos (no 404 in Network tab); settings uses the same map.
- **Out of scope:** Adding new provider logos.
- **Risk:** Low.

### T5 — Keyboard-accessible route rows + fix compare checkbox

- **Scope:** `frontend/src/components/routes/RoutesListView.tsx`, `frontend/src/components/routes/RoutesGridView.tsx`
- **Current:** Rows are clickable divs (unfocusable); grid compare label double-toggles to a no-op.
- **Desired:** Rows are real buttons/`<Card onClick>`; compare is a single labeled 44px checkbox.
- **Acceptance:** Tab reaches each row, Enter/Space opens detail; clicking "Compare" text toggles exactly once; axe reports no nested-interactive error.
- **Out of scope:** Routes map view.
- **Risk:** Low.

### T6 — Add query error states to the dashboard

- **Scope:** `frontend/src/app/(app)/dashboard/page.tsx`, `frontend/src/components/dashboard/TodayTab.tsx`, `frontend/src/components/dashboard/WeeklyTab.tsx`
- **Current:** Any query failure renders the "no data" empty state.
- **Desired:** `isError` renders an error card with retry; EmptyState only for successful empties.
- **Acceptance:** Simulate a 500 on `todaySummary`/weekly → error card visible, "Retry" refetches; empty DB still shows EmptyState.
- **Out of scope:** Monthly tab (mirror later), global error boundary.
- **Risk:** Low.

### T7 — Fix `RouteFilterBar` search loop + collection rules

- **Scope:** `frontend/src/components/routes/RouteFilterBar.tsx`
- **Current:** Debounce re-sets filters every 300ms indefinitely while typing; saved collections drop `is_ridden`.
- **Desired:** Debounce only fires when `q` actually changes; smart collection includes status.
- **Acceptance:** Typing a query produces exactly one store update after settle (React DevTools/network); "Save as Collection" against Ridden filter round-trips `is_ridden` in `rules`.
- **Out of scope:** Other filters.
- **Risk:** Low.

### T8 — Replace native `alert()` in `LiftVideoForm` with inline errors

- **Scope:** `frontend/src/components/lifting/LiftVideoForm.tsx`
- **Current:** Five `alert()` calls; upload failure alerts twice.
- **Desired:** One inline `bg-warning/10 border-warning/30` banner using the component's existing error styling.
- **Acceptance:** Invalid type/oversize/failed upload show inline banner, no native dialog, one message per failure.
- **Out of scope:** Other native-dialog sites.
- **Risk:** Low.

### T9 — Extract shared `YearlyReview` component

- **Scope:** new `frontend/src/components/dashboard/YearlyReview.tsx`, `WeeklyTab.tsx`, `MonthlyTab.tsx`
- **Current:** ~215 lines duplicated (and diverged) in two tabs.
- **Desired:** One component; both tabs compose it; identical output.
- **Acceptance:** Rendering Weekly and Monthly year blocks produces identical markup; `git diff` removes the duplicate blocks; no visual regression.
- **Out of scope:** Adding a dedicated Yearly tab (follow-up).
- **Risk:** Medium (large block); verify against a real yearly payload.

### T10 — Settings a11y & loading states

- **Scope:** `frontend/src/app/(app)/settings/page.tsx`, `frontend/src/components/settings/NotificationSettings.tsx`, `frontend/src/components/settings/HealthAlertSettings.tsx`
- **Current:** Connections flash "Connect"; export errors vanish; toggles render ON before load; pills/toggles under 44px.
- **Desired:** Skeleton until loaded; visible export error; disabled skeleton toggles; 44px hit areas.
- **Acceptance:** Slow-network throttle → no "Connect" flash, toggles disabled until data; export failure shows a message; pills/toggles measure ≥44px in DevTools.
- **Out of scope:** Other settings cards.
- **Risk:** Low.

---

## C) Design-System Deltas (specs, no code)

**1. Semantic colour tokens (root cause of many P1/P2s).** Add beyond `warning` (currently overloaded as red):
- `info` (sky/blue) — informational, "normal/medium"
- `caution` (amber) — 60–79% conformity, medium fatigue, "at risk"
- `danger` = existing `warning` (#ef4444) — only genuine failure/destructive
- `success` = existing `positive`
Rule: numeric bands map `success → info → caution → danger`; never two adjacent bands to the same token. Delete dead branches (`LiftingAnalysisCard`, `WeeklyView` TSB).

**2. Buttons.** One `Button` primitive, variants:
- `primary`: `bg-accent text-white hover:bg-accent-hover`, `focus-visible:ring-2 ring-accent ring-offset-2 ring-offset-background`, `disabled:opacity-50 disabled:cursor-not-allowed`
- `secondary`: `bg-surface-light text-white hover:bg-surface-light/80`
- `tinted`: `bg-accent/20 text-accent border border-accent/30 hover:bg-accent/30` (replace `bg-blue-500/20`, `bg-purple-500/20` one-offs)
- `ghost`: `text-muted hover:text-white hover:bg-surface-light/50`
- `danger`: `bg-warning text-white` (destructive only)
- `success`: reserved for explicit confirm/complete actions (not primary submits)
Sizes: `sm` (min-h-36), `md`/default (min-h-44), `lg` (min-h-56). Icon buttons: 44×44, always `aria-label`. Kill `text-background`/`text-surface`/`text-accent-foreground` on accent buttons — always `text-white`.

**3. Section + type scale (one ladder).** Page H1 `text-2xl sm:text-3xl font-bold text-white`; section H2 `text-lg font-semibold text-white`; card title `text-base font-semibold` (CardTitle today is `text-lg`); body `text-sm`; meta `text-xs text-muted`; tabular micro `text-[11px]` minimum. Ban `text-[9px]`/`text-[10px]` and `text-muted/50`. Uppercase section labels become a `SectionLabel` component (`text-xs font-medium uppercase tracking-wider text-muted`) — currently mixed with `text-sm` headings.

**4. Card & headers.** Standardize `Card` `p-6` (kill `p-4` re-rolls like `RespiratoryRateCard`), header `flex items-baseline justify-between mb-4`, optional right-aligned `actions` slot. Interactive cards: `Card` may keep `role="button"` only when it contains **no** nested controls; otherwise use a header `Link`/button.

**5. Skeletons & spinners.** One `<Spinner size>` used by `ChartBody`/`AiAnalysisCard`/page loaders. `SkeletonText`, `SkeletonMetric`, `SkeletonRow`, `SkeletonCard`, `SkeletonMap`. Each list/map/grid view provides a matching skeleton selected by `viewMode`. Replace all `"Loading…"` text.

**6. Empty & error states.** `EmptyState` everywhere (retire inline `text-center py-8`). Add `ErrorState { title, message, onRetry }` (`role="alert"`), used whenever `isError`. Reserve `EmptyState` for successful-empty only.

**7. Feedback primitives.** One `ToastProvider` (`role="status"` success / `role="alert"` error, auto-dismiss, dismiss button ≥44px) + `useConfirm`/`ConfirmDialog`. Retire native `alert`/`confirm`; standardize inline mutation errors on an `InlineAlert` (`bg-warning/10 border-warning/30 text-warning`, or positive variant).

**8. Forms.** `Field` wrapper: `<label htmlFor>` + control + `error` text with `aria-describedby`/`aria-invalid`. Label style `block text-xs text-muted mb-1`. Numeric inputs get `min`/`max`/`step` + inline validation.

**9. Tabs/toggles.** One `Tabs` primitive: `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, roving arrow-key focus, `min-h-[44px]`. Toggle/pill group: 44px hit area, text ≥12px.

**10. Tooltips.** `Tooltip` with focusable trigger, `aria-describedby`, toggle on focus/click, and inline fallback on touch; stop hover-only on `MetricCard`/`ConformityBadge`/`LiveWorkout` sync pill.

**11. Provider assets.** `PROVIDER_ICONS` keyed and `${BASE_PATH}`-prefixed, shared by `ProviderBadge` and settings.

**12. Formatting.** Enforce `lib/utils.ts` as the only formatter; add `formatPower`, `formatElevation`, `formatNumber` for the 100+ inline `.toFixed(` sites; delete `lib/analysisRenderer.relativeTime` in favour of `formatRelativeTime`.

---

## D) Explicit Non-Goals

- No light mode, no CSS modules, no change to the dark palette tokens or `basePath`.
- No backend, schema, migration, or API-contract changes (except accepting optional query params already supported).
- No new chart library, no Recharts replacement; `Chart.tsx` `<Brush>` is already compliant (ariaLabel + startIndex + endIndex + tickFormatter) and stays as-is.
- No rework of the three.js `Replay3D`/`Route3D` engines or the live-sync `useLiveSession` trust model — only surface UI (confirmations, labels, live regions).
- No sidebar/IA restructure (14 items stay); no new Yearly tab in this pass (T9 extracts only); no new routes.
- No design-system-wide migration in one sweep — component specs (§C) are the target; adoption is incremental per ticket.
- No global state-management change (React Query + Zustand stay).
- No i18n framework; existing en-GB/en-US + 12/24h preferences only.
- No E2E/visual-regression infrastructure additions; verification is manual + axe + existing `vitest` where present.
- No production changes; no direct commits to `prod`.
