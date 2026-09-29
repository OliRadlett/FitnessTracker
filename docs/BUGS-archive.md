# FitTrack Bug Report — Archive (Fixed Bugs)

> **98 total bugs** — **82 fixed / already-fixed** archived here for historical reference.
> Full detail with root-cause analysis and fix descriptions preserved in git history:
> ```bash
> git log --all -- docs/BUGS.md
> ```
> The active tracker (`BUGS.md`) retains only the 5 open/deferred/investigating bugs.

All bugs below are **FIXED** or resolved — kept for root-cause learning. Do not attempt to fix again.

## CRITICAL (all fixed)

| ID | Title | Key Learning |
|----|-------|-------------|
| BUG-001 | Strava Webhook HMAC `hmac.new()` crash | `hmac.new()` → `hmac.HMAC()` |
| BUG-002 | OAuth callback assigns to wrong user | Embed user_id in signed OAuth state |
| BUG-003 | `/sync-user` has no auth | Require `INTERNAL_API_SECRET` |
| BUG-004 | Redis has no authentication | Add `--requirepass`, remove port publish |
| BUG-005 | OAuth error messages hardcoded as "Whoop" | Use `provider.capitalize()` |
| BUG-006 | GPX download token always undefined | Accept `token` from `useAuthFetch()` |
| BUG-007 | Routes page uses absolute URLs | Use relative URLs (`/api/v1/...`) |
| BUG-008 | Decoupling endpoint IDOR | Add ownership check |
| BUG-009 | Webhook doesn't verify activity ownership | Filter by `connection.user_id` |
| BUG-010 | Webhook POST skips HMAC verification | Verify HMAC on POST too |
| BUG-011 | Weak Fernet key derivation | Use HKDF/PBKDF2 instead of padding |
| BUG-012 | `backup_database` task fails (no pg_dump) | Install `postgresql-client` in container |

## SYNC HARDENING (BUG-051 through BUG-098) — all fixed

| ID | Title | Key Learning |
|----|-------|-------------|
| BUG-051 | Celery asyncpg cross-loop pool errors | Use `task_session()` per invocation |
| BUG-052 | `int(None)` crash on Strava `moving_time` | Use `or 0` guard |
| BUG-053 | Whoop refetches full history every 30 min | `last_synced_at` watermark + date filter |
| BUG-054 | Wahoo walks full history every 30 min | Early-exit after 3 empty pages |
| BUG-055 | Komoot routes synced per-user with global creds | Run once per sync, not per-user |
| BUG-056 | Orphaned streams backfill task never scheduled | Add to Beat schedule |
| BUG-057 | Whoop recovery backfill duplicated | Extract shared `_backfill_missing_recovery()` |
| BUG-058 | Whoop backfill SSE reports success on partial failure | Add `chunks_failed` to complete event |
| BUG-059 | Cycling streams button force-refetches everything | `days=90&limit=50` gap-fill mode |
| BUG-060 | No concurrency guard on backfill endpoints | Redis-based distributed locks |
| BUG-061 | Route-link backfill N+1 query | Pre-fetch routes once |
| BUG-062 | `redis_lock` releases locks it no longer owns | Token-based compare-and-delete |
| BUG-063 | Per-user except blocks never rollback | Add `await db.rollback()` in all loops |
| BUG-064 | Watermarks committed only at task end | Commit per-user after each sync |
| BUG-065 | `compute_metric_trend` returns empty for 9/13 metrics | Add history branches |
| BUG-066 | Exercise library listing fails (422) | Raise limit cap to 200 |
| BUG-067 | Recharts Brush renders "undefined"/"NaN" | Pass `ariaLabel`,`startIndex`/`endIndex`,`tickFormatter` |
| BUG-070 | Route filtering inconsistent | Move ride stats to SQL subquery |
| BUG-071 | Merge thresholds too strict | Activity: proximity 20%, shape 50%; route threshold 0.55 |
| BUG-072 | Failed token refreshes retry forever | `connection_health.py` with status tracking |
| BUG-073 | Whoop chunk backfill commits nothing | Per-chunk `db.commit()` in SSE generators |
| BUG-074 | Strava backfill loses tail pages/streams/links | Final `db.commit()` before complete event |
| BUG-075 | Sync backlog truncated — watermark advances past unfetched data | Paginate through window, hold watermark |
| BUG-076 | Whoop backfill crashes on chunk 2 (`NameError: asyncio`) | Add `import asyncio` |
| BUG-077 | Token refresh races rotate twice | Single `refresh_connection()` with `SELECT … FOR UPDATE` |
| BUG-078 | Concurrent sync runs overlap | Task-level Redis locks + per-user locks |
| BUG-079 | Webhooks processed inline with no retries | Queue in `strava_webhook_events`, drain via Celery |
| BUG-080 | Whoop resting HR/strain/calories clobbered by nulls | Conditional upserts |
| BUG-081 | `Notification.metadata` collides with reserved attr | Renamed ORM attr to `payload` |
| BUG-082 | Frontend `t`→`e` bulk replacement | Restored from git HEAD |
| BUG-083 | Date chart X-axis shows "undefined NaN" | Add regex capture groups |
| BUG-084 | Whoop backfill progress bar never appears | Emit initial 0% event immediately |
| BUG-085 | Whoop sleep sync includes naps | Skip `record.get("nap")` records |
| BUG-086 | Whoop dates assigned to wrong day | Use `cycle.start + timezone_offset` (local bedtime) |
| BUG-087 | Recovery backfill excludes stale dates outside window | Use `pass_min=start, pass_max=today` |
| BUG-088 | Linkable-activities 500 (MissingGreenlet) | Eager-load `Activity.sources` + use `_enrich_activity_read` |
| BUG-089 | Live Lift pending deletes re-queued forever (undo wedge) | Track `processedDeletes`, exclude from merge; treat 404 as done |
| BUG-090 | Live Lift stale flush resurrects old session | `mergeWithStorage` returns `null` on session mismatch |
| BUG-091 | All 5 Modal jobs crash-loop (`pydantic_settings` missing) | Keep `app.config` imports inside `_modal_configured()` |
| BUG-092 | Power-model worker `NameError` (`hrv_data`) + constants never fitted | Use `hrv`; pass 90-day TSS + HRV to Modal |
| BUG-093 | Weather job crashes on `None` humidity/pressure | Use `or` defaults, not `.get(key, default)` |
| BUG-094 | Token refresh `KeyError: 'access_token'` skips health bookkeeping | Raise `PermanentAuthError` for Withings non-zero status |
| BUG-095 | Weekly LLM analysis has no retry (503 costs a week) | Bounded retry (3 attempts, exponential backoff) |
| BUG-096 | Segment intelligence crashes on null `effort_vam` | Guard `None` explicitly |
| BUG-097 | Redis client cached across event loops → syncs silently skipped | Cache per running event loop |
| BUG-098 | Live Lift wedged on "Finishing…" (mobile) | Backfill legacy state, treat PATCH 404 as done, `z-index: 50` |

## Priority Fix Order (historical — all resolved)

All bugs in the "immediate/next sprint/backlog" tiers above are FIXED. The remaining open bugs are tracked above and in `bug` plan items in `plans/backlog-2026-09-20.md`.
