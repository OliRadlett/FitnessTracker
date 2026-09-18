# Modal Expansion: Serverless Intelligence Platform

## Executive Summary

Modal currently handles one thing: lifting video processing. This plan expands Modal into a **serverless intelligence platform** that enables compute-heavy features impossible on a single Celery worker. Modal containers run on-demand with no DB access — data flows in via function arguments, results flow back via return values.

**Architecture principle**: Modal handles heavy compute. Celery orchestrates and owns all DB I/O. No DB credentials in Modal containers.

---

## 1. Smart Route Intelligence

### 1.1 Problem

Route dedup uses 50-point shape sampling + Haversine (`polyline_utils.py:179`). This is fast but coarse — it catches obvious duplicates but misses close variants (e.g. same road, different start point 200m away). Route quality scoring uses 4 static weights with a hardcoded 20 km/h flat speed (`route_quality_service.py:147`). Effort estimation for unridden routes assumes flat terrain and fixed CdA.

### 1.2 Modal-Enabled Features

**A. Fréchet Distance Matching**

Replace 50-point shape sampling with discrete Fréchet distance — a true curve-to-curve similarity metric that respects point ordering and spatial continuity. O(n²) in polyline point count, but runs in a Modal container with no DB access.

| Current | Modal |
|---------|-------|
| 50-point sampling, avg Haversine | Full polyline Fréchet distance |
| Catches obvious dups | Catches same-road variants, start-point offsets |
| ~1ms per comparison | ~50-200ms per comparison |

**B. Terrain Classification**

Analyze elevation profile shape using signal processing:
- Compute gradient array from elevation profile
- Classify: `flat` (<1% avg gradient), `rolling` (variable gradient, low total gain), `climbing` (sustained >3%), `mixed` (multi-peak profile)
- Detect dominant climb characteristics (category, sustained length, max gradient)

**C. Segment-Level Effort Prediction**

For unridden routes, predict personal effort by:
1. Extract gradient signature from route elevation profile
2. Find K-nearest-neighbor segments from ridden routes (Euclidean distance on gradient/distance/elevation vectors)
3. Weight actual segment efforts by similarity to predict effort on new route
4. Return predicted TSS, duration, NP, and confidence score

**D. Route Similarity Graph**

Compute pairwise Fréchet similarity across all user routes. Enables:
- "Routes like this one" recommendations
- Training variety analysis (are you riding the same 3 routes?)
- Overuse injury prevention (route diversity score)

### 1.3 Modal Function

```python
# backend/app/integrations/route_intelligence.py

def analyze_routes_on_modal(
    routes_data: list[dict],  # [{id, polyline, elevation_profile, distance, ...}]
    segments_data: list[dict],  # [{id, route_id, gradient, distance, efforts: [...]}]
    user_ftp: float | None,
    user_weight_kg: float | None,
) -> dict:
    """Run heavy route analysis in a Modal container.
    
    Returns:
        {
            "terrain_classifications": {route_id: {terrain_type, climb_categories, ...}},
            "similarity_matrix": {route_a_id: {route_b_id: score, ...}},
            "effort_predictions": {route_id: {predicted_tss, predicted_duration, confidence, ...}},
        }
    """
```

### 1.4 Integration Points

- `route_service.py` — enhanced `find_duplicate_route` with Fréchet scoring
- `route_quality_service.py` — terrain classification feeds into quality scoring
- `effort_estimator.py` — segment-level prediction replaces flat-speed assumption
- `workout_planner.py` — better TSS estimates for unridden routes
- New API endpoint: `GET /routes/{id}/similarity` — returns similar routes
- New API endpoint: `GET /routes/{id}/effort-prediction` — predicted effort

### 1.5 Data Flow

```
Celery task / API endpoint
  → Fetch routes + segments + efforts from DB
  → Serialize to JSON arguments
  → Call Modal function (no DB, no R2)
  → Get results back
  → Write terrain classifications, predictions to DB
```

---

## 2. Personalized Power-Duration Model

### 2.1 Problem

FTP estimation uses fixed multipliers (20min × 0.95, 8min × 0.855). VO2max uses fixed ACSM formula. CTL/ATL time constants (42/7 days) are identical for every rider. These work but aren't personalized.

### 2.2 Modal-Enabled Features

**A. Critical Power Curve Fitting**

Fit a 3-parameter critical power model (Morton 2004) to the user's actual power-duration data:
- `CP` (critical power) — the asymptotic power output
- `W'` (anaerobic capacity) — finite work above CP
- Nonlinear least-squares fitting (Levenberg-Marquardt)

This replaces fixed multipliers with a model that learns the user's personal power-duration curve shape.

**B. Personalized VO2max**

Regress the user's steady-state HR-vs-power data to find their personal oxygen-uptake curve. Multi-ride regression instead of a single fixed formula.

**C. Adaptive CTL/ATL Constants**

Learn personal time constants by fitting EWMA decay to the user's HRV recovery patterns post-hard-ride. Grid search over candidate (CTL_tau, ATL_tau) pairs to minimize prediction error on observed recovery.

### 2.3 Modal Function

```python
def fit_power_models_on_modal(
    power_curve_data: dict,  # {duration_buckets: [5s, 60s, ...], best_watts: [...]}
    hr_power_pairs: list[dict],  # [{hr, power, duration}] for steady-state efforts
    tss_history: list[dict],  # [{date, tss, hrv_next_day}]
) -> dict:
    """Fit personalized training models.
    
    Returns:
        {
            "critical_power": float,  # watts
            "w_prime": float,  # joules
            "power_curve_fit": {durations: [...], predicted: [...], actual: [...]},
            "vo2max_personalized": float,
            "ctl_tau": float,  # days (default 42)
            "atl_tau": float,  # days (default 7)
            "model_confidence": float,
        }
    """
```

### 2.4 Integration Points

- `cycling/power_curve.py` — new `fit_critical_power()` uses Modal results
- `cycling/vo2max.py` — personalized estimate alongside existing formulas
- `cycling/training_load.py` — user-specific tau values
- New fields on `User` or `CyclingProfile`: `cp`, `w_prime`, `ctl_tau`, `atl_tau`, `personalized_vo2max`
- New API endpoint: `GET /cycling/power-model` — returns fitted model + confidence

---

## 3. Weather-Performance Correlation

### 3.1 Problem

Weather data is tagged on activities (temperature, wind speed/direction, precipitation, conditions) but only used for display. No analysis correlates weather with performance.

### 3.2 Modal-Enabled Features

**A. Weather-Performance Coefficients**

Multi-variate regression across all rides with weather tags:
- Power output vs (temperature, wind speed, wind direction relative to route, humidity, precipitation, pressure)
- Decoupling vs temperature/humidity
- HR response vs temperature

Produces per-user "weather coefficients" that quantify how weather affects their performance.

**B. Personalized Weather Zones**

From the coefficients, derive actionable insights:
- "You produce 4% less power in headwinds >30 km/h"
- "Your decoupling increases 3% above 28°C"
- "Optimal riding temperature for you: 12-18°C"

**C. Weather-Aware Route Planning**

Feed weather coefficients into the workout planner's route matching:
- Adjust predicted effort based on forecast wind direction vs route heading
- Flag routes where headwind would significantly impact workout quality

### 3.3 Modal Function

```python
def analyze_weather_performance_on_modal(
    rides: list[dict],  # [{date, avg_watts, np, decoupling, hr_avg, weather: {temp, wind_speed, wind_dir, ...}}]
    route_headings: dict,  # {route_id: avg_heading_degrees}
) -> dict:
    """Analyze weather-performance correlations.
    
    Returns:
        {
            "power_vs_temp": {slope, intercept, r_squared, optimal_range},
            "power_vs_wind": {headwind_penalty_pct, tailwind_boost_pct, crosswind_penalty_pct},
            "decoupling_vs_temp": {threshold_c, penalty_above},
            "weather_coefficients": {temp: ..., humidity: ..., wind_speed: ...},
            "personalized_insights": ["str", ...],
        }
    """
```

### 3.4 Integration Points

- `weather.py` — store analysis results alongside weather cache
- `effort_estimator.py` — weather-adjusted effort prediction
- `workout_planner.py` — weather-aware route matching
- New API endpoint: `GET /cycling/weather-analysis` — returns coefficients + insights
- Frontend: new weather insights panel on dashboard or cycling profile

---

## 4. Advanced Segment Intelligence

### 4.1 Problem

Segment detection uses a raw linear scan with fixed thresholds (`segments.py:157`). No smoothing, no shape clustering, no personal difficulty baselines.

### 4.2 Modal-Enabled Features

**A. Gaussian-Smoothed Climb Detection**

Replace the raw gradient scan with a sliding-window Gaussian filter on the elevation profile. Eliminates false positives on rolling terrain where local gradient spikes aren't sustained climbs.

**B. Segment Similarity Clustering**

Group segments by gradient-signature fingerprint using DBSCAN. Enables:
- "These 5 climbs are essentially the same" — unified effort history
- Detect under-trained climb types
- Suggest new routes that target weak climb categories

**C. Personal Segment Difficulty Model**

Predict personal VAM/power for a segment based on:
- User's history on similar segments
- Current fitness (CTL/ATL)
- Segment characteristics (gradient, length, elevation gain)

### 4.3 Modal Function

```python
def analyze_segments_on_modal(
    segments: list[dict],  # [{id, route_id, gradient_profile, distance, gain}]
    efforts: list[dict],  # [{segment_id, elapsed_s, power, hr, vam}]
    user_fitness: dict,  # {ctl, atl, recent_vam}
) -> dict:
    """Advanced segment analysis.
    
    Returns:
        {
            "smoothed_segments": {segment_id: {real_climb: bool, smoothed_gradient: [...], ...}},
            "similarity_clusters": [{cluster_id: [segment_ids], characteristics: {...}}],
            "difficulty_predictions": {segment_id: {predicted_vam, predicted_power, difficulty_score}},
        }
    """
```

---

## 5. Cross-Domain Correlation Analysis

### 5.1 Problem

Sleep, HRV, training load, and performance exist in silos. Cross-sport insights (lifting → cycling) are a planned Phase 3 goal with no implementation.

### 5.2 Modal-Enabled Features

**A. Sleep-Performance Prediction**

Train a gradient-boosted model on (sleep architecture, HRV, recovery score) → (next-day power output / RPE). Feature engineering across 90+ days of sleep + ride data.

**B. Cross-Sport Fatigue Correlation**

Time-lagged cross-correlation across activity types:
- Lifting volume → next-day cycling power
- Cycling TSS → next-day lifting performance
- Combined load → recovery score

**C. Post-Race Retrospective**

Correlate pre-race TSB projection, actual performance, weather, plan conformity, fuel plan adherence. Heavy multi-domain analysis.

### 5.3 Modal Function

```python
def analyze_cross_domain_on_modal(
    sleep_data: list[dict],  # [{date, deep_pct, rem_pct, efficiency, hrv_next_day}]
    training_data: list[dict],  # [{date, type, tss, lifting_volume}]
    performance_data: list[dict],  # [{date, avg_watts, np, rpe}]
    event_data: dict | None,  # {tsb_projected, actual_watts, weather, conformity}
) -> dict:
    """Cross-domain correlation analysis.
    
    Returns:
        {
            "sleep_performance": {correlations, insights, optimal_sleep_profile},
            "cross_sport": {lifting_impact_on_cycling, cycling_impact_on_lifting},
            "race_retrospective": {vs_projection, factors, lessons},
        }
    """
```

---

## 6. Implementation Plan

### Phase 1: Route Intelligence (Week 1-2)
- [ ] Create `route_intelligence.py` Modal integration
- [ ] Implement Fréchet distance algorithm
- [ ] Implement terrain classification
- [ ] Implement segment-level effort prediction
- [ ] Add terrain classification to Route model
- [ ] Enhance route quality scoring with terrain data
- [ ] Enhance effort estimator with segment prediction
- [ ] Add similarity and prediction API endpoints
- [ ] Frontend: terrain badges on route cards

### Phase 2: Power-Duration Model (Week 2-3)
- [ ] Create `power_models.py` Modal integration
- [ ] Implement critical power curve fitting
- [ ] Implement personalized VO2max regression
- [ ] Implement adaptive CTL/ATL constant fitting
- [ ] Add CP/W' fields to CyclingProfile
- [ ] Update power curve service with personalized model
- [ ] Add power model API endpoint
- [ ] Frontend: personalized power curve with model fit

### Phase 3: Weather Correlation (Week 3-4)
- [ ] Create `weather_analysis.py` Modal integration
- [ ] Implement multi-variate weather-performance regression
- [ ] Implement weather coefficient computation
- [ ] Enhance effort estimator with weather adjustment
- [ ] Enhance workout planner with weather-aware matching
- [ ] Add weather analysis API endpoint
- [ ] Frontend: weather insights panel

### Phase 4: Segment Intelligence (Week 4-5)
- [ ] Create `segment_intelligence.py` Modal integration
- [ ] Implement Gaussian-smoothed climb detection
- [ ] Implement segment similarity clustering
- [ ] Add segment similarity data to Route/Segment models
- [ ] Enhance segment detection service
- [ ] Frontend: segment similarity view

### Phase 5: Cross-Domain (Week 5-6)
- [ ] Create `cross_domain.py` Modal integration
- [ ] Implement sleep-performance prediction
- [ ] Implement cross-sport fatigue correlation
- [ ] Implement post-race retrospective
- [ ] Frontend: cross-domain insights dashboard

---

## 7. Architecture: Modal Container Pattern

All Modal functions follow the same pattern established by video processing:

1. **Data in**: Function arguments (serialized JSON, no DB access)
2. **Compute**: Pure Python math in a Modal container (numpy, scipy, etc.)
3. **Results out**: Return value (serialized JSON)
4. **DB I/O**: Celery task or API endpoint handles all reads/writes

```python
# Modal image: minimal, no DB drivers needed
image = modal.Image.debian_slim(python_version="3.12").pip_install(
    "numpy", "scipy", "scikit-learn"
)

app = modal.App("fittrack-intelligence", image=image)

@app.function(timeout=300, memory=2048)
def compute_something(data: dict) -> dict:
    # Pure computation, no imports from app.*
    import numpy as np
    from scipy.optimize import curve_fit
    # ... computation ...
    return results
```

---

## 8. Cost Estimate

| Feature | Runtime | RAM | Frequency | Monthly Cost |
|---------|---------|-----|-----------|-------------|
| Route intelligence (per-user) | 10-60s | 1GB | On-demand + weekly batch | ~$0.50-2.00 |
| Power model fitting | 5-30s | 1GB | Weekly per user | ~$0.20-1.00 |
| Weather correlation | 5-20s | 512MB | Weekly per user | ~$0.10-0.50 |
| Segment intelligence | 10-30s | 1GB | Weekly per user | ~$0.20-0.80 |
| Cross-domain analysis | 5-15s | 512MB | Weekly per user | ~$0.10-0.30 |
| **Total (10 users)** | | | | **~$1-5/mo** |
| **Total (100 users)** | | | | **~$10-45/mo** |

All within Modal's $30/mo free tier for personal use, modest cost at scale.

---

## 9. New Dependencies

| Package | Purpose | Used By |
|---------|---------|---------|
| `numpy` | Array math, linear algebra | All features |
| `scipy` | Curve fitting, signal processing, clustering | Power model, segments, weather |
| `scikit-learn` | Gradient boosting, regression, clustering | Cross-domain, segment clustering |

No GPU required — all CPU-bound computation.
