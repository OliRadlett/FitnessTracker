# Testing Guide — Audit Changes (2026-08-18) — Round 2

> **How to use**: Work through each section. Tick off items as you verify them.
> Report bugs by pasting errors/screenshot descriptions back to me.
>
> **Legend**: `[Y]` = Passed | `[N]` = Not working | `[ ]` = Not tested | `[FIX]` = Bug found & fixed this session | `[IMP]` = Improvement applied

---

## 1. Migrations & Startup

| # | What to test | Status | Notes |
|---|-------------|--------|-------|
| 1.1 | `python fittrack.py up --migrate` succeeds | [FIX] | Fixed stale `014` duplicate, added alembic volume mount, made 018/019 idempotent with IF NOT EXISTS |
| 1.2 | All containers start healthy | [ ] | |
| 1.3 | Structured JSON logs with correlation IDs | [ ] | |
| 1.4 | `GET /api/v1/health` returns ok | [ ] | |
| 1.5 | `GET /metrics` returns Prometheus format | [ ] | |

---

## 2. Landing Page & Auth

| # | What to test | Status |
|---|-------------|--------|
| 2.1 | Landing page loads at `/` | [ ] |
| 2.2 | Sign in with OAuth works | [ ] |
| 2.3 | Sidebar visible with all nav links including Training | [ ] |
| 2.4 | Mobile hamburger menu works | [ ] |
| 2.5 | Sidebar closes after navigation | [ ] |

---

## 3. Dashboard Page

| # | What to test | Status | Notes |
|---|-------------|--------|-------|
| 3.1 | **Training readiness** card always visible showing TSB, Recovery, Consecutive Days | [FIX] | Was hidden when `should_rest=false`. Now always shows with green "Training readiness looks good" or amber "Consider a rest day" |
| 3.2 | **Goals** section with exercise autocomplete | [FIX] | ExerciseAutocomplete integrated into GoalForm for 1RM targets |
| 3.3 | **Monthly summary** renders | [FIX] | NaN guards added to `dashboard.py` — was likely crashing on NaN values in aggregated data. After restart, should render |
| 3.4 | **Upcoming events** section | [ ] | Still conditional — appears when events exist |
| 3.5 | **Yearly summary** card with year navigation | [FIX] | NaN guards added — same root cause as monthly summary |
| 3.6 | **PDF download** buttons work | [Y] | |
| 3.7 | Empty states graceful | [Y] | |

---

## 4. Activities Page

| # | What to test | Status |
|---|-------------|--------|
| 4.1 | Activity list loads with pagination | [Y] |
| 4.2 | GPX import works | [Y] |
| 4.3 | FIT import works | [Y] |
| 4.4 | Upload error handling | [ ] |
| 4.5 | Calendar view at `/calendar` via sidebar | [Y] |
| 4.6 | X-Total-Count pagination | [Y] |

---

## 5. Cycling Page

| # | What to test | Status | Notes |
|---|-------------|--------|-------|
| 5.1 | Cycling profile editor | [Y] | |
| 5.2 | FTP history chart | [Y] | |
| 5.3 | Power curve table/chart | [Y] | |
| 5.4 | Power zones display | [Y] | |
| 5.5 | **HR zones** always visible with LTHR setup notice | [FIX] | Always shows card. Without LTHR: "Set your LTHR to see HR zone distribution" with 💓 emoji |
| 5.6 | **VO2max card** always visible | [FIX] | Shows data when available, shows "requires per-second power data" empty state when not |
| 5.7 | **VO2max history trend** always visible | [FIX] | Shows empty state with instructions when no data |
| 5.8 | **Decoupling chart** always visible | [FIX] | Shows empty state explaining >60min + power/HR requirement |
| 5.9 | Weight trend chart | [Y] | |
| 5.10 | **Benchmarks** on MetricCards | [FIX] | NaN guards on metrics-summary should fix the crash. Requires FTP + weight set in profile |
| 5.11 | Power curve comparison | [ ] | Requires stream data — use Fetch Streams button |
| 5.12 | Metrics summary 7d/28d | [Y] | |
| 5.13 | **Training load** CTL/ATL/TSB | [FIX] | NaN guards added to cycling service. Requires TSS data — use Recalculate TSS button |
| 5.14 | **Fetch Streams button** always visible | [FIX] | Always shown when FTP is set (was conditionally hidden before). Click to backfill stream data |

---

## 6. Lifting Page

| # | What to test | Status |
|---|-------------|--------|
| 6.1 | Exercise list loads | [Y] |
| 6.2 | Add session works | [Y] |
| 6.3 | Add sets works | [Y] |
| 6.4 | PR celebration toast | [ ] |
| 6.5 | Personal records shows | [Y] |
| 6.6 | Warmup templates | [Y] |

---

## 7. Routes Page

| # | What to test | Status |
|---|-------------|--------|
| 7.1 | Route list loads | [Y] |
| 7.2 | Map with polyline | [Y] |
| 7.3 | Ridden/Unridden badges | [Y] |
| 7.4 | Surface breakdown (Komoot routes only) | [ ] |
| 7.5 | GPX download | [Y] |
| 7.6 | GPX upload | [Y] |
| 7.7 | Elevation profile | [Y] |

---

## 8. Training Page

| # | What to test | Status |
|---|-------------|--------|
| 8.1 | Page loads | [Y] |
| 8.2 | Goals with autocomplete | [FIX] |
| 8.3 | GoalCard progress | [ ] |
| 8.4 | Auto-generate plan | [Y] |
| 8.5 | PlanBuilder calendar grid | [Y] |
| 8.6 | Create event | [Y] |
| 8.7 | Periodization chart | [ ] |
| 8.8 | Taper info on events | [ ] |

---

## 9. Backend API — New Endpoints

| # | What to test | Status | Notes |
|---|-------------|--------|-------|
| 9.1-9.13 | All new endpoints | [ ] | NaN guards added across all endpoints. Re-test after restart |

---

## 10. Infrastructure

| # | What to test | Status |
|---|-------------|--------|
| 10.1 | Rate limiting | [ ] |
| 10.2 | CORS | [ ] |
| 10.3 | HMAC webhooks | [ ] |
| 10.4 | Encrypted tokens | [ ] |
| 10.5 | OAuth connections work | [ ] |
| 10.6 | Retry logic | [ ] |
| 10.7 | Bundle sizes | [ ] |
| 10.8 | Skeleton loaders | [ ] |

---

## 11. Charts

| # | What to test | Status |
|---|-------------|--------|
| 11.1 | weight_trend | [Y] |
| 11.2-11.7 | vo2max_trend, decoupling_trend, periodization, hr_zones, power_comparison, ReferenceAreas | [ ] | Requires stream data. Use Fetch Streams button |

---

## 12. Settings Page

| # | What to test | Status |
|---|-------------|--------|
| 12.1 | Data export | [ ] |
| 12.2 | OAuth connections | [Y] |
| 12.3 | FTP auto-estimate toggle | [Y] | On Cycling page ProfileEditor |

---

## Quick Smoke Test

1. [ ] `python fittrack.py migrate` succeeds
2. [ ] `python fittrack.py restart backend worker` completes
3. [ ] Login works
4. [ ] Dashboard: training readiness card visible with TSB/Recovery/Consecutive Days
5. [ ] Dashboard: monthly summary renders (was crashing before NaN fix)
6. [ ] Cycling: VO2max, decoupling, VO2max trend all visible (with empty states if no stream data)
7. [ ] Cycling: Fetch Streams button visible
8. [ ] No browser console errors on any page

---

## All Bug Fixes This Session

| # | Bug | Fix | Files |
|---|-----|-----|-------|
| 1 | Migration 014 duplicate multiple heads | Deleted stale file + added alembic volume mount | `014_add_composite_indexes.py` (deleted), [`docker-compose.yml`](docker-compose.yml:37) |
| 2 | Migration 018/019 fail on existing tables | Changed to `CREATE TABLE IF NOT EXISTS` | [`018_add_goals.py`](backend/alembic/versions/018_add_goals.py:20), [`019_add_training_plans_events.py`](backend/alembic/versions/019_add_training_plans_events.py:20) |
| 3 | GoalForm missing exercise autocomplete | Replaced text input with ExerciseAutocomplete | [`GoalCard.tsx`](frontend/src/components/ui/GoalCard.tsx:212) |
| 4 | NaN in DB crashes JSON serialization (500 errors) | Added `_safe_float()` guards on sync + `_nan0()` on aggregations | [`strava.py`](backend/app/services/strava.py:19), [`wahoo.py`](backend/app/services/wahoo.py:24), [`cycling.py`](backend/app/api/cycling.py:351), [`dashboard.py`](backend/app/api/dashboard.py:34), [`cycling.py` (service)](backend/app/services/cycling.py:441) |
| 5 | Rest day suggestion hidden when should_rest=false | Always shows TSB/Recovery/Consecutive Days breakdown | [`dashboard/page.tsx`](frontend/src/app/(app)/dashboard/page.tsx:520) |
| 6 | HR zones hidden when no data | Always shows card with LTHR setup notice | [`cycling/page.tsx`](frontend/src/app/(app)/cycling/page.tsx:668) |
| 7 | VO2max/decoupling/trend sections silently hidden | Always visible with informative empty states | [`cycling/page.tsx`](frontend/src/app/(app)/cycling/page.tsx:406,721,770) |
| 8 | Fetch Streams button conditionally hidden | Always visible when FTP is set | [`cycling/page.tsx`](frontend/src/app/(app)/cycling/page.tsx:553) |

---

## Post-Restart Workflow

1. **`python fittrack.py migrate`** — should complete all 19 migrations
2. **`python fittrack.py restart backend worker`** — pick up NaN guards + frontend changes
3. **Cycling page → "⚡ (Re)calculate TSS"** — compute TSS for training load
4. **Cycling page → "📡 Fetch Streams from Strava"** — backfill power/HR stream data
5. **Cycling page → "📊 Backfill FTP History"** — populate FTP progression chart
6. **Re-test all [ ] items** — most should now populate with data