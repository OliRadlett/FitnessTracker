# FitTrack V2 — "Refined" Design Plan

**Status:** Phase 1 complete
**Date started:** 2026-10-12
**Inspired by:** [A1 Gallery](https://www.a1.gallery) dark-design principles
**Palette:** Warm Dark + Emerald (#090e0e bg, #10b981 accent)
**Approach:** Keep existing pages, fix data placement + UI. Activity Journal replaces Activities page. No "signature moments."

---

## Decisions

| Decision | Choice |
|----------|--------|
| Palette | Warm Dark + Emerald (#090e0e bg, #10b981 accent, one accent only) |
| Structure | Keep existing pages, fix data placement + UI |
| Metrics | Card + sparkline (add inline to MetricCard) |
| Nav | 6 primary + More drawer, ⌘K for routes only |
| Mobile/Desktop | Parallel (independently designed) |
| Existing V2 components | Discard (useAthleteState, VerdictCard, LoadStrip, ModeRail, etc.) |
| Dashboard tabs | Today / Week / Month / Year (no emoji) |
| More drawer | Routes → Segments → Videos → 3D Replay → Analytics → Notifications → Wiki → Settings |
| Year dashboard | Yes |
| Goals on Today tab | Yes, compact top-3 |
| Command palette | Routes only |
| Journal | Replaces `/activities` |

---

## 1. Design System — Warm Dark + Emerald

### Tokens (globals.css)

```
--background: 9 14 14;      /* #090e0e */
--surface: 18 24 24;        /* #121818 */
--surface-light: 30 41 41;  /* #1e2929 */
--accent: 16 185 129;       /* emerald-500 */
--accent-hover: 18 163 113; /* emerald-600 */
--foreground: 230 230 230;  /* off-white */
--muted: 148 163 184;       /* slate-400 */
--surface-border: 255 255 255 / 0.08; /* 8% */
```

### Typography
- Display metrics: Inter 700, 2rem, tabular-nums
- Card header: Inter 600, 1.125rem, -0.01em tracking
- Body: Inter 500, 0.875rem (medium weight — A1: "thin weights vibrate on dark")
- Meta: Inter 500, 0.75rem
- Caption: Inter 500, 0.7rem

### Depth System
- 3 layers max: background → surface → surface-light (card)
- Borders at 8% opacity (not 50%)
- NO `shadow-lg` — "shadows barely show on dark" (A1)

---

## 2. Dashboard Rewrite

### Problems in current DashboardPage (660 lines)
1. Duplicate fetching: `useAthleteState()` + direct `useQuery` fetch same endpoints with different keys
2. Tab-gated queries cause refetch on tab switch
3. Confusing swipe on VerdictCard
4. Emoji tab labels
5. 12+ query keys

### V2 Dashboard
- Single `useDashboardData()` hook (one verdict source)
- 5 queries max (integrated dashboard endpoint + verdict + recent + events + goals)
- Tabs: Today / Week / Month / Year (text-only, no emoji)
- WeekNav: prev/next week + year dropdown
- LoadSummary: 6-column card+sparkline grid (links to Cycling for detail)
- VerdictCard: static, no swipe
- YearDashboard: annual stats + bar chart + key moments timeline

---

## 3. Activity Journal (replaces `/activities`)

Chronological diary of all activities. Each entry is a card with inline sparkline.
- Desktop: 2-column card stream by day
- Mobile: single-column, swipe between days
- Top bar: Today/Week/Month/All + sport filter icons
- Search across titles + notes + route names
- Compare mode: select → "Compare" split-view
- Stats tab: large typographic numbers

---

## 4. Navigation — 17 → 6 + More

Desktop sidebar: 6 primary (Dashboard, Cycling, Lifting, Health, Training, Activity) + More dropdown (8 items).
Mobile: 5-tab bottom bar (Today/Review/●Train/Plan/⋯) — designed independently, not adapted from desktop.
⌘K command palette: routes only.

---

## 5. Component Inventory

### Keep (update styling)
Card, PageHeader, EmptyState, ErrorState, Skeleton, Badge, ReadinessIndicator, ErrorBoundary, CommandPalette, Chart/ChartCard, Health cards, WeatherWidget, DashboardRefresh

### Discard (V2-specific, rebuild)
useAthleteState, VerdictCard, LoadStrip, WeightCard, SyncBadge, ModeRail, MobileBottomNav, SwipeViews, TimeRangeProvider, TimeRangePicker

### Add (new)
Sparkline, MetricCard (updated with sparklineData), JournalCard, LoadSummary, VerdictCard (new), YearDashboard, WeekNav, MoreDrawer, FAB

---

## 6. Phased Roadmap

### Phase 0 — Design System Foundation (1-2 weeks)
- [x] Update globals.css tokens (warm dark + emerald, theme-aware calendar/leaflet)
- [x] Update Card component (remove shadow-lg, 8% borders)
- [x] Update EmptyState (same border fix)
- [x] Add Sparkline component (inline SVG, area fill, prefers-reduced-motion)
- [x] Update MetricCard (add sparklineData prop, remove tooltip shadow)
- [x] Sparkline test (14 tests, 639 total pass)
- [x] tsc + vitest pass
- [x] Sidebar rewrite (6 items + MoreDrawer, simplified MobileBottomNav)
- [x] useTodayPlanTarget hook (replaces resolveTrainTarget)

### Phase 1 — Dashboard Rewrite (2-3 weeks) — COMPLETE
- [x] useDashboardData() hook — single consolidated data source
- [x] WeekNav component — prev/next week + year dropdown
- [x] Rewrite DashboardPage — killed useAthleteState + 12 individual queries
- [x] LoadSummary — card+sparkline grid (replaces LoadStrip)
- [x] Static VerdictCard — removed SwipeViews wrapper
- [ ] YearDashboard tab (Phase 2)

### Phase 2 — Navigation + Journal (2 weeks)
- [ ] Rewrite Sidebar (6 items + More)
- [ ] Rewrite MobileBottomNav (independent mobile)
- [ ] Command palette (routes)
- [ ] Activity Journal page
- [ ] Redirect /activities → /journal
- [ ] Fix cross-page links

### Phase 3 — Per-Page Polish (1-2 weeks)
- [ ] Cycling (single load source)
- [ ] Lifting (card+sparkline)
- [ ] Health (single weight source)
- [ ] Training (plan cards)
- [ ] 3D Replay surfacing
- [ ] States matrix audit

### Verification Gate
- tsc clean
- vitest 176+ pass
- A1 dark checklist: ✅ bg not pure black, ✅ one accent, ✅ body 500 weight, ✅ 3-layer depth, ✅ 8% borders, ✅ no shadow, ✅ tabular nums, ✅ 44px targets, ✅ no emoji nav, ✅ 6 nav items
