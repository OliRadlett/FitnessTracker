# UI Overhaul Plan — September 2026

> **Scope**: Frontend visual + data-fetching consistency across `frontend/src`
> **Status**: **COMPLETE** (2026-09-17)

## Context

Previous work addressed surface-level inconsistency:
- Mobile UX audit (Phases 0-5) — 2026-09
- Frontend cohesiveness Phase 1-3 (links, deep-links, tokens, query keys) — 2026-08
- Dead client module deletion + helpers slim-down — 2026-09

## 1. Color Token Consistency — COMPLETE

### Completed conversions (semantic colors only)
- **`bg-slate-800`** → `bg-surface` in `MetricCard.tsx` tooltip (bug fix)
- **`text-red-400`** → `text-warning` across 20+ sites (error banners, dismiss buttons, badges, quality poor tier, recovery color, heart rate)
- **`text-green-400`** → `text-positive` (FTP improvement, form score rings)
- **`text-red-300`** → `text-warning` (error text)
- **`hover:text-red-300`** → `hover:text-warning/80` (discard/delete buttons)
- **`bg-gray-500`** → `bg-muted` (zone fallbacks, provider fallbacks, default sport)
- **`text-gray-300/400`** → `text-muted` (DayDetailPanel, plan status badges, MetricCard benchmark)
- **`border-gray-500/30`** → `border-muted/30` (sportUtils default)
- **Error banner patterns** (`bg-red-500/10 border-red-500/30`) → `bg-warning/10 border-warning/30` in: dashboard, lifting, training, routes, goals, WorkoutPlanner, WeeklyView, SyncHealthBanner, LinkActivityModal, all 4 AI analysis cards

### Left as-is (intentional)
- Sport-specific colors (blue=cycling, purple=lifting, orange=running, cyan=swimming) — no sport tokens exist
- Exercise category colors in ExerciseManager (big3=orange-red, compound=blue) — categorical, not semantic
- Gradient/zone bar colors (power zones, HR zones, quality tiers, severity badges) — no matching tokens
- `text-slate-200` body text in `layout.tsx` — lighter than `text-muted`, no dedicated body token

### 4 AI analysis cards refactored to shared patterns
- `ActivityAiAnalysisCard`, `SessionAiAnalysisCard`, `HealthAiAnalysisCard`, `EventAiAnalysisCard` — error banners + loading skeletons now use `text-warning` tokens and `SkeletonLine` primitives

## 2. Skeleton Migration — COMPLETE

- **`loading.tsx`** — replaced `animate-pulse` divs with `SkeletonLine`/`SkeletonMetric`/`SkeletonRow`
- **`TodayTab.tsx`** — replaced inline pulse with `SkeletonLine`
- **`ActivityAiAnalysisCard`, `SessionAiAnalysisCard`, `HealthAiAnalysisCard`, `EventAiAnalysisCard`** — replaced `animate-pulse` with `SkeletonLine`
- **`RouteWeatherCard.tsx`** — replaced inline pulse with `SkeletonLine`
- **`DashboardRefresh.tsx`** (via loading.tsx) — fixed
- `ExerciseManager.tsx` — replaced `Loading...` with `SkeletonRow`
- `Training page` — replaced `Loading...` with `SkeletonRow`
- `WorkoutPlanner.tsx` — replaced `animate-pulse` with `SkeletonLine`
- `CalendarAgendaView.tsx` — replaced `animate-pulse` with `SkeletonRow`
- `DayDetailPanel.tsx` — replaced `animate-pulse` with `SkeletonRow`

## 3. Query Key Alignment — COMPLETE

- `['goal-projections', ...]` → `['goal-projection', ...]` in `ProjectionCard` (aligns with `GoalDetailModal`)
- `['chart-strength-balance']` → `['chart-strength-balance', 30]` in `lifting/page.tsx`
- `['chart-periodization']` → `['chart-periodization', 16]` in `training/page.tsx`

## Verification

- `npx tsc --noEmit` — **clean**
- `npx vitest run` — **125/125 passed**
- ESLint: not configured in repo (documented)
