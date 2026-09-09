# Mobile UI/UX Review — Android-only Full Pass

> Scope: Android Chrome, 320 / 360 / 390 / 430px. No iOS work. Full pass Phases 0–6.
> Source: read-only audit of `frontend/src` (layout, Sidebar, Modal, TabGroup, all 12 `(app)` pages, forms, Leaflet, Recharts, Replay3D/Route3D, PWA/offline).

## Decisions

1. **No priority preference → order by risk/effort:** low-risk globals first, high-value forms next, heavy maps/3D later, PWA last.
2. **Bottom tab bar → NOT recommended.** `Sidebar.tsx:8-23` has 14 destinations; a 4–5 slot bar hides 9+ items behind a second "More" drawer (two nav truths). Drawer links are already `px-4 py-3` (~48px). A bottom bar also collides with Android gesture nav + Live `LOG SET` sticky footer + compare bars + install pill. Fix the drawer instead: 44px hamburger/bell (currently ~40px), focus trap + `aria-modal` + focus-return, swipe-dismiss.
3. **PlanBuilder touch DnD → NOT recommended.** `PlanBuilder.tsx:749-807,860-885` is mouse-only `draggable`/`onDrop`; true touch-DnD (long-press + ghost + auto-scroll) is fragile on Android Chrome and fights vertical scroll. `WeeklyView` already covers ~90% of phone needs (day cards, quick-edit, targeted `updatePlanDay` PATCHes). Make the builder safe on phones + add move-buttons/date-move, steer mobile to WeeklyView.

## What's already good

- Centralized `pt-16` shell (`app/(app)/layout.tsx:94`), hamburger `md:hidden`, `Modal` bottom-sheet on `<sm` (`Modal.tsx:52-69`), `CalendarAgendaView` (`md:hidden`) + `TimelineView` card fallback, `MobileRouteDetailSheet`, LiveWorkout 56–64px steppers/CTA + `pb-[safe-area]`, `Chart` Brush guards (pitfall #17), dominant `grid-cols-1 sm/md/lg` pattern.

## Phase 0 — Baseline (no code)

Viewport matrix 320/360/390/430 Android Chrome. Per-page checklist: no horizontal scroll, all primary taps ≥44px, sheets dismiss safely, charts legible ~260–300px, maps scroll-past works.

## Phase 1 — Global tap-targets + overflow (quick wins)

- `ModalHeader` close (`text-xl` no padding → 44px), pills `px-2.5 py-1 text-[11px]` → 44px min-h, `p-2/p-2.5` icon buttons, table actions, `NotificationBell` View-all/Mark-read, install pill, 3D play/rate/mode buttons.
- `TabGroup.tsx:19-36`: `max-w-full overflow-x-auto` + `shrink-0` tabs, 44px height, arrow-key nav (7-tab `RouteDetailPanel` clips at 360px).
- Fixed grids → responsive: `FuelPlanCard:79 grid-cols-3`, `Compare*Modal grid-cols-2`, `DayDetailPanel:190 grid-cols-3`, `ExerciseManager grid-cols-2`, `EventResultPanel grid-cols-2`.
- Routes header (`routes/page.tsx:172-256`): `flex-wrap` + icon-collapse Upload/Duplicates/Sync/Heatmap on `<sm`.
- Search/sort/palette inputs `text-sm` → `text-base` (16px+).
- Accept: zero h-scroll at 360px, primaries ≥44px.

## Phase 2 — Drawer / Modal / sheets a11y

- `Sidebar.tsx:119-170`: trap, `aria-modal`, focus-return, swipe-dismiss (backdrop is click-only today).
- `Modal.tsx`: trap + initial focus + labelled-by + `inert` bg + dirty-form confirm-before-close (prevents fat-finger loss).
- `MobileRouteDetailSheet:62-74`: larger grab area, velocity-aware dismiss, fix nested `overflow-y-auto` double-scroll.
- `CommandPalette:216-242`: `mx-4` + safe-area, visible close on mobile, touch dismiss, fix `listbox` wiring.
- `ActivityCard:69-81`: 16px compare checkbox → 44px hit area, separate `View route` tap from card `onSelect`.

## Phase 3 — Forms (Live first)

- `LiveWorkout`: RPE row (9×~36px → wrap/slider), quick chips `py-2`→44px, `Finish py-1.5`→44px+, `aria-live` on sync pill.
- `PlanBuilder`: per-day Move-to-date picker + prev/next arrows, 44px week tabs/inputs/checkboxes, safe-area footer, replace `confirm()` delete, hide drag hint on `pointer: coarse`.
- `AddExerciseForm` (2-col cramp, 32px inputs, `w-72` warmup overflow), `WeightPanel`/`ProfileEditor` (36px→44px, `htmlFor/id`, `role=switch`, `inputMode`), `RouteFilterBar` (collapse tier-2, `inputMode`), `ExerciseAutocomplete` (touch-close, listbox semantics).

## Phase 4 — Maps / Charts / 3D

- Leaflet (`RouteMap:45-48`, `RoutesMapView:49-52`): 44px zoom controls offset from hamburger, `tapTolerance`, fix scroll/drag trap, 44px markers/popups, mobile fullscreen.
- Charts (`Chart.tsx:223-258`, `ElevationProfile:59-101`): mobile height ~260–300, collapse legend, `Brush 30→24` on `<sm`, tap-to-inspect (hover-only today), fix pie clipping + 12px heatmap cells.
- `Replay3D`/`Route3D`: `OrbitControls` touch-action so page scrolls past canvas, pinch hint, 44px scrub/play thumbs, `prefers-reduced-motion` + low-power/disable-3D toggle.

## Phase 5 — Android PWA / offline honesty

- Install pill: safe-area `bottom-4`, 44px targets, re-prompt (today `DISMISS_KEY` forever), fix update banner `z-[60]` covering hamburger/bell.
- `OfflineBanner` copy over-promises universal sync (only LiveWorkout queues) → honest copy + per-form offline handling; `useOnlineStatus:11-30` try/catch + heartbeat.
- `OfflineSnapshot` (dashboard-only) vs banner promise; SW (`sw.js:76-111`): deep-link nav fallback, cache tiles/DEM or designed empty states (blank offline today).

## Phase 6 — Verify per phase

`npm run dev` + 360/390px Android pass, `vitest` for touched pure logic, `git diff --stat` + spot-read 2 files before typecheck/lint. One phase at a time, no bulk rewrites.

## Progress log

- [x] Phase 0 — this doc written (2026-09-09).
- [x] Phase 1 — done (2026-09-09): TabGroup overflow+44px, ModalHeader 44px close, routes header wrap, FuelPlanCard stack+44px inputs, hamburger/bell 44px + bell dropdown actions, compare modals stack + table scroll + 44px close, EventResultPanel stack+44px, ExerciseManager stack, training event form stack+44px, RouteFilterBar search/sort 16px+44px + icon buttons, CommandPalette edge margin + 16px input + 44px rows. Verified: tsc clean (5 pre-existing `three` errors only), vitest 119/119 pass. Deliberately left: 2–3-up centered stat tiles (DayDetailPanel, EffortEstimateCard, RouteWeatherCard, dashboard KPIs) — standard mobile pattern, readable at 360px.
- [ ] Phase 2 — done (2026-09-09): drawer trap + `aria-modal` + focus-return + swipe-dismiss (`Sidebar.tsx`); Modal trap + initial-focus-once + `aria-modal` + `inert` main + opt-in `guardClose` (`Modal.tsx`); sheet velocity flick-dismiss + 44px grab + Escape + dialog semantics + single scroller via `scrollable={false}` (`MobileRouteDetailSheet`/`RouteDetailPanel` + 44px panel close); ActivityCard 44px compare checkbox + View-route stopPropagation; CommandPalette edge margin + listbox role. Verified: tsc clean, vitest 119/119. Deferred: bell-dropdown focus trap (closes on Escape/outside already), full `guardClose` adoption (available for future dirty forms).
- [ ] Phase 3 — done (2026-09-09): LiveWorkout 44px Finish/chips/toggles, RPE `grid-cols-5`, `role=status` sync pills, 44px retry; PlanBuilder `swapDates` refactor + ⇄ Swap-date touch control + pointer-aware tip + safe-area footer + 44px complete toggle; WeightPanel 16px/44px inputs + 44px row actions; ProfileEditor htmlFor/ids + inputModes + 44px + `role=switch` + full-width Save; AddExerciseForm 16px/44px inputs, 20px checkboxes, 44px remove/actions, picker viewport clamp. Verified: tsc clean, vitest 119/119. Deferred micro-items: ExerciseAutocomplete listbox/touch-close, RouteFilterBar tier-2 collapse + inputModes, live finish-sheet range thumb, PlanBuilder week-tab/number-input sizes + `confirm()` delete replacement.
- [ ] Phase 4 — done (2026-09-09): all 4 Leaflet maps (zoom bottom-right 44px via globals.css, wheel-zoom off, tapTolerance 30, 28px start/end + route marker hit areas); Chart caps at 280px on phones, Brush 24px, pie labels off (legend carries names), heatmap `role=img` summary; Replay3D/Route3D `touch-action:pan-y` (page scrolls past canvas), touch hints, 44px play/rate/mode/scrub. Verified: tsc clean, vitest 119/119 (incl. Chart 14/14 after jsdom matchMedia guard). No change needed: ElevationProfile already 150px + Recharts touch tooltips; Replay defaults paused (no autoplay); TelemetryStrip squish left (traces stay legible).
- [ ] Phase 5 — done (2026-09-09): install pill safe-area + 44px + 30-day re-prompt (back-compat with old flag), update banner safe-area + 44px; honest OfflineBanner copy (dashboard snapshot only, Live queues); localStorage try/catch; SW v5 — deep-link nav fallback order, OSM tile + DEM bounded SWR cache (maps/3D work offline). Verified: tsc clean, vitest 119/119. (No ESLint config in repo — `next lint` unset-up, skipped.) Deferred: heartbeat verification for lie-fi (Live syncer self-heals on reconnect).
