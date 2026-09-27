# Jev Decision Layer — Implementation Plan (2026-09-27)

> **Status**: Implementation plan — no code yet. The "why/what" lives in
> [`plans/jev-decision-layer.md`](jev-decision-layer.md) (design proposal). This doc is the
> "how/when": verified touchpoints, exact files, migration numbers, tests, and PR sequence.
>
> **Scope** (unchanged): use cases **3 (free-text tagging)** and **4 (heuristic match
> arbitration)** only. Explicitly **not**: NL query→filters, exercise-name canonicalisation,
> Gemini guardrails, any numeric/statistical judgment (TSS/CTL/ATL/TSB, PR math, projections).
>
> **Hard dependency**: `typesafe-sdk` + `TYPESAFE_API_KEY`. Optional integration: when unset,
> everything no-ops and deterministic behaviour is byte-for-byte unchanged.

---

## 0. Verified touchpoints (against `main` @ `a680879`, 2026-09-27)

| Concern | Location (current) | Notes |
|---|---|---|
| Optional-integration diagnostic | [`config.py:235`](../../backend/app/config.py) `_warn_optional_integrations` | dict of `name → (id, secret)`; add a Jev entry |
| AI budget/lock guard | [`services/llm_base.py:104`](../../backend/app/services/llm_base.py) `ai_generation_guard(user_id, kind, target)` | async context manager; **raises `HTTPException(429)`** — must be wrapped for Jev |
| Lifting session fields | [`models/lifting.py:50-61`](../../backend/app/models/lifting.py) | `program_name`, `focus`, `total_volume_kg`, `rpe_session`, `notes` (`String(2000)`) |
| Activity JSONB bucket | [`models/activity.py:102`](../../backend/app/models/activity.py) `context` | reuse under a `"tags"` key — no migration |
| Injury analysis | [`services/health_analysis.py:440`](../../backend/app/services/health_analysis.py) `analyze_injury_risk` | composite of `_volume_spike_signal`, `_rest_day_signal`, … |
| Activity↔session link matcher | [`services/strava/linking.py`](../../backend/app/services/strava/linking.py) — `_focus_overlap_score:69`, `_match_score:94`, `MATCH_THRESHOLD = 0.55:141` | keyword lists `_EXERCISE_KEYWORDS:30` |
| Activity dedup | [`services/merge_service.py:141`](../../backend/app/services/merge_service.py) `find_duplicate_activity` | single gate `settings.activity_merge_threshold`; near-miss log `:193` |
| Route dedup | [`services/route_service.py:132`](../../backend/app/services/route_service.py) `_compute_match_score`, `:125 _name_score`, `:966 find_potential_duplicates`, `:608 merge_routes` | **already two-tier**: `route_match_threshold=0.55` (review floor) / `route_match_auto_threshold=0.82` (auto-merge); response carries `tier` + `requires_confirmation` |
| Search (ILIKE only) | [`api/search.py:106`](../../backend/app/api/search.py) | `LiftingSession.notes.ilike(...)` |
| Migration head | `080` | new migration is **`081_add_lifting_ai_tags`** |

**Design refinement discovered:** routes are **already** a two-tier matcher (`0.55` review →
`0.82` auto). So Phase 3's "band" is not new plumbing — Jev arbitrates the **existing review
tier** (`0.55 ≤ score < 0.82`). Activities and linking still have a single gate.

---

## 1. Recommended sequencing

| Phase | Ships | Risk | Decision needed |
|---|---|---|---|
| **0** | Foundation: client, config, guard, fake mode, tests (no call sites) | None | — |
| **1** | Tag `LiftingSession.notes`; `ai_tags` (migration 081); inline + backfill; health consumer; badge | Low (additive) | Q1 **resolved**: on by default |
| 2 | Tag `Activity.name` / `Event.name` into `Activity.context.tags` | Low | — |
| 3 | Route duplicate **review-tier** arbitration (already human-gated) | Low | — |
| 4 | `linking._match_score` + `find_duplicate_activity` band arbitration + review surface | **Medium** (touches linking/merge) | Band values (Q5) |

**Ship Phase 0 + 1 first**, then reassess before touching matchers. Each phase is an independent
PR into `main`.

---

## 2. Phase 0 — Foundation (no call sites)

### 2.1 Config (`backend/app/config.py`)
```python
    # TypeSafe Jev (System One decisions) — optional. Unset → all call sites no-op.
    typesafe_api_key: str = ""
    jev_enabled: bool = True          # kill switch without unsetting the key
    jev_model: str = "jev-latest"     # pin a version for reproducibility
    jev_timeout_s: float = 3.0
```
Add to `_warn_optional_integrations()`: `"TypeSafe Jev": (self.typesafe_api_key, "x")`.

### 2.2 Dependency
Add `typesafe-sdk` to `backend/requirements.txt` (or `pyproject`). **Rebuild the backend image**
(AGENTS pitfall #10) — the running container won't have it until then.

### 2.3 Client (`backend/app/integrations/jev_client.py`)

**Verified SDK surface** (`typesafe-sdk`, Python 3.10+, imported as `typesafe_sdk`; the app must
use the **async** client):
```python
from typesafe_sdk import AsyncTypeSafeClient, Choice, Noul, Score
client = AsyncTypeSafeClient(model=settings.jev_model)   # reads TYPESAFE_API_KEY from env
resp = await client.system_one(state=state, questions=questions)
resp.answers["pain_injury"].noul        # float 0..1
resp.answers["outcome"].choice          # winning label
resp.answers["energy"].score            # float
# each answer also exposes .probabilities and .confidence; resp.nouls/.choices/.scores are typed shortcuts
```
- `Noul(instructions=...)`; `Choice(instructions=..., criteria={label: desc|None})`;
  `Score(instructions=..., criteria=[...])` — **`Score.criteria` is an ordered sequence**
  (≥0.6.0; index = score), not an int-keyed dict.
- The SDK auto-retries 408/429/5xx twice; so set our outer `asyncio.wait_for` timeout **above**
  that budget, and treat `TypeSafeRateLimitError` / `TypeSafeAPITimeoutError` /
  `TypeSafeAPIConnectionError` / `TypeSafeInternalServerError` / `TypeSafeError` as `None`.
- `resp.usage` (input tokens / cost estimate) — useful to log for the budget picture.

Client contract:
- `is_configured() -> bool` — key set **and** `jev_enabled`.
- `async def decide(state, questions, *, user_id=None, timeout_s=None) -> JevResult | None`:
  - Import the SDK **lazily** inside the function (cheap import; missing extra ≠ app crash).
  - **Never raises** to the caller: wrap SDK call, `asyncio.wait_for`, and the guard in
    `try/except Exception` → return `None`.
  - Reuse the budget guard: wrap `llm_base.ai_generation_guard(user_id, "jev", target)` in
    `try/except HTTPException` → `None` (the guard raises 429; Jev must swallow it).
  - Question builders `noul/choice/score` are thin adapters over the SDK classes (so SDK churn
    stays in this file).
  - `JevResult`: per-question answer + `probabilities` + `confidence`, plus `model`, `computed_at`.
- `JEV_FAKE=1` env → deterministic canned answers, no network (CI-safe).

### 2.4 Tests (`backend/tests/test_jev_client.py`)
- `is_configured()` false when key unset or `jev_enabled=False`.
- `decide()` returns `None` (never raises) on timeout / SDK error / budget `HTTPException`.
- Fake mode returns the canned shape; question-builder output matches the schema.

---

## 3. Phase 1 — `LiftingSession.notes` tagging

### 3.1 Migration `081_add_lifting_ai_tags`
`ALTER TABLE lifting_sessions ADD COLUMN ai_tags JSONB NULL` (+ model `Mapped[dict | None]`).
Register nothing new in `models/__init__.py` (column on an existing model). Verify
`alembic downgrade 080` + `upgrade head`.

### 3.2 Service (`backend/app/services/jev_tagging.py`)
- `async def tag_lifting_session(db, user_id, session_id) -> None`:
  - Load session; skip if `ai_tags` present with the current `jev_model`.
  - Build state: `{note, focus, program_name, duration_seconds, rpe_session, total_volume_kg}`
    (truncate note/state to a few KB).
  - Questions per design §4.2 (`pain_injury`, `high_fatigue`, `pr_mention`, `outcome`, `energy`).
  - `res = await jev_client.decide(...)`; if `None`, return (best-effort).
  - Apply §4.4 thresholds; write `session.ai_tags` (source/model/confidence) and commit.
- Confidence routes: `pain_injury ≥ 0.70` → signal; `0.40–0.70` → stored + review, no notify;
  `< 0.40` → drop. `outcome` needs confidence ≥ 0.60.

### 3.3 Triggers
1. **Inline best-effort** on session create/update (`api/lifting.py`): schedule the tag call
   fire-and-forget **after** the write commits (don't block; `None` = silent no-op).
2. **Weekly backfill** `backfill_free_text_tags` in `tasks/scheduler.py`, patterned on
   `backfill_activity_context` (per-user `task_session()`, per-user rollback, Redis task lock,
   beat entry). Tags rows missing/with stale `model`. Idempotent.

### 3.4 Consumers
- `health_analysis.analyze_injury_risk` (`:440`) — feed `pain_injury`/`high_fatigue` as
  additional inputs **behind a deterministic cross-check** (a tag never becomes an alert alone).
- `notifications` — surface a `pain_injury` tag at most once, review-gated.

### 3.5 Frontend
Badge on the lifting-session detail (and activity card via `include_context`), reusing existing
badge components. Optional tag filter later.

### 3.6 Tests
- Tagging stores `ai_tags` with `source="jev"` + confidence (fake mode); `None` → no write.
- `pain_injury ≥ 0.70` reaches the health path **only** with the numeric cross-check.
- Backfill is idempotent; re-run makes no changes.

---

## 4. Phase 2 — Activity / Event tagging
- `Activity.name` → purpose; `Event.name`/`event_type` → category. Store under
  `Activity.context["tags"]` (**no migration**).
- Same client, same guard, same best-effort trigger on sync/update; backfill extends the Phase 1
  task. Enrich `api/search.py` with tag facets (ILIKE stays).

---

## 5. Phase 3 — Route duplicate arbitration (review tier)
- In `find_potential_duplicates` (`route_service.py:966`), for pairs with
  `tier == "review"` (`0.55 ≤ score < 0.82`), ask Jev
  `choice("same | different | unclear", …)` over both names/descriptions.
- `different` → drop from the review list; `same` → pre-label as a one-tap confirm; store
  `{score, jev_decision, confidence, model}` in the response for audit.
- **Deterministic score is unchanged** in the response; Jev only re-orders/labels.
- Unset Jev → output is byte-for-byte today's.

---

## 6. Phase 4 — Linking & activity-dedup band (higher risk)
- `linking._match_score` (`:94`): introduce `low/high` = `MATCH_THRESHOLD ∓ δ` (start δ=0.08);
  inside the band, ask `noul("Is this Strava strength activity the same session as this lifting
  log?")` over `{activity.name, session.focus, session.program_name, session.notes}`. Link if
  ≥ 0.75, review 0.50–0.75, else skip.
- `merge_service.find_duplicate_activity` (`:141`): band around `activity_merge_threshold`
  (`0.55`); `noul("Are these the same workout from two providers?")` over both names + sport +
  duration. **Merge only if Jev ≥ 0.80 AND numeric ≥ low** (never Jev alone). Replace the bare
  near-miss log (`:193`) with the candidate record.
- Persist `{candidate_id, deterministic_score, jev_decision, confidence, model, computed_at}`
  (log for now; a `merge_candidates` table only if a review UI ships).

---

## 7. Testing strategy (all phases)
- **Offline only**: `JEV_FAKE=1`; no test may depend on network/early-access.
- Client contract tests (Phase 0) + per-call-site tests against the stub.
- **Regression invariant tests**: with Jev unset, each matcher's output must equal today's
  (add assertions to the existing `test_strava_sync`, `test_route_*`, `test_merge_*` suites).
- Guard test: budget `HTTPException` → `decide()` returns `None`, write still commits.

---

## 8. Decisions

| # | Question | Decision |
|---|---|---|
| Q1 | **Consent/privacy** — sending lifting notes to TypeSafe | **Decided 2026-09-27: on by default.** Tag all users' notes; add a visible privacy note (Settings page + docs). Send note text only, capped length. Keep `jev_enabled` as an ops kill switch; offer a per-user disable as an escape hatch. |
| Q2 | User-editable tags? | **Read-only hints** initially (derived, not user data) |
| Q3 | Store raw Jev response? | Store derived tags + `model`/`confidence` only; keep raw in debug logs |
| Q4 | Local classifier instead of hosted? | Keep Jev (zero training data + calibration); revisit if privacy blocks it |
| Q5 | Band δ values (Phase 4) — still open | Derive from existing near-miss logs before shipping Phase 4; don't guess |

### Q1 privacy-note requirements (Phase 1)
- Settings: a short note that lifting notes are sent to TypeSafe Jev for tagging, with the
  ability to disable it.
- A `docs/` note (e.g. `docs/JEV_TAGGING.md`) describing what is sent and how to turn it off.
- Send only the note text + the minimal numeric context in §3.2; never the whole session.

---

## 9. PR sequence
1. `feat/jev-foundation` — config + `jev_client.py` + fake mode + tests (Phase 0).
2. `feat/jev-lifting-tags` — migration 081, `jev_tagging.py`, inline trigger, backfill task, health consumer, badge (Phase 1).
3. `feat/jev-activity-tags` — Phase 2.
4. `feat/jev-route-arbitration` — Phase 3.
5. `feat/jev-matcher-arbitration` — Phase 4.

Each: isolated worktree → tests (`pytest` for backend, `tsc`/`vitest` for the badge) → PR into
`main` → release via `main → prod`. Docs (`AGENTS.md` integration table + optional-integration
diagnostic, CODEMAPs) updated in the same PR.
