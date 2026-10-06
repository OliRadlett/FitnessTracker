# Review vs Act — gating data porn away from training aids

> **Status**: Adopted principle (proven on the `/lifting` redesign, 2026-10-06).
> Apply it to every page that mixes charts with actions.

## The principle

Data-rich visualization ("data porn") is welcome — it is never cut for being
too much. What is *gated* is its placement: **review content** (explore and
understand: charts, breakdowns, timelines, scores) must be structurally
separated from **action content** (decide and do: prescriptions, quick-add,
start buttons, refresh actions, edit forms).

Why: when a chart sits between two buttons, the athlete reads the chart as an
instruction and the buttons as decoration. Separation makes each mode legible —
*this area tells me what happened, that area tells me what to do next* — and it
keeps new visualizations from silently becoming new obligations.

## The gates, strongest first

1. **Route/tab separation.** The strongest gate: review and act live on
   different tabs (or pages) with URL state, so each has a linkable,
   distraction-free surface. Reference: `/lifting` Sessions (act) vs Analytics
   (review) vs PRs (review-your-story) tabs via `SegmentedControl` with `?tab=`
   state (`frontend/src/app/(app)/lifting/page.tsx`); deep-links (`?session=`,
   `?pr=`) land on the correct side of the gate.
2. **Labeled zones within a view.** Where both modes share a screen, a
   `SectionLabel` names the review zone explicitly (e.g. "Set review"), so the
   boundary is visible, not implied. Reference: `SetsVisualizer` under its
   label in the session detail.
3. **Floating action layer.** Primary actions float physically apart from
   scrolling review content: sticky, bordered, shadowed, backdrop-blurred.
   Reference: `QuickAddSetBar` (`sticky bottom-4 z-10 … shadow-lg backdrop-blur`).
4. **Read-only viz components.** A review component takes data props and emits
   no mutations — no POST/PATCH/DELETE, no query invalidation. All writes live
   in table/form/action components. Reference: `SetsVisualizer` (`sets` +
   `e1rmByExercise` in, nothing out); `CombinedLoadChart` (reads one query).
   If a chart file imports `useMutation`, it is on the wrong side of the gate.
5. **Suggest-only shared data.** Hooks feeding both modes return data, never
   side effects; application stays a tap away in the action layer. Reference:
   `useTodaysStrengthDay` (same `['live-plan-today']` key in Live Lift and the
   Sessions tab; "Load from today's plan" applies only on tap).

## Checklist for new work

- [ ] New chart/viz goes on the review side (tab, labeled zone). Which one?
- [ ] Its component imports zero mutation hooks. Verify by reading imports.
- [ ] Every action it implies (log, adjust, refresh, start) exists in the
       action layer — or is explicitly deferred in the plan, not silently missing.
- [ ] Touch targets on new buttons ≥44px (`min-h-[44px] min-w-[44px]`).
- [ ] Emoji-free: lucide icons only (emoji reserved for content strings).

## Known applications / candidates

- `/lifting`: done — tabs + "Set review" zone + floating quick-add bar.
- `/cycling`: candidate — prescriptions (`NextSessionCard`, autoregulation)
  share the page with power-curve/zone/load charts; same tab treatment applies.
- `/dashboard` Today: candidate — brief verdict (act) vs KPI grid and trend
  charts (review) already read as two bands; formalize with labels if they blur.
- `/activities` expanded detail: Overview (review) vs Analysis tabs already
  follow this shape — the pattern to copy, via the same `SegmentedControl`.
