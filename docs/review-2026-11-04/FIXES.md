# Post-audit fixes — 2026-11-04

Branch: `fix/audit-p0-2026-11-04` (clean worktree at `C:\Projects\fitness-tracker-stabilise`)
Base: `origin/main` @ `0151e5f` (the audit snapshot was `d2a7fd0`; main advanced two commits, and every finding below was re-checked on the newer base).
Commits:

- `c352083` — `fix(audit): restore sync auth imports and persist backups`
- `0f76f15` — `fix(audit): keep lifting load and tab state current`
- `a94c70c` — `fix(audit): unblock the weather task and close the prod frontend port`

Nothing was pushed or merged. The dirty checkout in `C:\Projects\fitness-tracker` was not modified.

## Fixed

| ID | Fix | Evidence |
|---|---|---|
| AUD-00 | Imported `mark_connection_reauth` and `handle_sync_http_error` in the sync task; narrowed the F821 ignore to `app/models/*`; added an AST guard that the task imports both. | `backend/tests/test_scheduler_auth_handlers.py`; `ruff --select F821` clean |
| AUD-01 | Added `./backups:/backups` to the production worker and a config guard. | `docker-compose.prod.yml`; `backend/tests/test_backup_durability.py`; merged compose shows the mount |
| AUD-02 | The deep-link effect reads `window.location.search` once on mount instead of depending on `getParam`; added an E2E tab-selection case. | `frontend/src/app/(app)/lifting/page.tsx`; `frontend/e2e/lifting.spec.ts`; `tsc --noEmit` clean |
| AUD-03 | `refresh_persisted_session_tss` recomputes from the persisted set rows after create/add/update/delete; `refresh_session_tss` accepts an explicit set list. | `backend/app/services/lifting.py`; `test_lifting_api.py` create/add/delete assertions; 21 integration tests pass |
| AUD-04 | Added one ownership helper for route/session/template IDs; `save_plan_days` and `add_plan_day` use it; `update_plan_day` now also checks `warmup_template_id`. | `backend/app/services/training_plan.py`; foreign-session integration test returns 404 and stores no row |
| AUD-05 | Removed the base frontend `ports`; moved 3000 to the dev override; set `NODE_ENV=production` in the prod override. | `docker-compose*.yml`; `docker compose config` shows no 3000 in prod, 3000 in dev |
| AUD-07 | The weather task now awaits `aanalyze_weather_on_modal`; added a scheduler-wiring test alongside the existing wrapper test. | `scheduler.py`; `backend/tests/test_weather_modal_async.py` |
| AUD-06 | Deploy now starts `db`/`redis`, runs `alembic upgrade head` in a one-shot backend, and only then starts the app. Startup fails closed on migration failure. `/health` reports `db_revision`, `db_head`, and `schema`, and returns 503 on a mismatch. | `.github/workflows/deploy.yml`; `backend/app/main.py`; local `/health` returned 503 with `db_revision=102`, `db_head=103` |
| AUD-23 | On `PermanentAuthError`, the webhook drain keeps the event pending, records the error, counts it as `deferred`, and continues with other events. Each loop re-reads the event with `populate_existing` so a rollback from the previous iteration cannot expire the queue. | `webhook_queue.py`; `test_webhook_queue.py` (6 passed) |

## Verification

- Backend unit: **1773 passed**, 796 deselected.
- Frontend unit: **741 passed** across 76 files.
- Lifting API integration: **21 passed**.
- Multi-sport/training-plan integration: **24 passed** (includes the foreign-session case).
- Weather/wrapper + integration set: **47 passed**.
- `/health` exercised locally: 503 with `db_revision=102`, `db_head=103`, `schema=error`; the two schema cases are unit-tested in `backend/tests/test_health_schema.py`.
- `ruff check backend/`: clean, including `F821`.
- `tsc --noEmit`: clean.
- E2E tab case was added but **not executed** (no server was started in this session).

## Remaining

No P0/P1 code item remains. The release gate still needs a real deploy run to prove `AUD-06` end to end: a failed migration must stop the release before `up -d`, and `/health` must return 200 only when `db_revision == db_head`.

The P2 register in [AUDIT.md](AUDIT.md) is unchanged. The verifier's snapshot checks for AUD-03/AUD-04/AUD-06/AUD-23 still describe the pre-fix code, so use the tests above as the fix evidence rather than expecting the snapshot to flip.
