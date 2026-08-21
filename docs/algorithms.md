# Key Algorithms & Thresholds

> Extracted from AGENTS.md for token optimisation. Read this file when working on merge, scoring, or analysis logic.

## Scoring Algorithms

| Algorithm | Location | Threshold | Scoring |
|-----------|----------|-----------|---------|
| Activity merge (dedup) | [`merge_service.py`](../backend/app/services/merge_service.py) | `0.60` | date 50%, sport 20%, duration 15%, distance 15% |
| Activity↔Route link | [`merge_service.py`](../backend/app/services/merge_service.py) | `0.70` | proximity + distance + shape |
| Activity↔Lifting link | [`strava.py`](../backend/app/services/strava.py) `_match_score()` | `0.55` | date 50%, duration 20%, exercise overlap 30% |
| Route dedup | [`route_service.py`](../backend/app/services/route_service.py) | `0.60` | start/end 40%, distance 30%, name 15%, shape 15% |
| PR detection | [`lifting.py`](../backend/app/services/lifting.py) `_check_and_record_pr()` | Brzycki: `weight × (36/(37-reps))` | Updated in-place (one PR per exercise) |
| Exercise normalisation | [`exercise_db.py`](../backend/app/services/exercise_db.py) | — | Canonical names, aliases, categories |
| Workout zone matching | [`workout_planner.py`](../backend/app/services/workout_planner.py) | TSB-based readiness | 5 zones from FTP/LTHR, route scoring: TSS 35%, duration 25%, power 25%, HR 15% |

## Merge Priority

Strava (3) > Wahoo (2) > Komoot (1). Lower-priority only fills NULL fields. Strava is source of truth.

## Training Load Formulas

- **TSS**: `(duration_s × NP × IF) / (FTP × 3600) × 100`. Auto-computed during Strava sync if FTP exists.
- **CTL/ATL/TSB**: Computed on-the-fly. CTL = 42-day EWMA of TSS, ATL = 7-day EWMA, TSB = CTL − ATL.

## Chart System

Backend registry [`CHART_REGISTRY`](../backend/app/api/charts.py) → [`ChartService`](../backend/app/services/charts.py) → frontend [`Chart`](../frontend/src/components/charts/Chart.tsx) renders Recharts. Charts include: training_load, ftp_history, power_curve, power_zones, daily_tss, exercise_progress, strain_vs_recovery, hrv_trend, weight_trend, vo2max_trend, decoupling_trend, hr_zone_distribution, periodization. Reference areas supported for zone coloring.

## Specialised Algorithms

- **VO2max**: ACSM power formula + Uth HR formula. Endpoint: `GET /api/v1/cycling/vo2max`.
- **Decoupling**: HR vs power ratio across ride halves. Only for rides >60min with both streams.
- **Workout Planner**: 5 intensity zones (Z1–Z5) derived from FTP and LTHR. Readiness recommendation based on TSB (CTL − ATL). Unridden route TSS estimated from distance + elevation. Endpoint: `GET /api/v1/workout-planner/zones`, `POST /api/v1/workout-planner/plan`, `POST /api/v1/workout-planner/match-routes`.
- **Encryption**: OAuth tokens encrypted at rest via Fernet ([`encryption.py`](../backend/app/services/encryption.py)). `EncryptedString` TypeDecorator transparent to services.
