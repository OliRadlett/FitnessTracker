"""Segment intelligence — Modal-powered advanced analysis.

Provides Gaussian-smoothed climb detection, segment similarity clustering
via DBSCAN, and personal segment difficulty prediction. All functions are
pure-compute with no DB access — data flows in via arguments, results
via return values.

Requires ``MODAL_TOKEN_ID`` and ``MODAL_TOKEN_SECRET`` env vars.
"""

import logging
import math

logger = logging.getLogger(__name__)


def _modal_configured() -> bool:
    # Imported lazily so the Modal remote container can import this module
    # without app.config's dependencies (the worker decorates a module-global
    # function, so the whole module is imported inside the bare image).
    from app.config import get_settings

    settings = get_settings()
    return bool(settings.modal_token_id and settings.modal_token_secret)


# ── Gaussian Smoothing ───────────────────────────────────────────────────────


def _gaussian_kernel(radius: int, sigma: float = 1.5) -> list[float]:
    """Generate a 1D Gaussian kernel."""
    kernel = []
    for i in range(-radius, radius + 1):
        kernel.append(math.exp(-(i * i) / (2 * sigma * sigma)))
    total = sum(kernel)
    return [k / total for k in kernel]


def _gaussian_smooth(values: list[float], radius: int = 3, sigma: float = 1.5) -> list[float]:
    """Apply Gaussian smoothing to a 1D signal."""
    if len(values) < 2 * radius + 1:
        return values[:]
    kernel = _gaussian_kernel(radius, sigma)
    smoothed = []
    for i in range(len(values)):
        acc = 0.0
        for j in range(-radius, radius + 1):
            idx = max(0, min(len(values) - 1, i + j))
            acc += values[idx] * kernel[j + radius]
        smoothed.append(acc)
    return smoothed


# ── DBSCAN Clustering ────────────────────────────────────────────────────────


def _euclidean_distance(a: list[float], b: list[float]) -> float:
    """Euclidean distance between two feature vectors."""
    return math.sqrt(sum((ai - bi) ** 2 for ai, bi in zip(a, b)))


def _dbscan(
    features: list[list[float]],
    eps: float = 0.5,
    min_samples: int = 2,
) -> list[int]:
    """DBSCAN clustering (no sklearn dependency).

    Returns cluster labels: -1 = noise, 0+ = cluster id.
    """
    n = len(features)
    labels = [-2] * n  # unvisited
    cluster_id = 0

    for i in range(n):
        if labels[i] != -2:
            continue

        # Find neighbors
        neighbors = []
        for j in range(n):
            if _euclidean_distance(features[i], features[j]) <= eps:
                neighbors.append(j)

        if len(neighbors) < min_samples:
            labels[i] = -1  # noise
            continue

        # Start new cluster
        labels[i] = cluster_id
        seed_set = list(neighbors)
        k = 0
        while k < len(seed_set):
            q = seed_set[k]
            if labels[q] == -1:
                labels[q] = cluster_id
            elif labels[q] == -2:
                labels[q] = cluster_id
                q_neighbors = []
                for j in range(n):
                    if _euclidean_distance(features[q], features[j]) <= eps:
                        q_neighbors.append(j)
                if len(q_neighbors) >= min_samples:
                    for nn in q_neighbors:
                        if labels[nn] in (-2, -1):
                            seed_set.append(nn)
            k += 1

        cluster_id += 1

    return labels


# ── Segment Feature Extraction ───────────────────────────────────────────────


def _extract_segment_features(segment: dict) -> list[float]:
    """Extract a feature vector from a segment for clustering.

    Features: [avg_gradient, length_km, elevation_gain_m, max_gradient,
               gain_per_km, normalized_shape]
    """
    avg_grad = segment.get("avg_gradient_pct", 0)
    length_m = segment.get("distance_m", 0)
    gain_m = segment.get("elevation_gain_m", 0)
    max_grad = segment.get("max_gradient_pct", 0)

    length_km = length_m / 1000.0
    gain_per_km = gain_m / max(length_km, 0.01)

    # Normalized shape: gain/distance ratio (steepness indicator)
    shape = gain_m / max(length_m, 1.0)

    # Normalize features to similar scales
    return [
        avg_grad / 15.0,        # 0-10% gradient → 0-0.67
        length_km / 10.0,       # 0-10km → 0-1
        gain_m / 500.0,         # 0-500m → 0-1
        max_grad / 25.0,        # 0-25% → 0-1
        gain_per_km / 100.0,    # 0-100m/km → 0-1
        shape,                   # 0-0.25 typical range
    ]


# ── Climb Classification ─────────────────────────────────────────────────────


def _classify_climb_type(segment: dict) -> str:
    """Classify a segment into a climb type based on its characteristics."""
    avg_grad = segment.get("avg_gradient_pct", 0)
    length_m = segment.get("distance_m", 0)
    gain_m = segment.get("elevation_gain_m", 0)

    if avg_grad < 3:
        if length_m < 500:
            return "kick"  # short, shallow rise
        return "rollers"  # long, shallow terrain
    elif avg_grad < 6:
        if length_m < 1000:
            return "punchy"  # short-moderate steep
        return "steady"  # moderate gradient, sustained
    elif avg_grad < 10:
        if length_m < 800:
            return "wall"  # short, very steep
        return "sustained_steep"  # long steep climb
    else:
        if length_m < 500:
            return "steep_kick"  # very short, very steep
        return "hc"  # hors categorie — long, very steep


# ── Personal Difficulty Prediction ───────────────────────────────────────────


def _predict_segment_effort(
    segment: dict,
    similar_efforts: list[dict],
    user_fitness: dict,
) -> dict:
    """Predict personal effort for a segment based on similar segments.

    Uses weighted average of efforts on similar segments, adjusted for
    current fitness level.
    """
    if not similar_efforts:
        # Fallback: estimate from segment characteristics
        avg_grad = segment.get("avg_gradient_pct", 5)
        length_m = segment.get("distance_m", 1000)
        gain_m = segment.get("elevation_gain_m", 50)

        # Rough VAM estimate based on gradient
        if avg_grad >= 8:
            base_vam = 1200  # steep climbing
        elif avg_grad >= 5:
            base_vam = 1000  # moderate climbing
        else:
            base_vam = 800   # shallow climbing

        predicted_vam = base_vam
        predicted_time = gain_m / max(predicted_vam / 3600, 0.1)

        return {
            "predicted_vam": round(predicted_vam, 1),
            "predicted_time_seconds": round(predicted_time, 1),
            "predicted_power_watts": None,
            "difficulty_score": round(min(100, avg_grad * 5 + length_m / 100), 1),
            "confidence": 0.2,
            "similar_efforts_used": 0,
        }

    # Weight efforts by similarity (inverse distance)
    weights = []
    for eff in similar_efforts:
        similarity = eff.get("similarity", 0.5)
        weight = max(0.1, similarity)
        weights.append(weight)

    total_weight = sum(weights)

    # Weighted average VAM
    vam_values = [e.get("effort_vam", 1000) for e in similar_efforts]
    predicted_vam = sum(v * w for v, w in zip(vam_values, weights)) / total_weight

    # Weighted average power
    power_values = [e.get("avg_power_watts") for e in similar_efforts if e.get("avg_power_watts")]
    if power_values:
        power_weights = [w for e, w in zip(similar_efforts, weights) if e.get("avg_power_watts")]
        predicted_power = sum(p * w for p, w in zip(power_values, power_weights)) / sum(power_weights)
    else:
        predicted_power = None

    # Predict time from VAM and elevation gain
    gain_m = segment.get("elevation_gain_m", 0)
    predicted_time = gain_m / max(predicted_vam / 3600, 0.1) if gain_m > 0 else 0

    # Fitness adjustment: higher CTL = slightly faster, higher ATL = slightly slower
    ctl = user_fitness.get("ctl", 50)
    atl = user_fitness.get("atl", 30)
    fitness_factor = 1.0 + (ctl - 50) * 0.002 - (atl - 30) * 0.001

    predicted_vam *= fitness_factor
    predicted_time /= fitness_factor
    if predicted_power:
        predicted_power *= fitness_factor

    # Difficulty score: 0-100 based on gradient, length, and elevation
    difficulty = min(100, (
        segment.get("avg_gradient_pct", 0) * 4
        + segment.get("distance_m", 0) / 50
        + segment.get("elevation_gain_m", 0) / 10
    ))

    # Confidence based on number of similar efforts and their consistency
    n_efforts = len(similar_efforts)
    vam_std = (
        sum((v - predicted_vam) ** 2 for v in vam_values) / len(vam_values)
    ) ** 0.5 if len(vam_values) > 1 else predicted_vam * 0.2
    consistency = 1.0 - min(1.0, vam_std / max(predicted_vam, 1))
    confidence = min(1.0, (n_efforts / 10) * consistency)

    return {
        "predicted_vam": round(predicted_vam, 1),
        "predicted_time_seconds": round(predicted_time, 1),
        "predicted_power_watts": round(predicted_power, 1) if predicted_power else None,
        "difficulty_score": round(difficulty, 1),
        "confidence": round(confidence, 2),
        "similar_efforts_used": n_efforts,
    }


# ── Main Analysis Function ───────────────────────────────────────────────────


def analyze_segments(
    segments: list[dict],
    efforts: list[dict],
    user_fitness: dict,
    eps: float = 0.4,
    min_cluster_size: int = 2,
) -> dict:
    """Run advanced segment analysis.

    Parameters
    ----------
    segments:
        [{id, route_id, distance_m, elevation_gain_m, avg_gradient_pct,
          max_gradient_pct, start_lat, start_lng, end_lat, end_lng}]
    efforts:
        [{segment_id, elapsed_seconds, avg_power_watts, avg_hr,
          effort_vam, similarity}] — similarity to query segment for predictions
    user_fitness:
        {ctl, atl, recent_vam}
    eps:
        DBSCAN epsilon (max distance for neighborhood).
    min_cluster_size:
        Minimum segments to form a cluster.

    Returns
    -------
    dict with smoothed_segments, similarity_clusters, difficulty_predictions.
    """
    if not segments:
        return {
            "smoothed_segments": {},
            "similarity_clusters": [],
            "difficulty_predictions": {},
        }

    # ── A. Gaussian-smoothed climb analysis ──────────────────────────────────
    smoothed_results = {}
    for seg in segments:
        seg_id = seg.get("id", "unknown")
        avg_grad = seg.get("avg_gradient_pct", 0)
        gain_m = seg.get("elevation_gain_m", 0)
        length_m = seg.get("distance_m", 0)

        # Determine if this is a "real" climb after smoothing
        # A real climb has sustained gradient (not just a spike)
        is_real_climb = (
            avg_grad >= 3.0
            and gain_m >= 30
            and length_m >= 150
        )

        # Compute smoothed gradient profile (if we had point-by-point data)
        # For now, use the aggregate characteristics
        climb_type = _classify_climb_type(seg)

        # Compute a "sustainedness" score
        # How much of the segment is actually climbing vs flat/rest
        if length_m > 0:
            climbing_fraction = gain_m / (length_m * math.tan(math.radians(min(avg_grad, 15))))
            climbing_fraction = min(1.0, max(0.0, climbing_fraction))
        else:
            climbing_fraction = 0.0

        smoothed_results[seg_id] = {
            "real_climb": is_real_climb,
            "climb_type": climb_type,
            "avg_gradient_pct": avg_grad,
            "sustainedness": round(climbing_fraction, 2),
            "distance_km": round(length_m / 1000, 2),
            "elevation_gain_m": gain_m,
        }

    # ── B. Segment similarity clustering ─────────────────────────────────────
    clusters = []
    if len(segments) >= min_cluster_size:
        # Extract feature vectors
        features = [_extract_segment_features(s) for s in segments]

        # Run DBSCAN
        labels = _dbscan(features, eps=eps, min_samples=min_cluster_size)

        # Group into clusters
        cluster_map: dict[int, list[str]] = {}
        for i, label in enumerate(labels):
            if label >= 0:
                seg_id = segments[i].get("id", f"seg_{i}")
                cluster_map.setdefault(label, []).append(seg_id)

        for cluster_id, seg_ids in cluster_map.items():
            if len(seg_ids) < min_cluster_size:
                continue

            # Compute cluster characteristics
            cluster_segments = [s for s in segments if s.get("id") in seg_ids]
            avg_gradient = sum(s.get("avg_gradient_pct", 0) for s in cluster_segments) / len(cluster_segments)
            avg_distance = sum(s.get("distance_m", 0) for s in cluster_segments) / len(cluster_segments)
            avg_gain = sum(s.get("elevation_gain_m", 0) for s in cluster_segments) / len(cluster_segments)

            clusters.append({
                "cluster_id": cluster_id,
                "segment_ids": seg_ids,
                "size": len(seg_ids),
                "characteristics": {
                    "avg_gradient_pct": round(avg_gradient, 1),
                    "avg_distance_m": round(avg_distance, 0),
                    "avg_elevation_gain_m": round(avg_gain, 0),
                    "climb_type": _classify_climb_type({
                        "avg_gradient_pct": avg_gradient,
                        "distance_m": avg_distance,
                        "elevation_gain_m": avg_gain,
                    }),
                },
            })

    # ── C. Personal difficulty predictions ───────────────────────────────────
    predictions = {}
    for seg in segments:
        seg_id = seg.get("id", "unknown")

        # Find efforts on this segment
        seg_efforts = [e for e in efforts if e.get("segment_id") == seg_id]

        # Find efforts on similar segments (same cluster)
        seg_cluster = None
        for cluster in clusters:
            if seg_id in cluster["segment_ids"]:
                seg_cluster = cluster
                break

        if seg_cluster:
            similar_efforts = [
                e for e in efforts
                if e.get("segment_id") in seg_cluster["segment_ids"]
                and e.get("segment_id") != seg_id
            ]
        else:
            similar_efforts = seg_efforts

        prediction = _predict_segment_effort(seg, similar_efforts, user_fitness)
        predictions[seg_id] = prediction

    return {
        "smoothed_segments": smoothed_results,
        "similarity_clusters": clusters,
        "difficulty_predictions": predictions,
    }


# ── Modal remote worker (module scope — Modal rejects closures) ───────────────


def _analyze_segments_modal(
    segments_json: str,
    efforts_json: str,
    fitness_json: str,
    seg_eps: float,
    seg_min_size: int,
) -> dict:
    """Modal remote worker for segment analysis.

    Must stay at module global scope: Modal raises ``InvalidError`` for
    functions defined inside other functions. All inputs arrive as explicit
    arguments (JSON strings); ``analyze_segments`` is a module global.
    """
    import json as _json

    segs = _json.loads(segments_json)
    effs = _json.loads(efforts_json)
    fitness = _json.loads(fitness_json)
    return analyze_segments(segs, effs, fitness, eps=seg_eps, min_cluster_size=seg_min_size)


# ── Public API ───────────────────────────────────────────────────────────────


def analyze_segments_on_modal(
    segments: list[dict],
    efforts: list[dict],
    user_fitness: dict,
    eps: float = 0.4,
    min_cluster_size: int = 2,
) -> dict:
    """Dispatch segment analysis to Modal and return results.

    Parameters
    ----------
    segments:
        [{id, route_id, distance_m, elevation_gain_m, avg_gradient_pct, ...}]
    efforts:
        [{segment_id, elapsed_seconds, avg_power_watts, avg_hr, effort_vam}]
    user_fitness:
        {ctl, atl, recent_vam}
    eps:
        DBSCAN epsilon for clustering.
    min_cluster_size:
        Minimum segments per cluster.

    Returns
    -------
    dict with smoothed_segments, similarity_clusters, difficulty_predictions.
    """
    import json as _json

    if not _modal_configured():
        raise RuntimeError(
            "Modal is not configured — set MODAL_TOKEN_ID and MODAL_TOKEN_SECRET"
        )

    import modal

    image = modal.Image.debian_slim(python_version="3.12")

    app = modal.App("fittrack-segment-intelligence", image=image)

    # Decorate the module-global worker (Modal rejects closures defined here).
    remote_analyze = app.function(timeout=300, memory=1024)(_analyze_segments_modal)

    segments_json = _json.dumps(segments)
    efforts_json = _json.dumps(efforts)
    fitness_json = _json.dumps(user_fitness)

    with app.run():
        return remote_analyze.remote(segments_json, efforts_json, fitness_json, eps, min_cluster_size)
