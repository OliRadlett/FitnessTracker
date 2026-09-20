# FitTrack as a training aid — data-utility & coaching-value review

*Review date: 2026-09-18. Read-only audit (no code changed). Judges usefulness, not science correctness. Citations are repo-relative `path:line`.*

> **Implementation status (2026-09-20): the full backlog below is implemented** (uncommitted working tree; `git status` to review). QW1 bodyweight truth · QW2 dead charts surfaced + decoupling/W-kg fixes · QW3 one-tap adaptive apply on Today · QW4 `tss_source` column (migration 062) + badges · QW5 LLM/weather grounding fixes · QW6 goals on Today + goal-aware adaptive · QW7 alert hygiene (prefs for all types, dismiss quiet-period, `/health` links) · FL1 target refresh + stale flags + personalized taus in adaptive · FL2 reschedule/substitute/unplanned + weekly review job + `plan_review` notification · FL3 %e1RM prescription + RPE prefill rule · CD1 cross-sport fatigue votes · CD2 strength readiness modulation · CD3 race-retrospective wiring · RM1 planner write-back · RM2 history endpoint removed + prompt dedup + grounding chips. Known pre-existing, untouched: `test_scheduler_tasks.py` Redis-guard failures (needs live Redis, not unit-safe); integration teardown `DROP TABLE` noise on dirty test DBs (reset `fittrack_test` schema if seen).

*Role lens: senior endurance + strength coach (powerlifting and cycling), sports data scientist, product analyst. Criterion: does it change what the athlete does next for the better?*

---

## 1. Executive summary

FitTrack is a **strong measurement-and-reporting product and a partial training aid**. The collect→compute→display half is genuinely good (TSS/CTL/ATL/TSB, conformity, adaptive advice, event prep PDF). The **compute→adapt half is largely open**: the training plan is a static template that ignores almost every physiological input, and the one engine that can change a session (adaptive advice) is buried two navigations deep and scales stale stored targets.

**Three highest-leverage gaps:**

1. **The plan loop is open.** Plans are generic (`training_plan.py:273-309`), FTP/1RM never propagate (`training_plan.py:466-486`), missed sessions are never rescheduled, and nothing runs a weekly review that mutates next week. Conformity is measured but not acted on (`conformity.py:866-870`).
2. **Insights stop at "interesting," and the actionable ones are mistimed.** Readiness is a gauge (`metrics.py:35-73`), health alerts notify to a page that only shows an unclickable count (`health_analysis.py:801`), and the only one-tap engine lives in Training→plan→This Week. Alert fatigue is high (9 types daily, dismissal re-fires, snooze on only 3).
3. **Domains stay siloed and cross-domain output is inert.** Lifting load never affects cycling readiness, sleep/recovery never affects lifting targets, bodyweight has two competing sources (`withings.py` writes only `WeightLog`; `deficiency.py:383-395` reads `CyclingProfile.weight_kg`), and the cross-domain engine's numeric results are stored but not surfaced — with race retrospective never computed at all (`scheduler.py:1811-1817`).

There is also a meaningful "wasted potential" layer: ~a dozen computed assets have no surface (dead charts, `stats_json`, segment predictions, body composition), and several numbers are misleading as presented (unlabeled hrTSS, always-empty weather cards, a CTL/ATL/TSB-less LLM analysis prompted to judge CTL/ATL/TSB).

The fix is not more data collection — it is **closing loops on data already present**. All proposals below reuse existing integrations.

---

## 2. Issue table

| # | Finding | Evidence | Category | Severity |
|---|---------|----------|----------|----------|
| 1 | Plan generation is a static week template; ignores FTP, 1RM, CTL/ATL/TSB, recovery, bodyweight, goals. Only personalization is a recent-average lifting volume heuristic. | `training_plan.py:273-309`, `:651-673`, `:676-727`; `PlanBuilder.tsx:389-404` | open-loop | coaching-harm |
| 2 | Conformity is measure-only. Missed sessions are never rescheduled/dropped/substituted; unplanned sessions on rest days are invisible (iteration is over `plan.days` only). | `conformity.py:866-870`; `training_plan.py:1028-1038`; no reschedule endpoint | open-loop | coaching-harm |
| 3 | No automatic weekly review mutates next week. Adaptive/conformity are on-demand HTTP GETs only; no Celery task writes plan changes. | `training_plans.py:235-238`; no scheduler writer for adaptive | open-loop | coaching-harm |
| 4 | Adaptive advice scales **stored** targets (×0.85/×1.08) with no live FTP/1RM/weight lookup. | `adaptive.py:384-440`, `:492-528` | open-loop | wasted-potential |
| 5 | FTP changes never propagate to existing plan days — cycle targets are filled once (when `planned_tss`/`power` are null) then freeze. | `training_plan.py:466-486`; `cycling/__init__.py:36-72` (writes profile only) | open-loop | coaching-harm |
| 6 | 1RM never reaches strength prescriptions. Templates ship `weight_kg=None`; no `PersonalRecord` reference in plan/planner services. | `training_plan.py:119-120`; `workout_planner.py` (no PR import) | open-loop | coaching-harm |
| 7 | RPE is captured but never changes the next session's load — no autoregulation; prefill uses only last weight/reps. | `LiveWorkout.tsx:189-207`; `reference.ts:41-87`; `adaptive.py:403-408` | open-loop | coaching-harm |
| 8 | Standalone Workout Planner computes personalized watts/HR/TSS but has no write-back to plan/calendar; user must re-enter values. | `WorkoutPlanner.tsx` (no plan mutation); math reused at `training_plan.py:462-486` | open-loop | wasted-potential |
| 9 | Goals are absent from the Today tab and have zero influence on plan generation, taper, or adaptive advice; only the weekly Gemini text consumes them. | `dashboard/page.tsx:320`; `adaptive.py:575-587`; `training_plan.py:273-309` | open-loop / siloed | wasted-potential |
| 10 | Goal projections and the metric-trend endpoint are display-only; badge never triggers a plan change; `/projections/metric` has no frontend caller. | `api/projections.py:45-71`; `ProjectionCard.tsx:36-99`; `lib/api/projections.ts:11` | unactionable / dead-data | wasted-potential |
| 11 | Race retrospective is never produced: the weekly cross-domain task omits `race_data`/`pre_race_data`, so `race_retrospective` is always None. Race group in the UI is permanently empty. | `scheduler.py:1811-1817`; `cross_domain.py:650-672`; `WeeklyTab.tsx:509` | dead-data / open-loop | wasted-potential |
| 12 | Event result is stored but disconnected from analysis/plan/taper; only shown as a badge and inside the event LLM prompt. | `models/event.py:33`; `EventResultPanel.tsx:20-42`; `llm_analysis.py:2336-2343` | siloed | wasted-potential |
| 13 | Taper is a fixed positional 100%→40% ramp; ignores CTL/TSB, `event.target_tss`, intensity, and fitness drift after linking. | `training_plan.py:517-528`; `models/event.py:28` | uninterpretable / open-loop | wasted-potential |
| 14 | Readiness is a gauge with no session action; the only actionable control (adaptive) is in Training→plan→This Week. | `metrics.py:35-73`; `ReadinessIndicator`; `adaptive.py:608-621`; `WeeklyView.tsx:466-467` | unactionable / mistimed | coaching-harm |
| 15 | Health-alert notifications deep-link to `/dashboard`, whose alert widget is an unclickable count; the real list lives on `/health`. | `health_analysis.py:801`; `TodayTab.tsx:218-225` | mistimed | coaching-harm |
| 16 | Alert fatigue: 9 types, daily run, push default-on; **dismissing an ongoing alert causes a new alert + push the next day**; snooze exists for only 3 of 9 types. | `health_analysis.py:811-821`, `:778-804`; `scheduler.py:134`; `metrics.py:520-523` | redundant / mistimed | coaching-harm |
| 17 | Stale recovery is presented as "today": latest metric with no date bound; the API returns `date` but no UI renders it. | `today.py:156-165`; `__init__.py:109-127`; `metrics.py:44-53,72` | mistimed | coaching-harm |
| 18 | No auto-refresh on an open dashboard despite 30-min sync; backend chart cache 300 s + frontend staleTime stack to ~10 min. | no `refetchInterval` in `dashboard/**`; `api/charts.py:22-29` | mistimed | wasted-potential |
| 19 | Lifting load has zero influence on cycling readiness/prescription; sleep/recovery has zero influence on lifting targets. | `workout_planner.py:127-185`; `lifting.py:1-29` (no SleepLog/`DailyMetric`) | siloed | coaching-harm |
| 20 | Bodyweight source-of-truth is broken/inconsistent: Withings writes `WeightLog` only (never `CyclingProfile`), while strength standards and W/kg read `CyclingProfile.weight_kg`; some goal resolvers use `WeightLog`. Auto weigh-ins silently don't update W/kg. | `withings.py` (no `CyclingProfile` ref); `deficiency.py:383-395`; `goal_metrics.py:55-67,241-244`; `vo2max.py:89-91` | siloed / misleading | coaching-harm |
| 21 | Body composition (fat %, muscle, visceral fat) is displayed but never fed to any model, LLM, or strength-standard logic. | `WeightPanel.tsx:251-257`; `body_composition_trend` | dead-data | wasted-potential |
| 22 | Fitted `ctl_tau`/`atl_tau` are displayed as "personalized" but `compute_training_load` hardcodes 42/7. | `training_load.py:14-15,48-49`; `PowerModelSection.tsx:107-119` | dead-data / misleading | wasted-potential |
| 23 | Cadence is collected but has no derived metric, target, or drift analysis. | `strava_client.py:127`; only raw in `ActivityCard.tsx:142`, `Replay3D.tsx` | dead-data | wasted-potential |
| 24 | hrTSS vs power-TSS is indistinguishable in the UI (both land in `Activity.tss`; no source surfaced). | `tss.py:13,33,139`; `ActivityContextBadges.tsx:22-38` | uninterpretable | wasted-potential |
| 25 | Weekly cycling LLM analysis **never receives CTL/ATL/TSB**: `compile_cycling_stats` references an undefined `tss_fetch_start`, the `NameError` is swallowed, yet the prompt explicitly asks the model to judge CTL/ATL/TSB. Ungrounded/hallucination-prone. | `llm_analysis.py:55`, `:71-76`, `:609-612` (verified) | redundant / misleading | coaching-harm |
| 26 | Event LLM weather is always empty: context reads a `daily`/`temperature_2m_max` shape the cache never writes (`days`/`temp_max`), plus float-equality lat/lng lookup against 2-dp stored rows. | `llm_analysis.py:2287-2313`; `weather.py:336-366` | ungrounded | wasted-potential |
| 27 | Weather-performance UI cards are empty: scheduler stores only the nested coefficients object, but the API reads the full result shape (`wc.get("power_vs_temp")`, `wc.get("weather_coefficients")`). | `scheduler.py:1456-1458`; `weather_analysis.py:459-463`; `power.py:959-1014` | dead-data / misleading | wasted-potential |
| 28 | Five Gemini analyses overlap heavily with deterministic features; no cross-links; `LlmAnalysis.stats_json` and `/llm-analysis/history` are never rendered. | `llm_analysis.py` prompt sections; `schemas/llm_analysis.py:18`; `api/llm_analysis.py:56` | redundant | wasted-potential |
| 29 | Computed but never-rendered charts: `estimated_1rm_history`, `weekly_volume` (carries an injury-risk insight), `recovery_vs_performance`, `whoop_strain_trend`, `sleep_quality_trend`. | registry `charts.py`; no frontend references (grep) | dead-data | wasted-potential |
| 30 | Misleading-as-shown: power-curve table W/kg column hard-coded `—`; `RideAnalysisCard` decoupling uses 3/5 thresholds (backend 5/8) with an unreachable red band; PowerModel shows "Data Points: 0"; weather/cross-domain Modal jobs read a non-existent `Activity.decoupling_pct`. | `PowerCurveTable.tsx:30`; `RideAnalysisCard.tsx:12-16,161-171`; `PowerModelSection.tsx:78`; `scheduler.py:1418,1774` | uninterpretable / polish | polish (some misleading) |
| 31 | Other dead endpoints/clients: `/dashboard/weekly-report` (no consumer), `/cycling/suggested-cycle` (7-day readiness plan, no UI), manual cycling PR/FTP-history client fns never called, `StatsView.tsx` dead. | `weekly.py:47`; `power.py:515`; `lib/api/cycling.ts:27,74`; CODEMAP `StatsView` note | dead-data | polish |

---

## 3. Opportunity backlog

Ranked by value/effort. Effort: S (≤1 day), M (2–4 days), L (1–2 weeks). "Value" = likelihood it changes what the athlete does next.

| Rank | ID | Proposal | Problem it solves | Data available | Data needed | UI shape | Effort | Training value |
|------|----|-----------|-------------------|----------------|-------------|----------|--------|----------------|
| 1 | **QW1** | **Bodyweight single source of truth.** On Withings sync, update `CyclingProfile.weight_kg` (or make all consumers read `WeightLog` latest). | W/kg, strength standards, BW-ratio goals silently stale after auto weigh-ins; two different bodyweights coexist. | `WeightLog`, `CyclingProfile` | none | No new UI; values simply become correct | S | High — every W/kg and relative-strength number becomes trustworthy |
| 2 | **QW2** | **Surface already-computed assets + fix misleading numbers.** Render `weekly_volume` (with injury-risk insight), `recovery_vs_performance`, `estimated_1rm_history`, `sleep_quality_trend`; fix power-curve W/kg column and `RideAnalysisCard` decoupling thresholds. | Correct analytics exist but are invisible; some shown numbers contradict the backend. | All backend-computed | none | 3–4 existing chart cards added to `/lifting`/`/health`; small fixes | S | Medium–High — fills real gaps in weekly review |
| 3 | **QW3** | **Point-of-decision action on Today.** Attach the adaptive `rest`/`intensity_cut` action to the readiness gauge / RestDayBanner as a one-tap "Apply to today" (reuse `derive_adaptive_advice` + `updatePlanDay`). | Readiness is shown exactly when the athlete decides, but the control is two navigations away and operates on upcoming days. | TSB, recovery, plan, adaptive actions | none | Button on `ReadinessIndicator`/`RestDayBanner` | S | High — first time readiness actually changes a session |
| 4 | **FL1** | **Load-coherence propagation.** When FTP/1RM/weight change, mark plan targets stale and offer "Refresh targets" (FTP→cycle W/TSS; 1RM→strength %). Personalize zones from fitted CP and adaptive τ. | Targets freeze at fill time; personalized constants are displayed but unused. | `FtpHistory`, `PersonalRecord`, `CyclingProfile`, `power_model` | none | "Stale targets" badge in PlanBuilder/WeeklyView + refresh button | M | High — closes FTP/1RM→plan |
| 5 | **CD1** | **Cross-domain fatigue interference.** Feed prior-day lifting volume/RPE into cycling readiness, and prior hard cycling TSS into lifting readiness/adaptive scaling. | Domains are siloed; a heavy squat day is invisible to tomorrow's ride and vice versa. | `LiftingSession`, `Activity.tss`, `DailyMetric`, CTL/ATL | none (add a combined load series; lifting "stress" mapping is an approximation to label clearly) | Readiness card shows "Legs: lifting load high" and adaptive scales the right sport | M | High — the app's stated edge, currently absent |
| 6 | **FL2** | **Scheduled weekly review + missed-session reconciliation.** Weekly task computes adaptive suggestions and writes a dashboard "Week ahead" card; missed days offer reschedule / drop / substitute; unplanned sessions surfaced as `extra`. | Conformity and adaptive are pull-only; nothing adjusts next week automatically. | conformity, adaptive, plan | small scheduler job + reschedule endpoint | Card on Today/Weekly with accept-all; per-day actions | M | High — closes measure→adapt |
| 7 | **CD2** | **Recovery→strength autoregulation.** Use recovery/HRV/sleep (and RPE trend) to modify today's strength target volume/RPE, not just cycling. | Sleep/recovery never touches lifting prescriptions. | `DailyMetric`, `LiftingSession` RPE | none | Badge on today's strength plan day + optional auto-scale | M | High for a powerlifter |
| 8 | **FL3** | **e1RM/RPE autoregulation.** Strength plan days carry %e1RM or RPE targets derived from current PRs; live prefill adjusts from last session's RPE (e.g. RPE <6 → +2.5%). | Prescriptions are hand-entered absolute kg with no progressive logic. | `PersonalRecord`, `LiftingSession`, `LiftingSet.rpe` | none | PlanBuilder target helper + live prefill | M | High |
| 9 | **CD3/FL4** | **Race retrospective closure.** Pass `Event.result` + pre-race TSB/plan/conformity to `analyze_race_retrospective`; store and surface a "what to change next block" retrospective; feed the result into the next plan's base load. | Race result is a dead-end badge; the retrospective capability exists but is never called. | `Event`, TSB projection, activity result | wire task args | Retro card on event detail + next-plan seeding | M | Medium–High — the only end-of-cycle learning loop |
| 10 | **QW4** | **TSS provenance + lifting load.** Label power-TSS vs hrTSS on every surface; add a transparent lifting stress contribution to the combined load view. | Load numbers are not comparable when HR-TSS substitutes silently. | `Activity` fields | a documented lifting-stress scale | Small badges/legend | S–M | Medium |
| 11 | **QW5** | **LLM grounding + de-duplication.** Fix the `tss_fetch_start` bug, weather-context shape mismatch, and weather-analysis store/read mismatch; drop sections that merely restate deterministic output; surface `stats_json`. | Expensive outputs are partly hallucinated and redundant with charts/alerts. | Existing contexts | bug fixes | Analysis card shows "based on" data summary | M | Medium — restores trust in AI output |
| 12 | **RM1** | **Merge Workout Planner into PlanBuilder/WeeklyView** (give it write-back, remove the standalone section). | A correct personalization engine that can't commit anything. | planner math already reused | none | Single plan-editing surface | S–M | Medium |
| 13 | **RM2** | **Consolidate AI analyses** to one weekly brief + on-demand per-session analyses; retire duplicate weekly health/event sections and the dead history endpoint. | 5 overlapping Gemini calls; alert/health advice duplicated. | — | none | Fewer cards, one brief | M | Medium (cost/clarity) |
| 14 | **QW6** | **Goals on Today + goal-aware adaptive.** Show top goal on Today; let an `ftp_watts`/`weekly_tss`/`1RM` goal bias the weekly review (e.g. raise volume if off-pace). | Goals live on a separate page and don't steer training. | goals, projections | none | Today strip + adaptive input | S–M | Medium |
| 15 | **QW7** | **Alert hygiene.** Deep-link alerts to `/health`, stop re-firing on dismissal (snooze/acknowledge), extend snooze to all types, cap pushes. | High alert fatigue; alerts point to the wrong page. | — | none | Default-link fix + snooze on all types | S | Medium — protects the signal |

**Required categories covered**
- **Quick wins (S, visible within a week):** QW1 bodyweight truth, QW2 surface computed charts + fix misleading numbers, QW3 readiness action on Today.
- **Cross-domain (3):** CD1 lifting↔cycling↔recovery fatigue interference, CD2 recovery→strength autoregulation, CD3 race retrospective/event↔analysis.
- **Feedback-loop closures (3):** FL1 FTP/1RM/weight→plan propagation, FL2 scheduled weekly review + missed-session reconciliation, FL3 e1RM/RPE autoregulation.
- **Removals/merges (2):** RM1 merge Workout Planner into the plan editor; RM2 consolidate the 5 Gemini analyses (plus retire dead endpoints/components: `/dashboard/weekly-report`, `/cycling/suggested-cycle`, `StatsView`, dead cycling clients).

---

## 4. New-feature specs (top 3)

### NF1 — Closed-loop weekly coach (plan → execute → adapt)

**Problem (job-to-be-done).** After a training week, the athlete wants the app to answer "what changes next week?" — and when a session is missed, "does it roll over or get dropped?" Today they get a compliance percentage and a hidden pull-only suggestion, then must manually re-plan.

**Proposed behavior.**
- A scheduler task `weekly_plan_review` runs Monday (after the weekly check-in task) and calls `generate_adaptive_suggestions` for the active plan, persisting a review snapshot (CTL/ATL/TSB, conformity %, patterns, missed days, goal trajectory, cross-domain flags).
- Surfaces a **"Week ahead"** card on the Today tab and a notification deep-link: recommended stance per sport, next-week proposed adjustments, and **one-tap accept-all** that applies day PATCHes.
- **Missed-session handling:** each missed day gets `reschedule` (move to the next training day), `drop`, or `substitute` (e.g. missed threshold → sweet-spot equivalent). No more silent "missed."
- **Goal-aware:** if a `weekly_tss`/`ftp_watts`/`1rm` goal is off-pace (projection badge At Risk/Unlikely), the review proposes a load or volume change rather than only reporting.
- **Propagation:** accepts FTP/1RM/weight into targets before the review (see NF3), so advice is computed against current physiology.

**Edge cases.**
- *No plan / no data:* card hidden; dashboard falls back to current behavior.
- *Single-sport week:* only the present sport's axes; never invent lifting advice from cycling data.
- *Travel/illness gap:* detect ≥5-day activity gap; suppress "missed" shaming, offer a re-entry week; health alerts gate all raise votes (`adaptive.py:297-320`).
- *Conformity < data threshold:* show "not enough logged sessions to advise" rather than a false verdict.

**Data flow.** `conformity.py` + `adaptive.py` + `projections.py` + `health_analysis.py` + new snapshot table/task; writes via `update_plan_day` (`training_plan.py`). New endpoint `GET /training-plans/{id}/review`.

**Success measured.** Goal = athlete applies ≥1 review action in a week; proxy = % of drifted plan days corrected within 7 days, and reduction in "missed, never addressed" days. Baseline: currently 0 automatic writes and no reschedule path.

---

### NF2 — "Coach's Call": one action at the point of decision

**Problem.** The athlete opens the dashboard in the morning and sees a readiness gauge, a rest-day banner, a planned workout, and (on another tab) alerts — none of which tell them what to change *today*, even though an engine exists that could.

**Proposed behavior.**
- New `GET /dashboard/coach-call` composes: latest recovery **with its date and staleness**, TSB/ramp, today's planned session (from the active plan), yesterday's load (lifting + cycling), active alerts, and the adaptive stance → returns a single ranked recommendation with 0–2 buttons ("Reduce today 15%", "Make today rest", "Proceed as planned").
- Renders at the top of Today, replacing the passive readiness strip + RestDayBanner duplication.
- Actions reuse `adaptive._actions_for` + `updatePlanDay` so behavior is consistent with the Training page.
- Alert notifications deep-link here (fixes the `/dashboard` misroute).

**Edge cases.**
- *No Whoop data:* fall back to TSB-only; show "recovery unavailable" rather than treating yesterday's score as today's (fixes issue #17).
- *No plan:* recommendation is prose only ("easy aerobic") with a link to create a plan.
- *Two-a-day / session already done:* if today's activity is logged, switch to a post-session note.
- *Conflicting signals* (fresh TSB but poor sleep): explain the conflict and default to the conservative action.

**Data flow.** `today.py` + `metrics.py:readiness` + `adaptive.py` + `health_analysis.py` + `training_plan.get_plan_week`; write path `update_plan_day`.

**Success measured.** Buttons pressed per week; reduced variance between planned and actual on high-fatigue days; reduction in same-day manual plan edits in PlanBuilder. Current baseline: zero actions on the dashboard.

---

### NF3 — Strength autoregulation & load coherence

**Problem.** Strength prescriptions are hand-entered absolute kilograms, RPE never feeds back, and FTP/1RM/bodyweight changes never reach targets. The powerlifter gets good *reporting* (e1RM, PRs, standards) but no *progression logic*.

**Proposed behavior.**
- **Prescription helper:** plan-day strength editor offers %e1RM targets computed from the current PR (`brzycki_1rm` reverse-solved) or an RPE target; saving stores both the derived kg and the `%e1RM`/RPE basis.
- **Autoregulation:** live-lift prefill uses last session's RPE + reps (not just last weight) to suggest the next load; a persistent "today's recovery" modifier applies an optional ±5% when recovery is low/high.
- **Load coherence:** a single `get_athlete_load_basis()` returns current FTP, e1RM per Big-3, and one canonical bodyweight; zone targets, W/kg, strength standards, and BW-ratio goals all read it. A "stale targets" badge appears when the basis moved since a plan day was set, with a one-click refresh.
- **Bodyweight truth:** Withings sync updates the canonical basis (or all consumers read latest `WeightLog`), eliminating the `CyclingProfile` vs `WeightLog` divergence.

**Edge cases.**
- *No PR for a lift:* fall back to last-session best set; if neither, keep manual entry.
- *Reps > 12:* e1RM unreliable (`MAX_REPS_FOR_1RM_PR=12`, `lifting.py:36`) — show "enter a heavy single/triple for an accurate 1RM."
- *Deload week:* suppress ±% suggestions and show a flat target.
- *Bodyweight missing:* W/kg features already fall back to 75 kg (`vo2max.py:288`) — surface that fallback visibly instead of silently.
- *New lift / name alias:* rely on existing exercise normalisation.

**Data flow.** `lifting.py` (`, `_check_and_record_pr`, `brzycki_1rm`), `reference.ts`, `training_plan.py`, `workout_planner.compute_workout_zones`, `goal_metrics.py`, `deficiency.py`, `withings.py`.

**Success measured.** % of strength plan days with a non-null load basis; next-session load adjustments after high/low RPE; reduction in manual kg edits; W/kg and strength-standard drift eliminated after weigh-ins.

---

## 5. What NOT to build

- **Running / triathlon / pace-zone features.** Explicitly out of scope; the existing "Pace Zones for Running" skip is correct.
- **Social, leaderboards, kudos, segment leaderboards vs other athletes.** Single athlete; adds noise and infra. Segments stay leaderboard-of-self.
- **New paid APIs or devices** (Garmin Connect, TrainingPeaks, force plates, Moxy). The app's edge is utilising existing Strava/Wahoo/Komoot/Whoop/Withings data; nothing here needs more inputs.
- **A general-purpose AI chatbot coach.** Given the existing grounding bugs (#25–27), a chat surface would amplify ungrounded claims and cost. Fix grounding and keep AI as a weekly/per-session brief.
- **Population-ML deload/injury prediction beyond the existing EWMA/TSB rules.** One athlete yields too few samples; the rules-based signals are appropriate.
- **Gamification beyond streaks (badges, points, challenges).** Doesn't change training and risks incentivising junk volume.
- **A full nutrition/calorie tracker.** Only ride-fuelling is in scope; no food API is integrated and it would distract from the lifting/cycling/recovery loops.
- **Duplicate strength-ratio models.** Do not build a new ratio engine; merge `charts.strength_balance` (`charts.py:2099`) and `deficiency.py` into one source to avoid contradictory advice (they currently use different baselines).
- **A second readiness score on top of Whoop's.** Compose (TSB + recovery + lifting load) rather than re-derive a competing black box the athlete will distrust.

---

## Appendix — condensed data-surface trace

| Asset | Has a surface? | Surface(s) | Note |
|---|---|---|---|
| Power streams | ✅ | power curve, W/kg, percentile, per-ride analysis, 3D replay, LLM | W/kg table column dead (`PowerCurveTable.tsx:30`) |
| HR streams | ✅ | HR zones, power-vs-HR, EF, decoupling, replay | EF uninterpreted |
| Cadence | ⚠️ raw only | ActivityCard, replay HUD | No derived metric — dead data |
| TSS series | ✅ | daily/weekly charts, KPI, PDF, LLM | hrTSS vs power-TSS unlabeled |
| CTL/ATL/TSB | ✅ | cards, charts, adaptive, event PDF, LLM | weekly LLM context broken (`llm_analysis.py:55`) |
| FTP history | ✅ | FTP section, chart, goal trend | no propagation to plan |
| VO2max | ✅ | section, trend chart, power model, deficiency | — |
| Decoupling | ✅ | section, trend, badges, deficiency, weather | ride-card thresholds wrong; not fed to Modal jobs |
| Power curve/PRs | ✅ | curve, lifetime PBs, notifications | manual-entry client dead |
| Power model CP/W′/τ | ✅ display | power model section, chart overlay | fitted τ unused; "Data Points: 0" |
| Weather-performance | ⚠️ empty cards | `/cycling` | store/read shape mismatch (#27) |
| Segments | ✅ | routes Segments tab, 3D overlays, LLM | predictions/cluster fields unsurfaced |
| Lifting sets/volume | ✅ | lifting, dashboard, PDF, LLM, injury alert | — |
| e1RM/PRs | ✅ display | PR cards, progress chart, goals, PDF | never prescribed back |
| RPE | ✅ input/retro | live, analysis, conformity, LLM | no autoregulation |
| Push/pull & Big-3 ratios | ✅ text | DeficiencyCard, LLM | no dose, no apply; duplicate ratio model |
| Recovery/HRV/RHR/RR/sleep | ✅ | dashboard, health, charts, alerts | sleep efficiency & recovery-vs-perf unrendered |
| Bodyweight | ⚠️ split source | WeightPanel, W/kg, standards | two sources disagree (#20) |
| Body composition | ⚠️ display only | WeightPanel, chart | never fed to models (#21) |
| Route geography | ✅ | routes map/3D/quality/effort/weather | similarity/effort predictions computed but not stored |
| Plan days | ✅ | training, weekly, PDF | generation generic; no propagation |
| Goal check-ins | ✅ | goals page, chart, projections | not on Today, not training-driving |
| Event dates/results | ✅ | training page, event PDF, LLM | result disconnected; retrospective dead |
| Cross-domain results | ⚠️ stored | WeeklyTab card | numeric `results` unsurfaced; race retro dead |
| LLM `stats_json`/history | ❌ | — | dead data |
