# Post-audit fixes — 2026-11-04

Status: **closed**. PRs #352, #358 and #361 are merged to `main`; CI was green on each.

| PR | Scope |
|---|---|
| [#352](https://github.com/OliRadlett/FitnessTracker/pull/352) | All P0/P1 + AUD-08/09/10/12 |
| [#358](https://github.com/OliRadlett/FitnessTracker/pull/358) | AUD-11/17/22 + AUD-15 docs truth |
| [#361](https://github.com/OliRadlett/FitnessTracker/pull/361) | AUD-13/14/18/19/20/21 |

## Fixed

| ID | Fix | Evidence |
|---|---|---|
| AUD-00 | Imported `mark_connection_reauth` / `handle_sync_http_error`; narrowed F821 to `app/models/*`; AST guard. | `test_scheduler_auth_handlers.py`; Ruff F821 clean |
| AUD-01 | Production worker mounts `./backups:/backups`; compose guard. | `docker-compose.prod.yml`; `test_backup_durability.py` |
| AUD-02 | Deep links read once on mount; E2E tab case. | `lifting/page.tsx`; `lifting.spec.ts` |
| AUD-03 | TSS recomputed from persisted sets after create/add/update/delete. | `lifting.py`; `test_lifting_api.py` |
| AUD-04 | Ownership helper for route/session/template IDs on create/upsert/PATCH. | `training_plan.py`; foreign-session test |
| AUD-05 | 3000 is dev-only; prod is Caddy-only with `NODE_ENV=production`. | compose config |
| AUD-06 | Migrations run before `up -d`; startup fails closed; `/health` gates on `db_revision == db_head`. | `deploy.yml`; `main.py`; `test_health_schema.py` |
| AUD-07 | Weather task awaits `aanalyze_weather_on_modal`; scheduler-wiring test. | `scheduler.py`; `test_weather_modal_async.py` |
| AUD-08 | Sessions failure renders `ErrorState` + Retry; E2E asserts it. | `lifting/page.tsx`; E2E |
| AUD-09 | 200-row request, `X-Total-Count`, shown-of-total, working `s_split`/`s_class`/`s_ex` + exercise search. | `SessionRail.tsx`; E2E |
| AUD-10 | Edit panel keyed by session id. | `lifting/page.tsx` |
| AUD-11 | Location-neutral Relive presets; removed the “arthur” route branch. | `types.ts`; `replay.py`; `test_replay.py` |
| AUD-12 | Completed wins over the date in `day_status`; pure helper + test. | `test_training_day_status.py` |
| AUD-13 | Migration 104 stores the pre-taper baseline; link idempotent, unlink restores, multi-sport dates share a factor. | `104_add_plan_taper_baseline.py`; `test_taper_restore.py` |
| AUD-14 | Set CRUD schedules Jev reclassification; API test. | `api/lifting.py`; `test_lifting_api.py` |
| AUD-15 | AGENTS/RUNNING/BUGS/backlog/2026-10-15 review corrected. | docs |
| AUD-17 | Deploy-generated Caddyfile carries the security headers. | `deploy.yml` |
| AUD-18 | Default `SECRET_KEY` rejected unless `ALLOW_INSECURE_DEFAULTS`; `.env.example` no longer ships `DEBUG=true`. | `config.py`; `test_config_secret.py` |
| AUD-19 | Account deletion removes R2 video objects before the DB cascade. | `account.py` |
| AUD-20 | Push endpoints require public HTTPS; upsert keyed by `(user_id, endpoint)`. | `schemas/push.py`; `test_push_validation.py` |
| AUD-22 | Volume chart scales to its own maximum. | `VolumeTrendChart.tsx` |
| AUD-23 | Webhook auth failures stay pending/deferred and continue the queue. | `webhook_queue.py`; `test_webhook_queue.py` |

## Re-audit findings (new after the first close, all fixed)

| ID | Finding | Fix |
|---|---|---|
| AUD-24 | Modal breaker's half-open let every caller through and a failed trial did not re-arm. | One claimed trial per window; failed trial resets `opened_at`; injected clock + deterministic tests. |
| AUD-25 | `extend_plan` could not fill a hole (cursor started after the last written day). | Start at the first written day; test weeks 1–2 + 4 written, week 3 filled. |
| AUD-26 | `extend_plan` accepted an unbounded `until`, staging millions of rows. | Reject `until` > plan start + 730 days; test. |
| AUD-27 | Lifting page cached `{items,total}` under the shared `['lifting-sessions']` key. | Paginated query moved to `['lifting-sessions','page',200]`. |
| AUD-28 | `planVerdict` claimed a healthy load with no live engine data. | Explicit `pending` verdict + guarded `shortDate`; test. |
| AUD-29 | A failed week request rendered as an empty week. | `ErrorState` + Retry branch; test via E2E. |
| AUD-30 | `?day=` deep link did not scroll when the payload arrived late. | Effect depends on `days.length`; E2E asserts `toBeInViewport`. |
| AUD-31 | A post-taper TSS edit was overwritten on unlink; `{event_id:null,end_date:X}` lost X. | Editing `planned_tss` clears the stale baseline; explicit `end_date` wins on unlink; tests. |
| AUD-32 | A revoked user with 50+ pending webhook events starved other users. | Selection excludes `needs_reauth` connections; test with 51 dead + 1 live event. |
| AUD-33 | The deploy health loop could finish and still exit 0 with production down. | Non-200 now dumps backend logs and exits 1; backend healthcheck added. |
| AUD-34 | The AUD-16 acceptance record named 14.2.35 while 14.2.15 is deployed. | Record corrected to the deployed pin and the patch-only option. |

## Accepted with a decision

| ID | Decision |
|---|---|
| AUD-16 | **Accepted residual risk, not fixed.** The deployed pin is `next@14.2.15`; a patch-only 14.2.35 upgrade is available but npm audit still flags the Next range, and only Next 16.4.5 clears it. Next 16 needs React 19 plus a broad migration. The app has no `middleware.ts` and no `next/image` import (the `/_next/image` endpoint exists but has an empty remote allowlist), so the middleware-bypass and image-optimizer advisories are not reachable; the App Router DoS/cache classes remain. Revisit with a dedicated React 19 + Next 16 migration. |
| AUD-21 | **Accepted full-replace contract.** `PATCH /training-plans/{id}` with `days` replaces the day set; the targeted `/days` endpoints are the non-destructive editor path. The misleading test name was corrected and the omitted-date deletion is asserted. |

## Verification

- Backend unit: **1790 passed**, 799 deselected.
- Frontend unit: **762 passed** across 77 files.
- Affected integration: **30 passed** (account, taper, lifting API); webhook queue **6 passed**; health **2 passed**.
- Migration 104: upgrade -> downgrade 103 -> upgrade head, clean.
- `ruff check backend/` clean, including F821.
- `tsc --noEmit` clean.
- CI: Lint, Backend, Frontend, Playwright E2E green on #352/#358/#361.

## Residual operational check

`AUD-06` is unit/static verified, but the one-shot migration ordering and `/health` gate have not been run in a real release. Confirm on the next deploy: a failed migration must abort before `up -d`, and `/health` must return 200 only when `db_revision == db_head`.
