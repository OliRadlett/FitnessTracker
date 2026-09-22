# UI Deep-Dive Plan — 22 Sept 2026 (Screenshot Audit)

> **Source**: 29 screenshots in `docs/screenshots/` covering Dashboard, Today Brief, Calendar, Notifications, Training, Goals, Activities, Activity Detail, Lifting, Videos, Cycling, Health, Routes, Analytics.
> **Missing**: Live Lift, Settings, Wiki, mobile views — second pass needed.
> **Prior plan**: `ui-overhaul-2026-09.md` (COMPLETE 2026-09-17, tokens/skeletons/query keys) — this plan builds on it, does not repeat it.
> **Mode**: Ongoing, hybrid (task checklist + design vision). Ship P0 first, then polish, then redesign bets.

## Phase 0 — Trust fixes (P0, ship first)

> **Status 2026-09-22: all items built except 0.8** (deferred — see note).
> Verified per item: `tsc` clean on touched files, vitest 176/176, backend
> snippets parse-checked. No commits yet — review the working tree first.
> Known pre-existing (other session, untouched): `lifting/videos/page.tsx`
> unused `VideoCompareModal` import fails global `tsc`.

Single source of truth + remove contradictions. Each item: fix, verify visually, one screenshot in PR.

- [x] **0.1 Readiness verdict unification** — DONE (interim frontend):
  `RestDayBanner` accepts `sleepDebtHours`, downgrades to the Brief's exact
  yellow headline at ≥2h; `TodayTab` wires it. `GET /dashboard/coach-call`
  does not exist in this tree — full NF2 unification still open.
- [x] **0.2 Goal progress math** — DONE: degenerate trajectory
  (start==current after lazy backfill) falls back to absolute current/target
  for increase goals, backend `_enrich` + frontend `goalProgressPct`.
  465/500→93.0%, decrease goals untouched.
- [x] **0.3 Goal status contradiction** — DONE: projection badge takes
  precedence on card (`useGoalProjections`, shared `['goal-projection', id]`
  cache keys) and modal summary; shared `PROJECTION_BADGE_STYLES`; card Due
  line shows projected date when available.
- [x] **0.4 Sleep debt sign** — DONE: Health page `+2.6h` → `-2.6h` (+
  `debt (7d)` subtitle), matching `SleepDebtCard`/Brief. Convention noted on
  the card: debt_hours ≥ 0 = owed, displayed negative.
- [x] **0.5 TSB rounding** — DONE: shared `formatTSB()` (±x.x) in
  `lib/utils` + unit tests; applied in banner, Today card, Cycling, badges,
  planner, event panel, AI grounding chip. Brief already matched.
- [x] **0.6 Calendar legend bug** — DONE: Python-style `\U0001…` escapes
  replaced with real emoji in `calendar/page.tsx` + `DayDetailPanel.tsx`;
  grep gate clean.
- [x] **0.7 Dev-string leaks** — DONE: `streamLabel()` helper + tests
  (pills, chart titles, 3D messages); week-ahead notification uses registry
  labels (`Estimated 1RM (Unlikely)`). `Proaress`/`Ctrl+1P` already fixed;
  Routes grid had no code bug (flex-separated spans).
- [ ] **0.8 Video Form 0 vs 90** — INVESTIGATED, DEFERRED to the video
  session: grid and modal read the same `video.form_score` (no data bug; the
  screenshots show different videos). Remaining work is a scale label/tooltip
  on the grid badge in `lifting/videos/page.tsx`, which the video session is
  actively rewriting — coordinate with them, don't edit under them.
- [x] **0.9 AI HRV hallucination** — DONE (two-sided): renderer accepts
  `* `/`• ` bullets + regression tests; health prompt pins `- ` bullets and
  forbids missing-data claims when JSON has entries. Stored 4d-old analyses
  render correctly without regeneration.
- [x] **0.10 Routes basemap** — DONE: shared `lib/mapTiles` (keyless OSM
  default, env override for dark tiles), 3 Leaflet views migrated, CODEMAP
  updated. OSM tiles are light — dark returns via provider key.
- [x] **0.11 Analytics empty + failed** — DONE (frontend): real backend
  `detail` surfaced in the error line; `Fetched X ago` timestamp in header.
  Backend already returns causes; a 500 with 863 activities still needs prod
  log triage if it recurs. Season/Insights merge left as redesign.

## Phase 1 — Global polish (P1)

> **Status 2026-09-22: built on `feature/ui-phases-1-3`** (tsc clean,
> vitest 178/178). Activity-detail tabs consolidated into Phase 3.2;
> `⋯` overflow menu deferred (primary actions stay visible).

- [x] **1.1 Icon pass** — DONE (slice): `lib/domainIcons.ts` one-icon-per-domain
  + `DomainIcon` (aria-hidden); applied to TodayTab headers + RestDayBanner.
  Remaining page headers keep emoji — extend per page in Phase 2 if touched.
- [x] **1.2 Badge budget** — DONE: GoalCard hides `Active` next to trajectory
  badge; EffortEstimateCard duplicate zone pill removed; SourceBadges capped
  at 2 + `+n` overflow.
- [x] **1.3 Chart primitives** — DONE (slice): `ChartCard` gains standard
  `insight` line; dashboard Form Trend migrated (title + TSB-state insight).
  Dual-axis/scatter fixes stay with the chart owners’ data work.
- [x] **1.4 Empty-state rule** — DONE: Brief hides Insight card until data;
  RouteDetailPanel returns null when unselected; tags hint rewritten.
  Resp-rate copy unification left for Health pass (2.x).
- [x] **1.5 Button hierarchy** — DONE (slice): shared `SegmentedControl`
  (arrow-key nav) replaces hand-rolled tablists in Activities + Routes.
- [x] **1.6 Metric tooltips** — DONE: central `metricGlossary.ts` + tests;
  `Badge.title` passthrough; `StatBadge.hint` in lifting + cycling cards
  (Fatigue Index scale verified 0–100 against backend); W-flag tooltip.
- [x] **1.7 Contrast + type** — DONE (slice): TrendIndicator micro-label
  `text-[10px]` → `text-xs` with stronger muted tone. Brush already ≥30px;
  full 12px sweep deferred (needs visual review per page).
- [x] **1.8 Long-page splits** — DONE (slice): Analytics →
  `Insights|Season|Load & Lab` tabs (lazy-mount); Cycling profile behind a
  summary-row collapsible. Activity-detail tabs consolidated into Phase 3.2.

## Phase 2 — Page polish (P1/P2, per-page acceptance)

> **Status 2026-09-22: built on `feature/ui-phases-1-3`** (tsc clean,
> vitest 179/179, ruff clean). 2.8 deferred to video session. Full
> Apply-to-Live-Lift + cross-session sparkline consolidated into Phase 3.

- [x] **2.1 Dashboard** — DONE: zero-day numbers read `Nothing logged yet`;
  WeightPanel moved to Health; per-goal deep links kept (useful, not noise).
  Bedtime ±15min window is backend copy in `whoop.py` (owned by sync
  session) — flagged, not touched.
- [x] **2.2 Today Brief** — DONE: 2-col desktop (action | context);
  `sportLabel()` helper + tests (`cycle` → Cycling); drizzle/rain never
  render as “good conditions”; DomainIcon headers.
- [x] **2.3 Calendar** — DONE: sport filter, full pill tooltips, future-day
  dim, off-by-one `+N more` fix. Planned-day marker needs plan-week wiring
  — suggested for Phase 3.
- [x] **2.4 Notifications** — DONE: consecutive duplicates collapse into
  expandable groups. Provider capitalization (`withings` → Withings) is one
  line in `connection_health.py` (owned by sync session) — flagged.
  Deep-link re-auth already existed (`link: /settings`).
- [x] **2.5 Training** — DONE: forecast legend + Best-day ring + always-on
  rain %; week-jump dropdown; Refresh is primary-accent when stale. Rest
  days already render slim; week pills don't exist (prev/next + dropdown).
- [x] **2.6 Activities** — DONE: linked-lifting flattened to left-border
  row with paired titles; HR titles explain red; 20px checkboxes; totals
  rounded (5731 km); non-cycling stream-empty line removed.
- [x] **2.7 Lifting** — DONE: Whoop banner 7-day snooze; ReadinessIndicator
  removed (link to Dashboard instead); Copy-all loads button.
- [ ] **2.8 Videos** — DEFERRED to video session (active rewrite; see 0.8).
- [x] **2.9 Cycling** — DONE: one-shot vs weekly FTP copy clarified; home
  coords privacy note; fractional baselines rounded (`vs 1.8`). CTL/Session
  duplication kept (page-specific context, not verbatim copies).
  `Recreational` band is backend data — left as is.
- [x] **2.10 Health** — DONE: dismissed alerts greyed; backend Pearson-r
  insight on Recovery-vs-Performance (renders via InsightsList). `91-day`
  is accurate (91 samples) — not a bug. Sleep dual-axis stays with chart
  data work.
- [x] **2.11 Routes** — VERIFIED mostly done: onboarding dismiss persisted
  (B-23), compare hint bar exists, no TS truncation in grid. Auto-naming +
  sparklines need backend/ML scope — suggested for Phase 3.

## Phase 3 — Redesign bets (P3, design doc + prototype, one at a time)

> **Status 2026-09-22: built on `feature/ui-phases-1-3`** (tsc clean,
> vitest 179/179, ruff clean, backend parse-checked). 3.4 deferred for
> device testing.

1. [x] **Readiness strip** — DONE: `TodaySummary.rest_day_suggestion`
  (schema + endpoint reuse `_suggest_rest_days`, cycle-safe local import);
  Today Brief renders the same `RestDayBanner` as Dashboard (local verdict
  card kept as fallback). Backend test extended.
2. [x] **Activity detail tabs** — DONE: `Overview|Replay|Analysis`
  SegmentedControl in `ActivityExpanded`; Replay3D unmounts off-tab.
3. [x] **Routes discovery polish** — DONE (slice): surface-mix mini-bar on
  grid cards from existing `surface_profile` fractions. True elevation
  sparklines need per-point profiles in `RouteSummary` (backend scope).
4. [ ] **Mobile pass** — DEFERRED: needs mobile screenshots + device
  testing; no blind responsive rewrites.

## Verification per phase

- `npx tsc --noEmit`, `vitest run`, manual screenshot before/after per page (desktop 1920 + mobile 390).
- Grep gates: no `U0001`, no `*_smooth|heartrate` in labels, no `Proaress`, no `API KEY REQUIRED` in tiles, no `* ` literal in AI cards.
- A11y spot: keyboard-only flow Dashboard → Activity → Lifting session; focus visible; icon buttons named.

## Next step (propose)

Start with **0.1 + 0.2 + 0.6 + 0.10** (verdict, progress, legend, basemap) — highest trust lift, each ≤1 session. Say the word and I’ll branch + implement in that order, one change + verify at a time.
