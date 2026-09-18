# Health Monitor Tuning Plan

## Problem Statement

Health monitor signals produce false positives during ramp-up periods (injury risk), miss acute bad days (illness risk), and use cycling-only metrics that ignore lifting stress. Two users with identical wearable data but different training types get wildly different alerts.

## Changes

### 1. Fix volume spike zero-drag in `_volume_spike_signal()`

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:111)

**Current behaviour**: Averages all 4 prior weeks including zeros from pre-tracking, inflating spike percentages.

**New behaviour**: Three-layer approach:

1. **Activity-aware weeks**: Check each of the 6 rolling weeks (current + 5 prior) for *any* user activity (lifting session OR cardio activity). Weeks with zero activity of any kind are excluded from the prior-week average. Weeks with cycling but no lifting count as legitimate 0-lifting weeks.

2. **Minimum history gate**: Require ≥2 prior weeks with activity before the signal can fire. Returns 0 if insufficient history.

3. **EWMA weighting**: Use exponential weighting with 4-week half-life (alpha ≈ 0.221) instead of simple average. Recent weeks dominate; old zeros from ramp-up fade naturally. Mirrors CTL computation for TSS.

**Implementation**:

```python
import math

def _volume_spike_signal(
    current_week_volume: float,
    prior_week_volumes: list[float],
    prior_week_active: list[bool],
) -> float:
    """Score 0-100 based on volume increase vs EWMA of prior weeks.

    Only considers prior weeks where the user was active (had any
    training activity). Requires ≥2 prior active weeks before firing.
    Uses EWMA with 4-week half-life to reduce impact of old data.

    Args:
        current_week_volume: Total lifting volume kg for the most recent 7 days.
        prior_week_volumes: Lifting volume for each prior week [1..5].
        prior_week_active: Whether each prior week had any activity.
    """
    # Pair and filter to active prior weeks only
    active_volumes = [
        vol for vol, active in zip(prior_week_volumes, prior_week_active)
        if active
    ]

    # Minimum history gate
    if len(active_volumes) < 2:
        return 0.0

    # EWMA with 4-week half-life (alpha = 1 - e^(-1/half_life))
    alpha = 1 - math.exp(-1 / 4)
    ewma = 0.0
    for vol in active_volumes:  # oldest first (index 1 = 7-14d ago)
        ewma = alpha * vol + (1 - alpha) * ewma

    if ewma <= 0:
        return 0.0

    increase_pct = (current_week_volume - ewma) / ewma * 100

    # Existing thresholds unchanged
    if increase_pct > 50:
        return 100.0
    elif increase_pct > 30:
        return 70.0
    elif increase_pct > 20:
        return 40.0
    return 0.0
```

**Changes to `analyze_injury_risk()`** (same file, line ~302): Extend the weekly query to also check for activity presence per week. Build `prior_week_active: list[bool]` alongside the existing `week_volumes: list[float]`.

### 2. Update `analyze_injury_risk()` to pass activity data

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:302)

Extend the week-loop (lines 314-326) to also query for *any* activity (lifting OR cardio) in each week window:

```python
# Inside the loop for each week i:
# Existing: get lifting volume
# New: also check for any activity
act_result = await db.execute(
    select(func.count(Activity.id))
    .where(
        Activity.user_id == user_id,
        Activity.start_date >= week_start,
        Activity.start_date < week_end,
    )
)
lift_result = await db.execute(
    select(func.count(LiftingSession.id))
    .where(
        LiftingSession.user_id == user_id,
        LiftingSession.session_date >= week_start,
        LiftingSession.session_date < week_end,
    )
)
has_activity = (int(act_result.scalar() or 0) + int(lift_result.scalar() or 0)) > 0
```

### 3. Fix sleep efficiency signal to catch acute bad nights

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:93)

**Current**: Averages all sleep efficiencies over 7 days. One 50% night among six 90% nights = 84% average = score 0.

**New**: Use EWMA with 2-day half-life so recent nights dominate. A single bad night will pull the weighted average down significantly.

```python
def _sleep_efficiency_signal(sleep_logs: list[SleepLog]) -> float:
    """Score 0-100 based on sleep efficiency using EWMA.

    Uses exponential weighting (2-day half-life) so a single bad
    night has meaningful impact on the score.
    """
    efficiencies = [l.sleep_efficiency for l in sleep_logs if l.sleep_efficiency is not None]
    if not efficiencies:
        return 0.0

    alpha = 1 - math.exp(-1 / 2)  # 2-day half-life
    ewma = efficiencies[0]
    for eff in efficiencies[1:]:
        ewma = alpha * eff + (1 - alpha) * ewma

    if ewma < 70:
        return 100.0
    elif ewma < 78:
        return 70.0
    elif ewma < 83:
        return 40.0
    return 0.0
```

Thresholds adjusted from 75/80/85 to 70/78/83 to compensate for EWMA pulling lower than a simple average.

### 4. Fix unexplained fatigue to use meaningful training activity instead of TSS-only

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:168)

**Current**: Uses `recent_tss < 200` (cycling-only metric). A powerlifter with low recovery and no cycling gets false positives.

**New**: Check for *meaningful* recent training (lifting OR cycling >30 min) in the past 3 days. A 20-minute walk should NOT disable this signal — only substantive training counts.

```python
def _unexplained_fatigue_signal(
    recovery_values: list[float | None],
    recent_meaningful_training_days: int,
) -> float:
    """Score 0-100 for low recovery without corresponding training.

    If recovery is low but the user hasn't been doing meaningful training,
    this suggests illness or other stressors. Meaningful = lifting session
    OR cardio activity >30 minutes.
    """
    values = [v for v in recovery_values if v is not None]
    if not values:
        return 0.0
    recent_recovery = values[-1]
    # Low recovery + no meaningful training = unexplained fatigue
    if recent_recovery < 35 and recent_meaningful_training_days == 0:
        return 100.0
    elif recent_recovery < 45 and recent_meaningful_training_days == 0:
        return 70.0
    return 0.0
```

Update `analyze_illness()` to count days with lifting sessions OR activities with `duration_seconds > 1800` (30 min) in the past 3 days.

### 5. Add recovery score signal to illness risk

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:402)

**Current**: Illness risk uses only respiratory rate, HRV trend, sleep quality, and unexplained fatigue. A very low Whoop recovery score — one of the clearest illness indicators — is completely ignored.

**New**: Add a `_recovery_illness_signal()` that fires when recovery is very low regardless of training state. This is distinct from the overtraining recovery signal (which checks for consecutive low days): this catches acute single-day crashes that indicate illness.

```python
def _recovery_illness_signal(recovery_values: list[float | None]) -> float:
    """Score 0-100 based on very low recovery scores.

    A single recovery score below 20% is a strong illness indicator.
    Below 35% is concerning. Distinct from the overtraining recovery
    signal which looks at consecutive days.
    """
    values = [v for v in recovery_values if v is not None]
    if not values:
        return 0.0
    latest = values[-1]
    if latest < 15:
        return 100.0
    elif latest < 25:
        return 70.0
    elif latest < 35:
        return 40.0
    return 0.0
```

**Updated weights for illness risk** (physiology-focused, distinct from overtraining):

| Signal | Old Weight | New Weight | Rationale |
|--------|-----------|-----------|-----------|
| Recovery Score (NEW) | — | 25% | Direct illness indicator |
| Respiratory Rate | 35% | 20% | Often missing, reduced |
| HRV Trend | 30% | 25% | Leading illness indicator |
| Sleep Quality | 20% | 15% | Secondary indicator |
| Unexplained Fatigue | 15% | 15% | No-training + low recovery |

### 6. Add resting HR to illness/overtraining evidence display (display only, not scored)

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:284)

Add resting HR to the evidence dictionaries returned by `analyze_overtraining()` and `analyze_illness()`. This provides context for *why* recovery/HRV signals are elevated without double-counting in the score (resting HR is already baked into the Whoop recovery score).

```python
# In analyze_overtraining() evidence dict:
"Resting HR": f"{'✅' if resting_hr_normal else '⚠️'} {current_rhr:.0f} bpm (baseline: {baseline_rhr:.0f} bpm)",

# In analyze_illness() evidence dict:
"Resting HR": f"{'✅' if resting_hr_normal else '⚠️'} {current_rhr:.0f} bpm (baseline: {baseline_rhr:.0f} bpm)",
```

### 7. Redistribute illness signal weights when respiratory rate is missing (updated)

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:485)

**Current**: Fixed weights `rr: 35%, hrv: 30%, sleep: 20%, fatigue: 15%`. When respiratory rate is NULL (common), 35% of the composite is wasted on a 0-score signal.

**New**: When `rr_s == 0` and respiratory rate data is missing, redistribute its weight proportionally to the other signals:

```python
# In analyze_illness(), after computing all signals:
if current_rr is None and baseline_rr is None:
    # No respiratory data — redistribute its 20% weight
    raw_total = recovery_illness_s * 0.25 + hrv_s * 0.25 + sleep_s * 0.15 + fatigue_s * 0.15
    score = raw_total / 0.80 * 100  # Normalize to full weight
else:
    score = (recovery_illness_s * 0.25 + rr_s * 0.20 + hrv_s * 0.25
             + sleep_s * 0.15 + fatigue_s * 0.15)
```

### 8. Adjust severity classification thresholds

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:194)

**Current**: ≥80→critical, ≥60→warning, ≥40→info, <40→none

**Proposed**: Raise thresholds slightly to reduce false positives:
- ≥85→critical (was 80)
- ≥65→warning (was 60)
- ≥45→info (was 40)

### 9. Rebalance overtraining weights (training-load focused, distinct from illness)

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:273)

**Current weights**: TSB 30%, Recovery 30%, HRV 25%, Sleep 15%

**Problem**: HRV and sleep overlap with illness risk signals. When both fire, the user gets two nearly identical alerts.

**New weights** (overtraining = "you trained too hard"):

| Signal | Old Weight | New Weight | Rationale |
|--------|-----------|-----------|-----------|
| TSB | 30% | 40% | Primary training load indicator |
| Recovery (consecutive + absolute) | 30% | 35% | Training response indicator |
| HRV Trend | 25% | 15% | Reduced — overlaps with illness |
| Sleep Efficiency | 15% | 10% | Reduced — overlaps with illness |

This creates clearer separation: overtraining is dominated by training load signals (TSB + recovery = 75%), while illness is dominated by physiological signals (recovery score + RR + HRV = 70%).

### 10. Raise overtraining TSB threshold

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:26)

**Current**: TSB < -30 for consecutive days triggers signal

**Proposed**: TSB < -35. -30 is functional overreaching for powerlifters; -35 is more clearly maladaptive.

### 11. Raise recovery signal threshold

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:48)

**Current**: Recovery < 50% for consecutive days triggers signal

**Proposed**: Recovery < 40%. Whoop recovery 40-50% is common after moderate training days.

### 12. Fix `_recovery_signal()` to consider absolute severity

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:48)

**Current**: Only counts consecutive days below 50%. A 6% recovery and a 46% recovery both score 40 if they are below 50% for 2 days. An acute recovery crash goes unnoticed.

**New**: Consider both consecutive days AND absolute severity. Take the higher of the two scores:

```python
def _recovery_signal(recovery_values: list[float | None]) -> float:
    """Score 0-100 based on consecutive low recovery days AND absolute severity."""
    values = [v for v in recovery_values if v is not None]
    if not values:
        return 0.0

    # Absolute severity: very low recovery is alarming regardless of history
    latest = values[-1]
    absolute_score = 0.0
    if latest < 15:
        absolute_score = 100.0
    elif latest < 25:
        absolute_score = 70.0
    elif latest < 35:
        absolute_score = 40.0

    # Consecutive days below 40% (raised from 50%)
    consecutive_low = 0
    for r in reversed(values):
        if r < 40:
            consecutive_low += 1
        else:
            break
    if consecutive_low >= 4:
        consecutive_score = 100.0
    elif consecutive_low >= 3:
        consecutive_score = 70.0
    elif consecutive_low >= 2:
        consecutive_score = 40.0
    else:
        consecutive_score = 0.0

    return max(absolute_score, consecutive_score)
```

**Example with 6% recovery**: absolute_score = 100 (latest < 15), composite jumps from 29.5 to 47.5 → "info" severity.

### 13. Lower HRV trend minimum data requirement

**File**: [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py:71)

**Current**: Requires 5+ HRV values to compute trend. Returns 0 if fewer available.

**Problem**: Intermittent Whoop usage (3 out of 7 days) silently disables the signal even when there IS a decline.

**New**: Lower minimum to 3 values. With 3 values, compare the last value to the average of the prior values:

```python
def _hrv_trend_signal(hrv_values: list[float | None]) -> float:
    """Score 0-100 based on HRV decline trend.

    Compares recent values to prior values. Requires ≥3 data points.
    """
    values = [v for v in hrv_values if v is not None]
    if len(values) < 3:
        return 0.0

    # Split: last value vs average of prior values
    recent = values[-1]
    prior_avg = sum(values[:-1]) / len(values[:-1])
    if prior_avg <= 0:
        return 0.0

    decline_pct = (prior_avg - recent) / prior_avg * 100
    if decline_pct > 20:
        return 100.0
    elif decline_pct > 15:
        return 70.0
    elif decline_pct > 10:
        return 40.0
    return 0.0
```

## Files to Modify

| File | Changes |
|------|---------|
| [`backend/app/services/health_analysis.py`](backend/app/services/health_analysis.py) | All 13 changes above |

## Verification (updated)

1. Run `python fittrack.py exec backend python -c "from app.services.health_analysis import ..."` to verify import
2. Hit `POST /api/v1/metrics/health-alerts/analyze` and check that:
   - Volume spike score is 0 during ramp-up (first 2 weeks of data)
   - Volume spike correctly reflects actual changes once ≥2 prior active weeks exist
   - Rest weeks (0 lifting but with cardio) don't inflate the spike
   - A single bad sleep night (50%) meaningfully affects the sleep signal
   - Illness risk fires correctly when recovery is low + HRV is low + no meaningful training
   - Illness risk includes recovery score signal (25% weight)
   - Overtraining is dominated by TSB + recovery (75% of weight)
   - Illness is dominated by recovery + RR + HRV (70% of weight)
   - Resting HR appears in evidence display for context
   - HRV trend works with as few as 3 data points
   - Unexplained fatigue ignores light activity (<30 min)
   - Severity thresholds produce fewer false "warning" classifications
