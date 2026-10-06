# Lifting Page Redesign Plan

> **Status**: Draft for review. Collaboratively evolving with the user.
> **Goal**: Transform `/lifting` from a dense data scroll into a useful, beautiful, coach-grade strength training hub.
> **Scope**: Frontend redesign + UX rearchitecture. Backend reuse wherever possible; minimal new endpoints only where a gap genuinely exists.

---

## 1. Vision

The lifting page should feel like the control center for an athlete's strength journey: a place you *start* a session, *execute* it with confidence, and *review* how you're progressing — all in one glance. It should close the loop between plan and execution, surface actionable insights (not just data), and integrate seamlessly with the cycling/recovery story the rest of FitTrack tells.

### Core principles

| Principle | What it means for lifting |
|---|---|
| **Action → Data → Insight → Action** | The page should drive you to train, show you training, teach from it, and prescribe the next move — all without navigating away. |
| **One primary task per view** | No 1,178-line page with everything. Split into focused tabs. |
| **Reuse, don't rebuild** | Use the same `Card`, `Chart`, `Modal`, `ErrorBoundary`, Tailwind tokens, and React Query patterns as cycling/dashboard. |
| **Mobile-first** | Strength work is often logged on a phone mid-rack. Every interactive surface must be 44px touch-safe. |
| **Coach-grade, not data-porn** | Every metric must have a clear "what do I do about it?" answer. If it doesn't earn its keep, remove it. |

---

## 2. Current State Assessment

### What works well today

- **Rich backend**: `session_analysis.py` already computes volume breakdown, set progression, rep dropoff, PR proximity, RPE analysis, fatigue index, and session density. These are *displayed* on the `LiftingAnalysisCard` but only for the currently-selected session.
- **Live Lift**: Solid local-first session with offline support, PR detection, and background sync.
- **Chart infrastructure**: The `ChartService` + `charts.py` API already provides `weekly_volume`, `estimated_1rm_history`, `strength_balance`, `exercise_progress`, and `combined_training_load`.
- **Plan integration exists**: `strength-suggestions`, `refresh-targets`, and `suggest-load` backends are built and unused on the lifting page.
- **PR detection**: Automatic Brzycki 1RM PRs with video chips.

### Problems

| # | Problem | Impact |
|---|---------|--------|
| P1 | **One 1,178-line page** — every section bolted vertically with no visual hierarchy | Overwhelming; key actions (start session, log sets) get lost in scroll |
| P2 | **Session list + detail fight for space** — 3-column grid splits attention; selecting a session rearranges the layout | Confusing flow; detail panel dwarfs the list |
| P3 | **No tabbed navigation** — PRs, charts, templates, and sessions are all on one scroll | Cognitive overload; hard to find anything after the fold |
| P4 | **New Session form is orphaned** — separate from Live Lift; unclear which entry point to use | User confusion at the primary action |
| P5 | **PRs are static cards** — no per-exercise trend chart, no bodyweight-relative strength (Wilks/ICS), no attempt history | Misses the "progression story" that a powerlifter cares about most |
| P6 | **No plan integration** — planned strength days, upcoming targets, and `%e1RM` prescriptions live on `/training` only | The lifting page can't answer "what should I do today?" |
| P7 | **Session detail is a flat table** — ExerciseGroup shows sets in rows with no visual progression, RPE trend, or set-to-PR distance | Misses coaching insights that `session_analysis` already computes |
| P8 | **Charts are shallow** — volume trend and 1RM history are single-series; no Big-3 total, no bodyweight-relative charts, no combined load on the page | Underutilizes backend chart service and the B-31 lifting TSS |
| P9 | **DeficiencyCard uses emoji icons** (`🏋️`, `🚴`) while the rest of the app uses lucide-react | Inconsistent UI language |
| P10 | **`order_index` missing from frontend `LiftingSet` type** — Backend (migration 093) tracks explicit set ordering; frontend type doesn't expose it | Can't reliably render drag-drop reordering or ordered sets |
| P11 | **No quick-add to recent sessions** — To add a set you must select a session, expand detail, then find the Add Exercise form | Friction for corrections/adjustments |
| P12 | **Mobile layout breaks** — 3-column grid collapses to cramped single column; form controls are small | Poor mobile experience |

### Data already available (no new backend needed)

| Backend capability | Currently surfaced? | Could move to lifting page |
|---|---|---|
| `analyze_lifting_session` — full session analysis | ✅ Only for selected session | ✅ Lift to session list cards |
| `weekly_volume` chart + injury-risk insight | ✅ Partial (two duplicate charts P22) | ✅ Consolidate into one |
| `strength_balance` chart | ✅ | ✅ Enhance with bodyweight-relative |
| `estimated_1rm_history` chart | ✅ | ✅ Better exercise selector |
| `exercise_progress` chart | ✅ | ✅ Already integrated |
| `combined_training_load` chart | ❌ On `/analytics` only | ✅ Bring to lifting page |
| `suggest_load` (%e1RM) API | ❌ | ✅ Wire into autoregulation + planned sessions |
| `strength-suggestions` API | ❌ On `/training` only | ✅ Quick-preview on lifting page |
| `refresh_strength_targets` | ❌ | ✅ Refresh button on planned sessions |
| `personal_records` (Brzycki PRs + manual) | ✅ | ✅ Per-exercise trends |
| `LiftingSet.order_index` | ✅ Backend (migration 093) | ✅ Add to frontend type |
| `ai_tags` (Jev) | ✅ On session read | ✅ Surface as insight chips |
| `estimated_tss` (B-31) | ✅ On session read | ✅ Chart with cycling |
| `whoop_strain` on sessions | ✅ | ✅ Show in session cards when present |

### Duplicate / redundant elements to remove

| # | Issue | Fix |
|---|-------|-----|
| D1 | **Two volume charts**: `buildVolumeChart(volumeData)` (12 weeks, from `getLiftingSessions`) + `weekly_volume` chart fetch (16 weeks, from `/charts/weekly_volume`) show the same data | Consolidate to one: use the backend `weekly_volume` chart (has injury-risk insight), remove the client-side one |
| D2 | **Two 1RM sources**: PR history chart + exercise progress chart both show 1RM | Unify: exercise_progress shows weight + 1RM + volume per session; estimated_1rm_history shows PR milestones |
| D3 | **ManualPRForm + AddExerciseForm** both create session data with different flows | Keep one consistent path: session detail → add exercise → auto-detect PRs |

---

## 3. Redesign Proposal

### 3.1 Information Architecture: Tabbed Layout

Replace the vertical scroll with a **tabbed interface** (responsive to sidebar width):

```
/lifting
├── Sessions tab (default)     → List + detail, session-focused
├── Analytics tab              → Charts, trends, combined load, VBT
├── PRs tab                    → Big-3 timeline, strength standards, Wilks/ICS
├── Templates tab              → Warmup templates CRUD
```

**URL state**: `?tab=sessions&session=<id>` drives the active tab and selected session, preserving deep-link compatibility (`/lifting?session=<id>` → sessions tab, session selected).

### 3.2 Sessions Tab (the new primary view)

**Layout (desktop ≥ 2-col grid, mobile single column):**

```
┌─────────────────────────────────────────────────────────────┐
│  [Today's Strength Day]  [Autoregulation Strip]             │
├─────────────────────────────────────────────────────────────┤
│  Session List (left, scrollable)  │  Session Detail (right) │
│  ┌─────────────────────────────┐  │  ┌────────────────────┐ │
│  │  Session Card 1  (selected) │  │  │  Edit Form         │ │
│  │  Session Card 2             │  │  │  Sets Table        │ │
│  │  ...                        │  │  │  Analysis Charts   │ │
│  │  [+ New Session]            │  │  │                    │ │
│  └─────────────────────────────┘  │  └────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

On mobile: **session list → select → detail replaces list** (drill-down pattern).

**Session Card enhancements** (each card becomes a mini-dashboard):
- Focus badge + date + volume + working-set count
- **Session quality score** (C-20) — color-coded badge (green/orange/red) combining fatigue index, RPE escalation, set completion, PR proximity
- **Fatigue index** (small colored bar/numeric from `session_analysis`)
- **Recovery-adjusted hint** (C-13) — "deload 2.5kg" or "ready to load" based on Whoop recovery + ai_tags when available
- **Live-session timing** (`started_at`–`ended_at` + duration) when applicable
- **Whoop strain badge** when linked
- **Video chip badge** ("📹 N") when videos are linked
- **PR chip** ("new PR!" or proximity %) when a set hit a PR
- **Linked Strava badge** with one-tap unlink
- Quick-action ⋮ menu: Edit, Delete, Duplicate, "Add Set" (quick-add)
- Recovery-adjusted load suggestion when Whoop recovery is available

**Session Detail** (right panel / drill-down screen):
- Edit form (date, program, focus, notes, duration)
- **Sets visualizer**: Instead of a flat table, group by exercise with:
  - Working sets shown as a small bar chart (weight × reps)
  - RPE markers per set (colored dots)
  - Warm-up sets visually de-emphasized but present
  - PR-distance indicator ("0.5kg from your 1RM")
  - AMRAP sets flagged
- `ExerciseGroup` (existing table) below the visualizer for raw editing
- `LiftingAnalysisCard` (existing — volume breakdown, progression, rep dropoff, PR proximity, RPE, fatigue index, density)
- `SessionAiAnalysisCard` (existing — AI insights button)
- **Quick-add bar** sticky at the bottom: one-line form to add a set to the current exercise

### 3.3 Analytics Tab

**Layout**: A responsive grid of chart cards, with a "Combined Load" prominence:

```
┌─────────────────────────────────────────────────────────┐
│  COMBINED TRAINING LOAD (TSS)  ← featured card           │
│  [daily cycling TSS + lifting TSS + combined]            │
├───────────────┬─────────────────┬───────────────────────┤
│  Vol × Intensity │ Strength       │ Exercise Progress    │
│  Periodization   │ Balance + Wilks│ (selector + series)  │
│  (C-15)           │ (A5 + C-17)    │                      │
├───────────────┴─────────────────┴───────────────────────┤
│  1RM History (selector + forecast)  │  Velocity Trend   │
│  (A5)                              │  (C-17)           │
├───────────────────────────────────────────────────────┤
│  [VBT Profile]  [Rest Timing]  [RPE Drift (C-16)]     │
└─────────────────────────────────────────────────────────┘
```

**Charts**:
1. **Combined Training Load** — `combined_training_load` from backend (cycling TSS + lifting TSS + combined). Prominently featured. Explains lifting vs cycling contribution.
2. **Weekly Volume Trend** — single `weekly_volume` chart (consolidate D1), with the injury-risk insight.
3. **Strength Balance** — `strength_balance` chart, enhanced with bodyweight-relative ratios (when bodyweight is known).
4. **Exercise Progress** — existing, but with a better exercise selector (autocomplete, not bare `<select>`).
5. **Estimated 1RM History** — existing, with forecast, exercise selector.
6. **New: Big-3 Total Progression** — sum of current squat/bench/deadlift PRs over time. *(Needs a small new chart method or client-side aggregation of PR history.)*
7. **New: Volume×Intensity periodization** (C-15) — weekly volume (kg) × average %1RM, color-coded by phase (accumulation / intensification / realization / recovery)
8. **New: RPE drift** (C-16) — actual RPE vs expected RPE per exercise over time
9. **New: Velocity trend** (C-17) — mean concentric velocity per exercise, only for sets with VBT-linked videos

### 3.4 PRs Tab (the powerlifter's story)

**Layout**:
```
┌─────────────────────────────────────────────────────┐
│  BODYWEIGHT                                         │
│  [Wilks/ICS coefficient: 42.5]                     │
├─────────────────────────────────────────────────────┤
│  BIG 3 TOTAL                                         │
│  [Timeline chart: squat + bench + deadlift + total] │
├─────────────────────────────────────────────────────┤
│  CURRENT PRs                                        │
│  [Squat] [$1rm]  [Bench] [$1rm]  [Deadlift] [$1rm]  │
│  [Standards badges: intermediate+]                  │
├─────────────────────────────────────────────────────┤
│  ALL PR HISTORY                                     │
│  [Table: date | exercise | weight | reps | e1RM]     │
│  sortable, with video chips                        │
└─────────────────────────────────────────────────────┘
```

**Features**:
- **Bodyweight input/display**: Show bodyweight (from `WeightLog` or `CyclingProfile`), compute Wilks/ICS coefficient, show bodyweight-relative total.
- **Big-3 Total timeline**: Stacked area or multi-line showing squat/bench/deadlift PRs + total over time.
- **Strength standards badges** (C-5): Map PRs to standards (Novice / Intermediate / Advanced / Elite) based on bodyweight ratios (Epley or ISC).
- **Wilks/ICS progression** (C-5): Bodyweight-normalized score over time — the fairest comparison across time and bodyweight.
- **Attempt history** (C-12): For each PR, show the session it came from, the sets leading up to it, and any video. "Competition mode" view: all sets for an exercise on a given day, sorted by time/weight.
- **Training max tracking** (C-4): Separate "training max" (e.g. 90% of meet max) used for programming.
- **Meet prep timeline** (C-6): If a `lift` event exists in the future (from Events), show a countdown with a standard 3-week peak/taper schedule.
- **Competition attempt simulator** (C-18): Given a current e1RM, simulate 3 attempts with total projection.
- **Manual PR entry**: `ManualPRForm` promoted to a first-class button, not buried.
- **Exercise substitution engine** (C-14): If notes or Jev tags flag an exercise as painful, suggest biomechanically similar alternatives.
- **DeficiencyCard** (moved here): Filter to `category: 'lifting'` — shows strength standards, Big-3 ratios, push/pull balance.

### 3.5 Templates Tab

Move `WarmupTemplateManager` to its own tab. Minor visual cleanup (replace emoji ✏️/🗑️ with lucide icons). No structural change needed.

### 3.6 Plan Integration (cross-cutting)

**"Today's Strength Day" card** at the top of the Sessions tab:
- Fetch active training plan's current week (reuse `useTodaysStrengthDay()` hook)
- Show today's (or next upcoming) strength day with planned exercises
- Display weight suggestions using `%e1RM` (from `suggest_load` API)
- **Recovery-adjusted loading** (C-13): If Whoop recovery < 60% or Jev tags indicate `high_fatigue`/`pain_injury`, suggest RPE reduction or load deload
- **"Start Workout"** button → pre-fills a new session or Live Lift with the plan's exercises and weights
- **"Warm-up Set Calculator"** (C-1): Given the top working weight, auto-generate warm-up sets using Rippetoe 5×5 progression — "Copy to Live Lift" button
- **"Refresh Targets"** button → calls `refresh_targets` to update `%e1RM` weights from current PRs
- **"Simulate Attempts"** (C-18): Quick-access to the competition attempt simulator

---

## 4. Feature Areas & Enhancements

### Tier A: High-impact, mostly frontend (no new backend)

| # | Feature | Effort | Backend? | Description |
|---|---------|--------|----------|-------------|
| A1 | **Tabbed IA** | M | ⚠️ `LiftingSet.order_index` to frontend type | Split the 1,178-line page into 4 tabs; preserve deep-link URLs |
| A13 | **Shared `CombinedLoadChart` component** | S | Extract from `/analytics` into `components/charts/CombinedLoadChart.tsx`; reused by Analytics tab |
| A2 | **Session Card mini-dashboard** | M | No | Add fatigue index, PR proximity, live timing, whoop badge to session cards |
| A3 | **Sets visualizer** | M | No | ✅ SHIPPED 2026-10-06 (user: data porn is fine — it must be *differentiated* from training aids, not cut). Per-exercise set bars with RPE markers + PR-distance, placed in a labeled "Review" zone; action surfaces (quick-add, edit) stay in a separate floating/action zone. No page redesign needed: tabs + section labels already separate the modes. Generalized as [`docs/review-vs-act.md`](../docs/review-vs-act.md) for reuse across pages |
| A4 | **Consolidate volume charts** | S | No | Remove client-side `buildVolumeChart`; use backend `weekly_volume` only |
| A5 | **PR timeline + strength standards** | M | No | Big-3 total chart, Wilks/ICS bodyweight-relative, standards badges |
| A6 | **Today's Strength Day card** | M | No | Show active plan's strength day with weight suggestions; reuse `live-plan-today` logic from `/lifting/live` |
| A14 | **Shared `useTodaysStrengthDay()` hook** | S | Extract plan-day resolution from `/lifting/live/page.tsx` into `lib/training/useTodaysStrengthDay.ts`; reused by card + Live Lift |
| A7 | **Combined Training Load on lifting** | S | No | Bring `combined_training_load` chart to Analytics tab |
| A8 | **Exercise selector autocomplete** | S | No | Replace bare `<select>` in ExerciseProgressSection with `ExerciseAutocomplete` |
| A9 | **Lucide icon consistency** | S | No | Replace emoji in DeficiencyCard, ExerciseGroup, WarmupTemplateManager |
| A10 | **Quick-add to recent session** | S | No | Sticky "add set" bar in session detail |

### Tier B: Medium effort, needs small backend additions

> **Plan integration detail (resolved)**: Active plan resolution = `getTrainingPlans(authFetch, 'active')` → filter by `start_date <= today <= end_date` → `getPlanWeek(authFetch, planId, weekNumber)` → find strength day. This is identical to `/lifting/live/page.tsx:97-116`. Extract into a shared hook. DeficiencyCard → PRs tab, filtered to `category: 'lifting'`.

| # | Feature | Effort | Backend? | Description |
|---|---------|--------|----------|-------------|
| B1 | **Drag-drop set reordering in detail** | S | Expose `order_index` on `LiftingSetRead` (already on model) | ❌ CUT 2026-10-06: no dnd primitive in the codebase, HTML5 DnD is dead on touch (this page is mobile-first), and reorder is an edge-case op — creation order + edit/delete cover real flows. Endpoint + `order_index` type stay available |
| B2 | **Big-3 Total Progression chart** | S | Small chart method in `ChartService` | Aggregate PR history into squat+bench+deadlift+total timeline |
| B3 | **`order_index` in frontend `LiftingSet` type** | XS | No | Already on backend schema; add to `types/lifting.ts` |
| B4 | **DeficiencyCard move to PRs tab** | S | No | Filter to `category: 'lifting'` only; dashboard keeps full view |

### Tier C: Larger features (future phases, P2+)

| # | Feature | Effort | Backend? | Description |
|---|---------|--------|----------|-------------|
| C1 | **Warm-up set calculator** | S | Pure frontend | Given a top working weight, auto-generate warm-up sets using Rippetoe 5×5 progression (45%, 55%, 65%, 75%, 85% of top set) with a "Copy to Live Lift" button |
| C2 | **Rep range distribution chart** | M | Small chart method | Pie/bar showing sets in strength (1-3 reps), hypertrophy (4-6), endurance (7+) per exercise over a time window → Phase 6 |
| C3 | **Load balance chart** | M | Small chart method | Volume distribution across push/pull/legs or squat/bench/deadlift/accessory ratio over time |
| C4 | **Training max tracking** | S | No | Track a separate "training max" (e.g. 90% of meet max) used for programming — visible in PRs tab alongside absolute PRs |
| C5 | **Dots score progression** | M | Client-side join (Big-3 total + bodyweight history) | Bodyweight-normalized score timeline on PRs tab. Score card shipped (Dots, male formula); progression → Phase 6 |
| C6 | **Meet prep timeline** | M | Read-only from Events table | ❌ CUT 2026-10-06: no meets → dead UI (compete bundle) |
| C7 | **Exercise notes history** | S | No | Per-exercise note timeline in session detail — shows past notes for that exercise across all sessions |
| C8 | **Injury risk composite score** | M | Aggregate existing data | Combine volume spikes (from `weekly_volume` insight), RPE escalation (from `session_analysis`), form deviations (from video analysis), and asymmetry metrics (bar path) into a single per-session score + tooltip breakdown |
| C9 | **1RM / 5/3/1 program selector** | M | Pure frontend | Generate warm-up + working sets for standard programs (5×5, 5/3/1, Hepburn, Simple Jack'd) given a target e1RM and bodyweight |
| C10 | **Video analysis on set rows** | M | Already has data | In session detail, show form score / velocity as inline badges on sets that have linked videos — click to open `Pose3D`/`VbtPanel` |
| C11 | **Session PDF export** | M | Pattern exists (`export/event-report`) | ❌ CUT 2026-10-06: user wants neither PDF nor clipboard sharing |
| C12 | **Attempt history / single-ply mode** | M | New endpoint or client-side filter | ❌ CUT 2026-10-06: no meets → dead UI (compete bundle). Shipped "View session →" links cover the casual case |
| C13 | **Recovery-adjusted loading** | M | No (uses existing whoop_strain + ai_tags + health data) | If Whoop recovery < 60% or Jev tags indicate `high_fatigue`/`pain_injury`, suggest RPE reduction or load deload — shown on Today's Strength Day card + session cards |
| C14 | **Exercise substitution engine** | M | Read ai_tags + exercise_db | If `ai_tags.pain_injury` or user notes flag an exercise, suggest biomechanically similar alternatives (e.g., low-bar → high-bar squat, barbell → dumbbell press) |
| C15 | **Volume×Intensity periodization chart** | S | New chart method | Lifting equivalent of cycling CTL/ATL: volume (kg) × average %1RM over time, color-coded by phase (accumulation / intensification / realization / recovery) → Phase 6 |
| C16 | **RPE drift chart** | M | Small chart method | Track actual RPE vs expected RPE (from plan `target_rpe`) per exercise over time — early indicator of overreaching or under-recovery → Phase 6 |
| C17 | **Velocity trend chart** | M | Uses existing video analysis data | Mean concentric velocity per exercise over time, with velocity-zone indicators (e.g., "speed strength" zone) — only shows for exercises with VBT-linked videos |
| C18 | **Competition attempt simulator** | M | Pure frontend | ❌ CUT 2026-10-06: no meets → dead UI (compete bundle) |
| C19 | **Exercise rotation tracker** | S | No | Track how often specific exercise variations (e.g., high-bar vs low-bar squat) are trained, to spot imbalances or overuse |
| C20 | **Session quality score** | S | No | Composite badge on session cards combining fatigue index, RPE escalation, set completion, PR proximity — color-coded (green/orange/red) |

### Tier D: Polish & power-user features (quick wins, P2)

| # | Feature | Effort | Backend? | Description |
|---|---------|--------|----------|-------------|
| D1 | **Keyboard shortcuts** | S | No | `N` → new session, `←`/`→` → navigate sessions, `Ctrl+K` → command palette, `?` → shortcuts modal |
| D2 | **Session comparison** | M | No | Select 2 sessions → side-by-side comparison of volume, intensity, exercises, fatigue index |
| D3 | **Clipboard export** | XS | No | ❌ CUT 2026-10-06: user wants neither PDF nor clipboard sharing |
| D4 | **Animated transitions** | S | No | Smooth fade/slide when selecting sessions, entering detail view — uses `framer-motion` or CSS transitions |
| D5 | **Session notes timeline** | S | No | In session detail, show a collapsible timeline of all notes across sets + session-level note history |
| D6 | **Focus filter** | XS | No | Filter session list by focus (squat day / bench day / deadlift day / accessories) — simple tag filter |

---

## 5. Technical Changes Summary

### Backend (existing APIs to wire up, no new ones needed for Tier A)

| Existing endpoint | Current use | New use on lifting page |
|---|---|---|
| `GET /charts/combined_training_load?days=N` | `/analytics` only | Analytics tab → featured card |
| `POST /lifting/suggest-load` | Unused | Today's Strength Day card → weight suggestions |
| `GET /training-plans` | `/training` | Lifting page → find active plan |
| `GET /training-plans/{id}/week/{n}` | `/training` | Lifting page → show today's strength day |
| `POST /training-plans/{id}/refresh-targets` | `/training` | Lifting page → "Refresh Targets" button |
| `GET /training-plans/{id}/strength-suggestions` | `/training` | Lifting page → quick preview |

### Frontend changes

| File | Change |
|---|---|
| `app/(app)/lifting/page.tsx` | **Major rewrite**: tab shell (Sessions/Analytics/PRs/Templates), URL state, sub-component split |
| `components/lifting/` | New: `SessionCardMini.tsx`, `SetsVisualizer.tsx`, `TodayStrengthDayCard.tsx`, `TabsBar.tsx`, `PrTimelineChart.tsx`, `StrengthStandardsBadges.tsx`, `WarmupSetCalculator.tsx`, `AttemptSimulator.tsx`, `PrHistoryTable.tsx`; modify: `ExerciseGroup.tsx` (lucide + drag-drop), `ManualPRForm.tsx` (promote) |
| `components/charts/` | New: `CombinedLoadChart.tsx` (extracted from analytics/shared) |
| `lib/api/types/lifting.ts` | Add `order_index` to `LiftingSet` type |
| `lib/api/lifting.ts` | Add `getCombinedLoadChart` (shared client fn) |
| `lib/lifting/useTodaysStrengthDay.ts` | **New hook**: active-plan resolution + today's strength day (extracted from `/lifting/live/page.tsx`) |
| `plans/` | This document + CODEMAP updates |

### Migration note

No database migrations needed for Tier A. The `order_index` column (migration 093) is already in the model and schema; only the frontend type needs updating.

---

## 6. Implementation Roadmap

### Phase 1 — IA foundation (1–2 weeks)
- ✅ Add `order_index` to frontend `LiftingSet` type
- ✅ Create tabbed layout shell in `lifting/page.tsx`
- ✅ Preserve existing deep-link URLs (`?session=`, `?pr=`)
- ✅ Move `WarmupTemplateManager` to Templates tab (visual cleanup only)
- ✅ Consolidate the two volume charts into one backend `weekly_volume` chart

### Phase 2 — Session list overhaul (1 week)
- ✅ Redesign `SessionCard` as a mini-dashboard (fatigue, PR proximity, live timing, whoop badge)
- ✅ Drill-down detail on mobile; side-by-side on desktop
- ✅ Quick-add "Add Set" sticky bar in session detail
- ✅ Lucide icon consistency pass

### Phase 3 — Analytics tab + plan integration (1.5 weeks)
- ✅ Build Analytics tab layout with combined training load as featured card
- ✅ Add Big-3 Total Progression chart (small backend method)
- ✅ "Today's Strength Day" card with `%e1RM` weight suggestions
- ✅ Exercise selector autocomplete in ExerciseProgressSection

### Phase 4 — PRs tab (1 week)
- ✅ Big-3 Total timeline chart
- ✅ Wilks/ICS coefficient + strength standards badges
- ✅ Attempt history / session source links
- ✅ Promote ManualPRForm to first-class
- ✅ DeficiencyCard moved to PRs tab (filtered to `category: 'lifting'`)

### Phase 5 — Polish & test (0.5 week)
- ✅ Mobile layout verification (touch targets, breakpoints)
- ✅ Dark mode consistency
- ✅ Component tests for new sub-components

### Phase 6 — Review-side analytics batch (decided 2026-10-06, build next)
- Dots progression over time (C-5 remainder: join Big-3 total + bodyweight history, client-side)
- Rep range distribution chart (C-2: strength/hypertrophy/endurance split per exercise)
- Volume×Intensity periodization chart (C-15)
- RPE drift chart (C-16: actual vs planned RPE per exercise)

### Phase 7 — Act-side batch (on the table, unstarted)
- Warm-up set calculator (C-1)
- Recovery-adjusted loading (C-13)
- Keyboard shortcuts (D-1)
- Focus filter (D-6)

### Cut with rationale (2026-10-06 user decisions)
- Compete bundle C-6/C-12/C-18 (meet prep timeline, attempt simulator, competition mode): no meets → dead UI. Attempt links already cover casual curiosity.
- Sharing C-11/D-3 (PDF export, clipboard export): neither wanted.
- B-1 drag-drop reorder: no dnd primitive, dead on touch, edge-case op.
- A-3 cut reversed same day: user ruled data porn stays if gated (see `docs/review-vs-act.md`).

### Still deferred (no decision)
C-3 load balance, C-4 training max, C-7 exercise notes, C-8 injury-risk composite
(open Q7 placement moot until built), C-9 1RM/5-3-1 programs, C-10 video on set
rows (open Q9 data question moot until built), C-14 substitution engine, C-17
velocity trend (needs VBT video data), C-19 rotation tracker, D-2 session
comparison, D-4 animated transitions, D-5 notes timeline.

---

## 7. Open Questions for the User

1. **Tabs vs. sections?** Are 4 tabs (Sessions/Analytics/PRs/Templates) the right granularity, or would you prefer 3 (e.g. merge Templates into Sessions)? I lean toward 4 since templates are a separate workflow.

2. **Big-3 Total chart** — should we add a small backend chart method, or compute it client-side from PR history (simpler, less backend risk)?

3. **Strength standards** — which system? Epley (simple, widely known) or ISC (bodyweight-based, more accurate)? Epley for MVP.

4. **Plan integration depth** — how far should the "Today's Strength Day" card go? Minimal (show day + exercises) vs. full (weights, warm-up sets, "Start Workout" pre-fill)?

5. **Session detail on desktop** — keep the 2-panel (list | detail) layout, or go full-width detail with a "back to list" breadcrumb?

6. **Feature priority** — which Tier C features matter most? Warm-up calculator (C1) and rep range distribution (C2) are quick wins; Wilks/ICS (C5) and meet prep timeline (C6) are deeper but high-value for competitors.

7. **Injury risk composite (C8)** — should this be a per-session badge on session cards, or a standalone chart on the Analytics tab? I lean toward a badge on cards + detail breakdown in session view.

8. **Session PDF export (C11)** — is PDF export in scope, or prefer a share-as-link feature? PDF follows the existing `export/event-report` pattern.

9. **Video analysis on set rows (C10)** — the `LiftVideo` type has `lifting_set_id`. Is there existing data linking videos to specific sets, or is this greenfield?

10. **Dots coefficients** — ✅ Resolved 2026-10-06: user supplied the official polynomial (Dots = Total × 500 / (a·BW⁴ + b·BW³ + c·BW² + d·BW + e); men a=-0.0000010930, b=0.0007391293, c=-0.1918759221, d=24.0900756, e=-307.75076; women stored alongside). Hand-verified reference (500kg @ 100kg male ≈ 307.76) pinned in `strength-standards.test.ts`. Male formula only (no sex field in schema — stated on the card). Dots *progression* over time stays Tier C.



---

## 8. Resolved Decisions

| Question | Decision | Rationale |
|---|---|---|
| Shared CombinedLoadChart? | ✅ Extract to `components/charts/` | Analytics page fetches inline; lifting needs it too. DRY + no behavior change to analytics. |
| DeficiencyCard placement? | ✅ PRs tab, `category: 'lifting'` filter | PRs tab = strength imbalance detection; dashboard keeps full cross-domain view. |
| Active plan resolution? | ✅ Reuse `/lifting/live/page.tsx:97-116` logic | Extract into shared `useTodaysStrengthDay()` hook; both Live Lift and lifting page use it. Backend uses `TrainingPlan.status == "active"` — confirmed across adaptive, conformity, dashboard, today services. |
| `order_index` exposure? | ✅ Add to frontend `LiftingSet` type | Already on `LiftingSetRead` schema (migration 093); frontend type simply omits it. |


