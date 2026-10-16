# Strength Session Labels — Utilisation Plan

> **Status**: Design plan — no code yet. Companion to
> [`plans/jev-strength-session-classification.md`](jev-strength-session-classification.md)
> (which covers how `session_split` / `session_lift` / `session_class` are **produced**).
> This doc covers what those three labels are **for**: the deterministic consumers, charts,
> insights and recommendations built on them.
>
> **Question this doc answers**: *"We added primary lift (`session_lift`) and training intent
> (`session_class`) — what do we actually do with them?"*
>
> Line references are against `main` at time of writing; verify before editing.

---

## 0. The three labels, and the two asks

The classification plan produces three typed labels per session, plus a provenance blob
(`ai_classification`). `session_split` (push/pull/legs/upper/lower/full_body) was the original
ask and has an obvious home. This doc focuses on the two **added** axes:

| Label | Values | The question it lets us answer |
|---|---|---|
| `session_lift` | `squat`·`bench`·`deadlift`·`overhead_press`·`accessory`·`none` | "Am I actually training each competition lift enough?" |
| `session_class` | `max_strength`·`volume_hypertrophy`·`speed_power`·`technique`·`accessory_conditioning`·`deload`·`test` | "Is my training *quality* balanced — or am I all intensity and no technique, or never deloading?" |

Both are **semantic labels over structured data the app already had but never interpreted**. The
utilisation work is therefore *not* new data collection — it is wiring the labels into logic that
today guesses from free-text exercise names or sees nothing at all.

---

## 1. Design principles (apply to every consumer)

1. **Deterministic logic owns the numbers; the label only *groups* or *escalates*.** Intensity,
   tonnage, %e1RM, TSS stay computed in `services/lifting.py` / `charts.py`. A label selects rows
   or nudges a gate — it never becomes a number or a verdict on its own.
2. **A label may escalate an already-nonzero deterministic signal, never create one.** Same
   contract `pain_injury` already follows (`health_analysis.py`). This is what stops "intent =
   max_strength" from inventing a fatigue alert.
3. **Degrade open, per component.** Every consumer must behave exactly as today when labels are
   NULL (Jev unset) or partial. No 500s, no silent empties (quality charter R1/R2).
4. **Honour provenance.** `source="rule"` labels are weaker than `source="jev"`. Only
   `source="jev"` at confidence ≥ threshold may raise a *notification* (§3.6).
5. **Review vs Act** (`docs/review-vs-act.md`): distribution/coaching viz belongs on review
   surfaces (tabs/zones), never on the action layer.
6. **Additive, never retroactive-mutating.** Labels do not rewrite `focus`, PRs, TSS or history.
   A taxonomy bump re-tags forward, marked by `taxonomy_version`.

---

## 2. What the two labels replace or sharpen (the "why")

| Today | With the label | Consumer |
|---|---|---|
| `deficiency.classify_push_pull()` — keyword match on exercise names, conservative, returns `None` on ambiguity | Session-level split + lift give a clean grouping; a *whole session* is unambiguously a pull day even when individual names are ambiguous | §3.2 |
| `rep_range_distribution` / `volume_intensity_periodization` group by **exercise name** (`"Low Bar Squat"` ≠ `"Back Squat"` ≠ `"SSB"`) | `session_lift` rolls messy names up under one lift | §3.3 |
| Nothing knows how *often* each competition lift is trained | `session_lift` gives per-lift frequency + recency | §3.1 |
| Nothing knows a session's *quality*; tonnage/`%1RM` imply it but cannot tell 5×5-as-strength from 5×5-as-volume | `session_class` names the intent | §4.1–§4.5 |
| No mesocycle model — the app cannot say "you're mid-block" | Intent *sequence* reconstructs phases | §4.2 |

---

## 3. Primary lift (`session_lift`) utilisation

### 3.1 Lift coverage — "am I squatting enough?"
New `services/lift_stats.py` (or an addition to `services/analytics.py`):
over a window (~8 weeks), per big-3 lift: **session count**, **tonnage**, and **days since last
trained**. Completes what `deficiency.evaluate_big3_ratios` starts — that scores strength *level*
(ratio to bodyweight); this scores *exposure* (frequency). A lift can be strong and undertrained,
or weak and over-scored.
- **Surface**: a "Lift coverage" panel on the lifting page + chart `lift_frequency`
  (sessions/week per lift, small multiples). Flag: "squat not trained in 18 days".
- **Risk**: none (read-only).

### 3.2 Push/pull balance, promoted to session level
`deficiency.evaluate_push_pull_ratio(push_volume, pull_volume)` already emits *"no pulling volume
logged in the window — pulling pattern absent, elevated shoulder injury risk"* (severity high).
Today that depends on `classify_push_pull` keyword hits per exercise. Feed it a **session-level
coverage count** from `session_split`/`session_lift` alongside the volume ratio:
- Add a `push_pull_session_coverage` signal: "0 pull sessions in 14 days" vs "push sessions 4:1".
- **Gate**: this is an existing deterministically-computed deficiency; the label only improves the
  input, it does not create the item. Keep the volume-ratio severity logic untouched.
- **Risk**: low — existing consumer, same output shape.

### 3.3 Clean per-lift intensity & volume
`charts.py` `rep_range_distribution` and `volume_intensity_periodization` group by exercise name.
Add a `group_by="lift"` path that buckets each set's session by `session_lift`, so
`weight_kg × reps × %e1RM` trends per **squat/bench/deadlift** regardless of naming.
- New chart `lift_intensity_bands`: stacked distribution of sets across %e1RM bands per lift over
  time (deload → heavy), built via `ChartService` + `CHART_REGISTRY`.
- **Note**: keep the existing exercise-name grouping as the default; `lift` is additive.

### 3.4 Per-lift freshness → readiness & today
Lift-specific acute load (sessions + tonnage per lift, trailing 7d) → "squat is the freshest lift,
bench has 3 hard sessions in 8 days".
- Feed `adaptive.strength_readiness` (extend its `note`, do **not** change the numeric `factor`
  without a deterministic basis).
- Feed a `today.py` engine row (§4.5) and, later, the plan's "which day next" suggestion.
- **Gate**: deterministic load first; the label selects the lift, not the verdict.

### 3.5 Per-lift PR context
Slice PR history and `big_3_total` progression by `session_lift`; correlate PR cadence with
training frequency (§3.1) — "you PR the squat roughly every 6 weeks when training it weekly."
`PersonalRecord` already has `session_id` (`models/lifting.py`), so the join is direct.
- **Risk**: read-only analysis.

### 3.6 Goal metrics (cheap, high leverage)
`goal_metrics.METRIC_REGISTRY` already supports keyed metrics with `optional_filter`. Add:
- `lift_sessions` — count, `optional_filter=["lift"]` → goal "4 squat sessions / month".
- `split_sessions` — count, `optional_filter=["split"]` → goal "1 legs session / week".
- **Note**: the `lift`/`split` filter values are the label vocabularies, so keep them stable
  (§ taxonomy versioning in the classification plan).

### 3.7 Movement-plan conformance
Already specified in the classification plan §6.2 (planned `planned_focus` movement value vs
`session_lift`). Listed here for completeness — it is the first consumer shipped.

### 3.8 Deferred — Strava linking signal
`linking._focus_overlap_score` uses a brittle keyword list. `session_lift` could sharpen it, but
linking is a *matcher* (pitfall #29-class blast radius). **Defer to a later, separately-reviewed
change**; do not bundle with read-only analytics.

---

## 4. Training intent (`session_class`) utilisation

### 4.1 Intent mix over time
Chart `session_class_mix`: stacked area of session intents per week. Answers "am I over-indexing
on intensity and starving volume?" — the single most useful read the label unlocks.
- Built through `ChartService` + `CHART_REGISTRY`, following `volume_intensity_periodization`.

### 4.2 Phase detection — reconstructing the mesocycle
The app has **no mesocycle model**, but the *sequence* of intents reveals one: blocks of
`volume_hypertrophy` → `max_strength` → `test`, punctuated by `deload`, are exactly
accumulation → intensification → realization.
- New pure helper `detect_training_phases(sessions) -> list[Phase]` (windowed, deterministic).
- Feeds `volume_intensity_periodization`'s existing "phase-read insights" (currently inferred from
  tonnage/%1RM alone) and the plan spine's **Plan · Peaks** modes
  (`plans/training-redesign-plan.md`).
- **Gate**: phase labels are *descriptive* ("you appear to be in an intensification block"), never
  prescriptive on their own.

### 4.3 Deload adherence — the safety-relevant one
Deterministic: N consecutive weeks of rising tonnage / %1RM with **no `deload` intent** → flag
"no reduce week in 6 weeks".
- Surfaces: `volume_intensity_periodization` insight; a gated notification (§4.6); a `today.py`
  stance (§4.5).
- **Why high value**: directly matches the app's injury/fatigue thesis, and it is the one intent
  read with a clear behavioural recommendation ("deload this week").
- **Gate**: the flag is driven by the *deterministic* tonnage trend; the `deload` intent only
  prevents a false positive (you did deload). It can escalate, never create.

### 4.4 Intent × outcome — "too heavy to be labelled that"
Combine `session_class` with the Phase-1 `ai_tags.outcome` (from notes): a session labelled
`max_strength` whose outcome is `grind`/`failed_sets` is a candidate over-reach; a `deload` whose
outcome is `grind` is a mislabel or an overreach by the user.
- Cheap (both labels already exist), read-only insight.
- **Gate**: descriptive, never a medical/training prescription on its own.

### 4.5 Today's recommendation — a sixth engine
`services/today.py` composes five engines with a `consensus[]` and `EngineRow` provenance. Add a
**session-mix engine**:
- Inputs: recent `session_class` mix, `session_split` coverage, `session_lift` freshness, readiness.
- Output: a `train`/`cut`/`rest`/`add` stance + a suggested **session type/split** ("last three
  sessions were `max_strength` → today suits `technique`/`volume`"; "pull untrained 12 days →
  today suits pull").
- **Follows the composer's contract exactly**: best-effort, `available: false` with a reason when
  labels are NULL, never 500s the verdict (pitfalls #42/#43).
- **Gate**: a *suggestion*, and the only engine that may reference a label directly.

### 4.6 Notifications (strictly gated)
`notifications.notify()` for at most: "deload overdue" (§4.3), "no pull in N weeks" (§3.2),
"split starved" (§3.x). Rules:
- `source="jev"` **and** confidence ≥ 0.70 only (mirror `pain_injury`'s escalation floor).
- Deduplicated; at most once per window; user preference respected
  (`notifications.get_notification_preferences`).
- A rule label never notifies.

### 4.7 Weekly narrative (Gemini)
Feed the intent + split + lift mix into the weekly `LlmAnalysis` narrative via the AI-analysis
pattern (`add-ai-analysis` skill) — the paragraph the user actually reads: *"this week was 60 %
max-effort with no technique work and no pulling."*
- **Gate**: Gemini narrates the numbers/labels; it does not re-classify.

### 4.8 Intent ↔ readiness correlation
Extend the weekly `cross_domain` job (Modal) or an analytics correlation: do `max_strength`/`test`
sessions cluster after high recovery? Does `technique` follow low sleep?
- Feeds §4.7 and the readiness story. **Gate**: correlation only, no causal claim.

### 4.9 Intent-axis conformance
Deferred (classification plan Phase 3): needs a *planned quality* field the plan model lacks.
Split/lift conformance ships earlier via `planned_focus`.

---

## 5. Cross-axis: the lifting "review" surface

A single read-only review panel (fits `docs/review-vs-act.md`) that collects the highest-value
reads in one place:

- **Split balance** — sessions/tonnage per split (are pushes and pulls balanced?).
- **Intent mix** — §4.1.
- **Lift coverage** — §3.1.
- **Deload adherence** — §4.3.
- **Top insight** — Phase detection (§4.2) or intent×outcome (§4.4).

Frontend: reuse existing badge/chart components; no new pattern. Also add split/intent/lift
**filters** to the sessions list, and include the labels in **export** and in **search**
(`api/search.py` currently ILIKEs `focus`/`notes` — add the labels as searchable/filterable text).

---

## 6. Where these labels must **not** be used (explicit non-goals)

| Do not | Why |
|---|---|
| Let a label alone raise a health alert / injury claim | non-negotiable escalation contract (§1.2) |
| Write `focus` from `session_lift` | clobbers user data; ripples into conformance + linking |
| Let a `source="rule"` label notify | rule labels are uncalibrated |
| Put intent/split coaching viz on the action layer | `review-vs-act` |
| Re-derive TSS/e1RM/tonnage from the label | numbers stay deterministic; the label groups them |
| Silently rewrite history on a taxonomy change | re-tag forward, mark `taxonomy_version` |
| Bundle the Strava-linker change with read-only analytics | matcher blast radius; separate review |

---

## 7. Phasing (maps onto the classification plan's phases)

| Phase | Utilisation work | Depends on | Effort | Risk |
|---|---|---|---|---|
| **1** | Chips + filters; **lift/split conformance** (§3.7); **push/pull session coverage** (§3.2) | labels exist | S | Low |
| **2** | `session_class_mix` (§4.1) + `lift_frequency` (§3.1) + `lift_intensity_bands` (§3.3); phase detection (§4.2); deload adherence flag (§4.3); intent×outcome (§4.4); goal metrics (§3.6) | Phase 1 | M | Low |
| **3** | `today.py` session-mix engine (§4.5); gated notifications (§4.6); weekly narrative (§4.7); intent↔readiness (§4.8); per-lift freshness (§3.4) | Phase 2 | M–L | Medium (touches verdict/notifications) |
| **4** | Per-lift PR context (§3.5); intent-axis conformance (§4.9); linking signal (§3.8); goal templates (§5) | Phase 3 | M | Medium |

Phase 2 is where most of the *user-visible* value lands and where the "what do we do with the
data" question is answered. Phase 3 is where a label starts influencing recommendations — hence
the higher risk tier and the strict gating.

---

## 8. Acceptance criteria & success signals

**Correctness / safety**
1. With Jev unset, every consumer in §3–§5 behaves exactly as today (byte-for-byte where an
   existing output exists) — verified per consumer.
2. `evaluate_push_pull_ratio` and the deficiency output shape are unchanged except for the added
   session-coverage input; existing `test_deficiency` stays green.
3. `today.py` verdict renders with the session-mix engine `available: false` when no session has
   labels (pitfall #42: constant `consensus[]` row count).
4. No notification can fire from a `source="rule"` label (test).
5. A label alone raises no health alert (test, mirroring the `pain_injury` test).

**Value (how we'd know it worked)**
6. Label coverage > 90 % of sessions with ≥ 1 set once Jev is configured (backfill included).
7. `lift_frequency` changes at least one user-visible behaviour: a "neglected lift" flag fires on
   real data.
8. `session_class_mix` + deload-adherence insights appear for users with ≥ 8 weeks of history.
9. Rule-vs-Jev `disagreement` rate is measured and logged (feeding a possible taxonomy tune).

---

## 9. Open questions

| # | Question | Recommendation |
|---|---|---|
| U1 | Does `session_lift` earn its own typed column, or is it a blob key until §3.1/§3.3 ship? | Keep the column — §3.1/§3.3/§3.6 are near-term. (Ties to classification plan Q3.) |
| U2 | Is the push/pull balance a *deficiency* item (feeds `analyze_deficiencies`) or a separate review metric? | Feed the existing deficiency — it already emits the "pulling absent" item; don't duplicate. |
| U3 | Should the `today.py` engine be a new 6th engine or fold into `adaptive`? | New engine, following the composer's provenance contract; folding hides it. |
| U4 | Phase detection thresholds (how many sessions per phase, min block length)? | Derive from real data before shipping §4.2; don't guess. |
| U5 | Notification set — which of deload-overdue / lift-neglected / split-starved ship first? | Deload-overdue first (clearest action + closest to the app's thesis). |
| U6 | Does the weekly narrative need label-based *consent* beyond the classification privacy note? | Reuse the classification privacy note; narrative adds no new data sent. |

---

## 10. Docs to update (in the same PRs)

- `docs/algorithms.md` — coverage/freshness, phase detection, deload-adherence formulas.
- `docs/JEV_TAGGING.md` — the labels and what consumes them.
- `AGENTS.md` — Jev bullet + Key Algorithms pointer; the new services in the CODEMAP table.
- `backend/app/services/CODEMAP.md`, `backend/app/api/CODEMAP.md` — new functions/charts/routes.
- `frontend/src/CODEMAP.md` — new chart(s), review panel, filters.
- `plans/training-redesign-plan.md` — reference the phase read for **Plan · Peaks** modes.
- `plans/lifting-redesign-plan.md` — the review panel + session cards use the labels.

---

## 11. Relationship to existing plans / systems

- **Classification plan** (`jev-strength-session-classification.md`) — produces the labels; this
  doc consumes them. Phase numbers are shared.
- **`deficiency.py`** — §3.2 sharpens an existing push/pull deficiency; the strongest "it already
  wanted this" pairing.
- **`charts.py` + `CHART_REGISTRY`** — §3.1/§3.3/§4.1 add charts through the existing system.
- **`today.py`** — §4.5 joins the five-engine composer as a sixth, under the same degrade contract.
- **`adaptive.py` / `health_analysis.py`** — §3.4/§4.6 feed readiness/notifications, gated.
- **`goal_metrics.py`** — §3.6 adds filterable metrics.
- **`cross_domain` (Modal) + `LlmAnalysis`** — §4.7/§4.8 use the weekly jobs and narrative.
- **Cycling counterpart** — [`plans/cycling-ride-labels-utilisation.md`](cycling-ride-labels-utilisation.md)
  is the cycling analogue, but deliberately leaner and mostly **non-Jev**: the one semantic axis
  (`purpose`) is already shipped, and the session-quality axis is deterministic (power-derived).
