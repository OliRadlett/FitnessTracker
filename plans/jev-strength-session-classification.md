# Jev — Strength Session Classification (split + intent)

> **Status**: **Phase 0 + the Phase 1 label producer are implemented** on
> `feature/jev-session-classification` — migration `100`, `services/jev_classification.py`,
> inline + weekly triggers, and tests (migration round-trip verified; 189 backend tests green).
> Still open in Phase 1: the `build_strength_conformity` split/lift comparison (§6.2) and the
> frontend chips/filters. The whole consumer surface lives in
> [`plans/jev-strength-labels-utilisation.md`](jev-strength-labels-utilisation.md).
> Extends the shipped Jev integration
> ([`docs/JEV_TAGGING.md`](../docs/JEV_TAGGING.md),
> [`plans/jev-decision-layer.md`](jev-decision-layer.md),
> [`plans/jev-implementation-plan-2026-09-27.md`](jev-implementation-plan-2026-09-27.md)).
> **Type**: New product capability on an existing optional integration (TypeSafe Jev / "System One").
> **Dependencies**: none new. Reuses `integrations/jev_client.py`, the `TYPESAFE_API_KEY` +
> `jev_enabled` kill switch, the `JEV_FAKE=1` offline mode, and the shared AI budget guard.
> **Not in scope**: per-exercise name canonicalisation, NL query→filters, Gemini guardrails, any
> *numeric* judgment (TSS/CTL/ATL, e1RM, tonnage, PR math) — those stay deterministic (§5.3).
>
> Line references are against `main` at time of writing; verify before editing.

---

## 1. The gap this fills

Jev Phase 1 already tags a lifting session **from its free text**: `tag_lifting_session`
(`services/jev_tagging.py`) sends `{note, focus, program_name, duration_seconds, rpe_session,
total_volume_kg}` and stores `ai_tags` = `{pain_injury, high_fatigue, pr_mention, outcome,
energy}` (`models/lifting.py:ai_tags`). That answers *"what did the note say?"*

It does **not** answer *"what kind of session was this?"* — and the two differ in three ways:

1. **It only fires when a note exists.** Phase 1 returns early on an empty note
   (`jev_tagging.py` `tag_lifting_session`). Most logged sessions have no note, so most sessions
   carry no Jev interpretation at all.
2. **It never reads the sets.** Exercise names, rep schemes, loads, warmup/AMRAP flags and
   structure — what actually *defines* a strength session — are not sent.
3. **"Outcome" is an assessment of execution, not a classification.** `outcome` ∈
   `{breakthrough, on_target, grind, failed_sets, deload}` is *how it went*. `focus`
   (`squat|bench|deadlift|overhead_press|accessories`, frequently NULL) is *which lift* — not the
   split, and not the training quality.

So today the app can say "you ground through this and your left knee hurt", but not "this was a
push session", "this was a legs day", or "this was a heavy max-effort day".

---

## 2. Scope — two classification axes (decided)

Both axes are in scope this pass:

| Axis | Question it answers | Vocabulary |
|---|---|---|
| **B — Split / day type** | "Did I train push, pull, legs, upper, lower or full body?" | `push` · `pull` · `legs` · `upper` · `lower` · `full_body` |
| **A — Training intent** | "What quality of work was this — heavy, volume, speed, technique, deload…?" | `max_strength` · `volume_hypertrophy` · `speed_power` · `technique` · `accessory_conditioning` · `deload` · `test` |

A third, lighter axis falls out naturally and is worth taking because it maps straight onto the
existing `focus` field and makes conformance possible:

| Axis | Question | Vocabulary |
|---|---|---|
| **C — Primary lift** | "Which competition lift dominates?" | `squat` · `bench` · `deadlift` · `overhead_press` · `accessory` · `none` |

**Why C matters:** `LiftingSession.focus` is user-entered and *often NULL* (synced/Strava
sessions, quick logs), and `TrainingPlanDay.planned_focus` already holds exactly these values
(`models/training_plan.py:83`; CODEMAP lists `squat/bench/deadlift/overhead_press/accessories/
full_body/push/pull/legs/upper/lower`). Axis B (`push`/`pull`/`legs`/`upper`/`lower`/`full_body`)
and axis C (`squat`/`bench`/`deadlift`/`overhead_press`) together cover the **entire**
`planned_focus` vocabulary — so a Jev label can be compared directly against the planned day
(§6.2), closing the "conformance" gap long before a planned-quality field is ever modelled.

### 2.1 What is *not* an axis

- **Movement/pattern at the exercise level** (canonicalising "RDL" → "hinge") stays out of scope
  (existing Jev design, §2). We classify the **session**, not each exercise.
- **Intensity band / %e1RM / tonnage / session TSS** — numeric, deterministic, sent as *state*
  only (§5.1).
- **`focus` is never overwritten.** Axis C is stored separately (`session_lift`); consumers
  prefer an explicit user `focus` where present. Auto-writing `focus` would clobber user data
  and ripple into conformance and Strava linking — forbidden (§5.9).

---

## 3. Why Jev, and not a rule engine

A rule engine is the obvious alternative, and it is *wrong often enough to matter*:

| Case | Rule says | Actually is | Why structured data alone fails |
|---|---|---|---|
| 5×5 @ 80% | ambiguous | volume day in some programs, strength in others | intent lives in the program, not the reps |
| Speed pulls @ 60% | technique/light | `speed_power` | load says light; intent says dynamic |
| Week-4 deload | a light session | `deload` | needs block context the numbers do not carry |
| Superset circuit | `accessory` | `accessory_conditioning` | a set-level rule sees only loads × reps |
| "DB Incline Press + Cable Fly + Triceps" | `upper` | `push` | needs to read exercise *names*, not a keyword list |
| "Squat + RDL + Leg Press" | `legs` or `lower` | `legs` (powerlifting) | split vocabulary depends on the program |

Jev's fit is exactly the one the existing design names: closed label sets, high call frequency,
**calibrated confidence to threshold on**, and semantic signal (`notes`, `program_name`, exercise
names) the arithmetic cannot see. It generates no prose, so it wires straight into deterministic
consumers.

The rule engine is not discarded — it becomes the **deterministic fallback + cross-check**
(§5.3), mirroring the injury-risk rule ("a Jev tag may escalate a signal, never create one"). For
the split axis it can reuse/extend the existing keyword list `_EXERCISE_KEYWORDS`
(`services/strava/linking.py`), which is itself the brittle thing Jev improves on.

---

## 4. Verified touchpoints (against `main` @ today)

| Concern | Location | Notes |
|---|---|---|
| Jev client + fake mode | `backend/app/integrations/jev_client.py` — `decide()`, `noul/choice/score`, `_fake_result`, `JEV_FAKE` | reuse as-is; no new SDK surface |
| Jev config / kill switch | `backend/app/config.py` — `typesafe_api_key`, `jev_enabled`, `jev_model`, `jev_timeout_s` | reuse; add `jev_taxonomy_version` if we want it config-driven |
| Existing tagging service | `backend/app/services/jev_tagging.py` — `_build_state`, `_questions`, `build_tags`, `tag_lifting_session`, `backfill_free_text_tags` | new sibling module (or new functions in this file) |
| Session fields | `backend/app/models/lifting.py` — `LiftingSession` (`focus`, `program_name`, `duration_seconds`, `total_volume_kg`, `rpe_session`, `estimated_tss`, `notes`, `ai_tags`) | classification input + storage |
| Set fields | `backend/app/models/lifting.py` — `LiftingSet` (`exercise_name`, `weight_kg`, `reps`, `rpe`, `is_warmup`, `is_amrap`, `order_index`) | the input Phase 1 ignores |
| Exercise keyword list | `backend/app/services/strava/linking.py` — `_EXERCISE_KEYWORDS` | seed for the rule fallback + cross-check |
| Session triggers | `backend/app/api/lifting.py` — `create_session` (BackgroundTasks hook), `update_session`, `add_set`, `ai-analysis` | add classification scheduling on create/update/finalize |
| Weekly backfill task | `backend/app/tasks/scheduler.py` — `backfill_free_text_tags` (task + beat entry) | extend to also classify stale/missing rows |
| Deterministic helpers | `backend/app/services/lifting.py` — `brzycki_1rm`, `rpe_to_pct`, `estimate_lifting_tss`, `refresh_session_tss` | rule fallback + numeric state |
| Conformance | `backend/app/services/conformity.py` — `build_strength_conformity`, `_exercise_match`, `STRENGTH_WEIGHTS["focus"]` | **now a Phase-1 consumer** (§6.2) |
| Plan day model | `backend/app/models/training_plan.py` — `TrainingPlanDay.planned_focus` | vocabularies axes B+C must match |
| Consumers today | `services/health_analysis.py` (`ai_tags["pain_injury"] >= 0.70`), `services/charts.py` (`strength_balance`, `rep_range_distribution`, `volume_intensity_periodization`), `api/charts.py` `CHART_REGISTRY` | pattern for new consumers |
| Migration head | `099_add_training_plan_strength_progression.py` | number the new migration at build time (check `origin/main`, pitfall 34) |

---

## 5. Design

### 5.1 What is sent (state)

One batched call per session. State is capped (the 64k context is shared by all questions):

```jsonc
{
  "focus": "squat", "program_name": "5/3/1", "duration_seconds": 3900,
  "rpe_session": 8.5, "total_volume_kg": 6400, "estimated_tss": 132,
  "bodyweight_kg": 82.5,                 // optional; lets Jev judge absolute load
  "notes": "…",                           // capped ~2000 chars
  "sets": [                               // capped; warmups trimmed
    {"exercise": "Low Bar Squat", "weight_kg": 142.5, "reps": 3, "rpe": 9, "is_warmup": false},
    {"exercise": "Leg Press",     "weight_kg": 180,   "reps": 12, "rpe": 8, "is_warmup": false}
  ]
}
```

Caps: at most ~40 sets; drop `is_warmup` rows beyond the first 3; cap `notes` as Phase 1 does.
Numeric context is included so the labels are not decided blind, but the **numbers themselves are
never asked of Jev**.

### 5.2 Questions + confidence routing

Three `choice` questions in **one** call (parallel; adding questions adds ~no latency):

```python
questions = {
    "session_split": jev_client.choice(
        "Which training split does this session best represent?",
        {"push": "Chest/shoulders/triceps dominant",
         "pull": "Back/biceps/hinge-rear-delt dominant",
         "legs": "Quad/hamstring/glute dominant",
         "upper": "Mixed upper body (no clear push/pull dominance)",
         "lower": "Mixed lower body (no clear legs/hinge dominance)",
         "full_body": "Whole body across patterns"},
    ),
    "session_lift": jev_client.choice(
        "Which competition lift, if any, dominates this session?",
        {"squat": "…", "bench": "…", "deadlift": "…",
         "overhead_press": "…", "accessory": "No competition lift dominates",
         "none": "No clear dominant lift"},
    ),
    "session_class": jev_client.choice(
        "What best describes the training intent/quality of this session?",
        {"max_strength": "…", "volume_hypertrophy": "…", "speed_power": "…",
         "technique": "…", "accessory_conditioning": "…", "deload": "…", "test": "…"},
    ),
}
```

| Choice confidence | Action |
|---|---|
| ≥ 0.60 | Store as the assertive label for that axis; surface |
| 0.40 – 0.60 | Store as `provisional` only; never asserted in UI/consumers |
| < 0.40 | Omit that label (keep `unclear` in the detail blob for audit) |

Mirrors the Phase-1 `CHOICE_MIN_CONFIDENCE = 0.60` floor. Axes are independent: a low-confidence
intent does not suppress a confident split, and vice-versa.

### 5.3 Deterministic fallback + cross-check

A small pure rule engine computes provisional values for all three axes:

- **split** — match set `exercise_name`s against a keyword map (seeded from
  `linking._EXERCISE_KEYWORDS`); e.g. bench/press/fly → `push`, row/pull-up/RDL → `pull`,
  squat/lunge/leg-curl → `legs`.
- **lift** — same map at the competition-lift level; falls back to the stored `focus` if present.
- **intent** — rep-range + %e1RM (via `lifting.brzycki_1rm` / `rpe_to_pct`) + tonnage + duration.

Used to:

- **cross-check** Jev: when the two disagree, store both and set `disagreement: true`. A
  disagreement never silently overrides Jev, and never on its own drives a consequential action;
- **degrade open at read time** via the public `rule_labels(session)` helper, so a consumer that
  needs a label while Jev is unset — or on a row Jev has not reached — can compute one on demand
  (quality charter: degrade open, never silent-empty). **Nothing is persisted to the typed columns
  when Jev is unset**, so an unconfigured deployment is byte-for-byte unchanged (the same contract
  `jev_tagging` honours); the rule labels are stored only inside `ai_classification["rule"]` when
  Jev runs.

Provenance (`source: "jev"`) plus the stored `rule` block prevents mistaking a rule label for a
calibrated one.

### 5.4 Storage

Add to `LiftingSession` (migration; number at build time — **check `origin/main` per pitfall 34**):

```python
session_split: Mapped[str | None] = mapped_column(String(32), nullable=True)  # push|pull|legs|upper|lower|full_body
session_lift:  Mapped[str | None] = mapped_column(String(32), nullable=True)  # squat|bench|deadlift|overhead_press|accessory|none
session_class: Mapped[str | None] = mapped_column(String(32), nullable=True)  # intent archetype
ai_classification: Mapped[dict | None] = mapped_column(JSONB, nullable=True)  # provenance + depth
```

Typed strings are what consumers group/filter by (Phase 1 used a pure JSONB blob only because
`ai_tags` is read for one boolean threshold; these three are *aggregated* — grep, index,
`GROUP BY`). The JSONB holds provenance and depth:

```jsonc
{
  "source": "jev", "model": "jev-latest", "resolved_model": "…",
  "taxonomy_version": "v0", "content_hash": "…", "computed_at": "…",
  "session_split":  {"label": "push",  "confidence": 0.83},
  "session_lift":   {"label": "bench", "confidence": 0.79},
  "session_class":  {"label": "max_strength", "confidence": 0.71,
                      "probabilities": {"max_strength": 0.71, "volume_hypertrophy": 0.18, "...": 0.11}},
  "rule": {"session_split": "push", "session_lift": "bench", "session_class": "max_strength"},
  "disagreement": false
}
```

(If a reviewer prefers a narrower table, `session_lift` is the one to fold back into the blob —
split and intent are the two with charts. Flagged as Q3.)

### 5.5 Triggers

1. **On session create / update / finalize** — reuse the existing `BackgroundTasks` hook in
   `api/lifting.py` (`create_session`, `update_session`). For the live-session flow, classify on
   **finalize** (`ended_at` set), *not* on every `add_set` flush — bounds calls and avoids
   classifying a half-logged session.
2. **Weekly backfill** — extend `backfill_free_text_tags` (scheduler task + beat entry) to also
   classify sessions whose labels are missing or whose `ai_classification.content_hash` is stale.
   Idempotent.
3. *(Optional)* `POST /lifting/sessions/{id}/classify` for a manual re-tag from the detail page.

### 5.6 Idempotency & staleness

`content_hash = sha1(canonical(sets, metadata, taxonomy_version))`. Skip if
`ai_classification.content_hash` matches **and** `model` matches **and** `taxonomy_version`
matches. Any set edit changes the hash → re-classify (background). This is the right staleness
key here: unlike Phase 1 (keyed on `note_hash`), classification depends on the *sets*, which the
user edits after the fact.

### 5.7 Failure contract (inherited from Phase 0/1, non-negotiable)

- Jev unset / disabled / timeout / SDK error / budget 429 → return `None`, **no write**, never
  raise. The session write commits regardless.
- Never blocks a write; never fabricates a signal; every stored decision carries
  `source` + `model` + `confidence` + `taxonomy_version`.
- `JEV_FAKE=1` → deterministic canned answers for CI (note: `_fake_result` returns confidence
  `0.5` for choices, below the `0.60` floor, so tests must monkeypatch `decide` to exercise the
  assertive path — exactly as `tests/integration/test_jev_tagging.py` does today).

### 5.8 Privacy / consent

Classification sends **more** than Phase 1: exercise names + loads + set structure, not just the
note. Not health data, but a widening of the payload. Requirements:

- Extend `docs/JEV_TAGGING.md` §"What is sent" to cover the set list.
- Extend the Settings privacy note (Phase 1 added one) to say session structure is classified.
- Keep `jev_enabled` as the escape hatch; respect a per-user disable if one ships.
- Consistent with the Phase-1 decision (Q1: on by default). Marked Q2 if per-user opt-in is
  wanted for the wider payload.

### 5.9 Guardrails specific to this feature

| Guardrail | Why |
|---|---|
| Never write `focus` from `session_lift` | clobbers user data; ripples into conformance + Strava linking |
| A split/intent label is never a medical claim | same contract as `ai_tags` |
| A label may *escalate* a deterministic signal, never create one | fatigue consumer (§6.3) |
| `disagreement` is stored, not resolved | keeps the rule read auditable |

### 5.10 Cost / latency

One batched call per session (all three axes answered in parallel) — more calls than Phase 1's
note-only path, but at ~$0.0001/session and ~100ms, always off the write path. Far below the
budget guard's limits.

---

## 6. Consumers (the value)

1. **Session chips + list filters** *(Phase 1)* — split chip, lift chip, intent chip on the
   session card/detail (`plans/lifting-redesign-plan.md` already reserves `ai_tags` as insight
   chips) plus filters on the sessions list. Read-only, additive.
2. **Conformance — planned split vs actual split** *(Phase 1)* — `build_strength_conformity`
   (`services/conformity.py`) scores a planned day against its session; its `focus` component is
   today a brittle two-way substring `_exercise_match`. Feed the Jev `session_split`/`session_lift`
   into that component so a planned `push` day meets an actual `push` session *by label*, not by
   lucky substring — and for movement-plan days, compare planned lift to `session_lift`. This is
   the strongest early win and works for **both** planning styles (`planned_focus` already holds
   both vocabularies). **Preserve the numeric components** (volume/exercises/duration/RPE) — only
   the semantic `focus` component changes.
3. **Charts** *(Phase 2)* —
   - `split_balance`: sessions/volume per split over time ("am I neglecting pull?") — a real
     coaching read, distinct from the existing per-lift `strength_balance`.
   - `session_class_mix`: intent distribution over time (over-indexing on intensity, starving
     volume?).
   Both via `ChartService` + `CHART_REGISTRY` (47 → 49), following `volume_intensity_periodization`.
4. **Fatigue interaction** *(Phase 2)* — feed `services/adaptive.py` `strength_readiness` and the
   weekly insight: flag consecutive `max_strength`/`test` sessions, or a split starved for weeks.
   **Gated**: a label may only escalate an already-nonzero deterministic fatigue signal.
5. **`focus`-null enrichment** *(Phase 2, read-only)* — for sessions where the user left `focus`
   NULL, consumers that key on `focus` may fall back to `session_lift`. Never write `focus` (§5.9).

---

## 7. Rollout phases

| Phase | Ships | Risk | Value |
|---|---|---|---|
| **0** | Taxonomy (all three axes) + prompt + rule engine + state builder; **no call site** | None | Foundation |
| **1** | Migration (4 cols), `jev_classification.py`, triggers, backfill, chips, **conformance split comparison**, tests | Low–Medium (touches `conformity.py`) | Every session typed + filterable; better conformance |
| **2** | `split_balance` + `session_class_mix` charts; readiness consumer; weekly insight; `focus`-null fallback | Low–Medium (consumer-side) | Coaching insight; split/intensity balance |
| **3** *(optional)* | Intent-axis conformance against a *planned quality* | Medium | needs a planned-quality source (see `plans/training-redesign-plan.md`) |

Each phase is an independent PR into `main`. If Phase 1 feels too large, split it into
`feat/jev-session-split` (axes B+C + conformance) and `feat/jev-session-intent` (axis A) sharing
one migration.

---

## 8. Migration

| # | Change | Phase |
|---|---|---|
| `1XX_add_lifting_session_classification` | `ALTER TABLE lifting_sessions ADD COLUMN session_split VARCHAR(32) NULL, ADD COLUMN session_lift VARCHAR(32) NULL, ADD COLUMN session_class VARCHAR(32) NULL, ADD COLUMN ai_classification JSONB NULL` | 1 |

Take the next free number at build time; `origin/main` is currently at `099`. Re-check
`origin/main` immediately before opening the PR (AGENTS pitfall 34; do not renumber an applied
revision, pitfall 24). A partial expression index on `session_split`/`session_class` is optional
later if a chart needs it — not Phase 1.

---

## 9. Tests

- **`tests/test_jev_client.py`** — unchanged (client contract already covered).
- **New `tests/integration/test_jev_session_classification.py`**:
  - Jev (patched high-confidence) → all three typed labels + `ai_classification` with
    `source="jev"` + `taxonomy_version`.
  - Per-axis confidence floor: an axis in `[0.40, 0.60)` is provisional and not asserted, while a
    confident sibling axis still is.
  - Unconfigured / `decide() is None` → no write, no raise, endpoint still 201/200.
  - Rule fallback populates labels with `source="rule"` when Jev is off; `disagreement` set when
    rule and Jev differ; `focus` column never mutated.
  - Idempotent: re-run with unchanged sets makes no write; **changing a set** changes
    `content_hash` → re-classify.
  - `conformity`: a planned `push` day vs a `push`-labelled session scores the focus component
    full; numeric components unchanged.
  - Fake mode (`JEV_FAKE=1`) returns the canned shape and never asserts below the floor.
- **Regression invariant**: with Jev unset, existing `ai_tags` behaviour and every deterministic
  output are byte-for-byte unchanged (classification is purely additive).

---

## 10. Open questions / decisions

| # | Question | Recommendation |
|---|---|---|
| **Q1** | **Taxonomy** — are the §2 vocabularies right (esp. axis B `push/pull/legs/upper/lower/full_body` and whether C is worth a third question)? | Aligned to existing `planned_focus` values on purpose; store `taxonomy_version` so it is re-taggable. **Blocks Phase 0.** |
| Q2 | Privacy — classify from set structure (not just the note) on by default? | Yes, consistent with Phase-1 Q1; document; keep kill switch. |
| Q3 | Four typed columns, or fold `session_lift` into the blob? | Three typed + blob; drop `session_lift` to a blob key if the table width is unwanted. |
| Q4 | Should the deterministic rule labels be persisted when Jev is off? | **No (implemented)** — keep "unset = unchanged"; expose `rule_labels()` for an on-demand read-time fallback. Flip only if we want a no-vendor baseline. |
| Q5 | Does the intent axis need more than one question (primary + secondary intent)? | Start with **one**; add axes only if a consumer needs them. |
| Q6 | Re-classify on every set flush or on finalize? | Finalize + explicit update + weekly backfill (§5.5). |
| Q7 | Change `conformity`'s focus component in Phase 1, or behind a flag? | Change it, but keep the numeric components and a rule fallback so unconfigured behaviour is unchanged. |

---

## 11. Acceptance criteria

**Phase 1**
1. A note-less session with sets gets `session_split` (and/or `session_lift`, `session_class`)
   from Jev when configured — proving the §1 gap is closed.
2. Jev unset/timeout → no write, no raise, session write commits. The deterministic `rule_labels()`
   helper stays available for consumers to compute a fallback **on demand** and is **not** persisted
   when Jev is unset; `focus` column unchanged. When Jev runs, the rule labels are stored under
   `ai_classification["rule"]` and a mismatch sets `disagreement`.
3. Classification is idempotent by `content_hash`; editing a set re-classifies.
4. `build_strength_conformity` compares planned `planned_focus` to the Jev split/lift label, with
   numeric components unchanged.
5. Chips render on the session card/detail; unconfigured sessions show nothing (no empty badge).
6. Offline test suite green with no `TYPESAFE_API_KEY`; existing Jev/`ai_tags` tests unchanged.

**Phase 2**
7. `split_balance` and `session_class_mix` appear in `CHART_REGISTRY` and degrade to an
   empty-but-labelled state when every label is NULL.
8. A label may escalate, never create, a fatigue signal.

---

## 12. PR sequence

1. `feat/jev-session-classify-core` — taxonomy (axes B+C+A) + rule engine + state builder +
   tests, **no call site** (Phase 0).
2. `feat/jev-session-split` — migration, `jev_classification.py`, triggers, backfill, chips,
   conformance split comparison, docs (Phase 1, axes B+C).
3. `feat/jev-session-intent` — the intent axis wired into the same service + chips (Phase 1,
   axis A). *(Optionally merged into #2 if the migration is shared and the PR stays reviewable.)*
4. `feat/jev-session-insights` — charts + readiness consumer (Phase 2).

Each: isolated worktree → backend tests + frontend `tsc`/vitest → PR into `main` → release via
`main → prod`. Docs updated in the same PR: `docs/JEV_TAGGING.md`,
`docs/algorithms.md` (taxonomies), `AGENTS.md` (Jev bullet + integration table), the `services` /
`models` / `api` CODEMAPs, and the `ai_tags` chip reference in
`plans/lifting-redesign-plan.md`.

---

## 13. Relationship to existing plans

- **Extends, does not replace** Phase 1 (`ai_tags` from `notes`). They coexist: `ai_tags` = what
  the note said; the new labels = what the session *was* (split, lift, intent).
- **Feeds** `plans/training-strength-programming.md` + `plans/training-redesign-plan.md` — split
  labels make plan conformance label-based now, and a *planned quality* field would later complete
  intent-axis conformance (Phase 3).
- **Respects** the Jev scope boundary (`jev-decision-layer.md` §2): no per-exercise
  canonicalisation, no numeric judgment, no prose.
