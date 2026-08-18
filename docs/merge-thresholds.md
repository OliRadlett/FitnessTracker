# Merge Threshold Analysis

> Phase 6 — Threshold tuning and analysis

## Current Thresholds

| Threshold | Value | Location | Purpose |
|-----------|-------|----------|---------|
| `activity_merge_threshold` | 0.60 | [`config.py`](../backend/app/config.py) | Min score to merge activities from different providers |
| `activity_route_link_threshold` | 0.70 | [`config.py`](../backend/app/config.py) | Min score to link an activity to a saved route |
| `route_match_threshold` | 0.60 | [`config.py`](../backend/app/config.py) | Min score for route deduplication |

## Activity Merge Scoring

**Formula**: `score = date×0.50 + sport×0.20 + duration×0.15 + distance×0.15`

### Component Scores

| Component | 1.0 | 0.9 | 0.7 | 0.5 | 0.3 | 0.0 |
|-----------|-----|-----|-----|-----|-----|-----|
| Date proximity | ≤30min | ≤2h | ≤4h | ≤6h | Same day | Different day |
| Sport type | Exact match | — | — | Compatible group | — | Different |
| Duration | Identical | — | — | ~67% ratio | Missing data | Very different |
| Distance | Identical | — | — | ~67% ratio | Missing data | Very different |

### Threshold Analysis

**At threshold 0.60** (current):
- Same sport, within 2h, duration within 20%, distance within 20%: `0.9×0.5 + 1.0×0.2 + 0.8×0.15 + 0.8×0.15 = 0.45+0.20+0.12+0.12 = 0.89` ✅
- Same sport, within 2h, duration off by 50%, distance off by 50%: `0.9×0.5 + 1.0×0.2 + 0.5×0.15 + 0.5×0.15 = 0.45+0.20+0.075+0.075 = 0.80` ✅
- Same sport, within 6h, duration off by 50%, distance off by 50%: `0.5×0.5 + 1.0×0.2 + 0.5×0.15 + 0.5×0.15 = 0.25+0.20+0.075+0.075 = 0.60` ✅ (borderline)
- Same sport, same day (8h+), duration off by 50%, distance off by 50%: `0.3×0.5 + 1.0×0.2 + 0.5×0.15 + 0.5×0.15 = 0.15+0.20+0.075+0.075 = 0.50` ❌
- Compatible sport, within 2h, duration off by 50%: `0.9×0.5 + 0.5×0.2 + 0.5×0.15 + 0.5×0.15 = 0.45+0.10+0.075+0.075 = 0.70` ✅
- Different sport, within 2h: `0.9×0.5 + 0.0×0.2 + ... = 0.45` ❌ (correctly rejected)

**Previous threshold 0.65** missed the "within 6h, 50% off" case (0.60 score).

### Edge Cases

1. **Indoor vs outdoor rides**: Same sport type, same time, but very different distance. Duration usually similar. Score: ~0.75 ✅ (correctly merged)
2. **Morning + evening sessions**: Same day, same sport, different times. Score: ~0.50-0.60 (borderline — correctly rejected as separate sessions)
3. **Missing data**: Duration/distance both missing → neutral 0.5 score. Combined with date+sport: `0.9×0.5 + 1.0×0.2 + 0.5×0.15 + 0.5×0.15 = 0.80` ✅

## Route Dedup Scoring

**Formula**: `score = proximity×0.40 + distance×0.30 + name×0.15 + shape×0.15`

At threshold 0.60, routes need either:
- Very similar start/end points (proximity ≥0.8) + similar distance (≥0.8): `0.8×0.4 + 0.8×0.3 + 0×0.15 + 0×0.15 = 0.56` (borderline)
- Exact start/end + somewhat similar distance: `1.0×0.4 + 0.5×0.3 + 0×0.15 + 0×0.15 = 0.55` (borderline)
- Good proximity + good distance + similar name: `0.7×0.4 + 0.8×0.3 + 0.8×0.15 + 0.5×0.15 = 0.28+0.24+0.12+0.075 = 0.715` ✅

## Recommendations

1. **Activity merge threshold 0.60**: Optimal. Catches cross-provider duplicates with slight timing differences while rejecting same-day separate sessions.
2. **Route match threshold 0.60**: Reasonable. The proximity-heavy weighting (40%) means routes need similar start/end points, which is correct.
3. **Activity-route link threshold 0.70**: Appropriate. This is a higher-confidence link, so a higher threshold makes sense.

## Configuration

All thresholds are configurable via environment variables:

```env
ACTIVITY_MERGE_THRESHOLD=0.60
ACTIVITY_ROUTE_LINK_THRESHOLD=0.70
ROUTE_MATCH_THRESHOLD=0.60
```

## Near-Miss Logging

The merge service logs warnings when scores fall within 0.05 of the threshold. Review these logs to identify potential false negatives:

```bash
python fittrack.py logs backend --tail 100 | grep "Near-miss"
```
