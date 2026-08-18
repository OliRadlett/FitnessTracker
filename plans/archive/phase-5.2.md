# Phase 5.2 — Whoop Intelligence Features

> Created: 2026-08-17
> Status: Implemented
> Depends on: Phase 5 (core Whoop integration)

Advanced intelligence features built on top of Whoop data. These provide training guidance, sleep optimization, health monitoring, and cross-provider insights.

---

## Work Items

### 1. Recovery-Based Training Readiness

**Goal**: Show a "readiness" indicator based on Whoop recovery score, guiding training intensity decisions.

#### Approach

1. **Add [`ReadinessIndicator`](frontend/src/components/cycling/ReadinessIndicator.tsx)** component:
   - Green (≥67%): "Ready to train hard"
   - Yellow (34-66%): "Moderate — listen to your body"
   - Red (≤34%): "Rest day recommended"
   - Show recovery score, HRV, and resting HR

2. **Add to lifting page** [`frontend/src/app/(app)/lifting/page.tsx`](frontend/src/app/(app)/lifting/page.tsx):
   - Show readiness indicator at the top of the page before starting a session
   - Color-code the session header based on readiness

3. **Add to dashboard** [`frontend/src/app/(app)/dashboard/page.tsx`](frontend/src/app/(app)/dashboard/page.tsx):
   - Replace the plain recovery score card with the readiness indicator

4. **Backend**: Add `GET /api/v1/metrics/readiness` endpoint that returns:
   ```json
   {"recovery_score": 72, "readiness": "green", "hrv_ms": 45, "resting_hr": 58, "message": "Ready to train hard"}
   ```

#### Files

| File | Change |
|------|--------|
| [`frontend/src/components/ui/ReadinessIndicator.tsx`](frontend/src/components/ui/ReadinessIndicator.tsx) | **Create** — readiness badge component |
| [`backend/app/api/metrics.py`](backend/app/api/metrics.py) | Add readiness endpoint |
| [`frontend/src/app/(app)/lifting/page.tsx`](frontend/src/app/(app)/lifting/page.tsx) | Add readiness indicator |
| [`frontend/src/app/(app)/dashboard/page.tsx`](frontend/src/app/(app)/dashboard/page.tsx) | Use readiness indicator for recovery card |

---

### 2. Strain vs Recovery Correlation Chart

**Goal**: Scatter plot showing the relationship between daily strain and next-day recovery.

#### Approach

Add to [`ChartService`](backend/app/services/charts.py):

```python
async def strain_vs_recovery(self, days: int = 30) -> ChartData:
    """Scatter plot: x-axis = day strain, y-axis = next-day recovery score.
    Each point is a day. Color by recovery level (green/yellow/red).
    Helps identify the optimal strain range for maintaining good recovery."""
```

Query: for each day with both strain and next-day recovery, plot (strain, recovery).

#### Files

| File | Change |
|------|--------|
| [`backend/app/services/charts.py`](backend/app/services/charts.py) | Add `strain_vs_recovery()` |
| [`backend/app/api/charts.py`](backend/app/api/charts.py) | Add endpoint |
| [`frontend/src/app/(app)/dashboard/page.tsx`](frontend/src/app/(app)/dashboard/page.tsx) | Add chart to dashboard |

---

### 3. Recovery vs Performance Correlation

**Goal**: Show how Whoop recovery predicts next-day lifting volume or cycling power.

#### Approach

```python
async def recovery_vs_performance(self, days: int = 60) -> ChartData:
    """Scatter plot: x-axis = recovery score, y-axis = next-day performance metric.
    Performance = lifting volume (kg) for strength days, or TSS for cycling days.
    Helps answer: does better recovery lead to better performance?"""
```

#### Files

| File | Change |
|------|--------|
| [`backend/app/services/charts.py`](backend/app/services/charts.py) | Add `recovery_vs_performance()` |

---

### 4. Sleep Consistency Tracking

**Goal**: Track bedtime regularity — irregular sleep patterns reduce recovery quality.

#### Approach

1. **Compute sleep consistency score** in [`whoop.py`](backend/app/services/whoop.py):
   ```python
   def compute_sleep_consistency(sleep_logs: list[SleepLog], window_days: int = 7) -> float:
       """Score 0-100 based on bedtime regularity.
       Low std dev of sleep_start times = high consistency.
       0 = very irregular, 100 = perfectly consistent."""
   ```

2. **Add to [`DailyMetric`](backend/app/models/daily_metric.py)** or compute on-the-fly in the API

3. **Frontend**: Show "Sleep Consistency: 85%" badge on the dashboard sleep section

#### Files

| File | Change |
|------|--------|
| [`backend/app/services/whoop.py`](backend/app/services/whoop.py) | Add `compute_sleep_consistency()` |
| [`backend/app/api/metrics.py`](backend/app/api/metrics.py) | Add sleep consistency endpoint |

---

### 5. Sleep Debt Calculator

**Goal**: Compare actual sleep vs needed sleep over a rolling 7-day window.

#### Approach

```python
def compute_sleep_debt(sleep_logs: list[SleepLog], needed_hours: float = 8.0, window_days: int = 7) -> dict:
    """Calculate cumulative sleep debt.
    Returns: {"debt_hours": float, "avg_sleep_hours": float, "days_below_target": int}
    """
```

The user's target sleep can be configurable. Default 8 hours.

#### Files

| File | Change |
|------|--------|
| [`backend/app/services/whoop.py`](backend/app/services/whoop.py) | Add `compute_sleep_debt()` |
| [`backend/app/api/metrics.py`](backend/app/api/metrics.py) | Add sleep debt endpoint |

---

### 6. Optimal Bedtime Suggestion

**Goal**: Suggest optimal bedtime based on the user's sleep patterns and wake time.

#### Approach

Analyze the user's best recovery days (top 25%) and find the common bedtime window. Show: "Your best recovery happens when you sleep between 10:30 PM and 11:00 PM."

#### Files

| File | Change |
|------|--------|
| [`backend/app/services/whoop.py`](backend/app/services/whoop.py) | Add `suggest_optimal_bedtime()` |
| [`backend/app/api/metrics.py`](backend/app/api/metrics.py) | Add endpoint |

---

### 7. Respiratory Rate Baseline

**Goal**: Track resting respiratory rate over time. Elevated rate is an early illness indicator.

#### Approach

1. **Compute rolling baseline**: 30-day average respiratory rate
2. **Alert if current rate > baseline + 10%**: Already handled by [`generate_health_alerts`](backend/app/tasks/scheduler.py) — just need to ensure respiratory_rate is populated in [`DailyMetric`](backend/app/models/daily_metric.py) from Whoop recovery data
3. **Dashboard**: Show respiratory rate with trend arrow (↑ elevated, → stable, ↓ low)

#### Files

| File | Change |
|------|--------|
| [`backend/app/tasks/scheduler.py`](backend/app/tasks/scheduler.py) | Add respiratory rate alert to [`generate_health_alerts`](backend/app/tasks/scheduler.py:140) |
| [`frontend/src/app/(app)/dashboard/page.tsx`](frontend/src/app/(app)/dashboard/page.tsx) | Add respiratory rate display |

---

### 8. Body Weight Tracking

**Goal**: Track weight over time from Whoop body measurements.

#### Approach

1. **Create [`WeightLog`](backend/app/models/weight.py)** model:
   ```python
   class WeightLog(Base):
       id, user_id, date, weight_kilogram, source, created_at
   ```
   Unique constraint: `(user_id, date, source)`

2. **Sync on Whoop connection**: Call [`get_body_measurements()`](backend/app/integrations/whoop_client.py) and store weight

3. **Add weight trend chart**: Line chart showing weight over time with 7-day rolling average

#### Files

| File | Change |
|------|--------|
| [`backend/app/models/weight.py`](backend/app/models/weight.py) | **Create** — WeightLog model |
| [`backend/alembic/versions/011_add_weight_log.py`](backend/alembic/versions/011_add_weight_log.py) | **Create** — migration |
| [`backend/app/services/whoop.py`](backend/app/services/whoop.py) | Add weight sync |
| [`backend/app/services/charts.py`](backend/app/services/charts.py) | Add weight trend chart |

---

### 9. HRV Trend with Rolling Averages

**Goal**: Show HRV over time with 7-day, 30-day, 90-day rolling averages and personal baseline.

#### Approach

```python
async def hrv_trend(self, days: int = 90) -> ChartData:
    """Line chart: daily HRV with 7-day and 30-day rolling average overlays.
    Shaded region = personal baseline (±1 std dev from 90-day average).
    Points below the baseline are highlighted in red."""
```

#### Files

| File | Change |
|------|--------|
| [`backend/app/services/charts.py`](backend/app/services/charts.py) | Add `hrv_trend()` |

---

### 10. Weekly Whoop Summary Card

**Goal**: Dedicated Whoop section on the dashboard showing weekly health trends.

#### Approach

Add a "Whoop Weekly" card to the dashboard showing:
- Average recovery score (with trend arrow vs last week)
- Average sleep duration (with trend arrow)
- Total strain (with comparison)
- Sleep consistency percentage
- Best/worst recovery day

#### Files

| File | Change |
|------|--------|
| [`backend/app/api/dashboard.py`](backend/app/api/dashboard.py) | Add whoop weekly summary endpoint |
| [`frontend/src/app/(app)/dashboard/page.tsx`](frontend/src/app/(app)/dashboard/page.tsx) | Add Whoop weekly card |

---

### 11. Training Load Balance

**Goal**: Unified training load score combining Strava TSS, Whoop strain, and lifting volume.

#### Approach

```python
async def training_load_balance(self, weeks: int = 4) -> ChartData:
    """Stacked area chart: Strava TSS + Whoop strain + lifting volume per week.
    Shows how different training modalities contribute to total load.
    Include an acute:chronic workload ratio line."""
```

#### Files

| File | Change |
|------|--------|
| [`backend/app/services/charts.py`](backend/app/services/charts.py) | Add `training_load_balance()` |

---

### 12. Rest Day Analysis

**Goal**: Show recovery scores on rest days vs training days to validate rest day effectiveness.

#### Approach

Query [`DailyMetric`](backend/app/models/daily_metric.py) grouped by whether the day had an activity or not. Compare average recovery on rest days vs training days.

#### Files

| File | Change |
|------|--------|
| [`backend/app/services/charts.py`](backend/app/services/charts.py) | Add `rest_day_analysis()` |

---

## Files Summary

| File | Change | Work Item |
|------|--------|-----------|
| [`frontend/src/components/ui/ReadinessIndicator.tsx`](frontend/src/components/ui/ReadinessIndicator.tsx) | **Create** | 1 |
| [`backend/app/api/metrics.py`](backend/app/api/metrics.py) | Add readiness, sleep consistency, sleep debt, bedtime endpoints | 1, 4, 5, 6 |
| [`backend/app/services/whoop.py`](backend/app/services/whoop.py) | Add sleep consistency, sleep debt, bedtime, weight sync | 4, 5, 6, 8 |
| [`backend/app/services/charts.py`](backend/app/services/charts.py) | Add strain_vs_recovery, recovery_vs_performance, hrv_trend, weight_trend, training_load, rest_day | 2, 3, 8, 9, 11, 12 |
| [`backend/app/models/weight.py`](backend/app/models/weight.py) | **Create** — WeightLog model | 8 |
| [`backend/app/tasks/scheduler.py`](backend/app/tasks/scheduler.py) | Add respiratory rate alert | 7 |
| [`frontend/src/app/(app)/dashboard/page.tsx`](frontend/src/app/(app)/dashboard/page.tsx) | Readiness indicator, Whoop weekly card, respiratory rate | 1, 7, 10 |
| [`frontend/src/app/(app)/lifting/page.tsx`](frontend/src/app/(app)/lifting/page.tsx) | Add readiness indicator | 1 |
