# FitTrack — UI/UX Enhancement Investigation

> **Date:** 2026-09-20
> **Type:** INVESTIGATION ONLY — no code changed in this pass.
> **Companion:** `docs/frontend-design-audit-2026-09-20.md` (functional/a11y issue table, tickets, design-system deltas).
> **Direction assumed:** dark, dense-but-scannable, Strava-meets-Whoop.
> **Method:** static analysis of `frontend/src` (TSX/TS/CSS), full reads of shell + shared
> primitives, scripted counts (icon glyphs, color-family utilities, type sizes, radius,
> motion), plus verification of map tiles, fonts, and chart usage.

**Concurrent-session caveat:** at the time of this investigation the working tree already had
uncommitted changes from another session in `app/(app)/health/page.tsx`, `lifting/page.tsx`,
`components/cycling/PowerCurveSection.tsx`, `RideAnalysisCard.tsx`, `dashboard/TodayTab.tsx`,
`RestDayBanner.tsx`, `lifting/LiveWorkout.tsx`, `lib/api/fetch.ts`. Any enhancement work must
coordinate with that session first.

---

## 1. Executive Diagnosis

The app is functionally rich and its primitives (`Card`, `Modal`, `Chart`, `Skeleton`,
`EmptyState`) are genuinely reusable. The design problem is **not** that it looks unfinished —
it is that it has **no codified visual language**. Six root causes explain most of the visual
inconsistency found in the audit:

1. **Emoji is the de-facto icon system.** 821 emoji/symbol glyphs across 106 files; the
   installed `lucide-react` is used in only 6 files. Emoji render differently per OS/browser,
   have inconsistent optical weight and vertical alignment, are not themeable, and carry
   unintended colour — the single largest visual-quality drag.
2. **No typographic system.** No web font is configured (system stack only), body text uses an
   untokenized `text-slate-200`, and there are 163 hard-coded `text-[Npx]` sizes (112 × 10px,
   35 × 11px, 15 × 9px, 1 × 8px). Numeric alignment is weak (`tabular-nums` only 15×),
   which matters disproportionately in a metrics app.
3. **Colour has drifted off-token.** ~560 off-token Tailwind colour utilities (yellow 135,
   blue 108, green 74, purple 70, orange 62, red 37, amber 30) compete with ~620 token
   utilities. `warning` (#ef4444, red) is overloaded as "caution", "medium", and "destructive".
4. **No shape/elevation or motion language.** Four radii coexist (`rounded-lg` 432,
   `rounded-full` 128, `rounded-xl` 67, `rounded-md` 5, plus `rounded-2xl` on auth); only 19
   `shadow-*` uses in total (flat); 0 `prefers-reduced-motion`/`motion-safe` handling despite
   45 `animate-*` and 252 `transition-colors`.
5. **State coverage is ad hoc.** `EmptyState` is used 8 times but there are 42 inline
   `text-center py-8/12` empties; `Skeleton` is imported in 19 files but 29 raw `animate-pulse`
   blocks exist; `ChartCard` is used only 3 times although `<Chart>` appears 120 times, so most
   charts get hand-wrapped chrome with divergent loading/empty treatment.
6. **The shell is a flat list.** 14 emoji nav items with no grouping, no section labels, no
   active indicator beyond a tinted background, and a 6-column mobile bottom bar of emoji.

The enhancement thesis: **codify one visual language (tokens + primitives), replace emoji with
a proper icon set, and give data a typographic voice — then the existing screens become
coherent without re-architecting them.**

---

## 2. Evidence Dashboard

| Dimension | Measured | Implication |
|---|---|---|
| Emoji/symbol glyphs in source | **821** across **106** files, **116** distinct | Emoji is the icon system |
| `lucide-react` adoption | **6** files (all `routes/` + Changelog) | Installed but unused |
| Custom `text-[Npx]` sizes | **163** (10px×112, 11px×35, 9px×15, 8px×1) | Micro-type, no scale |
| `tabular-nums` | **15** | Numbers don't align |
| Body colour | `text-slate-200` (#e2e8f0), untokenized | Token gap |
| Off-token colour utilities | **~560** (yellow 135, blue 108, green 74, purple 70, orange 62, red 37, amber 30) | Palette drift |
| Token colour utilities | ~620 accent, 909 surface, 786 surface-light, 1123 muted, 315 warning | Tokens exist but compete |
| Radius variants | lg 432, full 128, xl 67, md 5, 2xl (auth) | No radius scale |
| `shadow-*` | **19** total | Flat, no elevation |
| Motion safety | **0** reduced-motion / motion-safe | A11y + polish gap |
| `animate-*` / `transition-colors` | 45 / 252 | Animation exists, unmanaged |
| `<Chart>` vs `<ChartCard>` | **120** vs **3** | Shared chart chrome bypassed |
| Direct `ResponsiveContainer` / `recharts` | 8 / 4 | Charts built outside the wrapper |
| `EmptyState` vs inline empties | **8** vs **42** | Empty states not unified |
| `Skeleton` imports vs raw `animate-pulse` | 19 vs **29** | Loading not unified |
| Page headers | 19 `<h1>`, **17 distinct class strings**, no `PageHeader` | Header drift |
| Map tiles | OSM **light** tiles ×3 (`tile.openstreetmap.org`) | Light map in a dark app |
| Lazy `next/dynamic` | 4 | three.js/leaflet handled, little else |
| Landing brand | "Fitness Tracker" vs `themeColor #0f172a`; white Google / `bg-gray-800` GitHub buttons | Brand + token drift |

---

## 3. Dimension-by-Dimension Critique & Enhancement Direction

### 3.1 Iconography — the biggest single win

**Current:** Sidebar (`Sidebar.tsx:8-23`, `:150-156`) uses emoji for all 14 nav items and the
mobile bar. Page titles use emoji (`<h1>…📋 Training Plans`, `📹 Videos`, `🩺 Health`,
`🎯 Goals`). Empty states (`EmptyState` takes `icon: string`, `EmptyState.tsx:7`), alerts,
buttons, and inline chips all use emoji — 116 distinct glyphs.

**Problems:**
- Cross-platform inconsistency (Windows Segoe UI Emoji vs Apple vs Android) — the app looks
  different for every user and screenshots don't match the product.
- Colour is uncontrolled: 🏋️/bicycle/target inject purple/orange/red that clash with the
  accent.
- Optical size/baseline vary; emoji can't inherit `currentColor`, weight, or `strokeWidth`.
- Inconsistent semantics: ↑↓→ (arrows), ✓✕ (marks), ⚠ (sign), and pictographs are mixed.

**Direction:** Adopt **lucide-react** (already a dependency, MIT, tree-shakeable, `size` +
`strokeWidth` + `currentColor`) as the single icon set. Map nav/empty/section concepts to a
named registry (e.g. `LayoutDashboard`, `CalendarDays`, `Bike`, `Dumbbell`, `Zap`, `Video`,
`Target`, `Map`, `BookOpen`, `Bell`, `Settings`, `HeartPulse`, `LineChart`). Reserve emoji for
**content only** (e.g. `weatherEmoji()` in `lib/utils.ts:66` is legitimate). Every icon inside
a label gets `aria-hidden`; icon-only controls get `aria-label`.

### 3.2 Typography & numeric density

**Current:** No `next/font`/`font-family`; OS default. Body `text-slate-200`. 163 micro-sizes.

**Direction:**
- **One UI face** (`Inter` or `Geist` via `next/font`, self-hosted, no CLS) plus an optional
  **numeric/mono companion** for timestamps, IDs, and raw power/duration readouts. Keep it to
  two families max.
- **Tokenized ladder** (see §4.1) with a hard floor of **12px** for meta text; eliminate 8/9/10px.
- **`tabular-nums` on all numeric surfaces** (metric values, tables, splits, power/pace,
  timestamps, chart ticks, sidebar dates). This is the highest-leverage detail for a
  "dense-but-scannable" feel.
- Stop using `font-medium` (381 uses) as the default emphasis; make `semibold` the emphasis
  weight and reserve `bold` for hero/value numerals.
- Section labels become deliberately small-caps (`text-xs uppercase tracking-wide`) while
  content stays sentence case — one clear rule instead of 105 `uppercase` scattered uses.

### 3.3 Colour & semantic tokens

**Current:** ~560 off-token utilities. `warning` (#ef4444) means "danger", "caution", and
"medium" (see audit P1s: `WeeklyView.tsx:407-413`, `DayConformityPanel.tsx:86-91`,
`LiftingAnalysisCard.tsx:14-15`).

**Direction:** Keep the existing six tokens; add a small semantic layer and a chart ramp:
- `info` (sky), `caution` (amber), `success` (= `positive`), `danger` (= `warning`).
- Rule: **bands desaturate upward**: neutral → info → caution → danger; never collapse two
  bands onto one token. Fixes the "green error", "red okay", and dead-branch bugs wholesale.
- A single **categorical chart ramp** (8 colours aligned to tokens) replaces the hardcoded
  hex arrays in `CompareActivitiesModal`, `Replay3D`, `Chart.tsx`, `CompareRoutesModal`.
- Tokenize body text (`foreground`) and an explicit `border`/`divider` token so
  `surface-light/50` isn't copy-pasted (`786` uses).
- Elevation via a **surface scale** (`surface-1/2/3`) rather than border+shadow mixes.

### 3.4 Shape, elevation, surface

**Current:** 4+ radii; 19 shadows total; no elevation hierarchy; `bg-gradient` ×3;
`backdrop-blur` ×4; `hover:scale` 0.

**Direction:**
- **Radius scale:** `sm=8 / md=12 / lg=16 / full` — controls `sm`, cards `md`, modals/sheets
  `lg`. Retire `rounded-2xl` and ad-hoc mixes.
- **Elevation scale:** `0` flat surface (page cards), `1` raised (dropdowns/popovers), `2`
  overlay (modals/sheets). Today everything is flat `shadow-lg`, so overlays don't separate.
- **Hairline borders** at 1px with an explicit border token; use dividers
  (`divide-*`, currently 2 uses) for dense lists/tables instead of nested cards.
- **Optional density toggle** (Comfortable / Compact) persisted like the sidebar collapse —
  relevant to a powerlifting/cycling user who scans long lists. Compact reduces card padding
  (p-6→p-4), row height, and chart height (−20%).

### 3.5 Motion & feedback

**Current:** 45 `animate-*`, 252 `transition-colors`, 19 `transition-all`; 0 reduced-motion.

**Direction:**
- Adopt a **motion policy**: 120–160ms for hover/press, 200–250ms for enter/exit overlays,
  ease-out; no decorative motion on data.
- Wrap all non-essential animation in `motion-safe:` / honour
  `prefers-reduced-motion: reduce`.
- One **toast + one confirm** primitive (currently native `alert`/`confirm`, `PRCelebration`,
  and ad-hoc inline states coexist). Standard success (positive, auto-dismiss), error
  (warning, sticky), and a page-level "Sync" indicator.
- Give **optimistic mutations** a visible pending state (today `WeeklyView`/`AdaptiveSuggestionsCard`
  fail silently to console) and a success tick.

### 3.6 Loading / empty / error coverage

**Current:** 8 `EmptyState` vs 42 inline empties; 19 `Skeleton` vs 29 raw `animate-pulse`;
`<Chart>` 120 vs `<ChartCard>` 3.

**Direction:**
- Route **every** chart through `ChartCard` (or a new `ChartFrame`) so loading/empty/error are
  uniform and skeletons match the chart's real height.
- Add an **`ErrorState`** (`role="alert"`, retry) and use it wherever `isError` today renders
  as "no data" (dashboard, health, routes detail, route widgets).
- Replace text "Loading…" placeholders (13+ found) with shape-matched skeletons.
- Empty states always carry **one** primary CTA (currently some are CTA-less inline `<p>`).

### 3.7 Data visualisation

**Current:** Recharts default styling; inline hardcoded tooltip/axis styling in `Chart.tsx`;
grid/axis in `#334155`; palette partly theme-aligned. Reference bands/lines exist but no
consistent colour logic. Radar/histogram/streamline visuals are absent.

**Direction:**
- A **chart theme module** (axis/grid/tooltip/legend/brush tokens + categorical ramp) consumed
  by `Chart.tsx`; remove per-call-site styling.
- Consistent **semantic banding** (TSS/HR/power zones use the zone ramp, not ad-hoc colours).
- Standard **metric tooltip** (label, value + unit, delta vs baseline) rather than the default
  Recharts tooltip.
- For the flagship "Strava-meets-Whoop" feel: a **readiness/form hero** on the dashboard
  (see §5.1) and **sparklines** on activity/session cards (tiny inline `<Area>`), which
  currently show raw numbers only.

### 3.8 Layout, density, responsiveness

**Current:** `grid-cols-1 sm:grid-cols-N` is applied consistently (278 `grid-cols-*`); padding
is `p-4` mobile / `p-8` desktop; the shell reserves `pt-20 pb-24` for the mobile chrome
(`layout.tsx:94`). Good foundation.

**Direction:**
- Introduce a **12-column content grid** and a consistent **card padding rhythm** (kill the
  `p-4` re-rolls like `RespiratoryRateCard`).
- **Page headers** get one component (title + subtitle + actions + status) — today 17 distinct
  `<h1>` strings and no `PageHeader`.
- Mobile: keep the bottom bar, but replace emoji with icons and give it a **raise-on-scroll /
  hide-on-keyboard** behaviour for the long Live Lift and Routes pages.
- Tables (`DayConformityPanel`, route history, power curve) get horizontal scroll + sticky
  first column rather than shrinking to 9–10px text.

### 3.9 Navigation & IA shell

**Current:** 14 flat emoji items; longest-prefix active matching (`Sidebar.tsx:312-341`);
collapsible to `w-16`; mobile drawer + 6-tab bottom bar.

**Direction (visual only, no route changes):**
- **Group** the flat list under quiet section labels — e.g. *Overview* (Dashboard, Calendar,
  Notifications), *Train* (Training, Goals, Activities, Lifting, Live Lift, Videos, Cycling,
  Health, Routes), *More* (Wiki, Settings) — improving scanability without adding chrome.
- Active state gets an **accent left-rail** + tinted row (today it's a full fill), so the
  current page reads instantly in a dense list.
- Icons via lucide; consistent 20px optical size; labels at one weight.
- Keep Search/command palette prominent; add a subtle divider before the account block.

### 3.10 Brand & identity

**Current:** Landing says **"Fitness Tracker"** while `metadata.title` and the manifest say
**FitTrack** (`layout.tsx:7`, `manifest.ts`). Landing buttons use `bg-white`/`bg-gray-800`.
No logo mark (💪 emoji in the sidebar). `themeColor #0f172a` is correct.

**Direction:** A minimal **mark** (monogram or abstract "FT"/bolt/bike-lift glyph) used at
32–40px in the sidebar and auth card; unify the name to **FitTrack**; style OAuth buttons as
one `secondary`/`provider` variant with brand SVGs (not raw Tailwind grays); a landing hero
with a one-line value prop and a single dominant CTA.

### 3.11 Maps

**Current:** All three map views use **light OSM raster tiles** on a dark UI
(`L.tileLayer('https://{s}.tile.openstreetmap.org/...')` ×3). The container is dark-themed but
the tiles are bright — the harshest visual mismatch in the app.

**Direction:** Switch to a **dark basemap** (CARTO `dark_all`, or a Stadia/Thunderforest dark
style — free tiers exist) with proper attribution; tune route/polyline colours and marker
badges against the dark basemap; ensure legend/heatmap contrast. This alone makes Routes,
Replay3D, and the dashboard weather/location feel like one product.

---

## 4. Proposed Design Direction (specs only)

> Specs are **direction**, not implementation. Values are starting points to be tuned against
> real screens.

### 4.1 Tokens

- **Colour:** existing six + `info`, `caution`, `success(=positive)`, `danger(=warning)`,
  `foreground` (`#e2e8f0`), `border` (`#334155`), and three surface levels
  (`surface-1 #1e293b`, `surface-2 #263449`, `surface-3 #334155`).
- **Type ramp:** `display 28/700`, `h1 24/700`, `h2 18/600`, `body 14/400`,
  `body-strong 14/600`, `meta 12/500`, `micro 11/500` (absolute floor 11px), `mono 13/500`
  for numbers. `tabular-nums` on every numeric class.
- **Spacing:** 4px base; card padding `compact 16 / comfortable 24`; section gap `24–32`;
  page gutter `16` mobile / `32` desktop.
- **Radius:** `sm 8` controls, `md 12` cards, `lg 16` sheets/modals, `full` pills/avatars.
- **Elevation:** `e0` (flat, border only), `e1` (raised: dropdown/popover/sticky),
  `e2` (overlay: modal/sheet), with a single shadow token per level.
- **Motion:** `fast 120ms`, `base 160ms`, `overlay 220ms`, standard `ease-out`; all
  non-essential motion `motion-safe`.

### 4.2 Icon system

- `lucide-react` only, named registry, `size` 16/18/20/24 by context, `strokeWidth` 1.75/2.
- Nav → filled-on-active or accent-coloured; icon-only buttons always `aria-label` + 44px.
- Emoji allowed only in user-facing content strings (weather, celebration copy).

### 4.3 Component specs

| Component | Spec (direction) |
|---|---|
| `Button` | Variants primary/secondary/tinted/ghost/danger/success; sizes sm/md/lg; all with focus-visible ring, disabled, loading spinner slot; 44px min touch. |
| `IconButton` | 44×44, icon 20, `aria-label` required, hover surface, active accent. |
| `PageHeader` | Title (h1 token) + subtitle (meta) + `actions` slot + optional status/breadcrumb; single source for all pages. |
| `SectionLabel` | `text-xs uppercase tracking-wide text-muted` + optional count/action on the right. |
| `Card` | Radius `md`, border hairline, padding by density, `Header` (title + actions) / `Body` / `Footer`; interactive variant never nests controls. |
| `Stat` | Label (meta) + value (display, `tabular-nums`) + unit + delta (info/caution/danger) + optional sparkline. Replaces the 2–3 divergent metric cards. |
| `Badge` | Tones neutral/info/success/caution/danger/provider; pill, 11–12px, consistent height. |
| `Tabs` | Real ARIA tablist, `Tabs` + `TabPanel`, roving arrow keys, 44px, underline or segmented variant. |
| `Field` | Label (`htmlFor`) + control + hint + error (`aria-describedby`/`aria-invalid`); 44px inputs; numeric inputs validated. |
| `Toast` | Single provider: success (positive, auto-dismiss ~4s), error (warning, sticky), info; `role=status`/`alert`; dismiss ≥44px. |
| `ConfirmDialog` | Accessible confirm for all destructive paths; typed-confirm option for account/data actions. |
| `Skeleton` | `SkeletonText/Metric/Row/Card/Chart/Map`; every view provides a view-matched skeleton. |
| `EmptyState` / `ErrorState` | Shared, `role=status`/`alert`, one CTA, optional illustration via lucide icon. |
| `ChartFrame` | Wraps title/actions/legend + loading/empty/error + shape-matched skeleton; every chart uses it. |
| `Sparkline` | Tiny inline `<Area>` used on activity/session/route cards for trend glanceability. |
| `Sheet` | One mobile bottom-sheet primitive (focus trap, drag-to-dismiss, safe-area) reused by routes detail, finish flow, command palette. |

### 4.4 Density modes

- `comfortable` (default) and `compact`, persisted per user, applied via a data attribute that
  drives card padding, row height, chart height, and type sizes. Helps the long-list use cases
  without a separate design.

---

## 5. Per-Surface Enhancement Concepts

### 5.1 Dashboard (Today)
- Add a **hero band**: greeting + date + readiness/form ring (uses existing
  `ReadinessIndicator`) + one-line "what to do today" from the adaptive action. Today the page
  opens on a flat list of cards (`TodayTab`).
- Make the KPI grid a fixed **4-up stat row** with `tabular-nums` and sparklines; fix the
  `lg:grid-cols-5`-with-6-cards orphan.
- Charts in a uniform 2-col grid via `ChartFrame`; consistent height; range control in the
  header slot.

### 5.2 Activities
- Richer **activity cards**: primary stat row + mini elevation/HR sparkline; provider badge via
  lucide; weather chip tokenized.
- Sticky **filter/summary bar**; filters in a slide-over on mobile; a visible "showing X of Y".
- Empty/error/skeleton per view mode (list/week/timeline/patterns), not one list skeleton.

### 5.3 Training
- Plan **week grid** with a clear "today" column, sport colour rail, and load shading; day
  cards keyboard-operable and visually consistent with WeeklyView.
- Conformity banding via info/caution/danger, with a small trend arrow and sparkline.

### 5.4 Routes
- **Dark basemap**, quality badge tiers unified with list/grid, marker clustering at low zoom.
- Detail panel as one responsive **Sheet** primitive; tab bar scrollable on mobile.
- Compare mode: clear A/B chips with add/remove, guard the one-route state.

### 5.5 Lifting / Live Lift
- Session cards with a volume mini-bar; PR shown as a distinct positive pill.
- Live workout: big numeric readouts (`tabular-nums`), an always-visible sync/offline pill,
  haptic-style press feedback (visual), and a bottom-sheet finish flow using `Sheet`.

### 5.6 Health
- Readiness/recovery **hero** + signal cards with a shared `Stat`; alert history as a timeline
  with severity rails (info/caution/danger), not four tinted buttons.

### 5.7 Settings / Notifications
- Grouped cards with `SectionLabel`; consistent toggles/pills (44px); a settings **search**
  becomes viable once sections are labelled.
- Notifications as a timeline with unread rail + type icons (lucide), replacing opacity-dimming.

---

## 6. Accessibility & Interaction Enhancements

These overlap the audit but are visual/interaction-rooted:
- Global **focus-visible ring** on every interactive element (currently absent repo-wide).
- Icon-only controls get names + ≥44px; toggles/pills reach 44px.
- Route list/grid rows become real focusable targets (`role`/`tabIndex`/Enter-Space).
- Command palette + mobile sheets use the same focus trap/inert as `Modal`.
- Decorative emoji/icons `aria-hidden`; status messages use `role=status`/`alert`.
- Charts: keyboard-reachable range (the `Brush` is already ARIA-complete; extend to chart
  legend/tooltip), and a text/table fallback for the calendar heatmap.

---

## 7. Prioritised Enhancement Roadmap (investigation only)

**Phase 0 — Foundations (no page redesigns).**
Tokens (colour semantics, type ramp, spacing, radius, elevation, motion) + `Button`,
`IconButton`, `PageHeader`, `SectionLabel`, `Card`, `Badge`, `Tabs`, `Field`, `Skeleton*`,
`EmptyState`/`ErrorState`, `Toast`, `ConfirmDialog`, `ChartFrame`. Icon registry. Replace emoji
in shell + page headers. Dark map tiles. Outcome: the app instantly reads as one product.

**Phase 1 — Shell & identity.** Sidebar grouping + active rail + lucide icons; mobile bottom
bar icons; brand mark; landing/auth restyle; density toggle.

**Phase 2 — Data surfaces.** Dashboard hero + stat row + sparklines; activities cards +
per-view skeletons; training week grid; routes dark map + compare chips; health hero/timeline.

**Phase 3 — Feedback & polish.** Toast/confirm rollout, optimistic pending states, motion
policy + reduced-motion, empty/error unification, per-surface micro-interactions (press,
expand, sheet transitions).

Each phase is independently shippable and verifiable by screenshot comparison + axe.

---

## 8. Open Questions / Decisions Needed

1. **Font choice** — Inter vs Geist vs a Strava-adjacent geometric face; and whether to add a
   mono companion for numeric readouts.
2. **Density default** — is the audience comfortable with a compact default, or comfortable
   with an opt-in compact mode?
3. **Basemap provider** — CARTO dark (simplest, free) vs Stadia/Thunderforest (more control,
   API key).
4. **Icon aesthetic** — outline-only (lucide default) vs a filled active variant for nav.
5. **Emoji policy** — fully remove from chrome, or keep a few high-recognisability ones (e.g.
   sport glyphs, weather)?
6. **Scope of "enhance"** — visual-only pass, or also the functional/a11y issues in the
   companion audit? (Recommend foundations first, then the audit tickets.)

---

## 9. Explicit Non-Goals

- No light mode; no CSS modules; no change to `basePath` or the six core tokens (only additions).
- No route/IA restructuring beyond visual grouping of the existing 14 items.
- No chart library change; `Chart.tsx` `<Brush>` stays (already ARIA-complete).
- No new state management; React Query + Zustand remain.
- No backend/API changes.
- No re-architecture of Live Lift sync or the three.js engines — surface UI only.
- No full app-wide migration in one PR; foundations land first, pages follow in phases.

---

## 10. Appendix — Representative Evidence

- Emoji nav: `frontend/src/components/Sidebar.tsx:8-23` (14 items), `:150-156` (mobile bar).
- Emoji empty state API: `frontend/src/components/ui/EmptyState.tsx:7,23`.
- Untokenized body text: `frontend/src/app/layout.tsx:35` `text-slate-200`.
- No font config: `frontend/src/app/layout.tsx` (no `next/font`), `globals.css` (no `@font-face`).
- Card chrome: `frontend/src/components/ui/Card.tsx:14` (`p-6`, `rounded-xl`, `shadow-lg`).
- Chart bypasses: `<Chart>` 120× vs `<ChartCard>` 3× (scripted count).
- Axis/grid hex: `frontend/src/components/charts/Chart.tsx:229-232, 249-254`.
- Light map tiles: `RoutesMapView.tsx`, `MergedRouteMapView.tsx`, `RouteMap.tsx`
  (`tile.openstreetmap.org`).
- Landing brand/token drift: `frontend/src/app/page.tsx:36` ("Fitness Tracker"),
  `layout.tsx:7` (`FitTrack`).
- Doc drift found: `docs/component-review-2026-09-16.md:203` claims `StatsView` was deleted, but
  `frontend/src/components/activities/StatsView.tsx` still exists (unimported).
