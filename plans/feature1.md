# Feature 1 — In-App Notifications (Core)

> **Status**: Approved — implementation in progress
> **Type**: Core (not POC)
> **Dependencies**: none
> **Own plan**: this document. Work is discrete — do not bundle with other features.

## Goal

Give the platform an in-app notification centre so nothing important stays silent: health alerts, new personal records, goal milestone crossings, and daily training-plan reminders. Per-user toggles in Settings control which notification types are produced.

## Scope

- `Notification` model + per-user preferences (JSONB on `User`) + migration `038`
- `notifications` API router (`/api/v1/notifications`)
- `notify()` service helper with preference gating + dedup
- Wire-ins: health alerts, PRs, goal milestones, plan reminders
- New daily Celery task for plan reminders
- Frontend: top-right bell with unread badge, dropdown panel, Settings toggles

**Out of scope (deferred):** email delivery, PWA push, a full notifications page (dropdown only), sync-failure warnings (handled in the separate sync session).

## Backend

### 1. Model — `backend/app/models/notification.py`

`Notification`:
- `id` UUID pk, `user_id` FK → `users.id` (index)
- `type` str — one of `health_alert` | `pr` | `goal_milestone` | `plan_reminder`
- `title` str, `body` str
- `severity` str — `info` | `success` | `warning` | `error`
- `link` str (frontend route path, e.g. `/dashboard`)
- `read` bool default False, `read_at` datetime nullable
- `dedup_key` str nullable (unique per user) — idempotent creation
- `metadata` JSONB, `created_at` datetime

**User column**: add `notification_preferences` JSONB on `User` (default all-on: `{"health_alert": true, "pr": true, "goal_milestone": true, "plan_reminder": true}`). Migrate default via `server_default`.

Register in `backend/app/models/__init__.py` + `Base.metadata`.

### 2. Migration — `038_add_notifications.py`

Head is `037` (strava webhook events, from the sync session). One migration adds: `notifications` table + `users.notification_preferences` column. Verify with `alembic downgrade`/`upgrade` round-trip (Pitfall: Dev Lesson #2).

### 3. Service — `backend/app/services/notifications.py`

```python
async def notify(db, user_id, type, title, body, severity="info", link="", dedup_key=None, metadata=None) -> Notification | None
```
- Skip if the type is disabled in the user's `notification_preferences`.
- Skip (return None) if a notification with same `(user_id, dedup_key)` exists.
- Insert + return the row (do **not** commit — callers/`get_db` own the transaction).

### 4. API — `backend/app/api/notifications.py`

- `GET /api/v1/notifications?limit=50&unread_only=false` → newest first
- `PATCH /api/v1/notifications/{id}/read` → mark one read (404 if not owned)
- `POST /api/v1/notifications/read-all` → mark all read
- `GET /api/v1/notifications/preferences` → current prefs
- `PATCH /api/v1/notifications/preferences` → body `{health_alert, pr, goal_milestone, plan_reminder}` (partial OK)

Register in `main.py` (`app.include_router(notifications_router, prefix="/api/v1/notifications", tags=["notifications"])`).

### 5. Wire-ins

| Source | Location | Trigger | Notification content | dedup_key |
|---|---|---|---|---|
| Health alert | `upsert_alert` `services/health_analysis.py:705` | when a **new** alert is created (function already returns `True` exactly then, `:748`) | title=alert.title, body=alert.description, severity mapped from alert.severity, link `/dashboard`, metadata `{alert_type}` | `alert:{alert_id}` |
| PR | `_check_and_record_pr` `services/lifting.py:490` · `_recalculate_pr_after_set_change` `:538` · `create_manual_pr` `:774` | on PR creation | title `"{exercise} PR"`, body `"{weight} kg × {reps} — e1RM {est} kg"`, severity `success`, link `/lifting` | `pr:{pr_id}` |
| Goal milestone | `record_goal_checkins` task `tasks/scheduler.py:1176` | on 50/75/100% crossing (compare prior check-in → current progress; also on completion) | title `"Goal milestone"`, body `"{name} — reached {pct}% — projected {date}"`, link `/goals` | `goal:{goal_id}:{pct}` |
| Plan reminder | **new** daily task `send_plan_reminders` (~07:00, Beat entry) | today has a planned (non-rest) session | title `"Today's plan"`, body `"{focus} — {planned work}"`, link `/training` | `plan_reminder:{date}` |

- `upsert_alert` wiring is inside the service so **both** scheduler and on-demand (`/metrics/health-alerts/analyze`) paths notify.
- `record_all_check_ins` (`services/goals.py`) currently returns a count; the task loop detects crossings from the last check-in value vs the new value — implement detection in the task, not in the shared service.

### 6. Celery — plan reminder task

New task `app.tasks.scheduler.send_plan_reminders`, Beat schedule (once daily ~07:00 UTC). Uses `task_session()` + `asyncio.run()` per convention. Restart worker + beat after adding.

## Frontend

- **API client** `frontend/src/lib/api/notifications.ts`: `fetchNotifications`, `markNotificationRead`, `markAllNotificationsRead`, `getNotificationPreferences`, `updateNotificationPreferences` + types + barrel export in `lib/api/index.ts`.
- **`NotificationBell`** component (`components/ui/NotificationBell.tsx`):
  - Fixed top-right (`fixed top-4 right-4 z-50`, mirrors `MobileMenuButton` pattern — no top header exists in `(app)/layout.tsx`).
  - Unread badge via React Query `['notifications', {unread_only:true}]` with `refetchInterval: 30_000`.
  - Dropdown panel: notifications grouped by type with icon/severity styling; click → `router.push(link)` + mark read; "Mark all read" button. Close on outside click / Escape.
  - Mounted in `(app)/layout.tsx` (session present).
- **Settings**: "Notifications" section with 4 toggles (health alerts, PRs, goal milestones, plan reminders) → `updateNotificationPreferences`.

## Tests

- Unit: `notify()` dedup (`(user_id, dedup_key)`), preference gating (disabled type → no row).
- Integration (reuse `tests/integration/conftest.py` fixtures): health-alert creation produces one notification; repeated upsert does not duplicate; PR creation notifies; prefs PATCH round-trip.
- Run from host per Pitfall #19: `$env:TEST_DATABASE_URL=...; python -m pytest backend/tests/...`; then `ruff check backend/ --fix` + `ruff format backend/`.

## Acceptance

1. Bell shows unread count; dropdown lists newest-first; click navigates + marks read.
2. Each of the 4 sources produces exactly one notification per event (dedup verified).
3. Settings toggles genuinely suppress the source's notifications.
4. Backend tests + lint pass; migration round-trips.