# Bug Review — 2026-10-15

**HEAD**: `5f54f40` (detached, clean tree)
**Method**: static reading + ripgrep. **Revised 2026-10-16** after the two "critical 500"
findings in the first pass were re-checked against the code and did not hold — the corrected
triage is below, and the discarded claims are listed explicitly in §2 so nobody re-chases them.

> Related sources: `docs/BUGS.md` (5 open, tracked), the 43 "Critical Pitfalls" in `AGENTS.md`
> (not repeated here), and `plans/weak-areas-remediation-2026-09-26.md` (Track 3 ×7 / Track 4 ×9
> still open — several rows below are re-confirmations of that list).

---

## 1. Confirmed defects (code-verified)

| ID | Title | Severity | Evidence | Impact | Fix | Confidence |
|----|-------|----------|----------|--------|-----|------------|
| BUG-R01 | **Unvalidated `weight_kg` on the custom effort-estimate endpoint → `ZeroDivisionError` → 500** | medium | `schemas/route.py:375-381` — `EffortEstimateRequest.weight_kg: float` has **no `gt=0`**; `api/routes.py:740-746` passes it straight to `estimate_effort`; `services/effort_estimator.py:177` does `wpk = power_watts / weight_kg` with no guard | An authenticated `POST /routes/{id}/effort-estimate-custom` with `weight_kg: 0` raises an unhandled `ZeroDivisionError`. Not reachable from the UI (the client sends profile values), so this is a crafted-request 500, not a user-facing crash | Add `Field(gt=0)` to `weight_kg` (and `ftp_watts`) in the schema, plus a defensive `if weight_kg <= 0: return <zeros>` in `estimate_required_power` | high |
| BUG-R30 | **Wahoo route-sync `merged_count` is never incremented** | medium | `services/wahoo.py:427` (`merged_count = 0`) → `:550` (`return synced_count, merged_count`); the only other occurrences are the log line `:548`. There is no `merged_count += …` anywhere | The sync summary always reports `0 merged` even when `create_or_merge_route` merged rows — a *lying metric* (same class as SYNC-11 in `weak-areas-remediation`) | Increment when `create_or_merge_route` reports a merge | high |
| BUG-R31 | **Whoop weigh-ins dated with server-local `date.today()`** | medium | `services/whoop.py:1295` — `today = date.today()` used as `WeightLog.date` | A weigh-in for a user in a non-server timezone can land on the wrong calendar day, so it can miss a genuine same-day entry or write a spurious one. (SYNC-12) | Derive the date from the user's local offset, as the cycle/sleep paths already do via `_local_date_from_utc` | high |
| BUG-R32 | **Route-pair proximity grid ignores `cos(lat)` on *both* axes** | medium | `services/route_matching.py:260` and `:338` — `cell_deg = tol_m / 110_000.0` for lat **and** lng; the module already scales longitude correctly elsewhere (`:102` `_M_PER_DEG_LNG * cos(lat)`, `:697`) | At ~55 °N a longitude degree is ~64 km, not 110 km, so the cell is ~1.7× too wide in longitude → the O(n²)-reducing grid can miss genuine candidates at high latitude. (Track 4) | Size the longitude cell by `tol_m / (110_000 * cos(lat))`; add a ~55 °N test | high |
| BUG-R08 | **JSONB `None` written as JSON `null`, not SQL `NULL`** | high (informational) | Only 5 columns declare `JSONB(none_as_null=True)` (`models/activity.py:118,121`; `models/route.py:63,67,70`). ~45 other JSONB columns write a JSON `null` when assigned `None`, so `IS NULL` will not match | Already mitigated for the road-match/terrain columns by migration 092; the rest are deliberately left as-is (AGENTS pitfall #28). Listed so a future `WHERE <jsonb> IS NULL` is not written against a non-`none_as_null` column | Confirm the column declares `none_as_null=True` before any `IS NULL` filter | medium |
| BUG-R09 | **Unbounded `.all()` on list endpoints** | medium (suspected) | e.g. `api/activities.py:233,416,442,475,671,1420,1648`; `api/routes.py:284,644,661,1183,1214,1450,1496,1654,1720,1761,1776` | Endpoints without an explicit limit can load a user's entire history into memory (latency/memory pressure). Some may be filtered small in practice — flagged rather than confirmed | Add `limit`/`offset` where a user-facing list can grow unbounded | low |
| BUG-R22 | **Live-session flush aborts the whole batch on one failed set** | medium (suspected) | `plans/2026-10-01-live-session-flush-liveness.md:50` describes `throw new Error('add-set-failed')` aborting the flush | A single rejected set can lose the rest of the queue — consistent with the plan's own "one bad set can wedge a workout" framing. Needs live repro | Per-set error isolation; continue on partial failure | low |

---

## 2. Already fixed / false positives (do NOT chase)

These appeared in the first pass and were re-verified as **not defects**. Listed so they are not
re-discovered.

| Claim | Why it does not hold |
|-------|----------------------|
| "`/routes/{id}/effort-estimate` 500s without FTP/weight" | **False.** `api/routes.py:705` guards `if profile and profile.ftp_watts and profile.weight_kg:` and otherwise returns a friendly "configure your Cycling Profile" payload — it never calls `estimate_effort`. The real issue is the *custom POST* variant (BUG-R01). |
| "`/quality/recompute` 500s without weight" | **False twice over.** (a) `route_quality_service.py:134` returns `50.0` when `not ftp_watts or not weight_kg`, so the later division is unreachable for `weight_kg == 0`; (b) `/quality/recompute` wraps each route in `try/except … logger.warning` (`api/routes.py:664-669`), so it cannot 500 — worst case a route is silently left unscored. |
| "VO2max divides by zero on `weight_kg == 0`" (R03) | **False.** `services/cycling/vo2max.py` guards `if weight_kg and weight_kg > 0` on the weight path. |
| "`prs.py` W/kg division unguarded" (R04) | **False.** `services/cycling/prs.py:174` is guarded by `if weight_kg and weight_kg > 0`. |
| "power-zone W/kg division unguarded" (R05) | **False.** `api/cycling/power.py:302-303` is guarded. |
| "`/cycling/power-curve` 500s when no FTP" (R12) | **False.** The handler returns `ftp_watts=ftp` (None allowed) and performs **no** division by FTP; the sibling `/power-zones` guards with an explicit `400`. |
| "MissingGreenlet on `/routes/duplicates`" (R06) | **Fixed.** Both `find_cached_duplicates` and `find_potential_duplicates` eager-load `tags` (`services/route_service.py`). |
| "Auth queries missing `enabled: !!token`" (R19) | **Fixed / not present.** Audited queries include the token guard (pitfall #11 satisfied). |
| "Service Worker caches API responses" (R20) | **Not present.** `frontend/public/sw.js` is network-only for `/api/v1/` (pitfall #10 satisfied). |
| "React Query keys collide" (R21) | **Not a defect.** `['route-weather', id]` vs `['zoneflow-weather', lat, lng]` are distinct keys over one data source — that is allowed. |

---

## 3. Migration chain

| ID | Finding | Evidence | Confidence |
|----|---------|----------|------------|
| BUG-R13 | **Chain is clean.** Single head `099`; revisions `003` and `073` are absent but **not dangling** (`074.down_revision == "072"`; `004_add_pr_notes.py` carries `revision = "004"`), so `docs/BUGS.md` **BUG-013 is already fixed**. No duplicate revision ids at/above `090`. | `backend/alembic/versions/`, revision headers | high |

---

## 4. Docs / config inconsistencies

| ID | Title | Severity | Evidence | Fix |
|----|-------|----------|----------|-----|
| BUG-R14 | `RUNNING.md` claims migration head is `079` | medium | `docs/RUNNING.md:112` — "…→079(head)"; actual head is **`099`** | Update to 099 |
| BUG-R15 | `RUNNING.md` gives contradictory pytest instructions | high | `:58-62` "Run inside the backend container"; `:75-76` "Run from the host instead" | Lead with the host command (pitfall #23); mention the container only to warn |
| BUG-R16 | `RUNNING.md` cites the wrong pitfall number | medium | `:75` "AGENTS.md pitfall #19" — #19 is bilateral-weights; stale-container-tests is **#23** | Fix the reference |
| BUG-R17 | `RUNNING.md` cites a phantom migration duplicate | medium | `:112` "014_add_composite_indexes.py is a stale duplicate" — the files are `014_add_surface_profile.py` and `015_add_composite_indexes.py`; no duplicate exists | Delete the phantom claim |
| BUG-R18 | Services CODEMAP references `extract_activity_polyline()` with a misleading signature note | low | `backend/app/services/CODEMAP.md:38` | Update to match `polyline_utils.py` |
| BUG-R33 | **`AGENTS.md` "Training page overhaul … Nothing built yet" is stale** | medium | Phases 0–4 + S1 + S2 shipped (`api/training_plans.py:478-560`; `components/training/*`; commits `834208e`…`5f54f40`) | Update the Active Planning section |

---

## 5. Frontend

| ID | Finding | Severity | Confidence |
|----|---------|----------|-----------|
| BUG-R22 | Live-session flush aborts the batch on one failed set (see §1) | medium | suspected |
| — | No other new confirmed frontend defects found in this pass; the pitfall-10/11 classes were audited and are satisfied (see §2). | — | — |

---

## 6. `TODO` / `FIXME` / `type: ignore` / `noqa` triage

| ID | Finding | Severity | Evidence |
|----|---------|----------|----------|
| BUG-R23 | `type: ignore[return-value]` on `get_session` returns in `lifting.py` | low | `services/lifting.py:322,378,532,1449,1486` — masks a possible `None` |
| BUG-R24 | `type: ignore[arg-type]` on enum `level`/`severity` in `deficiency.py` | low | `services/deficiency.py:435,437,504` |
| BUG-R25 | `type: ignore[name-defined]` on relationship forward refs across models | low | `models/activity.py`, `models/cycling.py`, `models/daily_metric.py`, … |
| BUG-R26 | `noqa: TRY004` — `ValueError` instead of a typed exception | low | `schemas/training_plan.py:17` |
| BUG-R27 | `WebPushException = Exception  # type: ignore[assignment,misc]` fallback in `push.py` | low | `services/push.py:28-29` — masks a missing `pywebpush` |
| BUG-R28 | `import cv2  # noqa: F401` example in a plan markdown | trivial | `plans/2026-10-01-video-pipeline-trust-spine.md:68` |

These are all cosmetic-but-telling: each `type: ignore` marks a place where the type system was
silenced rather than satisfied. None is a live defect on its own.

---

## Not re-reported (already tracked)

`docs/BUGS.md` open items (BUG-015, BUG-025, BUG-045, BUG-048, BUG-068) and the `AGENTS.md`
pitfalls are deliberately excluded. BUG-013 is **fixed** (see BUG-R13). The open Track 3/4 rows in
`plans/weak-areas-remediation-2026-09-26.md` (SCI-02 taper compounding, RMI-12 `W'` bound,
SYNC-06/07/08 N+1s, Replay3D `raceMarkers` misalignment, `useLiveSession` 4xx handling, …) remain
open and are not duplicated here — read that plan for the full list.
