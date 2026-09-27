# Jev Decision Layer — Free-Text Tagging & Match Arbitration

> **Status**: Design proposal — not approved, no code written. Companion to the Jev use-case
> exploration; covers use cases **3 (free-text tagging)** and **4 (heuristic match arbitration)**
> only.
> **Type**: New product capability, optional third-party integration (TypeSafe Jev / "System One").
> **Dependencies**: `typesafe-sdk` (Python 3.10+), `TYPESAFE_API_KEY`. No DB/Modal/Celery
> dependency is required for Phase 1.
> **Explicitly out of scope**: use cases 1 (NL query→filters), 2 (exercise-name canonicalization),
> 5 (Gemini guardrails); all AI-coding-agent / dev-workflow uses (`jev-harness`, `jev-reactor`);
> any numeric/statistical judgment (TSS, CTL/ATL/TSB, power curves, PR math, projections).

---

## 1. Motivation

Two separate patterns in the codebase make the same request of a classifier:

1. **Free text is collected but never interpreted.** `LiftingSession.notes` (2000 chars),
   `Activity.name`, `Event.notes`, `Goal.notes`, and the nutrition `actual_*_notes` fields are
   only ever matched with `ILIKE` (`backend/app/api/search.py`). A note saying *"left knee felt
   off on squats"* is invisible to `health_analysis.analyze_injury_risk()` and to
   `deficiency.py`, because both only see numbers.
2. **Three fuzzy matchers hand-roll their semantic comparison** with character-level string
   similarity or keyword lists. They work, but the semantic part is the brittle part, and each
   already logs or surfaces an "ambiguous" band that a classifier is ideally shaped for.

Jev is a good fit for both: fixed option sets, high call frequency, no free-form output to parse,
calibrated confidence to threshold on — and ~70–500ms / $0.042 per MTok input with output free.
It **cannot** generate text and does **not** accept images, which is exactly why it stays
subordinate to Gemini (narrative) and Modal/Gemini Vision (video) rather than replacing them.

---

## 2. Fit / non-fit summary

| Decision | Fit | Why |
|---|---|---|
| Tag free-text notes/names into a closed label set | ✅ Strong | Classic `Noul`/`Choice`/`Score`; output feeds existing services |
| "Are these the same session/route/workout?" tie-break | ✅ Strong | `Noul`/`match` with confidence, inside a numeric gate |
| Narrative coaching prose | ❌ | Jev generates no text — stays on Gemini (`llm_analysis.py`) |
| Form analysis from video | ❌ | Jev is text-only — stays on Modal + Gemini Vision |
| Load numbers, PR detection, projections | ❌ | Numeric/statistical — keep deterministic |
| Anything that needs an explanation for the user | ❌ | Jev returns probabilities, no rationale — use LLM narrative or deterministic math |

---

## 3. Shared foundation

All work in this doc depends on one optional integration module, mirroring the existing
Modal/Gemini pattern (config flag + "unset → no-op", never a hard dependency).

### 3.1 Config (`backend/app/config.py`)

```python
    # TypeSafe Jev (System One decisions) — optional. When unset, all Jev
    # call sites no-op and deterministic behaviour is unchanged.
    typesafe_api_key: str = ""
    jev_enabled: bool = True          # kill switch without unsetting the key
    jev_model: str = "jev-latest"     # pin a version for reproducibility
```

Add `"TypeSafe Jev": (self.typesafe_api_key, "x")` to the `_warn_optional_integrations()`
diagnostic (line 184) so an unconfigured deployment logs it like the other optional providers.

### 3.2 Client (`backend/app/integrations/jev_client.py`)

Single entry point so no call site imports the SDK directly:

```python
def is_configured() -> bool: ...

async def decide(
    state: str | dict,
    questions: dict[str, Question],
    *,
    timeout_s: float = 3.0,
) -> JevResult | None:
    """Return typed answers + confidence, or None when unset/unreachable.
    Never raises to the caller."""
```

- Question builders: `noul(instructions)`, `choice(instructions, criteria: dict)`,
  `score(instructions, criteria: list[str])` — thin wrappers over the SDK types.
- `JevResult` carries per-question `choice` / `noul` / `score`, `probabilities`, `confidence`,
  plus `model` and `computed_at`.
- Import the SDK lazily inside the function (keeps module import cheap and avoids an import-time
  failure taking down the app when the extra isn't installed).
- Reuse `services/llm_base.ai_generation_guard` for the per-user budget + in-flight dedupe, so
  Jev and Gemini share one guard against runaway calls.
- Return `None` on: unset key, `jev_enabled=False`, timeout, budget exceeded, SDK error.

### 3.3 Guardrails (apply to every call site)

| Rule | Detail |
|---|---|
| Never block a write | Tagging/arbitration is best-effort; the write commits regardless |
| Fail-safe on destructive actions | A low-confidence Jev answer must **never** auto-merge/link (see §5.4) |
| Threshold, don't trust | Confidence gates route to act / review / ignore (§4.4) |
| Provenance | Every stored decision records `source="jev"`, `model`, `confidence` |
| No medical claims | A tag may *feed* a health signal; it never *becomes* one without deterministic cross-check |
| Cap the state | Truncate to a few KB per record — the 64k context is shared with all questions |

### 3.4 Testing

- Offline stub via `JEV_FAKE=1` env (mirrors jevlang's `JEVLANG_FAKE_JEV`): deterministic canned
  answers, no network, so unit tests and CI never depend on early-access availability.
- `tests/test_jev_client.py`: `is_configured()` false when key unset; `decide()` returns `None`
  (not raises) on timeout; question-builder output matches the SDK schema.
- Per-call-site tests run against the stub.

### 3.5 Cost / latency budget

One call per record; state ~0.5–2k tokens. At $0.042/MTok that is ~$0.00008 per record — orders of
magnitude below a Gemini call. Latency ~100ms inside a best-effort path. Early-access limits
(~250k tokens, 1200 req/min) are far above this workload; the budget guard (§3.2) still applies.

---

## 4. Use Case A — Free-text tagging

### 4.1 Fields in scope

| Field | Location | Today | Tag type |
|---|---|---|---|
| `LiftingSession.notes` | `models/lifting.py:61` | stored, `ILIKE` only | outcome + risk flags |
| `LiftingSession.program_name` / `.focus` | `models/lifting.py:50-53` | structured, no semantic check | consistency hint |
| `Activity.name` | `models/activity.py` | Strava string | ride purpose |
| `Event.name` / `.event_type` | `models/event.py` | free string | event category |
| `Goal.notes` | `models/goal.py:42` | stored | intent hint (later) |

Start with **`LiftingSession.notes`** — it has no existing interpretation, feeds the most
services, and carries the highest value (injury/fatigue signals).

### 4.2 Decisions (one batched call per record)

```python
questions = {
    "pain_injury":   noul("Does the athlete mention pain, a tweak, or an injury?"),
    "high_fatigue":  noul("Does this describe unusual fatigue or overreaching?"),
    "pr_mention":    noul("Does this mention a personal record or a new max?"),
    "outcome":       choice("What best describes the session?",
                            {"breakthrough": "...", "on_target": "...",
                             "grind": "...", "failed_sets": "...", "deload": "..."}),
    "energy":        score("Rate reported energy/motivation.",
                           ["low", "ok", "high"]),
}
```

State is the raw note plus minimal numeric context the answer could be misled by without:
`{note, focus, duration_seconds, rpe_session, total_volume_kg}`. All questions are answered in
parallel; adding questions adds ~no latency.

### 4.3 Example request

```json
{
  "model": "jev-latest",
  "state": {"note": "Squats felt heavy, left knee a bit sore after set 3. Grinded through.",
            "focus": "squat", "duration_seconds": 3900, "rpe_session": 8.5, "total_volume_kg": 6400},
  "questions": { "...": "as §4.2" }
}
```

### 4.4 Confidence routing

| Signal | Threshold | Action |
|---|---|---|
| `pain_injury` (Noul) | ≥ 0.70 | Emit tagging signal consumed by `health_analysis` / injury-risk surface |
| | 0.40–0.70 | Store tag, surface for manual review, do not notify |
| | < 0.40 | Drop |
| `high_fatigue` | ≥ 0.70 | Feed `adaptive.py` / readiness context |
| `outcome`, `purpose` (Choice) | confidence ≥ 0.60 | Store as badge; else omit |
| `energy` (Score) | always | Store expected value |

### 4.5 Storage

- **Activities / events**: write into the existing `Activity.context` JSONB
  (`models/activity.py`) under a `"tags"` key — **no migration**.
- **Lifting sessions**: no JSONB bucket exists, so add one — `ai_tags JSONB NULL` on
  `lifting_sessions` (migration `0XX_add_lifting_ai_tags`). Symmetric with `Activity.context`.

```jsonc
// lifting_sessions.ai_tags
{
  "source": "jev", "model": "jev-latest", "computed_at": "2026-09-21T...",
  "outcome": "grind", "outcome_confidence": 0.71,
  "pain_injury": 0.82, "high_fatigue": 0.55, "energy": 1.0
}
```

### 4.6 Triggers

1. **Inline, best-effort** on session create/update — fire-and-forget after the write commits;
   `decide()` returning `None` is a silent no-op.
2. **Weekly backfill task** `backfill_free_text_tags` patterned on
   `backfill_activity_context` (§AGENTS Celery table) — tags rows missing/with stale `model`.
3. *(Optional)* manual re-tag on the session detail endpoint.

### 4.7 Consumers

- `services/health_analysis.py` — `pain_injury` / `high_fatigue` as additional injury-illness
  inputs, cross-checked against the numeric signals before an alert is raised.
- `services/deficiency.py` / `services/adaptive.py` — qualitative form as a secondary signal.
- `services/notifications.py` — surface a `pain_injury` tag at most once, review-gated.
- `api/search.py` — already searches notes; tags become an additional facet.

### 4.8 Frontend

Badges on the lifting-session detail and the activity card (via `include_context`); an optional
tag filter on the sessions list. Follows the existing badge components — no new pattern.

---

## 5. Use Case B — Match arbitration

### 5.1 Current matchers

| Matcher | Ref | Signals & weights | Gate | Ambiguous band |
|---|---|---|---|---|
| Activity ↔ lifting session | `strava/linking.py:94` `_match_score` | date 0.5 / duration 0.2 / keyword overlap 0.3 | `MATCH_THRESHOLD = 0.55` | `_focus_overlap_score` returns neutral 0.3 / fuzzy 0.8 / partial 0.2 |
| Activity dedup | `merge_service.py:141` `find_duplicate_activity` | date 0.40 / sport 0.20 / duration 0.20 / distance 0.20 | `settings.activity_merge_threshold` (0.55) | **name not used at all**; near-miss logged at `threshold−0.05` (`:194`) |
| Route dedup | `route_service.py:119` `_compute_match_score` | shape 0.50 / proximity 0.20 / distance 0.20 / name 0.10 | `settings.route_match_threshold` (0.55) | `_name_score` is char-level `SequenceMatcher`; `find_potential_duplicates` (`:613`) already returns `requires_confirmation` |

The spatial/numeric parts are correct and stay. The brittle part in each is the *semantic* one:
keyword matching (`_EXERCISE_KEYWORDS`), no name at all, and character-ratio names.

### 5.2 Two-threshold band

Replace the single gate with a band; Jev is consulted **only** inside it:

```
score < low   → reject (unchanged)
score ≥ high  → accept (unchanged)
low ≤ score < high → Jev arbitration → act only if confidence ≥ threshold, else review
```

`low` = current threshold − δ, `high` = current threshold + δ (start δ = 0.08; tune per matcher
using the existing near-miss logs). This keeps call volume proportional to *disagreements*, not to
all syncs.

### 5.3 Question shapes per matcher

| Matcher | Jev question | Act rule |
|---|---|---|
| `linking._match_score` | `noul("Is this Strava strength activity the same session as this lifting log?")` over `{activity.name, session.focus, session.program_name, session.notes}` | link if ≥ 0.75; review 0.5–0.75; skip < 0.5 |
| `find_duplicate_activity` | `noul("Are these the same workout from two providers?")` over both names + sport/duration | merge only if ≥ 0.80 **and** numeric score ≥ `low` |
| `find_potential_duplicates` | `choice("same | different | unclear", ...)` over the two route names/descriptions | remove clear "different" from the review queue; pre-label "same" as a one-tap confirm |

### 5.4 Fail-safe rules (non-negotiable)

| Condition | Behaviour |
|---|---|
| Jev unset / timeout / error | Exactly today's deterministic behaviour (no link, no merge) |
| Confidence below act-threshold | Candidate goes to the existing review/`requires_confirmation` surface |
| Destructive merge | Requires Jev ≥ act-threshold **and** the numeric gate; never Jev alone |
| Any merge/link | Recorded with `source="jev"`, decision, confidence, model for audit/replay |

### 5.5 Persistence & UI

Store `{candidate_id, deterministic_score, jev_decision, confidence, model, computed_at}` (in the
near-miss log for now; a small `merge_candidates` table if a review UI is built). Surface
"possible duplicate — confirm?" on the routes and activities pages, reusing the existing merge
endpoints (`route_service.merge_routes`, `merge_service.merge_activity`).

### 5.6 Preserved invariants

- Numeric/spatial gates and weights are untouched; Jev only replaces the *tie-break*.
- Sync idempotency is unaffected (Jev runs after the deterministic decision, not instead of it).
- Live-sync idempotency (`live_key`, `client_id`) and webhook-queue processing are not in this path.

---

## 6. Migrations

| # | Change | Phase |
|---|---|---|
| `0XX_add_lifting_ai_tags` | `ALTER TABLE lifting_sessions ADD COLUMN ai_tags JSONB NULL` | 1 |

Activities/events use the existing `Activity.context` JSONB (no migration). Match arbitration
needs no schema change for Phase 3 (log-based); a `merge_candidates` table is only needed if a
review UI ships (Phase 4).

---

## 7. Rollout phases

| Phase | Work | Risk | Value |
|---|---|---|---|
| 0 | `jev_client.py`, config, budget guard, fake-mode, tests | None (no call sites) | Foundation |
| 1 | Tag `LiftingSession.notes`; `ai_tags` migration; inline + weekly backfill; badges on session detail | Low (additive) | Injury/fatigue signals, qualitative badges |
| 2 | Tag `Activity.name` (purpose) + `Event.name` (category) into `Activity.context` | Low | Better filters/search |
| 3 | Route `find_potential_duplicates` arbitration (already human-gated) | Low | Shrinks manual duplicate review |
| 4 | `linking._match_score` and `find_duplicate_activity` band arbitration + review surface | Medium (touches linking/merge) | Fewer missed links, fewer false merges |

Sequencing rationale: start where a wrong answer costs the least. Tagging is additive; route
duplicates are already review-gated; auto-linking is last.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Calibrated ≠ correct (valid answer can still be wrong) | Thresholds + review band; never auto-merge on Jev alone |
| Sending user notes to a third party | Document in privacy review; consider per-user opt-in; send only the note text, cap length |
| Early-access availability / rate limits | Budget guard; `None` fallback; `jev_enabled` kill switch |
| Vendor/API churn (`jev-latest` alias moves) | Pin `jev_model`; isolate all SDK use in `jev_client.py`; store model per row |
| Latency in a write path | Best-effort inline + weekly backfill; never block the commit |
| 64k context shared across questions | Truncate state per record; one record per call |
| Over-tagging / alert fatigue | Confidence ≥ 0.70 for any signal that can notify; dedupe notifications |

---

## 9. Open questions

1. **Consent/privacy** — is sending lifting notes to TypeSafe acceptable by default, or opt-in?
2. **User-editable tags?** — do tags become editable/removable like route tags, or read-only hints?
3. **Raw-response retention** — store only derived tags, or the full Jev response for debugging?
4. **A local classifier instead?** — for the narrow note labels, is a small on-box model preferable
   to a hosted call? (Jev's advantage is zero training data + calibration.)
5. **`low`/`high` band values** — need near-miss log analysis per matcher before tuning.

---

## 10. Acceptance criteria

**Phase 1**
1. `jev_client.decide()` returns `None` (no raise) when unset/timeout; all writes succeed regardless.
2. Tagging a lifting note stores `ai_tags` with `source="jev"` + confidence; `pain_injury` ≥ 0.70 is
   surfaced to the health signal path behind a deterministic cross-check.
3. Weekly backfill tags untagged/stale rows; re-running is idempotent.
4. Offline test suite green with no `TYPESAFE_API_KEY`.

**Phase 3**
5. Route pairs that Jev marks `different` leave the review queue; `same` pairs arrive pre-labelled
   as one-tap confirms; the deterministic score is unchanged in the response.
6. With Jev unset, duplicate output is byte-for-byte today's behaviour.
