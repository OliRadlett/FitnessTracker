# Open-Agenda Brainstorm — 2026-09-30

> **Status**: Findings + idea inventory. No implementation plans — capturing to iterate per section later.
>
> **Context scan**: read `plans/backlog-2026-09-20.md` (Phases 0–5 reported complete), `plans/future-enhancements.md`, `plans/underdeveloped-features-2026-09-27.md`, `docs/BUGS.md`, `frontend/src/CODEMAP.md`. Codebase is unusually complete. The gap is **execution, not ideas** — so these aim at *gaps the code exposes*, not generic feature lists.
>
> Working tree note: `hotfix/087-jsonb-dialect-type` has in-flight uncommitted files owned by another session. Not touched.

## The honest headline

Backlog says every approved item is built. ~40 features shipped, codebase clean. None of the below is "you forgot X." These are disconnects between things the system *already has* but doesn't *connect*.

---

## Tier 1 — The under-leveraged thesis

### 1. Five recommendation engines that never talk to each other

Read the frontend and count the places the app decides what you should do:

| Engine | Where | Output |
|---|---|---|
| `derive_adaptive_advice()` | `/training` WeeklyView | weekly stance + one-tap apply |
| `brief.ts` verdict | `/today` | morning verdict |
| `analyze_deficiencies()` | dashboard Weekly + `/lifting` | weakness list |
| `CrossDomainInsight` (Modal) | dashboard WeeklyTab, **null when empty** | sleep/sport correlations |
| `AthleteInsight` | `/analytics` + `/today` | 6 model cards, confidence-badged |
| `HealthAlert` | `/health` + bell | threshold alerts |

Six systems, each with its own confidence model, none reconciling. They can simultaneously contradict on screen — adaptive "build," deficiency "squat is weak," brief "rest," health alert "elevated RHR." **No page tells you what they collectively mean.** Biggest opportunity: an arbitration layer over five features you already have.

### 2. Cross-domain is the product thesis, and it's a hidden card

FitTrack exists because you lift *and* you ride. `cross_domain.py` runs weekly via Modal and computes exactly the questions no competitor can: does Saturday's deadlift suppress Sunday's power? Are you cycling away your squat gains? Is sleep debt from a 05:00 start explaining a bad bench?

`CrossDomainInsightsCard` renders on the **dashboard Weekly tab only**, and `return null` when empty. The most differentiating feature in the codebase is one dismissible card. Positioning failure, not engineering.

### 3. Everything is retrospective; nothing is forward-looking

Goals project. TSB projects. Nothing predicts **next week**. No model of "if I execute this block as written I arrive at X CTL/ATL/TSB on race day — and skipping Tuesday costs 0.4 W/kg of freshness." `compute_tsb_projection` already does the hard part for single days. Extending it across a block against a plan is the natural next step and would make `/training` genuinely load-bearing.

---

## Tier 2 — Gaps in what's already built

**4. The 200-activity ceiling is architectural, not cosmetic.**
Every time-series view is capped at 200 activities; `StatsView` ships an inline note about it because charting a truncated window silently is worse. Docs call server-side bucketing "the proper fix" — still not done. Every chart inherits a ~2-year horizon.

**5. Export exists. Import does not.**
JSON export, CSV, PDF, GPX download — all outbound. **Zero inbound.** Cannot import a GPX into an activity, a strength log, or any CSV. For a system whose value compounds over a decade, data you can't get *in* caps everything, and it makes backups unrestorable.

**6. Offline write exists for exactly one flow.**
`useLiveSession` is a genuinely excellent local-first implementation — conflict merge, `client_id` idempotency, discard-abort, BUG-089/090 hard-won. But logging a session *the next morning* from a basement gym with no signal still fails. Same for weigh-ins, goal check-ins, notes. The reusable substrate isn't reused.

**7. Undo is a route feature, not a platform feature.**
Routes have merge-undo with history. Nothing else does. Delete a goal, a session, a check-in, a video — gone, unrecoverable. The routes pattern generalizes trivially and is disproportionately valuable in a multi-year log.

**8. No data lineage.**
Route quality, `AthleteInsight`, `LlmAnalysis` — all derived values with no "why does this say what it says." `AiAnalysisCard` grounding chips are a start. When a projection flips to "Unlikely," you want the inputs that drove it.

**9. Silent staleness is a product bug, not a dev pitfall.**
AGENTS.md Pitfall 2 documents it: a failed `POST /api/v1/auth/sync-user` leaves `token.backendToken` stale, every API call 401s, the SW swallows it — for **up to an hour**. User sees a dashboard that *looks* fine and is quietly a day old. Fix = a token-freshness signal in the UI, not a longer backoff.

**10. Stream storage has no lifecycle policy.**
`activity_streams` holds 1s samples for every ride in JSONB. Five years of riding is a very large table with no downsampling, tiering, or archival strategy anywhere. Linear unbounded growth.

---

## Tier 3 — Breadth (low effort to propose, grouped)

### Product
- **Subjective wellness check-in** (sleep quality / soreness / motivation / stress, ~10s). Recovery is Whoop-gated; without it, "recovery < 40 ⇒ rest" goes dark. Makes the adaptive engine work for non-Whoop users.
- **`/today`: promote, iterate, or kill.** Undecided POC since `plans/feature5.md`. The only page that could be the daily habit — needs a real-data go/no-go (your call, not another plan doc).
- **A single "attention inbox"** — rank + reconcile alerts, notifications, insights, suggestions, brief in one place.
- **Data-health page** — extend `IntelligenceStatusCard`: what's fitted, stale, missing, and *what one input unlocks the most.*
- **Surface `GET /events/{id}/retrospective`** if it exists but isn't shown.

### Modelling
- **What-if course simulator.** Routes + power models + weather present. Predict finish time, required power, PB feasibility, pacing strategy for a route never ridden. `EffortEstimateCard` (Martin model) → the real thing.
- **Forecast a plan block against a goal.** (See #3.)
- **Injury risk against planned load**, not just historical.
- **Narrative PR timeline** — `PR conditions` card → "when did this happen and what preceded it."

### Platform
- **Git-like history for training data** — see #7.
- **Backfill/manual-entry path for any offline event** — see #6.
- **Server-side time-series bucketing** — see #4.
- **AI usage & cost visibility** in settings. B-06 added per-user Gemini caps; no "240 of 300 used this month."
- **Stream retention / downsampling** — see #10.

### Engineering
- **`types/generated.ts` regen** (F2, ~1000 lines stale). Note the contradiction: §5.9 "type drift / openapi codegen" is marked ✅ while F2 says output is stale — one is wrong.
- **CI E2E non-blocking on a narrow subset** while ~210 specs pass locally. "Few green weeks" from blocking since 2026-09-21.
- **BUG-045** — live production credentials in `.env`, oldest open item.
- **Trace IDs surfaced in UI** — correlation IDs exist in logs, not the client.
- **Graphify CLI** — AGENTS.mandates it; CLI isn't on PATH here. Install fix or the mandate is theatre.

### Design
- Light theme shipped (B-25); dark remains default.
- 3D replay is spectacular and **disconnected from planning** — relive a ride, but can't preview a course in 3D before committing to a day.

---

## Reading order for iteration

1. Cross-domain + recommendation arbitration (T1 #1/#2)
2. Forward models / next-week projections (T1 #3, Modelling)
3. The 200-activity ceiling + stream lifecycle (T2 #4/#10, Platform)
4. Offline writes + undo (T2 #6/#7, Platform)
5. Import + lineage + attention inbox (T2 #5/#8, #9, Product)
6. `/today` decision + data-health page (Product)

## Non-obvious things confirmed by reading the code
- The 3D relive work (commits 179–193) is the most recent investment; it is genuinely first-class.
- `analyze_injury_risk`, `compile_cycling_stats` were already de-N+1'd (5.1/5.5 ✅) — so those specific perf items are done.
- `types/generated.ts` is NOT on .gitignore (verified) — so the 1000-line staleness is real rot, not a generated-and-ignored artifact.
- `notify()` accepts `user: User | None` (5.6 ✅) — so the notification path is already lean.
- `POST /webhooks/strava` only HMAC-verifies and queues; `process_strava_webhook_events` drains — correct, no change.
