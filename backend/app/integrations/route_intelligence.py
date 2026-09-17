"""Route intelligence — Modal-powered route analysis.

Provides Fréchet distance matching, terrain classification from elevation
profiles, segment-level effort prediction, and route similarity graphs.

Runs heavy computation in Modal containers. All functions are pure-compute
with no DB access — data flows in via arguments, results via return values.

Requires ``MODAL_TOKEN_ID`` and ``MODAL_TOKEN_SECRET`` env vars.
"""

import logging
import math

from app.config import get_settings

logger = logging.getLogger(__name__)

_EARTH_RADIUS_M = 6_371_000


def _modal_configured() -> bool:
    settings = get_settings()
    return bool(settings.modal_token_id and settings.modal_token_secret)


# ── Fréchet distance (pure Python, runs inside Modal container) ──────────────


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Haversine distance in meters between two lat/lng points."""
    lat1_r, lng1_r = math.radians(lat1), math.radians(lng1)
    lat2_r, lng2_r = math.radians(lat2), math.radians(lng2)
    dlat = lat2_r - lat1_r
    dlng = lng2_r - lng1_r
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return _EARTH_RADIUS_M * c


def _discrete_frechet(dist_matrix: list[list[float]]) -> float:
    """Compute discrete Fréchet distance from a precomputed distance matrix.

    Uses the dynamic programming approach. P and Q are polylines already
    represented as indices into the distance matrix.

    Parameters
    ----------
    dist_matrix:
        dist_matrix[i][j] = distance between point i of polyline P
        and point j of polyline Q.

    Returns
    -------
    The discrete Fréchet distance (scalar).
    """
    n = len(dist_matrix)
    m = len(dist_matrix[0]) if n > 0 else 0
    if n == 0 or m == 0:
        return 0.0

    # DP table
    ca = [[0.0] * m for _ in range(n)]
    ca[0][0] = dist_matrix[0][0]

    # First column
    for i in range(1, n):
        ca[i][0] = max(ca[i - 1][0], dist_matrix[i][0])

    # First row
    for j in range(1, m):
        ca[0][j] = max(ca[0][j - 1], dist_matrix[0][j])

    # Fill rest
    for i in range(1, n):
        for j in range(1, m):
            ca[i][j] = max(
                min(ca[i - 1][j], ca[i - 1][j - 1], ca[i][j - 1]),
                dist_matrix[i][j],
            )

    return ca[n - 1][m - 1]


def _resample_polyline(
    points: list[tuple[float, float]], n_samples: int
) -> list[tuple[float, float]]:
    """Resample a polyline to exactly n_samples evenly-spaced points."""
    if len(points) <= 1:
        return points * n_samples

    # Compute cumulative distances
    cum_dist = [0.0]
    for i in range(1, len(points)):
        cum_dist.append(
            cum_dist[-1] + _haversine(*points[i - 1], *points[i])
        )
    total = cum_dist[-1]
    if total == 0:
        return [points[0]] * n_samples

    step = total / (n_samples - 1)
    resampled = [points[0]]
    target = step
    idx = 1

    for _ in range(n_samples - 2):
        while idx < len(cum_dist) and cum_dist[idx] < target:
            idx += 1
        if idx >= len(points):
            break
        seg_len = cum_dist[idx] - cum_dist[idx - 1]
        frac = (target - cum_dist[idx - 1]) / seg_len if seg_len > 0 else 0.0
        frac = max(0.0, min(1.0, frac))
        lat = points[idx - 1][0] + frac * (points[idx][0] - points[idx - 1][0])
        lng = points[idx - 1][1] + frac * (points[idx][1] - points[idx - 1][1])
        resampled.append((lat, lng))
        target += step

    resampled.append(points[-1])
    return resampled


def _compute_frechet_distance(
    polyline_a: list[tuple[float, float]],
    polyline_b: list[tuple[float, float]],
    n_resample: int = 100,
) -> float:
    """Compute discrete Fréchet distance between two polylines.

    Resamples both to n_samples points, builds the pairwise distance
    matrix, then runs the DP algorithm. O(n²) in resampled point count.

    Returns distance in meters.
    """
    a = _resample_polyline(polyline_a, n_resample)
    b = _resample_polyline(polyline_b, n_resample)

    # Build distance matrix
    dist_matrix = [
        [_haversine(a[i][0], a[i][1], b[j][0], b[j][1]) for j in range(len(b))]
        for i in range(a)
    ]

    return _discrete_frechet(dist_matrix)


# ── Terrain classification (runs inside Modal container) ─────────────────────


def _classify_terrain(elevation_profile: dict | None) -> dict:
    """Classify route terrain from elevation profile.

    Parameters
    ----------
    elevation_profile:
        {"distance": [0, 100, 200, ...], "elevation": [100, 105, ...]}

    Returns
    -------
    dict with keys: terrain_type, avg_gradient_pct, max_gradient_pct,
    total_climb_m, dominant_climb_category, climb_count, rolling_index.
    """
    if not elevation_profile:
        return {
            "terrain_type": "unknown",
            "avg_gradient_pct": 0.0,
            "max_gradient_pct": 0.0,
            "total_climb_m": 0.0,
            "dominant_climb_category": None,
            "climb_count": 0,
            "rolling_index": 0.0,
        }

    distances = elevation_profile.get("distance", [])
    elevations = elevation_profile.get("elevation", [])

    if len(distances) < 2 or len(elevations) < 2:
        return {
            "terrain_type": "unknown",
            "avg_gradient_pct": 0.0,
            "max_gradient_pct": 0.0,
            "total_climb_m": 0.0,
            "dominant_climb_category": None,
            "climb_count": 0,
            "rolling_index": 0.0,
        }

    # Compute gradients between consecutive points
    gradients: list[float] = []
    total_climb = 0.0
    total_descent = 0.0

    for i in range(1, min(len(distances), len(elevations))):
        d_dist = distances[i] - distances[i - 1]
        d_elev = elevations[i] - elevations[i - 1]
        if d_dist > 0:
            grad = (d_elev / d_dist) * 100  # percent
            gradients.append(grad)
        if d_elev > 0:
            total_climb += d_elev
        else:
            total_descent += abs(d_elev)

    if not gradients:
        return {
            "terrain_type": "flat",
            "avg_gradient_pct": 0.0,
            "max_gradient_pct": 0.0,
            "total_climb_m": total_climb,
            "dominant_climb_category": None,
            "climb_count": 0,
            "rolling_index": 0.0,
        }

    avg_grad = sum(gradients) / len(gradients)
    max_grad = max(gradients)

    # Rolling index: ratio of gradient variance to mean absolute gradient
    # High = variable terrain (rolling), low = consistent (flat or sustained climb)
    abs_grads = [abs(g) for g in gradients]
    mean_abs = sum(abs_grads) / len(abs_grads) if abs_grads else 0.0
    variance = sum((g - avg_grad) ** 2 for g in gradients) / len(gradients)
    rolling_index = math.sqrt(variance) / (mean_abs + 0.001)

    # Detect sustained climbs (gradient > 3% for > 200m)
    climbs: list[dict] = []
    climb_start_idx = None
    climb_gain = 0.0
    climb_dist = 0.0

    for i, grad in enumerate(gradients):
        d_dist = distances[i + 1] - distances[i] if i + 1 < len(distances) else 0
        d_elev = (
            elevations[i + 1] - elevations[i] if i + 1 < len(elevations) else 0
        )

        if grad >= 2.5:  # sustained uphill threshold
            if climb_start_idx is None:
                climb_start_idx = i
            climb_gain += max(0, d_elev)
            climb_dist += d_dist
        else:
            if climb_start_idx is not None and climb_dist >= 150:
                avg_climb_grad = (climb_gain / climb_dist * 100) if climb_dist > 0 else 0
                climbs.append(
                    {
                        "gain_m": round(climb_gain, 1),
                        "distance_m": round(climb_dist, 0),
                        "avg_gradient_pct": round(avg_climb_grad, 1),
                        "category": _climb_category(climb_gain, avg_climb_grad),
                    }
                )
            climb_start_idx = None
            climb_gain = 0.0
            climb_dist = 0.0

    # Handle climb extending to end of route
    if climb_start_idx is not None and climb_dist >= 150:
        avg_climb_grad = (climb_gain / climb_dist * 100) if climb_dist > 0 else 0
        climbs.append(
            {
                "gain_m": round(climb_gain, 1),
                "distance_m": round(climb_dist, 0),
                "avg_gradient_pct": round(avg_climb_grad, 1),
                "category": _climb_category(climb_gain, avg_climb_grad),
            }
        )

    # Classify terrain type
    if len(climbs) == 0 and avg_grad < 1.5:
        terrain_type = "flat"
    elif rolling_index > 0.8 and len(climbs) <= 2:
        terrain_type = "rolling"
    elif len(climbs) >= 2 and total_climb > 500:
        terrain_type = "mountainous"
    elif total_climb > 200:
        terrain_type = "hilly"
    else:
        terrain_type = "mixed"

    dominant = None
    if climbs:
        dominant = max(climbs, key=lambda c: c["gain_m"])["category"]

    return {
        "terrain_type": terrain_type,
        "avg_gradient_pct": round(avg_grad, 2),
        "max_gradient_pct": round(max_grad, 2),
        "total_climb_m": round(total_climb, 1),
        "total_descent_m": round(total_descent, 1),
        "dominant_climb_category": dominant,
        "climb_count": len(climbs),
        "climbs": climbs,
        "rolling_index": round(rolling_index, 3),
    }


def _climb_category(gain_m: float, avg_gradient_pct: float) -> str:
    """Categorise a climb by elevation gain and gradient (simplified HC system)."""
    if gain_m >= 1500:
        return "HC"
    elif gain_m >= 1000:
        return "1"
    elif gain_m >= 500:
        return "2"
    elif gain_m >= 300:
        return "3"
    elif gain_m >= 100:
        return "4"
    else:
        return "uncategorised"


# ── Segment-level effort prediction (runs inside Modal container) ────────────


def _predict_route_effort(
    route_distance_m: float,
    route_elevation_gain: float,
    terrain: dict,
    known_segments: list[dict],
    user_ftp: float | None = None,
    user_weight_kg: float | None = None,
) -> dict:
    """Predict effort for an unridden route using known segment data.

    Parameters
    ----------
    route_distance_m:
        Route distance in meters.
    route_elevation_gain:
        Total elevation gain in meters.
    terrain:
        Terrain classification from _classify_terrain.
    known_segments:
        List of previously ridden segments with effort data:
        [{distance_m, avg_gradient_pct, gain_m, efforts: [{elapsed_s, avg_power_watts, avg_vam}]}]
    user_ftp:
        User's FTP in watts (optional, improves prediction).
    user_weight_kg:
        User's weight in kg (optional, improves prediction).

    Returns
    -------
    dict with predicted_duration_s, predicted_tss, predicted_np, confidence, method.
    """
    if not known_segments or route_distance_m <= 0:
        return {
            "predicted_duration_s": None,
            "predicted_tss": None,
            "predicted_np": None,
            "confidence": 0.0,
            "method": "no_data",
        }

    # Build feature vector for this route
    route_features = _extract_route_features(
        route_distance_m, route_elevation_gain, terrain
    )

    # Find K most similar known segments using Euclidean distance on features
    k = min(5, len(known_segments))
    scored_segments: list[tuple[float, dict]] = []

    for seg in known_segments:
        if not seg.get("efforts"):
            continue
        seg_features = _extract_route_features(
            seg["distance_m"],
            seg.get("gain_m", 0),
            _classify_terrain_from_gradient(seg.get("avg_gradient_pct", 0), seg["distance_m"]),
        )
        dist = math.sqrt(
            sum((a - b) ** 2 for a, b in zip(route_features, seg_features))
        )
        scored_segments.append((dist, seg))

    scored_segments.sort(key=lambda x: x[0])
    neighbors = scored_segments[:k]

    if not neighbors:
        return {
            "predicted_duration_s": None,
            "predicted_tss": None,
            "predicted_np": None,
            "confidence": 0.0,
            "method": "no_matching_segments",
        }

    # Inverse-distance-weighted average of efforts
    total_weight = 0.0
    weighted_duration = 0.0
    weighted_power = 0.0
    weighted_vam = 0.0

    for dist, seg in neighbors:
        # Use best effort (fastest) for prediction
        efforts = seg["efforts"]
        best_effort = min(efforts, key=lambda e: e["elapsed_s"])

        weight = 1.0 / (dist + 0.001)  # inverse distance weighting
        weighted_duration += weight * best_effort["elapsed_s"]
        if best_effort.get("avg_power_watts"):
            weighted_power += weight * best_effort["avg_power_watts"]
        if best_effort.get("avg_vam"):
            weighted_vam += weight * best_effort["avg_vam"]
        total_weight += weight

    if total_weight == 0:
        return {
            "predicted_duration_s": None,
            "predicted_tss": None,
            "predicted_np": None,
            "confidence": 0.0,
            "method": "zero_weight",
        }

    predicted_duration = weighted_duration / total_weight
    predicted_power = weighted_power / total_weight if weighted_power > 0 else None
    predicted_vam = weighted_vam / total_weight if weighted_vam > 0 else None

    # Estimate TSS from predicted duration and power (if FTP available)
    predicted_tss = None
    if predicted_power and user_ftp and user_ftp > 0:
        if_ = predicted_power / user_ftp
        predicted_tss = (predicted_duration * predicted_power * if_) / (user_ftp * 3600) * 100

    # Confidence based on: similarity of best match, number of neighbors, data quality
    best_dist = neighbors[0][0]
    similarity_conf = max(0, 1.0 - best_dist / 2.0)  # 0 at dist=2.0
    coverage_conf = min(1.0, len(neighbors) / k)
    confidence = similarity_conf * 0.6 + coverage_conf * 0.4

    return {
        "predicted_duration_s": round(predicted_duration, 0),
        "predicted_tss": round(predicted_tss, 1) if predicted_tss else None,
        "predicted_np": round(predicted_power, 0) if predicted_power else None,
        "predicted_vam": round(predicted_vam, 1) if predicted_vam else None,
        "confidence": round(confidence, 3),
        "method": "segment_knn",
        "neighbor_count": len(neighbors),
    }


def _extract_route_features(
    distance_m: float, gain_m: float, terrain: dict
) -> list[float]:
    """Extract a numeric feature vector for route similarity comparison."""
    return [
        distance_m / 1000.0,  # km
        gain_m / 100.0,  # hm
        terrain.get("avg_gradient_pct", 0),
        terrain.get("max_gradient_pct", 0),
        terrain.get("climb_count", 0),
        terrain.get("rolling_index", 0),
        1.0 if terrain.get("terrain_type") == "flat" else 0.0,
        1.0 if terrain.get("terrain_type") == "hilly" else 0.0,
        1.0 if terrain.get("terrain_type") == "mountainous" else 0.0,
        1.0 if terrain.get("terrain_type") == "rolling" else 0.0,
    ]


def _classify_terrain_from_gradient(
    avg_gradient_pct: float, distance_m: float
) -> dict:
    """Minimal terrain dict from gradient + distance (for segment features)."""
    if avg_gradient_pct < 1.5:
        t = "flat"
    elif avg_gradient_pct < 4:
        t = "rolling"
    elif avg_gradient_pct < 7:
        t = "hilly"
    else:
        t = "mountainous"
    return {"terrain_type": t, "avg_gradient_pct": avg_gradient_pct, "climb_count": 1 if avg_gradient_pct > 3 else 0, "rolling_index": 0.5}


# ── Route similarity graph (runs inside Modal container) ─────────────────────


def _compute_similarity_matrix(
    routes: list[dict], n_resample: int = 100
) -> dict:
    """Compute pairwise Fréchet similarity across all routes.

    Parameters
    ----------
    routes:
        [{id, polyline: [(lat, lng), ...]}]

    Returns
    -------
    dict with pairs: {route_a_id: {route_b_id: similarity_score}}
    """
    n = len(routes)
    if n < 2:
        return {"pairs": {}}

    # Precompute polylines
    polylines = []
    for route in routes:
        pts = route.get("polyline", [])
        if len(pts) < 2:
            pts = [(route.get("start_lat", 0), route.get("start_lng", 0)),
                   (route.get("end_lat", 0), route.get("end_lng", 0))]
        polylines.append(_resample_polyline(pts, n_resample))

    # Compute pairwise Fréchet distances
    pairs: dict[str, dict[str, float]] = {}

    for i in range(n):
        id_a = routes[i]["id"]
        pairs.setdefault(id_a, {})
        for j in range(i + 1, n):
            id_b = routes[j]["id"]

            # Quick reject: if start points > 5km apart, similarity = 0
            start_dist = _haversine(
                routes[i].get("start_lat", 0), routes[i].get("start_lng", 0),
                routes[j].get("start_lat", 0), routes[j].get("start_lng", 0),
            )
            if start_dist > 5000:
                pairs[id_a][id_b] = 0.0
                continue

            # Full Fréchet
            dist_matrix = [
                [_haversine(polylines[i][a][0], polylines[i][a][1],
                            polylines[j][b][0], polylines[j][b][1])
                 for b in range(len(polylines[j]))]
                for a in range(len(polylines[i]))
            ]
            frechet = _discrete_frechet(dist_matrix)

            # Convert distance to similarity (0-1 scale)
            # < 50m = very similar, > 500m = dissimilar
            similarity = max(0.0, 1.0 - frechet / 500.0)
            pairs[id_a][id_b] = round(similarity, 4)

    return {"pairs": pairs}


# ── Modal remote worker (module scope — Modal rejects closures) ───────────────


def _analyze_routes_modal(
    routes_json: str,
    segments_json: str,
    ftp: float | None,
    weight: float | None,
    do_similarity: bool,
    do_terrain: bool,
    do_effort: bool,
) -> dict:
    """Modal remote worker for route analysis.

    Must stay at module global scope: Modal raises ``InvalidError`` for
    functions defined inside other functions. All inputs arrive as explicit
    arguments (JSON strings + scalars); pure-compute helpers are module globals.
    """
    import json as _json

    routes = _json.loads(routes_json)
    segments = _json.loads(segments_json) if segments_json else []

    result: dict = {}

    # Terrain classification
    if do_terrain:
        terrain_results: dict = {}
        for route in routes:
            rid = route["id"]
            terrain_results[rid] = _classify_terrain(route.get("elevation_profile"))
        result["terrain_classifications"] = terrain_results

    # Similarity matrix
    if do_similarity and len(routes) >= 2:
        result["similarity_matrix"] = _compute_similarity_matrix(routes)
    else:
        result["similarity_matrix"] = {"pairs": {}}

    # Effort predictions
    if do_effort:
        predictions: dict = {}
        for route in routes:
            rid = route["id"]
            # Find segments for this route
            route_segments = [s for s in segments if s.get("route_id") == rid]
            # Also include segments from similar routes as neighbors
            all_neighbor_segments = [
                s for s in segments if s.get("route_id") != rid and s.get("efforts")
            ]

            terrain = result.get("terrain_classifications", {}).get(rid, {})
            predictions[rid] = _predict_route_effort(
                route.get("distance_meters", 0),
                route.get("elevation_gain_meters", 0),
                terrain,
                route_segments + all_neighbor_segments,
                ftp,
                weight,
            )
        result["effort_predictions"] = predictions
    else:
        result["effort_predictions"] = {}

    return result


# ── Public API (called from Celery tasks) ────────────────────────────────────


def analyze_routes_on_modal(
    routes_data: list[dict],
    segments_data: list[dict] | None = None,
    user_ftp: float | None = None,
    user_weight_kg: float | None = None,
    compute_similarity: bool = True,
    compute_terrain: bool = True,
    compute_effort_predictions: bool = True,
) -> dict:
    """Dispatch route analysis to Modal and return results.

    Parameters
    ----------
    routes_data:
        [{id, polyline: [(lat, lng), ...], distance_meters, elevation_gain_meters,
          elevation_profile: {distance: [...], elevation: [...]},
          start_lat, start_lng, end_lat, end_lng}]
    segments_data:
        [{id, route_id, distance_m, avg_gradient_pct, gain_m,
          efforts: [{elapsed_s, avg_power_watts, avg_vam}]}]
    user_ftp:
        User FTP in watts for TSS estimation.
    user_weight_kg:
        User weight for power-to-weight.
    compute_similarity:
        Compute pairwise Fréchet similarity.
    compute_terrain:
        Classify terrain for all routes.
    compute_effort_predictions:
        Predict effort for routes without ride history.

    Returns
    -------
    dict with terrain_classifications, similarity_matrix, effort_predictions.
    """
    import json as _json

    if not _modal_configured():
        raise RuntimeError(
            "Modal is not configured — set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET"
        )

    import modal

    image = (
        modal.Image.debian_slim(python_version="3.12")
        .pip_install("numpy")
    )

    app = modal.App("fittrack-route-intelligence", image=image)

    # Decorate the module-global worker (Modal rejects closures defined here).
    remote_analyze = app.function(timeout=300, memory=2048)(_analyze_routes_modal)

    # Serialize data for Modal (no complex objects, just JSON-serializable dicts)
    routes_json = _json.dumps(routes_data, default=str)
    segments_json = _json.dumps(segments_data or [], default=str) if segments_data else ""

    with app.run():
        return remote_analyze.remote(
            routes_json,
            segments_json,
            user_ftp,
            user_weight_kg,
            compute_similarity,
            compute_terrain,
            compute_effort_predictions,
        )


def compute_frechet_score(
    polyline_a: str,
    polyline_b: str,
    n_resample: int = 100,
) -> float:
    """Compute Fréchet similarity between two encoded polylines.

    Returns a score 0.0-1.0 (1.0 = identical shape).
    This is a local convenience function for quick comparisons —
    for batch operations use analyze_routes_on_modal().
    """
    from app.services.polyline_utils import decode_polyline

    pts_a = decode_polyline(polyline_a)
    pts_b = decode_polyline(polyline_b)
    dist = _compute_frechet_distance(pts_a, pts_b, n_resample)
    return max(0.0, 1.0 - dist / 500.0)


def classify_route_terrain(elevation_profile: dict | None) -> dict:
    """Classify terrain locally (no Modal needed — lightweight).

    For on-demand classification of a single route. For batch, use
    analyze_routes_on_modal() which runs in a container.
    """
    return _classify_terrain(elevation_profile)
