# Withings Integration — Body Composition

> **Status**: Implemented (2026-09-17, migration 060 at head)
> **Effort**: L (≤1 week)
> **Priority**: P1 — high value, moderate scope
> **Goal**: Full Withings OAuth integration for body composition data (weight, body fat %, muscle mass, bone mass, hydration, visceral fat, BMI) with outlier detection and dedup against existing Whoop weight sync.
>
> **Implementation notes (deviations from plan):**
> - BMI is derived per weighing group when the same group carries height (type 4); no separate height store.
> - Manual composition input is body fat % + muscle mass only (full composition comes from scales).
> - `body_composition_trend` chart is fetched inside `PowerCurveSection.tsx` (eager `useQuery`, key `['chart-body-comp', 90]`) rather than plumbed through `cycling/page.tsx`.
> - Heart pulse (type 11) is ignored (BP/HR deferred per plan).
> - Live containers run a stale baked image (no dev mounts) — rebuild + restart backend/worker/beat to serve this (`python fittrack.py build`; `restart worker beat`). Dev DB already migrated to 060.

## Context

- Whoop already syncs `weight_kilogram` into `WeightLog` via `sync_whoop_weight()` — but the Whoop Developer API v2 does **not** expose body composition (body fat %, muscle mass, etc.)
- Withings scales provide full body composition via BIA (bioelectrical impedance). The Withings API exposes: weight, BMI, fat ratio, fat mass, fat-free mass, muscle mass, hydration, bone mass, visceral fat index, heart rate, PWV.
- `WeightLog` model currently stores only `weight_kilogram` + `source`. No composition fields exist.
- No outlier detection or data validation exists anywhere in the weight pipeline (only a 20–300 kg range check on manual entries).

## Withings API Reference

**OAuth 2.0 Authorization Code Flow:**
- Authorize: `https://account.withings.com/oauth2_user/authorize2`
- Token: `https://wbsapi.withings.net/v2/oauth2`
- Scopes: `user.info,user.metrics`
- Callback: `{public_url}/api/v1/auth/oauth/withings/callback`

**Body measurements endpoint:**
- `POST https://wbsapi.withings.net/v2/measure?action=getmeas`
- Params: `category=1` (real measurements), `meastypes=1,4,5,6,8,10,11,76,77,88,91,170`, `startdate`/`enddate` (unix timestamps)
- Response: grouped by `grpid` (one scale weighing), each group has `measures[]` with `type`, `value`, `unit`
- **Value encoding**: `actual_value = value × 10^unit` (e.g. `value=7463, unit=-2` → `74.63 kg`)

**Measurement type IDs:**

| ID | Metric | Unit | Scale Model |
|----|--------|------|-------------|
| 1 | Weight | kg | All scales |
| 4 | Height | m | All scales |
| 5 | Fat Free Mass | kg | Body+, Body Smart, Body Comp, Body Scan |
| 6 | Fat Ratio | % | Body+, Body Smart, Body Comp, Body Scan |
| 8 | Fat Mass | kg | Body+, Body Smart, Body Comp, Body Scan |
| 76 | Muscle Mass | kg | Body+, Body Smart, Body Comp, Body Scan |
| 77 | Hydration | % | Body+, Body Smart, Body Comp, Body Scan |
| 88 | Bone Mass | kg | Body+, Body Smart, Body Comp, Body Scan |
| 170 | Visceral Fat Index | — | Body Smart, Body Comp, Body Scan |
| 11 | Heart Pulse | bpm | Body Cardio, Body Smart, Body Scan |

**Token refresh:**
- `POST https://wbsapi.withings.net/v2/oauth2` with `action=refresh`, `grant_type=refresh_token`, `client_id`, `client_secret`, `refresh_token`
- Returns `access_token`, `refresh_token`, `expires_in`

**Gotchas:**
1. Value encoding: `actual = value * 10^unit` — must decode every measurement
2. Grouped measurements: One scale weighing returns a group with multiple measurement types (weight + fat + muscle + bone + hydration all share the same `grpid`)
3. Category 1 only: `category=1` = real measurements (vs category 2 = user-entered goals)
4. Token refresh uses `action=refresh` in POST body, not a standard OAuth endpoint
5. Rate limits: 120 requests/minute — fine for periodic sync
6. Webhook option (`Notify.subscribe`) deferred to a later enhancement

---

## Implementation Plan

### Phase 1: Backend Foundation

#### 1.1 Configuration
**File:** `backend/app/config.py`
- Add `withings_client_id: str = ""` and `withings_client_secret: str = ""`
- Add warning entry in `_warn_optional_integrations()`

#### 1.2 Withings API Client
**New file:** `backend/app/integrations/withings_client.py`

```python
class WithingsClient:
    BASE_URL = "https://wbsapi.withings.net/v2"

    def __init__(self): ...
    def _headers(self, access_token: str) -> dict: ...
    async def get_measurements(self, access_token, startdate, enddate, meastypes) -> dict: ...
    async def refresh_access_token(self, refresh_token: str) -> dict: ...
    async def get_user_info(self, access_token) -> dict: ...

withings_client = WithingsClient()
```

- Each API method wraps httpx calls in `retry_request()` from `app.integrations.retry`
- `get_measurements()` hits `POST /measure?action=getmeas` with form-encoded body
- `refresh_access_token()` hits `POST /oauth2` with `action=refresh`
- Module-level singleton

#### 1.3 OAuth Registration
**File:** `backend/app/services/auth.py`
- Add `"withings"` to `OAUTH_PROVIDERS` dict with authorize_url, token_url, userinfo_url, client_id, client_secret, scopes
- Add `elif provider == "withings":` branch in `get_authorize_url()`
- Add `elif provider == "withings":` branch in `exchange_code_for_user()`

#### 1.4 OAuth Callback
**File:** `backend/app/api/auth.py`
- Add `"withings"` to the fitness-integration tuple at line 135 (`redirect_uri` construction)
- Add `"withings"` to the fitness-integration tuple at line 192 (callback handler)
- Add `provider_user_id` extraction for Withings in the callback

#### 1.5 WeightLog Model Extension
**File:** `backend/app/models/weight.py`

Add nullable columns:
```python
body_fat_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
fat_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
lean_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
muscle_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
bone_mass_kg: Mapped[float | None] = mapped_column(Float, nullable=True)
hydration_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
visceral_fat_index: Mapped[float | None] = mapped_column(Float, nullable=True)
bmi: Mapped[float | None] = mapped_column(Float, nullable=True)
```

#### 1.6 Migration
**New file:** `backend/alembic/versions/049_add_body_composition_columns.py`

Adds nullable Float columns to `weight_logs` table. All columns nullable so existing Whoop/manual rows are unaffected.

#### 1.7 Withings Service
**New file:** `backend/app/services/withings.py`

Key functions:
- `get_withings_connection(db, user_id)` — query `OAuthConnection` for `provider="withings"`
- `refresh_if_needed(db, connection)` — wraps `connection_health.refresh_connection()` with Withings-specific expiry check
- `sync_withings_measurements(db, user_id, startdate=None)` — main sync function:
  1. Fetch measurements from API (`category=1`, types `1,5,6,8,76,77,88,170`)
  2. Group by `grpid` (each group = one scale weighing)
  3. Decode values (`value * 10^unit`)
  4. Apply outlier detection (see below)
  5. Upsert into `WeightLog` with `source="withings"` and all composition fields
  6. Flush at end

#### 1.8 Outlier Detection
**In:** `backend/app/services/withings.py`

Range validators applied at sync time:
```python
RANGE_VALIDATORS = {
    "weight_kilogram": (20, 300),
    "body_fat_percent": (3, 60),
    "fat_mass_kg": (2, 150),
    "lean_mass_kg": (15, 200),
    "muscle_mass_kg": (10, 150),
    "bone_mass_kg": (0.5, 8),
    "hydration_percent": (30, 80),
    "visceral_fat_index": (1, 59),
    "bmi": (10, 80),
}
```

- Values outside range → stored as `None` (skip that metric, keep the weight)
- Log a warning but don't reject the entire measurement
- Consecutive-day weight delta >3 kg → flag in logs but still store (for user review)

#### 1.9 Connections API Sync Dispatch
**File:** `backend/app/api/connections.py`
- Add `elif connection.provider == "withings":` branch in `_dispatch_sync()` calling `sync_withings_measurements()`

#### 1.10 Celery Task
**File:** `backend/app/tasks/scheduler.py`

Add beat entry + task:
```python
"sync-withings-data": {
    "task": "app.tasks.scheduler.sync_all_withings_data",
    "schedule": crontab(minute="*/30"),
    "options": {"expires": 3600},
},
```

Task follows exact Whoop pattern: `asyncio.run()` + `task_session()`, per-user lock, skip `needs_reauth`, rollback on failure, commit on success, update `last_synced_at`.

#### 1.11 Metrics API Updates
**File:** `backend/app/api/metrics.py`

- Update GET response to include body composition fields
- Update POST/PATCH schemas to accept optional body composition fields for manual entry
- Withings weight entries are read-only (no PATCH/DELETE for `source="withings"`)

**File:** `backend/app/schemas/metrics.py`

Add optional fields to `WeightEntryCreate` and `WeightEntryUpdate` with range validators.

#### 1.12 Weight Dedup Between Sources
When both Whoop and Withings provide weight for the same day:
- Withings wins (direct scale measurement vs Whoop's estimation)
- The unique constraint `(user_id, date, source)` allows both to coexist
- The weight API GET endpoint deduplicates: prefer Withings over Whoop over Manual for the same date
- Chart service picks the best source for each date

---

### Phase 2: Frontend

#### 2.1 TypeScript Types
**File:** `frontend/src/lib/api/types/health.ts`

Add to `WeightEntry`:
```typescript
body_fat_percent?: number | null;
fat_mass_kg?: number | null;
lean_mass_kg?: number | null;
muscle_mass_kg?: number | null;
bone_mass_kg?: number | null;
hydration_percent?: number | null;
visceral_fat_index?: number | null;
bmi?: number | null;
```

#### 2.2 Weight Panel
**File:** `frontend/src/components/cycling/WeightPanel.tsx`

- Show body composition in entry details (expandable row or detail section)
- Withings entries display composition; Whoop entries show weight only
- Manual entries allow optional composition input
- Source badge: Withings (teal), Whoop (purple), Manual (gray)

#### 2.3 Body Composition Chart
**File:** `backend/app/services/charts.py`

New `body_composition_trend()` method returning multi-series data:
- Series: Weight (kg), Body Fat (%), Muscle Mass (kg), Hydration (%)
- 7-day rolling averages for each
- Insights: "Body fat decreasing while muscle mass increasing — recomposition detected"

**File:** `backend/app/api/charts.py` — register in `CHART_REGISTRY`

**File:** `frontend/src/app/(app)/cycling/page.tsx` — add chart alongside existing weight trend

#### 2.4 Settings UI
**File:** `frontend/src/app/(app)/settings/page.tsx`

Add Withings entry to `integrations` array:
```tsx
{
  id: 'withings',
  name: 'Withings',
  description: 'Body weight, body composition, and health measurements',
  icon: `${BASE_PATH}/icons/withings.svg`,
  emoji: '⚖️',
  color: 'bg-teal-500',
  available: true,
},
```

#### 2.5 Provider Badge
**File:** `frontend/src/components/ui/ProviderBadge.tsx`

Add to `PROVIDER_COLORS` and `PROVIDER_ICONS`:
```tsx
withings: 'bg-teal-500',
```

#### 2.6 Withings Icon
**New file:** `frontend/public/icons/withings.svg`

Download or create a Withings SVG icon (teal color).

---

### Phase 3: Data Quality

#### 3.1 Sync-Time Validation
In `sync_withings_measurements()`:
- Apply `RANGE_VALIDATORS` per metric
- Invalid values → `None` for that field, keep the rest
- Log warnings for out-of-range values

#### 3.2 Schema Validation (Manual Entries)
Extend `WeightEntryCreate`/`WeightEntryUpdate`:
- Each body comp field has `Field(None, ge=MIN, le=MAX)` with appropriate bounds
- All nullable — only weight is required

#### 3.3 Frontend Display
- Fields that are `null` → show "—" or hide
- Show source-specific fields (Withings = full composition, Whoop = weight only, Manual = weight + optional composition)

---

### Phase 4: Documentation & Config

#### 4.1 Environment Variables
Add to `.env.example`:
```
WITHINGS_CLIENT_ID=
WITHINGS_CLIENT_SECRET=
```

#### 4.2 AGENTS.md Updates
- Add Withings to the integrations table
- Add `sync_all_withings_data` to the Celery tasks table
- Add Withings to the connection health documentation

#### 4.3 CODEMAP Updates
- `backend/app/api/CODEMAP.md` — add Withings callback endpoints
- `backend/app/services/CODEMAP.md` — add Withings service functions
- `frontend/src/CODEMAP.md` — add Withings UI references

---

## Files to Create

| File | Purpose |
|------|---------|
| `backend/app/integrations/withings_client.py` | Withings API client |
| `backend/app/services/withings.py` | Sync service + outlier detection |
| `backend/alembic/versions/049_add_body_composition_columns.py` | Migration |
| `frontend/public/icons/withings.svg` | Provider icon |

## Files to Modify

| File | Change |
|------|--------|
| `backend/app/config.py` | Add `withings_client_id`, `withings_client_secret` |
| `backend/app/services/auth.py` | Add Withings to `OAUTH_PROVIDERS` + branches |
| `backend/app/api/auth.py` | Add Withings to fitness-integration tuples |
| `backend/app/api/connections.py` | Add Withings sync dispatch |
| `backend/app/models/weight.py` | Add body composition columns |
| `backend/app/schemas/metrics.py` | Add body composition fields + validators |
| `backend/app/api/metrics.py` | Update GET/POST/PATCH with composition data |
| `backend/app/services/charts.py` | Add `body_composition_trend()` |
| `backend/app/api/charts.py` | Register new chart |
| `backend/app/tasks/scheduler.py` | Add Withings Celery task + beat entry |
| `frontend/src/lib/api/types/health.ts` | Add composition fields to types |
| `frontend/src/lib/api/weight.ts` | Update API client types |
| `frontend/src/components/cycling/WeightPanel.tsx` | Show composition data + inputs |
| `frontend/src/app/(app)/cycling/page.tsx` | Add body composition chart |
| `frontend/src/app/(app)/settings/page.tsx` | Add Withings integration entry |
| `frontend/src/components/ui/ProviderBadge.tsx` | Add Withings color/icon |
| `.env.example` | Add `WITHINGS_CLIENT_ID`, `WITHINGS_CLIENT_SECRET` |

---

## Testing Strategy

1. **Unit tests**: Outlier detection logic, value decoding (`value * 10^unit`), measurement grouping
2. **Integration tests**: OAuth flow (mock Withings API), sync function with fixture data
3. **Manual verification**: Connect real Withings account, verify sync, check chart rendering
4. **Edge cases**: Scale with no composition data (weight only), multiple weigh-ins same day, Whoop + Withings same day dedup

---

## Deferred

- **Webhook/push sync**: Withings `Notify.subscribe` for near-real-time measurement notifications — deferred to a later enhancement (polling every 30 min is sufficient for daily weigh-ins)
- **Blood pressure / heart rate**: Withings BPM Core data — separate feature, not part of body composition
- **Sleep data**: Withings sleep tracking — overlaps with Whoop, low priority
- **Multi-user scale recognition**: Withings scales auto-detect users — the API returns `measuregrps` without user attribution per measurement (it's per-account), so multi-user handling is in the Withings app, not the API
