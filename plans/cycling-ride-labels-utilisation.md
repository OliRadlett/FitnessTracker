# Cycling Ride Labels — Utilisation Plan

> **Status**: Design plan — no code yet. Companion to the strength work:
> [`plans/jev-strength-session-classification.md`](jev-strength-session-classification.md)
> (produces the labels) and [`plans/jev-strength-labels-utilisation.md`](jev-strength-labels-utilisation.md)
> (consumes them). This doc is the cycling analogue — but deliberately **not** a mirror of it.
>
> **Question this doc answers**: *"Should we do similar (Jev classification) for cycling, and if
> so, what?"*
>
> Line references are against `main` at time of writing; verify before editing.

---

## 0. Short answer

**Partially — and mostly *without* Jev.** Cycling already has more deterministic classification
than lifting did, and the one semantic Jev axis (`purpose`) is **already shipped but unused**. So
the useful work is: (1) give the dead `purpose` tag a consumer, (2) add a **deterministic**
power-based actual-ride classifier, (3) use Jev only as a **fallback** for power-less rides and
for the intent-vs-execution read. Do **not** build a push/pull/legs-style split, and do **not** let
Jev guess a training zone when power is available.

---

## 1. Why cycling is not symmetric with strength

The strength pass needed a new Jev taxonomy because the **numbers are genuinely ambiguous**: a
5×5 @ 80% can honestly be a strength day or a volume day; a deload looks like a light day; a
circuit looks like accessories. Jev resolves intent the arithmetic cannot see.

For a ride **with power**, that ambiguity largely disappears. Recovery / endurance / tempo /
threshold / VO2max is *directly measurable* from the power trace and time-in-zone. Asking Jev to
infer it would be strictly worse than the power curve and would break the Jev charter ("numeric
judgment stays deterministic"). Two further asymmetries:

- **No split.** Push/pull/legs has no cycling equivalent. Cycling's structural axes are
  discipline/terrain — already covered by `route.terrain_classification` (Modal route
  intelligence) — and energy system.
- **The semantic axis already exists.** Jev Phase 2 classifies `Activity.name` into `purpose`
  (training/endurance/commute/recovery/race/social) and stores it in `Activity.context["tags"]`
  (`services/jev_tagging.py` `tag_activity` / `build_activity_tags`). It is shipped and — verified
  — **read by nothing**.

So Jev's cycling footprint is small and already mostly built. The plan is to *use* it, not extend
it.

---

## 2. What cycling already has (and what is missing)

| Strength building block | Cycling equivalent | Status |
|---|---|---|
| `focus` (which lift) | `route.terrain_classification` (discipline/terrain, Modal) | ✅ shipped |
| Jev `purpose` on `Activity.name` | the same tag | ✅ **shipped but write-only — no consumer** |
| planned `session_class` quality | `TrainingPlanDay.planned_type` (`rest`/`easy`/`moderate`/`hard`/`race`) + `planned_zone` | ✅ planned, day-level |
| planned workout type | `workout_type` (`rest`/`recovery`/`endurance`/`tempo`/`threshold`/`vo2max`/`strength`/`mixed`) — SuggestedDay + `_TYPE_TO_DIFFICULTY` | ✅ planner vocab |
| **actual** `session_class` (what the session was) | **actual-ride energy-system label** | ❌ **missing** |
| conformance | `build_cycle_conformity` (duration/power/TSS/route — all numeric) | ✅ numeric only |
| fatigue/load side | CTL/ATL/TSB, `ramp_rate`, `decoupling_trend`, power curves | ✅ numeric |

Two vocabularies already exist and must not be duplicated: `workout_type` (energy system) and
`planned_type` (day intensity). The new actual-ride label should reuse the **`workout_type`**
vocabulary, because a ride *is* an energy-system session.

---

## 3. Design principles

Inherit the strength utilisation principles
([`jev-strength-labels-utilisation.md`](jev-strength-labels-utilisation.md) §1) and add:

1. **Deterministic first, Jev last.** Power → HR → Jev → NULL. Jev never overrides a measured
   power profile.
2. **Never rewrite stored TSS/CTL from a label.** Excluding commutes is a *view*, opt-in, not a
   migration of history.
3. **One vocabulary.** Reuse the existing `workout_type` set; do not invent a second one.
4. **Provenance.** The label records `source` (`power`/`hr`/`jev`) so a guess is never mistaken
   for a measurement.

---

## 4. The work

### 4.1 Consume the dead `purpose` tag  *(highest value, lowest effort)*
`Activity.context["tags"]["purpose"]` is produced for every activity with a name and read by
nothing. Wire it in:
- **Chip + filter** on the activity card/detail and the activities list ("commute", "race", …).
- **Exclude non-training rides from load/consistency analytics (opt-in).** A commute currently
  contributes to TSS/CTL and to `consistency_heatmap` — it is training the user did not intend as
  training. Add a "training-only" filter to the load/consistency views that drops
  `purpose="commute"` (and optionally `recovery`). **Default unchanged**, so no historical
  reinterpretation happens behind the user's back.
- **Feed the weekly narrative.**

This alone makes the shipped Jev work pay off, with no new Jev surface.

### 4.2 Deterministic actual-ride classifier (`ride_type`)

New `services/ride_classification.py` — the true `session_class` counterpart, but computed:

| Input | Source |
|---|---|
| Intensity factor (NP ÷ FTP) | `Activity.normalized_power`, `FtpHistory` |
| Variability index (NP ÷ AP) | `Activity.normalized_power` / `average_power` |
| Time-in-zone distribution | `Activity.streams` (`ActivityStream`) |
| Duration | `Activity.duration_seconds` |
| HR fallback (no power) | `average_heartrate` + HR zones |

Classify into the **existing `workout_type` vocabulary** (`recovery`/`endurance`/`tempo`/
`threshold`/`vo2max`/`mixed`, plus `sprint`/`race` if the taxonomy extends). Degrade:
power → HR → skip. Store `source` (`power`|`hr`).

- **Storage**: `Activity.context["ride_type"]` (no migration) *or* a typed `Activity.ride_type`
  column. Typed is better for charts/filters/`GROUP BY` (same reasoning as the strength
  `session_class`). Decision U1.
- **Consumers**: the ride-mix chart, ride_type × TSS, and label-level conformance (§4.4).

### 4.3 Jev fallback for power-less rides  *(low priority, honest)*

When no power (and optionally no HR) the deterministic classifier cannot fire. Extend
`tag_activity` to ask Jev for a `ride_type` (and to confirm `purpose`) from
`{name, sport_type, duration, distance, avg_hr, route terrain, notes}`.
- Bounded: only fires on the (small) power-less set — low call volume.
- **Gate**: rule/deterministic first; Jev only fills the gap; `source="jev"` recorded.

### 4.4 Intent-vs-execution  *(the one place Jev adds unique signal)*

Compare **declared intent** against **measured execution**:
- Jev `purpose` vs deterministic `ride_type` — "logged as a recovery spin, rode tempo."
- planned `planned_type`/`planned_zone` vs `ride_type` — "plan said threshold, you rode endurance".

The second is a **label-level conformance** that is more robust than `build_cycle_conformity`'s
numeric power comparison (which is sensitive to FTP drift). It *augments*, never replaces, the
numeric components — keep duration/power/TSS/route scoring exactly as-is and add a label component
(mirroring the strength plan's `focus` component).

### 4.5 Charts & metrics
- `ride_mix` — distribution of `ride_type` over time (the cycling analogue of
  `session_class_mix`), via `ChartService` + `CHART_REGISTRY`.
- `purpose_mix` — training/commute/race/recovery split (justifies the training-only filter).
- Goal metrics (`goal_metrics.METRIC_REGISTRY`): `ride_type_sessions`
  (`optional_filter=["ride_type"]`), `purpose_sessions` (`optional_filter=["purpose"]`).

### 4.6 Weekly narrative
Feed `ride_type` + `purpose` mix into the weekly `LlmAnalysis` narrative (AI-analysis pattern) —
"this week was two threshold sessions, a long endurance ride, and three commute junk-miles."

---

## 5. Non-goals

| Do not | Why |
|---|---|
| Add a push/pull/legs-style split | meaningless for cycling |
| Ask Jev for a training zone when power exists | worse than the power curve; breaks the Jev charter |
| Invent a second ride-type vocabulary | `workout_type` already exists |
| Silently drop commutes from historical CTL | opt-in view only; never rewrite history |
| Let a label alone drive a health/fatigue alert | escalation contract (§3 of the strength doc) |
| Bundle a `build_cycle_conformity` semantics change with charts | keep the numeric path stable and reviewed separately |

---

## 6. Phasing

| Phase | Work | Jev? | Effort | Risk |
|---|---|---|---|---|
| **1** | `purpose` chip + filter + training-only load view (§4.1); deterministic `ride_type` classifier + storage (§4.2) | no | S–M | Low |
| **2** | `ride_mix` + `purpose_mix` charts (§4.5); label-level conformance component (§4.4); intent-vs-execution insight; goal metrics | no | M | Low–Medium |
| **3** | Jev power-less fallback (§4.3); weekly narrative (§4.6) | yes | S | Low |

Note the shape: **Jev work is last and smallest.** Phases 1–2 are deterministic.

---

## 7. Acceptance criteria & success signals

**Correctness / safety**
1. `ride_type` is never populated from Jev when power (or HR) is available — `source` proves it.
2. With Jev unset, `purpose` is simply absent and every consumer degrades to today's behaviour.
3. The training-only view does not mutate or recompute stored `Activity.tss`; it filters.
4. `build_cycle_conformity`'s numeric components are unchanged when the label component is added.
5. No notification/health output can fire from a label alone.

**Value**
6. The `purpose` tag has ≥ 1 consumer in production (measurable: % activities with a purpose that
   surface a chip; the tag is no longer dead).
7. `ride_type` coverage > target for rides with power (measure before shipping).
8. Intent-vs-execution mismatch rate is measured and surfaced for at least the `purpose=recovery`
   case.

---

## 8. Open questions

| # | Question | Recommendation |
|---|---|---|
| C1 | Typed `Activity.ride_type` column, or `context["ride_type"]`? | Typed column (charts `GROUP BY` it), if the migration cost is acceptable. |
| C2 | Is `ride_type` ever Jev's job, or always deterministic? | Always deterministic where power/HR exist; Jev is a power-less-only fallback (§4.3). |
| C3 | Reuse `workout_type` exactly, or extend with `sprint`/`race`? | Reuse first; extend only if a consumer needs the split. |
| C4 | Exclude `recovery` from load views, or only `commute`? | `commute` first (clearest false signal); `recovery` opt-in later. |
| C5 | Is `purpose` the sole Jev role for cycling, or do we add §4.3? | Ship §4.1 first; add §4.3 only if power-less rides are common in real data. |
| C6 | `plan_workout`/`_TYPE_TO_DIFFICULTY` mapping from `ride_type` → difficulty for conformance? | Reuse the existing map; don't add a parallel one. |

---

## 9. Docs to update (in the same PRs)

- `docs/JEV_TAGGING.md` — note that `purpose` now has consumers.
- `docs/algorithms.md` — the `ride_type` classification rules (IF / VI / time-in-zone / HR bands).
- `AGENTS.md` + `backend/app/services/CODEMAP.md`, `backend/app/api/CODEMAP.md` — new service,
  charts, metrics.
- `frontend/src/CODEMAP.md` — purpose chip/filter, ride-mix chart.
- `plans/jev-strength-labels-utilisation.md` — cross-reference (shared principles).

---

## 10. Relationship to existing plans / systems

- **Strength docs** (`jev-strength-session-classification.md`,
  `jev-strength-labels-utilisation.md`) — shared principles; this is the cycling counterpart, but
  leaner and mostly non-Jev.
- **`jev_tagging.py`** — §4.1 consumes the shipped `tag_activity` output; §4.3 extends it.
- **`conformity.py`** — §4.4 adds a label component to `build_cycle_conformity` without changing
  its numeric components.
- **`charts.py` + `CHART_REGISTRY`**, **`goal_metrics.py`**, **`LlmAnalysis`** — §4.5/§4.6.
- **Modal route intelligence** — terrain/discipline axis already covered; not duplicated here.
- **`docs/algorithms.md`** — CTL/ATL/TSB remain the load source of truth; labels never replace them.
