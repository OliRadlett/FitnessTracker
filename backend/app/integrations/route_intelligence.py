"""Route intelligence — Modal-powered route terrain classification.

Provides terrain classification from elevation profiles (flat/rolling/hilly/
mountainous) for single routes (local) or batches (Modal container).

Runs heavy computation in Modal containers. All functions are pure-compute
with no DB access — data flows in via arguments, results via return values.

Requires ``MODAL_TOKEN_ID`` and ``MODAL_TOKEN_SECRET`` env vars.
"""

import logging
import math

logger = logging.getLogger(__name__)

_EARTH_RADIUS_M = 6_371_000


def _modal_configured() -> bool:
    # Imported lazily so the Modal remote container can import this module
    # without app.config's dependencies (the worker decorates a module-global
    # function, so the whole module is imported inside the bare image).
    from app.config import get_settings

    settings = get_settings()
    return bool(settings.modal_token_id and settings.modal_token_secret)


# ── Geo helpers (pure Python, runs inside Modal container) ─────────────────


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


# ── Terrain classification (runs inside Modal container) ─────────────────────


def _cumulative_polyline_distances(
    polyline: list[tuple[float, float]],
) -> list[float]:
    """Cumulative haversine distances (meters) along polyline points."""
    dists = [0.0]
    for i in range(1, len(polyline)):
        dists.append(
            dists[-1]
            + _haversine(
                polyline[i - 1][0], polyline[i - 1][1],
                polyline[i][0], polyline[i][1],
            )
        )
    return dists


def _normalize_elevation_profile(
    elevation_profile: dict | None,
    polyline: list[tuple[float, float]] | None = None,
) -> dict | None:
    """Normalize any stored profile shape to {distance, elevation} floats.

    Accepts the canonical ``{"distance": [...], "elevation": [...]}`` shape
    plus the legacy Komoot ``{"elevations": [...]}`` shape (RMI-04), which is
    aligned onto the route polyline's cumulative distances (zipped when
    lengths match, linearly interpolated otherwise — mirroring
    ``services/segments.py``). Points with missing elevation are dropped so
    downstream gradient math never sees None. Returns None when the profile
    carries no usable elevation data.
    """
    if not elevation_profile:
        return None

    if "distance" in elevation_profile and "elevation" in elevation_profile:
        pairs = [
            (float(d), float(e))
            for d, e in zip(
                elevation_profile["distance"], elevation_profile["elevation"]
            )
            if d is not None and e is not None
        ]
        if len(pairs) < 2:
            return None
        dists, eles = zip(*pairs)
        return {"distance": list(dists), "elevation": list(eles)}

    if "elevations" in elevation_profile and polyline and len(polyline) >= 2:
        raw = elevation_profile["elevations"]
        dists = _cumulative_polyline_distances(polyline)
        if len(raw) == len(dists):
            pairs = [
                (d, float(e)) for d, e in zip(dists, raw) if e is not None
            ]
        elif len(raw) >= 2:
            # Mismatched sampling — interpolate evenly across the span.
            valid = [float(e) for e in raw if e is not None]
            if len(valid) < 2:
                return None
            total = dists[-1]
            n = len(valid)
            pairs = []
            for d in dists:
                pos = (d / total * (n - 1)) if total > 0 else 0.0
                i = min(int(pos), n - 2)
                frac = pos - i
                pairs.append((d, valid[i] + frac * (valid[i + 1] - valid[i])))
        else:
            return None
        if len(pairs) < 2:
            return None
        dists, eles = zip(*pairs)
        return {"distance": list(dists), "elevation": list(eles)}

    return None


def _classify_terrain(
    elevation_profile: dict | None,
    polyline: list[tuple[float, float]] | None = None,
) -> dict:
    """Classify route terrain from elevation profile.

    Parameters
    ----------
    elevation_profile:
        {"distance": [0, 100, 200, ...], "elevation": [100, 105, ...]}
        (legacy Komoot {"elevations": [...]} also accepted when ``polyline``
        is supplied for distance alignment).
    polyline:
        Route [(lat, lng), ...] used to align legacy elevation-only profiles.

    Returns
    -------
    dict with keys: terrain_type, avg_gradient_pct, max_gradient_pct,
    total_climb_m, dominant_climb_category, climb_count, rolling_index.
    """
    normalized = _normalize_elevation_profile(elevation_profile, polyline)
    if not normalized:
        return {
            "terrain_type": "unknown",
            "avg_gradient_pct": 0.0,
            "max_gradient_pct": 0.0,
            "total_climb_m": 0.0,
            "dominant_climb_category": None,
            "climb_count": 0,
            "rolling_index": 0.0,
        }

    distances = normalized["distance"]
    elevations = normalized["elevation"]

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


# ── Modal remote worker (module scope — Modal rejects closures) ───────────────


def _analyze_routes_modal(
    routes_json: str,
) -> dict:
    """Modal remote worker for route terrain classification.

    Must stay at module global scope: Modal raises ``InvalidError`` for
    functions defined inside other functions. All inputs arrive as explicit
    arguments (JSON strings); pure-compute helpers are module globals.

    Only terrain classification runs here now (RMI-06): the Fréchet
    similarity matrix and kNN effort predictions were never consumed by any
    caller (both flags were permanently False) and have been removed.
    Route effort estimation is served by the physics-based ``estimate_effort``
    behind ``GET /routes/{id}/effort-estimate``.
    """
    import json as _json

    routes = _json.loads(routes_json)

    result: dict = {}

    # Terrain classification
    terrain_results: dict = {}
    for route in routes:
        rid = route["id"]
        terrain_results[rid] = _classify_terrain(
            route.get("elevation_profile"), route.get("polyline")
        )
    result["terrain_classifications"] = terrain_results

    return result


# ── Public API (called from Celery tasks) ────────────────────────────────────


def analyze_routes_on_modal(
    routes_data: list[dict],
) -> dict:
    """Dispatch route terrain classification to Modal and return results.

    Parameters
    ----------
    routes_data:
        [{id, polyline: [(lat, lng), ...], distance_meters, elevation_gain_meters,
          elevation_profile: {distance: [...], elevation: [...]},
          start_lat, start_lng, end_lat, end_lng}]

    Returns
    -------
    dict with terrain_classifications.
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

    with app.run():
        return remote_analyze.remote(routes_json)


def classify_route_terrain(
    elevation_profile: dict | None,
    polyline: list[tuple[float, float]] | None = None,
) -> dict:
    """Classify terrain locally (no Modal needed — lightweight).

    For on-demand classification of a single route. For batch, use
    analyze_routes_on_modal() which runs in a container.
    """
    return _classify_terrain(elevation_profile, polyline)
