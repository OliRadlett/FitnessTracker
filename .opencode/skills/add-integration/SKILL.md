---
name: add-integration
description: Use when adding a new OAuth provider integration (Strava, Whoop, Wahoo, Komoot style). Covers service, model, API endpoints, Celery sync task, and frontend settings UI.
---

# Add Integration

Step-by-step guide for adding a new fitness provider integration to FitTrack.

## Reference Implementations

- **Strava** (OAuth2, full sync): `backend/app/services/strava.py`
- **Wahoo** (OAuth2, simpler): `backend/app/services/wahoo.py`
- **Whoop** (OAuth2, health data): `backend/app/services/whoop.py`
- **Komoot** (Basic Auth, routes only): `backend/app/services/komoot.py`

## Files to Create/Modify

### 1. Backend Service (`backend/app/services/<provider>.py`)

Create service with these functions:
- `get_provider_config()` — return client_id, client_secret, auth URLs
- `get_authorize_url(redirect_uri)` — build OAuth authorization URL
- `exchange_code(code, redirect_uri)` — exchange auth code for tokens
- `refresh_token_if_needed(db, connection)` — refresh expired tokens
- `sync_<provider>_activities(db, user_id)` — pull activities from provider
- `sync_<provider>_routes(db, user_id)` — pull routes (if applicable)

### 2. OAuth Model Fields

The `OAuthConnection` model already stores:
- `provider` (string) — provider name
- `access_token` (encrypted) — OAuth access token
- `refresh_token` (encrypted) — OAuth refresh token
- `expires_at` (datetime) — token expiration
- `provider_user_id` (string) — user ID on provider

No model changes needed unless the provider has extra metadata.

### 3. API Endpoints (`backend/app/api/auth.py`)

Add to the existing OAuth router:
- `GET /api/v1/auth/oauth/<provider>/authorize` — returns auth URL
- `GET /api/v1/auth/oauth/<provider/callback` — handles callback, creates OAuthConnection

### 4. Celery Task (`backend/app/tasks/`)

Create `sync_all_<provider>_data` task:
```python
from app.tasks.base import app
import asyncio

@app.task
def sync_all_<provider>_data():
    asyncio.run(_sync_all())

async def _sync_all():
    # Get all users with <provider> connections
    # Call service sync function for each
    pass
```

Register in `celery_beat_schedule` in `backend/app/tasks/__init__.py`.

### 5. Frontend Settings

Add provider card to `frontend/src/app/(app)/settings/page.tsx`:
- Connection status display
- Connect/disconnect button
- Last sync time

## Pitfalls

1. **redirect_uri must match exactly** — use `settings.public_url` for base URL
2. **Token refresh** — check `expires_at` before every API call
3. **Rate limiting** — add backoff/retry for provider API calls
4. **Encrypted tokens** — use `EncryptedString` type for access/refresh tokens
5. **Webhook verification** — verify provider signatures on webhook endpoints

## Testing

1. Test OAuth flow manually: authorize → callback → check DB for OAuthConnection
2. Test sync: trigger task manually, check activities/routes in DB
3. Test token refresh: mock expired token, verify refresh works
