# API Versioning Strategy

## Current Scheme

All FitTrack API endpoints are versioned using **URL path prefixing**:

```
/api/v1/...
```

Every route is mounted under `/api/v1/` via FastAPI routers in [`backend/app/main.py`](../backend/app/main.py).

## Versioning Rules

| Change Type | Version Bump Required? | Examples |
|---|---|---|
| **Breaking change** | ✅ Yes — new major version | Removing a field, changing a response shape, renaming an endpoint |
| **Non-breaking addition** | ❌ No | Adding a new endpoint, adding an optional query param, adding a new response field |
| **Bug fix** | ❌ No | Correcting a calculation, fixing a status code |

A **breaking change** is any modification that would cause an existing client integration to fail.

## Deprecation Process

When a new API version is introduced:

1. **New version deployed** alongside the old one (e.g., both `/api/v1/` and `/api/v2/` are live).
2. **Sunset header** added to all responses from the deprecated version:
   ```
   Sunset: Sat, 01 Feb 2027 00:00:00 GMT
   Deprecation: true
   Link: </api/v2/docs>; rel="successor-version"
   ```
3. **Maintenance period**: the old version is maintained for **6 months** after the new version goes live.
4. **Removal**: after 6 months, the old version returns `410 Gone`.

### Timeline

| Milestone | Timing |
|---|---|
| New version released | Day 0 |
| Sunset header added to old version | Day 0 |
| Old version returns `410 Gone` | Day 0 + 6 months |

## How to Add a New Version

### 1. Create a new router prefix

```python
# backend/app/api/v2/activities.py
router = APIRouter()

@router.get("/")
async def list_activities_v2(...):
    ...
```

### 2. Register in main.py

```python
from app.api.v2.activities import router as activities_v2_router
app.include_router(activities_v2_router, prefix="/api/v2/activities", tags=["activities-v2"])
```

### 3. Share the service layer

Versioned routers should delegate to the same service functions in `backend/app/services/`. The service layer is the source of truth — routers only differ in request/response schemas.

### 4. Add Sunset headers to old version

Use a middleware or dependency to inject `Sunset` and `Deprecation` headers on all `/api/v1/` responses.

## Decision Log

| Date | Decision |
|---|---|
| 2026-01-01 | Initial API versioned as `/api/v1/` |
