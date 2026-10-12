# Training Strength Programming — Plan (companion to the Training Page Redesign)

> **Status**: v2 — decisions closed (2026-10-13). Companion to [`training-redesign-plan.md`](training-redesign-plan.md); this is the *capability* half of Plan mode.
> **Goal**: Let a plan be a **program**: every strength exercise in every week carries a target **sets × reps @ RPE**, the app **suggests a working weight** from recent history *and* previous weeks, and the user can **always plan or overwrite a weight by hand**.
> **Backend is in scope** (redesign plan §0); rules land in this pass, which means **one migration**.

---

## 0. Decisions of record (2026-10-13)

| Question | Decision |
|---|---|
| Progression default | **Per-exercise**, **RPE-driven by default**; a per-exercise switch to load-driven (prev week + δ). |
| Program matrix role | **Primary** editing surface for multi-week targets; the day editor handles single-day tweaks. |
| Auto-ramp rules | **In this pass** (stored per-exercise rules + materialise) → **one migration**. |
| Training max | **Optional per-exercise training max** (e.g. 90%); default = true e1RM. |
| Included features | 1 Program matrix · 2 Duplicate week→range · 3 Scoped suggest/apply · 4 Exercise notes/cues · 5 Deload automation · 6 Warm-up auto-fill · 7 Planned progression preview · 8 Week/plan templates · 9 Bulk week edit · 10 Clash lint |
| Excluded (follow-on) | 11 Wahoo bulk push · 12 Plan PDF export · 15 Multi-sport day (model change) |

---

## 1. What already exists (so we extend, not reinvent)

| Primitive | Where | What it does |
|---|---|---|
| `brzycki_1rm(w, r) = w × 36/(37−r)` | `services/lifting.py:39` | The app's one e1RM formula. |
| `resolve_exercise_e1rm(db, user, exercise)` | `services/lifting.py` (~1140) | `(e1RM, source)`, **stored PR first, else best recent set**; source ∈ `pr` \| `recent_sets` \| `none`. |
| `suggest_strength_load(db, user, exercise, sets, reps, pct_1rm)` | `services/lifting.py:1176` | `target_kg = round(e1RM × pct_1rm, 1)` + `basis_1rm_kg`, `basis_source`, `safety_warning` (≥95%). **Takes `pct_1rm`, no RPE.** |
| `refresh_strength_targets(db, user, plan)` | `services/training_plan.py:1323` | Re-solves only entries **carrying `pct_1rm`** → *already the "manual is preserved" rule*. |
| `suggest_strength_updates(db, user, plan)` | `services/training_plan.py:532` | Big-3 only: latest completed day's actual-vs-planned RPE → +2.5/+5/maintain. |
| `PlannedExercise {exercise, sets, reps, weight_kg, rpe, pct_1rm, target_rpe}` | `types/training.ts:83` (JSONB) | The per-day prescription. |
| `StrengthWeekTemplate {week, rpe, sets, reps, weights}` | `schemas/training_plan.py:373` | **Generation-time only** — a ramp is created but never editable. |
| `adjustWeightForRpe(kg, rpe)` | `lib/lifting/reference.ts:150` | RPE≤6 → +2.5%, RPE≥9.5 → −5%. |
| `buildLastSessionMap(..., withinDays=84)` | `lib/lifting/reference.ts:41` | Prefill reference, 12-week window. |

### The four gaps
1. **No RPE → %1RM conversion** — RPE is captured but never becomes a load.
2. **No cross-week progression** — suggestions are stateless `e1RM × pct`; the plan's own prior weeks are ignored.
3. **No multi-week target surface** — per-week targets exist only inside each day; the generation-time ramp is inert.
4. **Two RPE fields** — `rpe` (written/read) vs `target_rpe` (validated, unused).

---

## 2. Principles

| Principle | Meaning |
|---|---|
| **Manual always wins** | A suggestion is advisory. Overwriting marks the entry `weight_source: 'manual'`, which **re-suggest and `refresh-targets` skip**. |
| **Explain the number** | Every suggestion reports its basis (e1RM, source, date) and its progression (RPE→% or prev-week δ). |
| **One formula** | RPE→%1RM inverts the app's Brzycki form so prescriptions never disagree with the e1RM in PRs/charts. |
| **Targets are per week** | Progression = sets/reps/RPE (and optionally load δ) per exercise per week, materialised into the day entries so conformity is unchanged. |
| **Suggest ≠ apply** | The resolver proposes; applying writes a concrete `weight_kg` you can then edit. |

---

## 3. Data model

### 3.1 Extend `PlannedExercise` (JSONB — **no migration**)

```ts
interface PlannedExercise {
  exercise: string;
  sets: number;
  reps: number;
  rpe?: number | null;            // CANONICAL target RPE (1–10)
  weight_kg?: number | null;      // prescribed working weight
  pct_1rm?: number | null;        // basis, so refresh can re-solve kg
  weight_source?: 'manual' | 'suggested' | null;   // NEW — provenance
  note?: string | null;           // NEW — per-exercise cue ("pause on chest")
  // target_rpe: DEPRECATED — fold into `rpe`
}
```

### 3.2 Progression rules (**migration**)

New nullable JSONB column `TrainingPlan.strength_progression`:

```ts
interface ExerciseRule {
  exercise: string;                 // normalised key
  mode: 'rpe' | 'load';             // progression driver (default 'rpe')
  start?: { sets?: number; reps?: number; rpe?: number };
  weekly?: {
    rpe_delta?: number;             // e.g. +0.5 / week
    reps_delta?: number;
    sets_delta?: number;
    load_delta_kg?: number;         // mode='load'
    load_delta_pct?: number;        // mode='load'
  };
  deload_every?: number;            // e.g. 4 → every 4th week
  deload_factor?: number;           // e.g. 0.9 load (or −1 RPE)
  training_max_pct?: number;        // NEW: prescribe off a training max (default 1.0)
}
```

Rules **auto-fill** the per-week cells (materialise into day entries); the matrix then edits them freely. Cells remain the source of truth once materialised.

---

## 4. The progression resolver

### 4.1 RPE → %1RM (Brzycki-consistent)
```
effReps = clamp(reps + (10 − rpe), 1, 36)
pct     = clamp((37 − effReps) / 36, 0.30, 1.00)
```
Derived by inverting `brzycki_1rm` with reps-in-reserve. Sanity: RPE 10 @ 1 → 100%; RPE 8 @ 5 → 83.3%; RPE 7 @ 8 → 72.2%. Guard `reps > MAX_REPS_FOR_1RM_PR (12)` → unreliable, flag.

### 4.2 Suggesting a weight
```
basis_1rm, source, basis_date = resolve_exercise_e1rm(exercise)   # recent history
prescribe_basis = basis_1rm × (training_max_pct ?? 1.0)           # optional training max
if mode == 'rpe':                        # default
    kg = prescribe_basis × rpe_to_pct(rpe, reps)
elif mode == 'load':
    prev_kg = previous week's prescribed kg for this exercise
    kg = prev_kg ? prev_kg × (1+load_delta_pct) | prev_kg + load_delta_kg
                 : prescribe_basis × rpe_to_pct(rpe, reps)         # seed from history
if is_deload_week: kg ×= deload_factor
kg = round_to_plate(kg)                  # 0.5 kg
if kg / basis_1rm >= 0.95: safety_warning
```
- **Anchor = recent history**, **progression = previous weeks** (chained in `load`; via the RPE/reps ramp in `rpe`).
- Response explains itself: `basis_1rm_kg`, `basis_source`, `basis_date`, `training_max_pct`, `pct_1rm`, `prev_week_kg`, `delta_kg`, `mode`, `is_deload`, `safety_warning`, `skipped_reason`.

### 4.3 Staleness guard (fixes a real bug)
`resolve_exercise_e1rm` takes the **all-time** best set, while prefill windows to 84 days → an untrained-for-a-year lift can anchor a suggestion. Add an **optional `within_days` param (default 84)** and **surface `basis_date`**.

---

## 5. Manual-override semantics (the hard requirement)

| Action | Result |
|---|---|
| User types `weight_kg` | `weight_source = 'manual'`; `pct_1rm` cleared → **refresh and re-suggest skip it**. |
| User accepts a suggestion | `weight_kg = suggested`; `pct_1rm = pct`; `weight_source = 'suggested'` → future refresh re-solves it. |
| User edits `sets`/`reps`/`rpe` on a suggested entry | Suggestion marked **stale**; UI offers "re-suggest"; never silently overwritten. |
| Bulk apply / reset | Writes across cells; **manual entries excluded unless `force=true`**. |
| `refresh-targets` | Existing rule (only `pct_1rm`) **plus** an explicit `weight_source != 'manual'` guard. |

---

## 6. API

| Endpoint | Body | Returns |
|---|---|---|
| `POST /training-plans/{id}/strength-progression/suggest` (**new**) | `{ scope: 'day'\|'week'\|'plan', day_id?, week?, force?: false }` | Per `(day_id, exercise_index)`: the §4.2 object or `skipped_reason` (`manual`, `no_basis`, `reps_too_high`). |
| `POST /training-plans/{id}/strength-progression/apply` (**new**) | `{ targets: [{day_id, exercise_index, weight_kg, pct_1rm}], force?: false }` | Writes entries (`weight_source='suggested'`), one transaction. |
| `POST /training-plans/{id}/strength-progression/materialise` (**new**) | `{ rules?: ExerciseRule[], weeks?: number[] }` | Fills per-week cells from the rules (mode `replace` \| `fill-empty`). |
| `POST /training-plans/{id}/copy-week` (**new**) | `{ source_week, target_weeks: number[], mode: 'replace'\|'fill-empty' }` | Duplicate a week across a range. |
| `POST /training-plans/{id}/days/batch-edit` (**new**) | `{ day_ids: UUID[], fields }` | Week-level bulk edit (zone / RPE / etc.). |
| `GET/POST/DELETE /training-plans/week-templates` (**new**) | user-scoped week templates | Save/apply a 7-day block. |
| `PATCH /{id}` | *(exists)* | Carries `strength_progression`. |
| `POST /{id}/refresh-targets` | *(exists)* | Add the `weight_source != 'manual'` guard. |
| `POST /lifting/suggest-load` | *(exists)* | Keep for single explicit-`pct` calls. |

Frontend clients + types: `suggestStrengthProgression`, `applyStrengthProgression`, `materialiseProgression`, `copyWeek`, `batchEditDays`, week-template CRUD.

---

## 7. UI — the Program matrix is primary

### 7.1 Program matrix (`?mode=plan&view=program`)

```
              W1        W2        W3        W4 (deload)   W5
 Squat        5×5@7     5×5@7.5   5×5@8     3×5@6         5×3@8
              100kg     102.5     105       95            110
 Bench        ...
 [ Suggest all ] [ Apply all ] [ Ramp RPE +0.5/wk ] [ Deload W4 ] [ Reset ]
```

- Rows = exercises (union across weeks), columns = weeks; each cell = `sets×reps@RPE` + working weight (**ghost = suggested, solid = prescribed**, manual visually distinct).
- **Primary surface** for multi-week targets: editing a cell writes that week's day entry via instant targeted PATCH (redesign §3).
- Row/bulk actions: suggest all · apply all · ramp · deload week · reset to suggested · materialise-from-rule.
- Exercise `note` (cue) editable per row; propagates to each week's cell.

### 7.2 Day editor row (secondary — single-day tweaks)

The existing `%1RM` button becomes **Suggest**, driven by the row's `rpe`+`reps`. A **basis chip** ("e1RM 126 kg · PR · 3 Sep") explains it; editing `kg` flips to **manual** and reveals "re-suggest". `note` field per exercise.

### 7.3 Planned progression preview

Surface **planned** tonnage + avg %1RM by week in the program view (reusing the `volume_intensity_periodization` shape, re-pointed at planned data), so the ramp is visible while building.

---

## 8. Block tools

- **Duplicate week → range** (§6 `copy-week`): "copy W2 to W3–W6", `replace` or `fill-empty`.
- **Deload automation**: rule-driven `deload_every`/`deload_factor`; also a one-tap "make W4 a deload" in the matrix.
- **Bulk week edit** (§6 `batch-edit`): all cycle days in a week → zone/type; all strength days → RPE.
- **Week/plan templates**: save a 7-day block as a named template and apply it; start a plan from a **past plan** (client-side via the existing `POST /training-plans` with copied days).

---

## 9. Coaching aids

- **Warm-up auto-fill**: from the day's top working set, generate a Rippetoe-style ramp and assign a `WarmupTemplate` (§6 of the redesign's day editor already surfaces templates).
- **Exercise notes/cues** (§3.1 `note`): persist across the plan; shown in the matrix row and the day editor.
- **Clash lint** (non-blocking warnings in the builder): hard–hard adjacency; `squat`/`lower` the day before a long ride; week-over-week planned-TSS ramp beyond ~10–15%; too many consecutive training days; no deload after K weeks.

---

## 10. Edge cases

- **No PR / no recent sets** → `skipped_reason: no_basis`; keep manual; hint "enter a heavy single/triple".
- **Reps > 12** → unreliable e1RM; flag, don't suggest silently.
- **Exercise alias** → `normaliseExerciseKey` / backend normalisation ("Back Squat" == `back_squat`).
- **New exercise mid-plan** → no prior week to chain; seed from history in `load` mode.
- **Deload week** → suppress increments; show the flat/reduced target.
- **Per-arm (dumbbell/dual-cable)** → respect `PER_ARM_EXERCISES` + `weight_convention()` (pitfall 19); never halve ad-hoc.
- **Taper** → reuse the linked event's `taper_days` as a planned deload.
- **Stale basis** → `basis_date` surfaced; the recency window prevents a year-old set anchoring.
- **Training max** → prescription uses `e1RM × training_max_pct`; the safety check still compares against true e1RM.

---

## 11. Phases & tests

> Companion phases `S1–S4`. Phase `S1` carries the only migration.

### Phase S1 — Progression engine (backend + model)
- [ ] Unify `rpe` (deprecate `target_rpe`); add `weight_source`, `note` to the entry shape.
- [ ] `rpe_to_pct(reps, rpe)` (Brzycki-consistent) + boundary tests.
- [ ] `resolve_exercise_e1rm(..., within_days=84)` + `basis_date`; keep callers compatible.
- [ ] Migration: `TrainingPlan.strength_progression`.
- [ ] Services + endpoints: `suggest`, `apply`, `materialise`; training-max support.
- [ ] `refresh_strength_targets`: add the `weight_source != 'manual'` guard.
- **Tests**: formula boundaries; manual entries skipped by refresh + re-suggest; `load` mode chains; deload applies; ≥95% warning; per-arm not halved; training max applied; materialise fills- vs replaces.

### Phase S2 — Program matrix (primary) + day editor row
- [ ] Matrix view (union of exercises × weeks), cell editing, ghost/solid/manual, notes.
- [ ] Bulk actions: suggest/apply/ramp/deload/reset/materialise.
- [ ] Day-editor row: Suggest button, basis chip, provenance, cue.
- **Tests**: cell edit → day PATCH; bulk excludes manual; matrix reflects day data; exercise set = union across weeks.

### Phase S3 — Block tools
- [ ] `copy-week` + UI (duplicate week → range).
- [ ] `batch-edit` + week-level bulk edit UI.
- [ ] Deload automation UI (rule-driven + one-tap).
- [ ] Week templates (CRUD + apply); plan-from-past-plan.
- **Tests**: copy-week `replace` vs `fill-empty`; bulk edit touches only matching days; template apply; deload scales as specified.

### Phase S4 — Coaching aids
- [ ] Warm-up auto-fill from top set + template assign.
- [ ] Exercise cues surfaced everywhere.
- [ ] Planned progression preview chart.
- [ ] Clash lint rules + non-blocking warning surface.
- **Tests**: warm-up ramp monotonic + under top set; each lint rule fires and suppresses correctly.

---

## 12. Follow-on (not in this pass)

> Consolidated with the redesign's follow-ons in [`training-redesign-plan.md`](training-redesign-plan.md) §15 (the remaining/deferred register).

| Item | Why deferred |
|---|---|
| Wahoo bulk push (week) | Low value vs per-day push; can be a small follow-up. |
| Plan PDF export | Pattern exists (`export/event-report`); not requested for the first cut. |
| **Multi-sport day** (ride *and* lift on one date) | Highest-value item here, but a **model change** (one day = one sport today). Separate plan. |

---

## 13. Decisions log

| Question | Decision | Rationale |
|---|---|---|
| Progression default | Per-exercise, RPE default | RPE-driven self-corrects when e1RM moves; `load` remains for coaches who want explicit weekly brackets. |
| Matrix role | **Primary** | Multi-week targets are a table-shaped problem; the day editor is for one-off tweaks. |
| Auto-ramp rules | **In this pass** | Makes the generation-time ramp editable and gives deload automation a home; one additive JSONB column. |
| Training max | Optional per exercise | Common in 5/3/1-style blocks; defaults to true e1RM so nothing changes unless asked. |
| Included features | 1–10 (excl. 11 PDF/Wahoo-bulk, 15 multi-sport) | Chosen for value; the two excluded are cheap follow-ups and the third is a model change. |
