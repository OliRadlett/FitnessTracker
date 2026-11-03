# FitTrack Enhancement Review — 2026-10-15

**HEAD**: `5f54f40a848b4c4524f19ce2dc90e6a94bcfe10d`
**Method**: `git rev-parse HEAD` + plan-file reconciliation + code verification

> ### ⚠️ Corrections (verified 2026-10-16)
> The first pass of this document was drafted largely from the `plans/*.md` files, which are
> stale in both directions. The following were re-verified against **code at `5f54f40`** and
> are **already shipped** — the affected rows below have been corrected and the wrong
> "Top 5" items replaced:
> - **Training redesign**: Phase 0 (editor primitives), Review mode, Peaks scaffolding, the
>   mobile pass, strength-progression **S1** and the Program matrix **S2** are all shipped
>   (commits `834208e`, `62494e6`, `5d0442a`, `1e8f336`, `9510f47`, `5f54f40`). Editor
>   primitives live at `backend/app/api/training_plans.py:478-560` (`POST /days`,
>   `DELETE /days/{id}`, `POST /days/{id}/swap`); the UI is `components/training/{ModeSwitch,
>   PlanSpine,LoadStrip,WeekMasterBar,MissedDayPopover}.tsx` + `training/plan/*` +
>   `training/review/*` + `training/peaks/*`, all wired from `app/(app)/training/page.tsx`.
> - **Video intelligence Phase 5–6**: `aggregate_video_analyses_weekly` **is** registered
>   (`tasks/scheduler.py:304,3764`) and calls `recalibrate_rpe` (`:3799`); the five
>   `video_*_trend` charts **are** in `CHART_REGISTRY` (`api/charts.py:112-127`);
>   `VideoProgressTab` **is** mounted (`app/(app)/lifting/videos/page.tsx:163`); injury-risk
>   alerts exist (`services/video_analytics.py` `flag_injury_risks`).
> - **`/notifications` page exists** (`frontend/src/app/(app)/notifications/page.tsx`).
> - **`EventForm` does send `target_tss`/`notes`** (`components/training/peaks/EventForm.tsx:81-114`).
> - **Migration 099 exists** (`099_add_training_plan_strength_progression.py`); head is **099**.
>
> Still genuinely open and re-verified: warmup-effectiveness (C1), cross-route climb geometry
> key (C2b), synced 3D route compare (C3), UndoLog HTTP surface, orphan-route quarantine
> **producer** (see `unused-features.md` C-1), and the `StrengthSuggestionsCard` data-loss bug.

---

## 1. Status Reconciliation

### 1.1 `plans/underdeveloped-features-2026-09-27.md`

| # | Item | Status | Code Verification |
|---|------|--------|-------------------|
| A1 | `StatsView` wired as Activities "Stats" tab | **Shipped** | `frontend/src/components/activities/StatsView.tsx`; `app/(app)/activities/page.tsx` |
| A2 | 5 unused UI primitives adopted | **Shipped** | `ErrorState`, `PageHeader`, `SectionLabel`, `Field`, `Stat` all now imported |
| A3 | `LiftVideo.exercise_variation` persisted | **Shipped** | Migration 082; `backend/app/integrations/pose_analysis.py` |
| A4 | Notification API extended | **Shipped** | `backend/app/api/notifications.py`; page at `app/(app)/notifications/page.tsx` |
| A5 | JSON export grew 24→30 collections | **Shipped** | `backend/app/services/data_export.py` |
| B1 | Form-based weakness detection | **Shipped** | `api/deficiency.py`, `services/deficiency.py` |
| B2 | Lifting TSS (bodyweight-normalised volume load) | **Shipped** | `backend/app/services/lifting.py:133` |
| B3 | Learned bar detector (YOLOv8n→ONNX) | **Shipped** | `integrations/bar_detection.py`; `config.py` `video_bar_detection_enabled=True` |
| B4 | Segment distance alignment | **Shipped** | `backend/app/services/segments.py` |
| B5 | `_mean()` zero-handling fixed | **Shipped** | `backend/app/services/segments.py` (`zero_is_dropout`) |
| C1 | Warmup-effectiveness analysis | **Not started** | Only `WarmupTemplate` CRUD; explicitly deferred |
| C2a | Segments leaderboard page | **Shipped** | `app/(app)/segments/page.tsx` |
| C2b | Cross-route geometry-key clustering | **Not started** | `/segments` groups by route; no start/end snap + bearing key |
| C3 | Synced 3D route compare | **Open** | `CompareRoutesModal` = two independent `Route3D`; activities compare has a shared clock |
| C4 | New integrations | **Not started** | `AGENTS.md` Planned |
| C5 | Live-Lift supersets / reordering | **Not started** | Needs a grouping model |
| C6 | `/today` morning brief | **POC only** | `app/(app)/today/page.tsx` — product go/no-go |

### 1.2 `plans/future-enhancements.md`

| Part | Themes | Status | Verified |
|------|--------|--------|----------|
| Part 5 | Perf/reliability | **Partly shipped** | 5.5 LLM context-builder query count **open**; 5.9 `openapi-typescript` codegen **open**. (5.1–5.4, 5.6–5.8 reported shipped.) |
| Part 6 | Ops/infra/CI | **Partly shipped** | Secret rotation **open** (BUG-045); Prometheus **Alertmanager rules** open (metrics/Prometheus/Grafana stack exists per backlog Phase 5) |
| Part 7 | Testing | **Partly shipped** | E2E mutation flows **open**; Playwright CI job exists (non-blocking) |
| Part 4 | Backend analytics | **Partly shipped** | 4.2 `services/events.py` extraction **open** |
| Others | Parts 0–3 | **Largely shipped** | incl. 3.5 Notifications page — **built** (contradicts the plan) |

### 1.3 `plans/backlog-2026-09-20.md`

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 0 (B-01…B-05, B-37) | **Shipped** | committed `72a4138` |
| Phase 1 (B-06…B-09) | **Shipped** | committed `72a4138` |
| Phase 2 (B-10…B-13) | **In progress** | B-10 dead-client fork decision, B-11 codegen, B-12 `events.py`, B-13 WeeklyTab props all open |
| Phase 3 (B-14…B-25) | **Mostly shipped** | B-15 correlation engine, B-17 prescriptions, B-18 AI overlays, B-21 post-race retrospective open; B-19 `/notifications` **built** |
| Phase 4 (B-26…B-31) | **Shipped** | committed `d9cef5c` — video trends, aggregate task, VideoProgressTab, injury alerts, RPE calibration all confirmed present |
| Phase 5 (B-32…B-36) | **Shipped** | GHCR param, Prometheus+Grafana, Playwright CI, E2E flows |

### 1.4 `plans/modal-inference-expansion.md`

| Phase | Feature | Status | Verification |
|-------|---------|--------|--------------|
| 1 | Foundation (Modal image, migrations 051/052/053, models) | **Shipped** | `integrations/modal_client.py`; `models/rpe_calibration.py`, `models/lift_video_analysis.py` |
| 2 | Form Analysis | **Shipped** | `integrations/pose_analysis.py` `score_*_form`; `VideoAnalysisPanel` + `FormScoreRing` |
| 3 | Velocity Tracking (VBT) | **Shipped** | `pose_analysis.py`; `mean_concentric_velocity`, `vbt_zone` columns |
| 4 | Rest Timing + Consistency | **Shipped** | `rest_periods_json`, `rest_cv`, `rep_consistency_score`, … |
| 5 | Setup Analysis + RPE Estimation | **Shipped** | `recalibrate_rpe()` (`services/video_analytics.py:238`) runs weekly via `aggregate_video_analyses_weekly` (`tasks/scheduler.py:3799`); read-time `calibrated_rpe_for()` |
| 6 | Trends + Intelligence | **Shipped** | weekly aggregation task registered (`scheduler.py:304,3764`); `video_*_trend` charts in `CHART_REGISTRY` (`api/charts.py:112-127`); `VideoProgressTab` mounted; `flag_injury_risks()` |
| 7 | Training Load Integration | **Partly shipped** | Lifting TSS + `combined_training_load` chart exist (`api/charts.py:131`); warmup-effectiveness open |

### 1.5 `plans/training-redesign-plan.md`

| Phase | Item | Status | Verification |
|-------|------|--------|--------------|
| Phase 0 | Shell + editor primitives | **Shipped** (`834208e` #258) | Backend `POST /days`, `DELETE /days/{id}`, `POST /days/{id}/swap` at `api/training_plans.py:485,508,524`; `ModeSwitch`, `PlanSpine`, `useTrainingShell` wired from `training/page.tsx` |
| Phase 1 | Plan mode (unified editor) | **Shipped** (`62494e6` #262, `1e8f336` #265) | `plan/DayEditor.tsx`, `plan/CreatePlanPanel.tsx`, `plan/UnplannedStrip.tsx`; `WorkoutPlanner`/`PlanBuilder` removed |
| Phase 2 | Review mode | **Shipped** (`5d0442a` #263) | `training/review/ConformityTrendCard.tsx`, `ConformitySummaryCard.tsx`, `ModeSwitch` modes |
| Phase 3 | Peaks mode + strip | **Shipped** (`5d0442a` #263) | `training/peaks/EventForm.tsx`, `EventResultPanel.tsx`, `LoadStrip.tsx` |
| Phase 4 | Mobile pass | **Shipped** (`1e8f336` #265) | compact spine + day-editor bottom sheet; `MissedDayPopover.tsx` |
| Follow-on C1–C6 | Block model, generation inputs, per-edit undo, … | **Not started** | Deferred; see §4 |

> `AGENTS.md` "Active Planning" still says the training overhaul is **"Nothing built yet"** — that
> is stale and should be corrected (cross-ref `unused-features.md` §D).

### 1.6 `plans/training-strength-programming.md`

| Phase | Item | Status | Verification |
|-------|------|--------|--------------|
| S1 | Progression engine + `rpe_to_pct` + `TrainingPlan.strength_progression` | **Shipped** (`9510f47` #267) | migration **099**; `services/lifting.py` `rpe_to_pct`; `tests/test_strength_progression.py` |
| S2 | Program matrix (primary) + day-editor suggestions | **Shipped** (`5f54f40` #268) | `components/training/plan/ProgramMatrix.tsx`; `plan/PrescriptionPanel.tsx`; suggest/apply/materialise client fns wired |
| S3 | Block tools (copy-week, batch-edit, deload) | **Not started** | — |
| S4 | Coaching aids (warm-up auto-fill, cues, clash lint) | **Not started** | — |

### 1.7 `plans/withings-integration.md`

| Phase | Status | Verification |
|-------|--------|--------------|
| 1 Backend foundation | **Shipped** | `integrations/withings_client.py`, `services/withings.py`, beat `sync-withings-data`; migration **060** (plan said 049) |
| 2 Frontend | **Shipped** | `WeightPanel.tsx`, `charts.body_composition_trend()`, settings entry, `ProviderBadge.tsx` |
| 3 Data quality | **Shipped** | range/schema validators; null handling |
| 4 Docs & config | **Shipped** | `.env.example`, CODEMAP |

Deferred: webhook/push sync, BP/HR, sleep data, multi-user scale recognition.

---

## 2. New Feature Proposals

> Items **12, 13, 14** below have **already shipped** (see §1.4) and are retained only for
> context — do not schedule them.

| # | Title | User Value | Build On | Scope | Risks | Why Now |
|---|-------|------------|----------|-------|-------|---------|
| 1 | **Multi-sport day model** (ride + lift, same date) | Single calendar truth; unified daily load | `TrainingPlanDay` JSONB, `Activity.sport_type`, `LiftingSession` | L | Model change ripples to conformity, generation, `/today`, export | Phase 1 is session-scoped so this stays additive |
| 2 | **Periodisation block labels** (Base/Build/Peak/Recovery on the load strip) | Macrocycle at a glance | `TrainingPlan.strength_progression`, `LoadStrip.tsx`, `periodization`/`ramp_rate` charts (`api/charts.py:86,88`) | M | Must not invent structure the model lacks (redesign §5.4) | Strip is deliberately honest today; blocks are the next layer |
| 3 | **Cross-route climb geometry key + global leaderboard** | "My PR on this climb across all routes" | `segments`/`segment_efforts`, `detect_climb_segments`, `/segments` page | M | GPS-noise-tolerant key; DBSCAN exists but no cross-route id | Underdeveloped C2b; leaderboard meaningless without identity |
| 4 | **Synced 3D route compare** (shared playback clock) | Side-by-side "same climb, two attempts" | `Route3D.tsx`, `CompareRoutesModal.tsx`, `Replay3D` controlled-playback API | S | Needs controlled-playback props on `Route3D` | Visible parity gap vs `CompareActivitiesModal` |
| 5 | **Withings webhook** (near-real-time) | Weigh-in → dashboard in seconds | Withings OAuth + 30-min polling task | S | Endpoint + HMAC + queue drain (Strava pattern); HTTPS callback | Removes "why isn't my weight showing" support asks |
| 6 | **Garmin Connect OAuth** | Largest remaining provider gap | `add-integration` skill pattern | L | OAuth scope complexity; FIT parsing; rate limits | User demand; pattern proven by Withings |
| 7 | **TrainingPeaks import** | Coached athletes: import plan → push to Wahoo | `TrainingPlan`, push-to-wahoo endpoint | M | TP API access; zone translation; FIT generation | Closes "plan in, workout out" |
| 8 | **Apple Health sync** | iPhone/Watch users without Whoop/Withings | `WeightLog`, `DailyMetric`, `Activity` | M | HealthKit needs user-initiated export or native app | Largest installed base |
| 9 | **Zwift import + workout push** | Indoor riders | `Activity` (virtual ride), push pattern | M | Limited public API; `.zwo` format | Indoor volume is high |
| 10 | **AI weekly narrative (Gemini)** | Monday "what happened this week" | `LlmAnalysis`, `services/llm_analysis.py`, `services/today.py` | S | Context builders do 15+ sequential queries (Part 5.5) | Natural presentation upgrade over 5-engine composite |
| 11 | **AI form-coaching chat (per video)** | "Why did my knees cave on rep 3?" | `LiftVideoAnalysis.form_analysis_json`, `form_coaching_cues`; `add-ai-analysis` pattern | M | Frames + context in prompt; latency/cost | Richest untapped context |
| 12 | ~~Injury-risk HealthAlerts from video form~~ | — | — | — | — | ✅ **Shipped** (`flag_injury_risks`) |
| 13 | ~~RPE auto-calibration weekly task~~ | — | — | — | — | ✅ **Shipped** (`recalibrate_rpe`) |
| 14 | ~~`video_*_trend` charts in registry~~ | — | — | — | — | ✅ **Shipped** (`charts.py:112-127`) |
| 15 | **Unified training-load dashboard** | One "how hard was this week" number across sports | `combined_training_load` chart, `estimate_lifting_tss`, `compute_training_load` | M | Lifting-TSS scaling vs cycling TSS | Chart exists; a dashboard makes it a first-class view |
| 16 | **Offline-first Live Lift** (full create/log/finish offline) | Train with no signal; sync on reconnect | `useLiveSession` `syncStatus`, pending queue | S | Cross-device conflict; offline id generation | PWA offline shell shipped; session *creation* still needs network |
| 17 | **Notification bundling** (digest + quiet hours) | Fewer interrupts | `PushSubscription`, `notify()`, per-type toggles | M | Preference complexity | Volume will grow; preserve signal-to-noise |
| 18 | **UndoLog HTTP surface** | "I merged the wrong routes — undo" | `services/undo.py` (no HTTP surface, no registered kind) | M | Don't impose 30-day expiry on working `RouteMergeLog` undo | Mechanism is ready |
| 19 | **`/today` verdict promotion** | Make the computed verdict a real feature | `services/today.py` (5 engines, `consensus[]`), `today/page.tsx` (POC) | S | Product go/no-go; cross-page coherence | Verdict is computed — needs UI commitment |
| 20 | **`openapi-typescript` codegen** | Eliminate client/API type drift | `/openapi.json`; `lib/api/*` | L | Needs dead-client cleanup (B-10) first; CI gate | `types/generated.ts` is currently **unimported and stale** |

**Scope key**: XS <0.5d · S ≤1d · M ≤3d · L ≤1w

---

## 3. Enhancements to Already-Shipped Features

| Area | Enhancement | Evidence | Effort | Value |
|------|-------------|----------|--------|-------|
| **Training (bug)** | **Fix `StrengthSuggestionsCard.handleApplyAll` data loss** — it PATCHes a **one-element** `planned_exercises` array once per exercise, and each PATCH replaces the whole array, so only the **last** exercise survives | `components/training/StrengthSuggestionsCard.tsx:44-70` | XS | **High — verified data-loss bug** |
| **Training** | `WeatherForecast.tsx` residual emoji remnants | `components/training/WeatherForecast.tsx` | XS | Low |
| **Segments** | Cross-route geometry key for a global climb leaderboard | `services/segments.py`; `integrations/segment_intelligence.py` | M | High |
| **Segments** | Use the `distance` stream for exact point alignment (already requested at sync; verify all consumers) | `services/segments.py` | S | Medium |
| **Science/cycling** | Decoupling should use **Normalized** Power per half, not mean power (see `science-review.md` S3) | `services/cycling/vo2max.py:433-441` | S | Medium |
| **Science/cycling** | Align `climb_category()` with Strava's score (see `science-review.md` S2) | `services/segments.py:143-155` | S | High |
| **Science/vo2max** | Surface `VO2_CLASS_SCOPE` (defined, never read) and recalibrate the bands (S1) | `services/cycling/vo2max.py:52-80` | S | High |
| **3D** | Synced playback in `CompareRoutesModal` | `components/routes/Route3D.tsx`; `Replay3D` API | S | Medium |
| **Export** | Confirm export coverage of newer tables (`UndoLog`, `PushSubscription`, `AthleteInsight`, `CrossDomainInsight`, `LlmAnalysis`) | `services/data_export.py` | S | Medium (GDPR) |
| **PWA** | Background sync for offline mutations | `public/sw.js` | M | High |
| **Live Lift** | Supersets / reordering (needs grouping model) | `plans/live-lift-reliability-audit-2026-09-20.md` | M | Medium |
| **Data integrity** | Wire the orphan-route quarantine **producer** (the `/orphans` review UI is inert) | `services/route_quarantine.py:258`; `api/routes.py` | S | **High** |
| **AI/LLM** | Per-user Gemini cap + in-flight dedupe (backlog B-06) | `services/llm_analysis.py` | S | High |
| **Auth** | Server-side OAuth `redirect_uri` (BUG-025) | `api/auth.py`; `settings/page.tsx` | M | High |
| **Auth** | Short-lived token / revocation (BUG-002-class) | `services/auth.py` | M | High |
| **DB** | `services/events.py` extraction (Part 4.2) | `api/events.py` | S | Medium |
| **Infra** | Secret rotation (BUG-045) | `.env` | Manual | **Critical** |
| **Infra** | Prometheus Alertmanager rules (5xx, sync failures, queue backlog) | `/metrics` | M | High |
| **Infra** | `openapi-typescript` codegen + dead-client cleanup | Part 5.9 / B-10 / B-11 | L | High |
| **Testing** | E2E mutation flows (live-lift, goal check-in, route tag, GPX round-trip) | Part 7 / B-35 | L | High |

---

## 4. Deliberate Non-Goals

| Item | Source | Recorded Reason |
|------|--------|-----------------|
| **CSV import** | `plans/2026-10-01-data-integrity-integration-plan.md` | Rejected: import produced load-invisible rides; dedup gaps; no rollback story |
| **Exercise → FK migration** | same | Rejected: string keys + `normaliseExerciseKey` work; FK adds migration cost for ~no runtime benefit |
| **UndoLog for `RouteMergeLog`** | same + AGENTS.md Wave 3 | Not migrated: would impose 30-day expiry on a working, tested undo |
| **UndoLog HTTP surface for `/today`** | AGENTS.md Wave 3/4 | Read-only composite — no undo needed |
| **Routes drag-drop tagging / keyboard shortcuts** | `backlog-2026-09-20.md` "Decided otherwise" | Chips + bulk tagging cover the UX |
| **Wahoo bulk (week) push** | `training-strength-programming.md` §12 | Deferred: per-day push sufficient |
| **Plan PDF export** | same | Deferred: pattern exists (`export/event-report`); not requested |
| **Cycle block progression** | `training-redesign-plan.md` §15 | Deferred: `duplicate week → range` covers the bulk case |
| **Multi-sport day** | both training plans | Deferred: **model change** — separate plan required |
| **Withings webhook / BP-HR / sleep / multi-user scale** | `plans/withings-integration.md` | Polling suffices; overlapping or separate scope |
| **Per-edit undo for field edits** | `training-redesign-plan.md` §11 C6 | Would flood `UndoLog` with keystrokes — structural ops only |
| **Invented periodisation labels** | `training-redesign-plan.md` §5.4 | Deliberately honest: strip shows only real data |
| **Destructive `PATCH /training-plans/{id}` `days` array** | `training-redesign-plan.md` §3.1 | Deprecated in schema; UI never sends it |
| **HTML5 DnD on touch** | `training-redesign-plan.md` §7 | Not supported: touch uses swap/date picker |
| **E2E guard for drag→swap** | Phase 1 deviations | HTML5 DnD flaky in Playwright |

---

## 5. Top 5 To Do Next

Ranked by **(value × confidence) / effort**, re-verified after the corrections above:

| Rank | Item | Rationale | First step |
|------|------|-----------|-----------|
| 1 | **Wire the orphan-route quarantine producer** | The `/orphans` review endpoints + `OrphanReviewSection` UI are fully built but nothing ever calls `quarantine_orphaned_routes`, so the queue is permanently empty — a shipped feature that is inert. S effort, high value. | Schedule `quarantine_orphaned_routes` (weekly beat task or CLI) in `tasks/scheduler.py`; add a test that a zero-activity route becomes quarantined |
| 2 | **Fix `StrengthSuggestionsCard.handleApplyAll` data loss** | Verified bug: applying "all" wipes every exercise but the last on each day. XS effort, high value. | Accumulate the full `planned_exercises` array per day and send **one** PATCH, or PATCH per exercise *merging* server-side |
| 3 | **Cross-route climb geometry key + global `/segments` leaderboard** | The page groups by route only; a cross-route PR is the feature's whole point (C2b). M effort. | Add a geometry key (start/end snap + bearing) and a `geo_cluster_id`; group the page by cluster |
| 4 | **Secret rotation, and the worker-metrics gap** | BUG-045 live secrets in `.env`. The HTTP alerts already exist (`infra/prometheus/alerts.yml` carries `BackendDown`, `High5xxRate`, `HighLatencyP95`), so the remaining observability gap is narrower than this row first claimed: the `fittrack_sync_*` counters are process-local and never reach the scraper. | Rotate the secrets; decide Pushgateway or Prometheus multiprocess mode before adding any sync alert |
| 5 | **`openapi-typescript` codegen + dead-client cleanup (B-10/B-11)** | `lib/api/types/generated.ts` is both stale **and entirely unimported** — the structural fix for type drift. L effort; unblocks the dead-client decision. | Decide the codegen gate, regenerate in a dedicated PR (no hand edits) |

### Honorable mentions

| Item | Why close |
|------|-----------|
| Synced 3D route compare (C3) | `Route3D` + `Replay3D` playback API exist; merge under one clock |
| `/today` verdict promotion | 5-engine composite already computed; needs UI commitment |
| Withings webhook | Polling works; pattern (Strava) established |
| Unified load dashboard | `combined_training_load` chart already registered |
| Science fixes S1–S3 | Small, high-visibility correctness wins (see `science-review.md`) |

---

**File**: `docs/review-2026-10-15/enhancements.md`
**HEAD**: `5f54f40a848b4c4524f19ce2dc90e6a94bcfe10d`
