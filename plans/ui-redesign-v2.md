# FitTrack UI Redesign v2 — "One Athlete"

> Status: proposal (from team `ui-deep-dive`: t4 screenshot analysis + t5 evolution
> direction, pushed further per user verdict: *"clumsy, data scattered, UI basic"*).
> Sources: 48 prod screenshots (19 targets, desktop + mobile), t4's 12 ranked findings,
> t5's phased evolution plan, `docs/review-vs-act.md`, Wave-4 `services/today.py`
> (five-engine verdict + `consensus[]` with `available:false` silence reporting).
> Binding throughout: §1.0 data maximalism, the plan-precedence verdict
> philosophy + four-moment scope + image quota (Standing rules / Walkthrough
> decisions at the end of this file — read them as constraints, not appendix).

### 1.0 Overarching principle: data maximalism, gated — never cut

Data density ("data porn") is desired, not a problem. Every metric, breakdown, and
cross-cut the backend can produce must stay reachable within a tap or two. The
mechanism is the existing `docs/review-vs-act.md` convention — read-only viz
components gated behind tabs/zones/progressive disclosure, so action surfaces stay
focused while full depth sits one tap away. v2 builds on that pattern; it does not
invent a new one. **If any v2 move would remove or bury data, that is a non-goal
violation — flag it instead of shipping it.** Phase gates measure chrome and
contradictions going down with data reachability preserved, never "density down".

## The thesis in one paragraph

FitTrack doesn't have a *visual* problem — the dark card system is coherent. It has an
**identity** problem: the same athlete is described three different ways on three
different pages (dashboard says "Ready to Train 76%", Today Brief says "take it
easy", training zones say "all intensities available"), and the same number lives in
three places (TSS, body weight, FTP). v2 gives the app **one athletic identity** —
a single composed athlete-state every surface reads from — wrapped in a
**task-based IA** ("train today" is a flow, not 17 peer pages) and a grown-up
**design language** (type, motion, viz system, states). Evolution's *what*, with a
bolder *how*.

---

## 1. Data unification — one athlete-state

### 1.1 The `AthleteState` view-model

One React Query key — `['athlete-state']` — composed from endpoints that already
exist. Conceptually:

```
AthleteState {
  verdict:    { headline, action, why[], engines[] }  // from /today (Wave-4 consensus)
  load:       { ctl, atl, tsb, trend }                // single source for every TSS/CTL/ATL/TSB number
  body:       { weight, hrV, restingHr, sleepDebt, readiness }
  plan:       { today: TrainingPlanDay?, position, conformity }
  goals:      { atRisk[], onTrack[] }                 // trajectories, not full goal objects
  sync:       { staleProviders[], degradedEngines[] } // pitfall-42/43 made visible
}
```

No new backend models. Either a thin `GET /api/v1/athlete-state` compose endpoint
or frontend composition — record the decision in the build plan; default to frontend
composition first (zero migration risk), promote to an endpoint only if waterfall
latency hurts. The backend is ready: Wave-4's five-engine consensus already reports
silent/degraded engines instead of fake unanimity — the frontend must finally honor
that (show degraded, never blank, never 500 the surface).

### 1.2 What MERGES vs what LINKS

**Rule: every number has one home; everywhere else is a link to home.**

| Today (scattered) | v2 (home → link) |
|---|---|
| Dashboard banner + Today Brief verdict (contradicting) | MERGE → one `VerdictCard` rendered in both slots (dashboard keeps its banner position; TODAY renders the identical component — shared, no forks, no split) |
| TSS/CTL/ATL/TSB headers on dashboard, cycling, training | MERGE → one `LoadStrip` (persistent ribbon, §4 moment 2) |
| Body-weight widgets on cycling + health | MERGE → one `WeightCard` (manual + Withings sources) |
| Health-alert cards duplicated in notifications | LINK → notifications carry alert summaries that deep-link to Health (`?alert=`); full text lives once |
| AI health long-form pasted into a card | MERGE into structured `InsightCard`s (score header, priority list, collapsible method) — fixes t4 raw-markdown leak |
| FTP shown in cycling header, zones table, plan banner | MERGE → `LoadStrip` + cycling lab links to it |

**Stays separate, linked via the deep-link fabric from t1** (`?activity=`, `?session=`,
`?tab=`, `?route=`, `?replay=`): power-curve lab, video pose analysis, route maps,
3D replay theater, wiki docs. Depth is a feature for a single-user power tool —
v2 organizes it, never deletes it. Duplicates moves *into* Routes as a tab
(hidden `/routes/duplicates` URL keeps working as a redirect).

### 1.3 Unification guardrails

- A merged component renders **identical props** in every slot (no per-page forks).
- Merging never changes computation — CTL/ATL/TSB formulas, Brzycki, FTP
  estimation stay exactly as `docs/algorithms.md` specifies.
- Sync/health degradation is *shown* (stale badge + "last synced Xm ago"), never
  silently averaged away.

---

## 2. Task-based IA — a "train today" flow, not 17 peer pages

### 2.1 Four modes, each with one job

```
TODAY    the flow:    Verdict → Session → Fuel/Weather → Log/Done
REVIEW   the lab:     trends, cycling lab, health, analytics, activities, videos, climbs
PLAN     the future:  training plans, goals, calendar, events
SYSTEM   the library: routes (+duplicates tab), settings, wiki, notifications center
```

- **TODAY — job: get today's training done.** Absorbs Today Brief + today's plan
  slice + the Live Lift entry point into one vertical action path. It answers
  "what do I do in the next 2 hours" and nothing else. *Day in the life:* open
  the app at 6pm → verdict says the plan's push session stands → tap Train →
  Live Lift session pre-loaded with suggested working weights → log sets offline
  → done; tomorrow's verdict already accounts for tonight's volume.
- **Dashboard — job: overview home. It survives, it is not dissolved.**
  TODAY is the action path (do now); the dashboard is the overview home (how am
  I doing). No split, no duplication: the dashboard keeps its surface with a
  light reorganisation, gains previous-period navigation (prev week / prev month
  — history is currently unreachable), and renders the same `VerdictCard` /
  `LoadStrip` components rather than its own forks. *Day in the life:* Sunday
  coffee → swipe Month → swipe back to September → compare CTL ramp vs plan
  conformity before the plan review.
- **REVIEW — job: understand the body of evidence.** Sticky section nav and
  **one shared time-range context** — a single range picker drives dashboard
  charts, cycling lab, health trends, and analytics together (today each chart
  has its own window; cross-chart reasoning is impossible). *Day in the life:*
  FTP bumped → set range to 12 weeks → power curve, TSB band, and sleep→power
  insight all re-cut to the same window to check whether the gain is real.
- **PLAN — job: decide the future.** Consolidates plans/goals/calendar/events;
  goal cards link *into* plan days ("this goal needs +2.5 kg by Dec — 3 push days
  scheduled"). *Day in the life:* missed Tuesday's pull → drag it to Thursday →
  conformity score and weekly TSS preview update before committing.
- **SYSTEM — job: honest infrastructure.** Routes library, settings, docs, alert
  history. No one "browses settings for fun" — group it and stop apologizing.
  *Day in the life:* Withings re-auth alert → notification deep-links here →
  one Reconnect tap → tomorrow's weight card is fresh.

### 2.2 Navigation

- Desktop: 4-mode rail + contextual secondary nav per mode (replaces the 17-item
  flat sidebar; t5's zoning was the halfway house — v2 commits to modes).
  Reshuffling the shell, page structures, and navigation boldly is explicitly
  sanctioned — do not be conservative with layout. The binding constraints are
  §1.0 (maximalism, ≤2 taps), the plan-precedence verdict philosophy, the image
  quota, and the non-goals below; if a bolder layout wants to break one of
  those, flag it in the plan rather than assuming.
- Mobile: bottom bar `Today / Review / ● Train / Plan / More` with the central
  **Train action** (opens today's planned session in one tap) and a bottom
  safe-area padding token — fixes t4 P0 overlap structurally, not per-page.
- URLs: existing deep links keep working; modes are shells, pages keep route
  identity underneath (`/lifting`, `/cycling`…) so bookmarks and `?session=`-style
  links never break.

---

## 3. Design-language upgrade

### 3.1 Type scale

- Display numerals (verdict %, TSS, FTP) in large tabular figures; page titles one
  size; body one size; meta one size. Floor: **12px body minimum**, 11px reserved
  for timestamps only (fixes t4 microcopy complaint).
- `font-variant-numeric: tabular-nums` on every metric, table, and chart tick.

### 3.2 Motion (with `prefers-reduced-motion` respected throughout)

- Verdict transitions animate value changes, never flash.
- Existing `Modal` bottom-sheet pattern becomes *the* mobile interaction (sheets
  for Train picker, filters, "why this suggestion").
- Chart reveal on scroll into view; skeleton shimmer on loads; PR milestones reuse
  the existing PR toast/notification pattern (no bespoke celebration overlay —
  PR Theater was cut, §4). No motion on data-critical color changes (status must
  not depend on animation).

### 3.3 Data-viz system

- Shared Recharts theme tokens: axis/legend/grid/zone colors, label-culling rules
  (rotate-or-drop, never overlap — fixes t4 Form Trend complaint), one
  `InsightCallout` component replacing ad-hoc 💡 lines.
- Every chart gets a designed **empty** state ("sync Whoop to populate" pattern
  from Health is the template — extend it) and a **degraded** state (stale-data
  badge, per pitfall 43).

### 3.4 States matrix (the "basic UI" fix)

Every data surface ships four designed states, reviewed in screenshots:

| State | Pattern |
|---|---|
| Loading | Skeleton matching card shape, never spinners-in-void |
| Empty | The Honest Empty (§4, moment 4): what + how to get data + CTA |
| Error | Plain language, one action ("Reconnect Whoop"), no module names (fixes t4 `numpy` leak) |
| Degraded/Offline | Stale badge + last-sync time; Live Lift's offline-first copy is the template |

### 3.5 Mobile-first signatures

- Thumb-zone primary actions; 44px touch targets; focus-visible rings.
- Swipeable verdict cards (Today / Week / Month as swipe, not just tabs).
- Pull-to-sync on REVIEW surfaces.
- PWA update notice becomes a dismissible floating pill (fixes t4 P0 banner
  overlap app-wide).

---

## 4. Four signature moments (what makes it feel crafted)

1. **The Morning Verdict.** One card, one sentence, always plan-relative
   (adjust-or-affirm, never an invented workout — verdict philosophy). Concrete
   copy, plan says intervals and recovery is low:
   *"Plan says 5×5 min threshold. Recovery is low (54 ms HRV, −3.7 h sleep debt)
   — consider swapping with Friday's Z2 endurance, or proceed if legs feel
   fresh. [Swap with Friday] [Keep plan] [Why ▾]"*.
   Rest day: *"Rest day in Post summer strength. TSB +18.8 — freshness is the
   work today. [Why ▾]"*. No plan at all: *"No active plan — log anything and
   I'll start building your baseline. [Browse routes] [Start live lift]"*.
   The `Why` expands Wave-4 engine rows including silent ones (pitfall 42).
   This is the app's handshake, every day.
2. **The Load Ribbon.** Persistent strip under the header across all REVIEW
   surfaces, same `LoadStrip` component everywhere. Contents, left to right:
   `CTL 24.1 (42d)` · `ATL 5.3 (7d)` · `TSB +18.8 Fresh` · `7d TSS 312` ·
   `FTP 219 W` · sync badge (`Synced 36m ago` / `Stale`). Tapping any chip
   jumps to its home chart. This ends the "which TSS is real" era.
3. **"I have 1 hour, Z2" flow.** On-demand (user asked → allowed). Steps:
   (1) zone chips Z1–Z5 + duration chips 30m–3h → (2) three matching routes,
   each with distance, est. TSS, and weather badge (`14°C · 30 km/h · ⚠ rain`)
   → (3) route preview on mini-map with fuel estimate → (4) `[Push to Wahoo]`
   / `[Plan workout]`. Lives in TODAY; the current buried matcher UI is the
   starting implementation, not a new backend.
4. **The Honest Empty.** Template every empty state follows — headline naming
   the missing thing, one line naming the path to it, one primary CTA, one
   secondary link. Example (no power data):
   *"No power data yet"* / *"Connect Strava and ride with a power meter — your
   curve, zones, and FTP appear here automatically."* / `[Connect Strava]` /
   `How power data works →`. No more `—` placeholders (t4 Goals) or void
   screens: empty is a designed moment, not an absence.

---

## 5. Phased roadmap (0–3) with per-route moves

### Phase 0 — Hygiene (no design risk; t4 P0/P1 direct fixes)

- Shell: safe-area padding token; PWA pill replaces overlay banner.
- Health: render LLM markdown as structured cards; drop stray "Based on 1 fact".
- Notifications: plain-language error copy + single Reconnect CTA; dedupe
  identical re-auth alerts into one escalating card.
- Goals: hide Projections until data exists (skeleton + CTA, never `—`).
- Cycling: TSS banner becomes state-aware (only when CTL/ATL actually stale).
- Verify without reading screenshots (standing user rule — image quota): tsc,
  targeted DOM/text checks, user eyeballs in their own browser.

### Phase 1 — Unify (build `AthleteState` + merged components)

- New: `useAthleteState()` hook; `VerdictCard`, `LoadStrip`, `WeightCard`,
  `InsightCard`, `SyncBadge` components.
- Dashboard: banner → `VerdictCard`; numbers row → `LoadStrip`.
- Today Brief: same `VerdictCard` (contradiction dies by construction).
- Cycling/Health/Training: headers → `LoadStrip`/`WeightCard`; labs keep depth.
- Decisions to record: compose endpoint vs frontend composition; `?alert=`
  deep-link param for notification→Health links.

### Phase 2 — Re-IA (four-mode shell)

| Route | Move |
|---|---|
| Dashboard, Today Brief | Dashboard stays home surface (reorg + prev-week/month nav); TODAY flow (verdict → session → log) coexists as the action path |
| Training, Goals, Calendar | PLAN mode; goal↔plan-day cross-links |
| Activities, Videos, Climbs, Analytics | REVIEW sections under shared time-range |
| Cycling, Health | REVIEW labs; headers unified (Phase 1), depth kept |
| Lifting, Live Lift | TODAY flow entry (`Train` action) + REVIEW history |
| Routes, Duplicates | SYSTEM library; duplicates → tab, old URL redirects |
| Notifications | SYSTEM center + TODAY badge count |
| Wiki, Settings | SYSTEM; structure unchanged, states-matrix pass |

### Phase 3 — Craft (design language + signature moments)

- Tokens (type/motion/viz), states-matrix audit of every route, four signature
  moments, mobile polish pass, chart label-culling sweep.
- Gate: full 48-shot prod-shots run diffed against the pre-v2 baseline —
  **chrome and contradictions down, every metric still reachable within ≤2 taps**.
  (Harness may capture; agents verify from run output + text descriptions unless
  the user explicitly asks for image reads.)

## Standing rules (user, 2026-10-09)

- **Image quota: capture is cheap, reads are expensive.** Playwright screenshot
  runs are fine any time. Agents must not open/read image files (screenshots,
  PNGs) except when the user explicitly asks — verify via test output, DOM/text
  assertions, and `screenshots/prod/descriptions/`. This overrides any
  "eyeball-diff" verify step in the phases above.

## Non-goals (explicit)

- No light-mode default, no new integrations or sync-pipeline changes.
- Rebrand is allowed only with written justification in the plan (what problem
  it solves that tokens/components cannot) — otherwise the dark card system stays.
- No backend model/migration changes (optional compose endpoint excepted).
- No merging the cycling lab with the health lab — different jobs
  ("bike computer" vs "body dashboard"); they share components, not pages.
- No feature removal: depth moves behind tabs/zones/links, never deleted — and
  "behind" means ≤2 taps with a visible affordance, never buried. Any move that
  removes or buries data is a non-goal violation: flag it, don't ship it.
- No touching auth, sync, webhook, or Modal pipelines.

## Walkthrough decisions (with user, 2026-10-09)

- **§1 — agreed as written.** Composition default stands: `useAthleteState()` frontend
  composition first, promote to `GET /api/v1/athlete-state` only if waterfall
  latency hurts. AI cards go structured-everywhere (`InsightCard` template for all
  domains). Notifications become alert summaries deep-linking to Health (new
  `?alert=` param). Merge-vs-link table, guardrails accepted without changes.
- **§2 — dashboard survives.** User wants the dashboard kept as a surface with a
  light reorganisation, not dissolved into TODAY/REVIEW. Weekly and Monthly views
  must gain previous-period navigation (prev week / prev month, and by extension
  a general "look back" affordance) — currently history is unreachable.
  Implication for Phase 2: the Dashboard row becomes "stays home surface;
  reorganise; add prev-week/month navigation" instead of a TODAY/REVIEW split.
  TODAY flow coexists as the action path (verdict → session → log), dashboard
  remains the overview home.
- **Verdict philosophy — plan takes precedence, never prescriptive.** No
  suggested training without the user asking for it. Adjustments based on form
  and recovery are welcome, but they modify (or affirm) the current training
  plan's session — they never invent standalone workouts. With no plan or on a
  rest day, the verdict says so without prescribing. On-demand suggestions (the
  "1 hour, Z2" flow) are fine because the user asked.
- **§4 — four moments, plan-relative verdict, no PR Theater.** Moment 1 stays
  tied to the training plan (adjust-or-affirm, never invented workouts). PR
  Theater cut entirely.
