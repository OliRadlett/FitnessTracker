# Splitting `backend/app/tasks/scheduler.py`

> **Status**: plan, not started. Written 2026-10-24 at `ea3767e`.
> **Scope**: separate the beat schedule from the task definitions, then split the
> 4,641-line module by domain. No task is renamed and no schedule key changes.

## Why this needs a plan

`scheduler.py` holds the Celery beat schedule as a 240-line dict at the top, then
41 task definitions below it, plus shared helpers. That shape is why two separate
audits asked whether a task was scheduled and got different answers. It is also
why the orphan-quarantine producer could sit uncalled for weeks without anything
noticing.

The safety net already exists. `backend/tests/test_beat_schedule.py` asserts two
things that between them cover both ways a task silently stops running.

- Every `beat_schedule` entry names the task it was actually registered under.
- Every registered `app.tasks.scheduler.*` task is scheduled or on the explicit
  on-demand allowlist.

Any split must keep both green, and must not change a single `beat_schedule` key
or a single `name=` string.

## The one hard constraint

Celery task names are strings, and the beat config references them. Workers may
already have them queued across a deploy. So the `name="app.tasks.scheduler.…"`
value on every task is frozen, even when the function moves to another module.
Moving a function is safe precisely because the name is explicit rather than
derived from the module path.

The second constraint is that `beat_schedule` is assigned to
`celery_app.conf` at import time. Whatever module owns it must be imported when
the Celery app loads, or the schedule silently empties.

## Proposed shape

| Module | Holds |
|--------|-------|
| `app/tasks/beat.py` | `beat_schedule` and its assignment to `celery_app.conf`, nothing else |
| `app/tasks/common.py` | `_run_task_guarded` and the small helpers tasks share |
| `app/tasks/sync.py` | provider sync tasks (Strava, Wahoo, Komoot, Whoop, Withings) |
| `app/tasks/analytics.py` | insights, training load, power models, terrain, segments, weather |
| `app/tasks/videos.py` | lift-video processing and the weekly video aggregation |
| `app/tasks/maintenance.py` | prune, cleanup, reconcile, quarantine |
| `app/tasks/notifications.py` | notification fan-out tasks |
| `app/tasks/scheduler.py` | re-exports every task by its current attribute name |

The re-export layer is not ceremony. `celery_app` registers by name, the beat dict
refers to names, and the tests resolve tasks by attribute on this module. Keeping
the attributes means no caller, test, or beat entry has to change.

## Slices, each independently shippable

1. **Extract the schedule.** Move the dict verbatim into `beat.py`, assign it
   there, and import the module from `scheduler.py` so registration still happens.
   This is the highest-value slice and the only one that touches the schedule.
2. **Extract the guard helper.** Move `_run_task_guarded` to `common.py` and
   import it everywhere. Behaviour identical.
3. **Extract one domain, verify, repeat.** Start with `maintenance.py` because it
   has the fewest cross-imports. Then `videos.py`, then `notifications.py`, then
   `sync.py`, then `analytics.py`, which is the largest.
4. **Delete the re-export layer** only once nothing resolves through it. That is
   optional and can wait indefinitely.

## Verification per slice

- `python -m pytest backend/tests/test_beat_schedule.py -q` stays green. This is
  the gate, not a nicety.
- Compare `celery_app.conf.beat_schedule` before and after: same keys, same task
  strings, same schedules. A one-off script that prints the sorted keys and
  `repr` of each schedule is enough, kept in the PR description.
- Compare the registered task set: `set(celery_app.tasks)` filtered to the
  `app.tasks.scheduler.` prefix must be identical before and after.
- Restart a worker after each slice and confirm `celery inspect registered` lists
  the same count. No task logic changes, so no behavioural test is added.

## The test-patch trap

A moved task resolves `_run_task_guarded` in its own module's namespace, not the
scheduler's. A test that patches `app.tasks.scheduler._run_task_guarded` to bypass
Redis therefore stops affecting that task, and instead of failing loudly it runs
the real guard. `test_task_lock_guard.py` hit this on the first sync move.

The patch target must follow the definition. When a task moves, grep the tests for
the old module path and repoint them. Two integration tests still patch the
scheduler for `analyze_cross_domain_weekly` and `analyze_weather_performance_weekly`,
which are still in the scheduler, so they are correct until those tasks move.

## Progress at 2026-10-26

Fifteen slices landed, each with its own PR and the beat invariants green.

| Slice | Module | Contents |
|-------|--------|----------|
| 1 | `beat.py` | the beat schedule |
| 2 | `common.py` | `_run_task_guarded` |
| 3 | `celery_app.py` | the Celery app, the prerequisite slices 4 onward need |
| 4 | `maintenance.py` | cleanup, quarantine, undo prune |
| 5 | `videos.py` | weekly video aggregation |
| 6 | `sync.py` | Strava webhook drain and reconciliation |
| 7 | `analytics.py` | stream and TSS backfills, weather refresh |
| 8 | `analytics.py` | ride segment recompute, activity context backfill |
| 9 | `sync.py` | `sync_all_routes` |
| 10 | `analytics.py` | route quality scoring |
| 11 | `common.py` | the per-user sync lock and its no-op fallback |
| 12 | `sync.py` | the Withings sync |
| 13 | `maintenance.py` | the database backup, which needed `UTC` imported locally |
| 14 | `analytics.py` | LLM analysis and athlete insights |
| 15 | `analytics.py` | the Jev backfill |

`scheduler.py` went from 4,641 lines to about 3,630, having also grown with new
features in the same period. Every slice was verified by object identity, the
registered Celery name, the unchanged 39 beat entries and 41 tasks, and the
invariants in `test_beat_schedule.py`. Slice 13 also proved why the free-variable
check below exists.

**What remains is harder.** `sync_all_whoop_data` at 254 lines and
`sync_all_strava_activities` at 226 were scanned clean and deliberately left,
because a copy of that size costs more to review than the move gains now that
`sync.py` holds four tasks. The notification and plan tasks bring helper
functions with them. `process_lift_video` at 330 lines still has no behavioural
test, so identity checks cannot distinguish a correct move from a subtly broken
one. It needs a test before it moves, or an explicit decision to accept the risk.

## Check the free variables, not just the imports

A function's own imports are not the whole story. It may also read names from its
module's scope. `backup_database` called `datetime.now(UTC)` while importing
`datetime` locally and taking `UTC` from the scheduler's module-level import, so a
verbatim move would have raised `NameError` on the first scheduled backup, days
after a green PR.

Before each cut, list the names the function uses that it does not define and does
not import. Anything from module scope must move with it or be imported into the
new module. Identity checks cannot see this, and neither can a test that never
runs the task.

## What not to do

- Do not rename task names, even to tidy them. Queued messages and beat entries
  carry the string.
- Do not let the split change the beat cadence. A moved task with a subtly
  different `crontab` is the failure this plan exists to avoid.
- Do not split by line count. Split by domain, because the cross-imports are what
  make the file hard to change, not the length alone.
