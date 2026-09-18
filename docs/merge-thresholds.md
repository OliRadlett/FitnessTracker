# Merge Threshold Analysis

> Phase 6 — Threshold tuning and analysis

## Current Thresholds

| Threshold | Value | Location | Purpose |
|-----------|-------|----------|---------|
| `activity_merge_threshold` | 0.55 | [`config.py`](../backend/app/config.py) | Min score to merge activities from different providers |
| `activity_route_link_threshold` | 0.70 | [`config.py`](../backend/app/config.py) | Min score to link an activity to a saved route |
| `route_match_threshold` | 0.55 | [`config.py`](../backend/app/config.py) | Min score for route deduplication |

## Activity Merge Scoring

**Formula**: `score = date×0.40 + sport×0.20 + duration×0.20 + distance×0.20`

Hard cutoff: incompatible sport types (`sport_s == 0.0`) score 0.0 and never merge, regardless of timing.

### Component Scores

| Component | 1.0 | 0.9 | 0.7 | 0.5 | 0.3 | 0.0 |
|-----------|-----|-----|-----|-----|-----|-----|
| Date proximity | ≤30min | ≤2h | ≤4h | ≤6h | Same day | Different day |
| Sport type | Exact match | — | — | Compatible group | — | Different |
| Duration | Identical | — | — | ~67% ratio | Missing data | Very different |
| Distance | Identical | — | — | ~67% ratio | Missing data | Very different |

### Threshold Analysis

**At threshold 0.55** (current):
- Same sport, within 2h, duration within 20%, distance within 20%: `0.9×0.4 + 1.0×0.2 + 0.8×0.2 + 0.8×0.2 = 0.36+0.20+0.16+0.16 = 0.88` ✅
- Same sport, within 2h, duration off by 50%, distance off by 50%: `0.9×0.4 + 1.0×0.2 + 0.5×0.2 + 0.5×0.2 = 0.36+0.20+0.10+0.10 = 0.76` ✅
- Same sport, within 6h, duration off by 50%, distance off by 50%: `0.5×0.4 + 1.0×0.2 + 0.5×0.2 + 0.5×0.2 = 0.20+0.20+0.10+0.10 = 0.60` ✅
- Same sport, same day (8h+), duration off by 50%, distance off by 50%: `0.3×0.4 + 1.0×0.2 + 0.5×0.2 + 0.5×0.2 = 0.12+0.20+0.10+0.10 = 0.52` ❌
- Compatible sport, within 2h, duration off by 50%: `0.9×0.4 + 0.5×0.2 + 0.5×0.2 + 0.5×0.2 = 0.36+0.10+0.10+0.10 = 0.66` ✅
- Different sport, within 2h: hard cutoff → `0.0` ❌ (correctly rejected regardless of timing)

### Edge Cases

1. **Indoor vs outdoor rides**: Same sport type, same time, but very different distance. Duration usually similar. Score: ~0.72 ✅ (correctly merged)
2. **Morning + evening sessions**: Same day, same sport, different times. Score: ~0.50-0.60 (borderline — correctly rejected as separate sessions)
3. **Missing data**: Duration/distance both missing → neutral 0.5 score. Combined with date+sport: `0.9×0.4 + 1.0×0.2 + 0.5×0.2 + 0.5×0.2 = 0.76` ✅

## Route Dedup Scoring

**Formula**: `score = proximity×0.20 + distance×0.20 + name×0.10 + shape×0.50`

Shape (polyline geometry) dominates: two rides on the same roads match even with different start points or names. Early-exit guards return 0.0 on insufficient spatial overlap before weighting.

At threshold 0.55, routes need either:
- Same shape (≥0.8) + decent proximity (≥0.6): `0.6×0.2 + 0.6×0.2 + 0×0.1 + 0.8×0.5 = 0.12+0.12+0+0.40 = 0.64` ✅
- Same shape alone (≥0.9): `0.3×0.2 + 0.5×0.2 + 0×0.1 + 0.9×0.5 = 0.06+0.10+0+0.45 = 0.61` ✅
- Similar start/end + distance but different shape: `0.9×0.2 + 0.9×0.2 + 0.5×0.1 + 0.2×0.5 = 0.18+0.18+0.05+0.10 = 0.51` ❌ (correctly rejected — out-and-back vs loop sharing a trailhead)

## Recommendations

1. **Activity merge threshold 0.55**: Optimal. Catches cross-provider duplicates with slight timing differences while rejecting same-day separate sessions. The hard sport cutoff handles the different-sport case, so the threshold only arbitrates timing/duration/distance fuzz.
2. **Route match threshold 0.55**: Reasonable. The shape-heavy weighting (50%) means routes need genuinely similar geometry, which is correct — proximity alone can't merge.
3. **Activity-route link threshold 0.70**: Appropriate. This is a higher-confidence link, so a higher threshold makes sense.

## Configuration

All thresholds are configurable via environment variables:

```env
ACTIVITY_MERGE_THRESHOLD=0.55
ACTIVITY_ROUTE_LINK_THRESHOLD=0.70
ROUTE_MATCH_THRESHOLD=0.55
```

## Near-Miss Logging

The merge service logs warnings when scores fall within 0.05 of the threshold. Review these logs to identify potential false negatives:

```bash
python fittrack.py logs backend --tail 100 | grep "Near-miss"
```
