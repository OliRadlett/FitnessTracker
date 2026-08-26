# Plan-Day Linking Fix — DEPLOYED & VERIFIED (2026-08-26)

> Status: fix live in production. Commits `0598fb6` (fix) + `13764a2` (test
> determinism) + `aa0054d` (other session's live-sync idempotency work) pushed
> to main and fast-forwarded to prod; deploy workflow green; migration 034
> applied. Prod verification: worker task reported `plan_day_linked: 1` and
> the 2026-08-25 bench day ↔ Push session row shows linked=true.
>
> Remaining roadmap below — next up: substitution-detection design session,
> then manual attach/unlink feature. Also outstanding: BUG-072 (OAuth token
> health) in docs/BUGS.md.

## Reported Bug

Strength sessions never auto-link to training-plan days in production ("No sessions linked") — neither via the WeeklyView "Link activities" button (`POST /{plan_id}/link-activities`) nor the Celery pass inside `sync_all_strava_activities` (worker logs show `plan_day_linked: 0` every run, no errors).

## Root Cause (confirmed against prod data)

**Focus vocabulary mismatch.** The planner writes lift-style `planned_focus` (`bench`, `squat`, `pull`, `push`) while recorded sessions carry muscle-group `focus` (`Push`, `Back`, `Legs`). The guard in `link_activities_to_plan_days` required exact case-insensitive equality, so e.g. prod pair 2026-08-25 (day `bench` ↔ session `Push`) never linked. Ruled out: plan status (plan IS active), timezone/date off-by-one, FK issues, multi-plan consumption.

## Fix Applied (code done — NOT yet tested/committed)

`backend/app/services/conformity.py`:
- Added `FOCUS_GROUPS` compatibility map (push/bench/ohp/chest/shoulders→push; pull/back/row→pull; deadlift→pull+legs; legs/squat/lower/quads/hamstrings→legs; full_body/accessories→all; upper→push+pull) + `_focus_groups()` / `_focus_conflict()` helpers.
- Replaced strict-equality guard in `link_activities_to_plan_days` with `not _focus_conflict(day.planned_focus, s.focus)` — only known disjoint groups block; unknown/free-form text never blocks.
- Updated docstring. Also updated endpoint docstring in `backend/app/api/training_plans.py`.

## Remaining Steps

1. **Tests**: unit tests for `_focus_conflict` in `backend/tests/test_conformity.py` (pure fn); integration test for `link_activities_to_plan_days` covering: bench-day ↔ Push-session links; squat-day ↔ Push-session does NOT link; unknown focus text doesn't block. Integration fixtures exist in `tests/integration/conftest.py` (`test_user`, `test_training_plan`, `test_lifting_session`).
2. **Run**: host pytest per pitfall #19 — `$env:TEST_DATABASE_URL = "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack_test"; python -m pytest backend/tests/test_conformity.py backend/tests/integration -q`; then `ruff check backend/ --fix` + `ruff format backend/`.
3. **Deploy**: feature branch → PR → merge to `prod` (auto-deploys). NEVER patch on the Droplet.
4. **Verify in prod**: worker log should report `plan_day_linked ≥ 1` within 30 min of deploy (the bench↔Push day will link); or hit the link-activities endpoint.

## Agreed Roadmap (user-approved order)

1. ✅ Auto-link fix (this doc)
2. Deploy to prod
3. **Design automatic substitution detection WITH the user** — see notes below
4. Build manual attach/unlink feature

## Design Notes for Next Steps

**Manual attach/unlink** (build after substitution design): expose `lifting_session_id` (+ maybe `activity_id`) on single-day PATCH (`TrainingPlanDayUpdate` currently excludes them as server-managed — schemas/training_plan.py:71). Needs ownership validation + null-to-unlink semantics. Scoring is already correct once attached: `_assemble()` renormalises weights over comparable components, so a leg session on a push plan day scores focus=0 but volume/RPE/duration honestly → "Partial deviation" not "Missed".

**Auto-substitution detection** (design with user first): candidate shape = new `"substituted"` day status excluded from conformity denominators (like rest), cross-sport linking rules (schema already has both FK columns on every day; `compute_day_conformity` branches strictly on sport at conformity.py:~458). Open questions for user: which actual wins on multi-session days; do swaps count toward adherence %; cross-sport scoring semantics.

## Unrelated Prod Issue (tracked separately)

Prod worker logs: Strava + Wahoo OAuth token refresh failing with `400 Bad Request` (tokens likely revoked/expired). Filed as **BUG-072** in `docs/BUGS.md` with a full improvement plan (connection health status, permanent-vs-transient error handling, needs_reauth surfacing in Settings). Separate ticket — not part of this fix.
