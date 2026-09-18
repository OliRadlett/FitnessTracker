# Prod memory pressure investigation (2026-09-18)

Fix #1 (compose guardrails) implemented locally, uncommitted and undeployed; no prod
changes made. Scope: fix #1 only, one item at a time — fixes #2+ pending approval.

## 1. Background

- Droplet: 961 MB RAM, 7 containers (db, redis, backend, worker, beat, frontend,
  caddy), no memory limits, ~130 MB free, ~42% of 2 GB swap used (2026-09-17).
- Two global OOM kills, 19:21:37 and 20:56:52 UTC 2026-09-17: short-lived `python`
  processes (~1.6 GB footprint each: ~600 MB RSS + ~1 GB swap), invoked as plain
  `python`, NOT celery/uvicorn entrypoints. No deploy, no beat slot, no SSH login
  at either minute.
- Prior evidence preserved at `/tmp/mon.log` on the Droplet (Redis MONITOR trace,
  out of scope).
- Already known, not re-investigated: SSH brute-force noise, `uvicorn --reload`
  on prod, REDIS_PASSWORD fine, journald died in OOM #1.

## 2. Prod forensics (read-only, 2026-09-17 ~23:02 UTC)

- `docker stats`: worker 142 MB > backend 94 MB > db 34 MB > beat 18 MB >
  caddy 14 MB > frontend 7 MB > redis 3 MB (~314 MB total).
- `free -m`: 961 total / 733 used / **137 free** / 228 available;
  **swap 996/2047 MB = 48.7% (worse than ~42%)**, active swap-in/out — still
  thrashing lightly. ~419 MB used outside containers.
- No new OOMs: `oom_kill` counter still 2; dmesg + kern.log show only the two
  known kills (anon-rss 636 MB and 586 MB, total-vm ~2.5 GB each, both in scope
  `docker-4139bf0ca09b` — same container twice, ~95 min apart).
- `last`: no SSH login near either OOM (latest login Aug 30). Cron/timers: nothing
  at :21/:56. `docker ps -a`: zero exited one-shot containers.
- All 7 containers recreated 22:32 UTC (`RestartCount=0`) — cause unexplained,
  needs owner confirmation. Beat showed a transient 25.9% CPU blip.
- Prod `/tmp` is live scratch with Sep-17 files: `test_mediapipe.py` (15:12),
  `queue_videos.py`, `reprocess.py`, `get_two_urls.py` (22:46, post-recreate),
  dozens of `.sql` files. `/var/crash` holds a 346 KB journald crash from 19:21.

## 3. Verdict: what the OOMs most likely were

**Manual one-shot `python /tmp/*.py` runs on prod (video/MediaPipe debugging),
not scheduled app code.**

- Plain-`python` entrypoint matches `docker exec … python /tmp/script.py`, matches
  neither `celery` nor `uvicorn`.
- `test_mediapipe.py` (MediaPipe model + OpenCV decode ≈ 600 MB RSS) fits the
  victims' ~586–636 MB anon-RSS exactly.
- **Sep 17 2026 was a Thursday**: all Sunday-only intelligence/FTP/PR/segment/
  context beats are exonerated by calendar. OOM times align with no beat slot.
- Same-scope rerun ~95 min apart with no cron/timer fit = human iterating.
- Local `scripts/queue_videos.py` imports non-existent `process_video_analysis`
  (real task: `process_lift_video`, `backend/app/tasks/scheduler.py:3146`), so the
  queue script itself ImportErrors — the heavier pose/MediaPipe scripts are the
  credible footprint.

Contributors, not causes: stream-`.all()` transients (80–200 MB) shrink headroom
but are an order of magnitude below the ~1.6 GB footprint; video worker path is
~KB (heavy bytes already on Modal); missing `mem_limit`s + `--reload` + uncapped
journald explain thin headroom, not the spike.

## 4. Code audit hotspots (worst first)

Worker concurrency is Celery prefork default (no `--concurrency` flag,
`docker-compose.yml:55`); `task_session()` spans whole per-task user loops with
`expire_on_commit=False` and no expunge between users
(`backend/app/database.py:41-70`).

| Sev | Location | Peak | On prod worker |
|---|---|---|---|
| 1 | `services/cycling/prs.py:333-355` + `power_curve.py:272-278` (all-time/90d stream `.all()`) | 80–200 MB | Yes (Sun beats) |
| 2 | `services/strava/sync.py:786-803` (global stream-missing `.all()`, all users) | 10–100 MB | Yes (Sat 03:00) |
| 3 | `services/strava/sync.py:621-650` + `:536` (linking phase unbounded loads) | 10–50 MB | Yes (backfill) |
| 4 | `services/segments.py:403-413,394-400` (per-route streams + copies) | 5–30 MB/route | Yes (Sun 03:15) |
| 5 | `tasks/scheduler.py:1235-1278` (power-model fallback path) | 60–120 MB when triggered | Yes (Sun 05:30) |
| 6 | `services/strava/sync.py:967-975` (all acts + full `raw_data` JSONB) | 10–50 MB | Yes (every 2h) |
| 7–10 | Context backfill, segments/efforts, cross-domain, weather JSON shuttles | ~KB–2 MB | Yes, negligible |
| — | Video pipeline (`modal_client.py`, `video_analysis.py`, `pose_analysis.py`) | 0.5–2 GB **Modal-only**, ~KB on worker | No (worker passes URLs) |

## 5. Ranked optimisation plan (not implemented)

| # | Fix | Reduction | Risk | Effort |
|---|---|---|---|---|
| 1 | `docker-compose.prod.yml`: `mem_limit`s (worker 400m, backend 250m, db 200m, frontend 200m, beat 120m, caddy 80m, redis 100m) + backend `command:` without `--reload` + `--concurrency=1` **[implemented locally, uncommitted, undeployed — verified via `docker compose config`: all 7 caps merged, backend has no `--reload`, worker has `--concurrency=1`]** | Caps 1.6 GB monsters; ~50–90 MB baseline | Low (file clean, prod-only) | 15 min |
| 2 | Per-activity chunk + expunge in `power_curve.py`, `prs.py` **[implemented locally, uncommitted — `_STREAM_CHUNK_SIZE = 10`, per-stream `db.expunge`; verified: container import ok, ruff clean, `test_power_curve.py` 13 passed]** | 80–200 MB → ~2 MB | Low (files clean) | 1–2 h + tests |
| 3 | Bound `sync.py` loads **[implemented locally, uncommitted — backfill selects 3 narrow columns (was full rows + 2 JSONB); `defer(Activity.context)` on linking + route-sync queries (`raw_data` retained: linking/route extraction reads polylines from it; deferring it would N+1); verified: import ok, ruff clean, `test_merge_service.py` + `test_cycling.py` 54 passed. Scheduler.py portions (segments/efforts/cross-domain `.limit()`) BLOCKED — file dirty]** | 10–100 MB → ~2 MB each | Low–med | 2–3 h |
| 4 | Per-user session release in §1 loops — **BLOCKED: `scheduler.py` has another session's uncommitted changes** | Stops identity-map growth | Med | 1 h |
| 5 | Journald caps (`SystemMaxUse=100M`, `RuntimeMaxUse=50M`) — human on Droplet | Removes journald collateral | Low | 5 min |

Nothing to move to Modal/object storage: video already Modal-side, streams belong
in DB.

**Resize (1 GB → 2 GB):** steady state mostly fits (228 MB available); the kills
were anomalous spikes a bigger box absorbs but doesn't prevent, at ~2× monthly
cost vs free via fix #1. Do #1 first; resize only if swap stays >50% after a week.

## 6. Open items needing a human

1. Confirm with the video-session owner what ran at 19:21/20:56; keep one-shot
   scripts off prod (or under `systemd-run --scope -p MemoryMax=`).
2. Explain the 22:32 full-stack recreate.
3. Deploy fix #1 (merge `main` → `prod` when ready); verdict on resize after #1 settles.
4. On Droplet: fix #5, `/tmp` + `/var/crash` cleanup, off-prod scratch policy.
5. Fix #4 only after the other session's `scheduler.py` changes land.
