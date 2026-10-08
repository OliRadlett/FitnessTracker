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
    dict with keys: terrain_type, avg_gradient_pct, climb_rate_pct,
    max_gradient_pct,
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

    # Detect sustained climbs. Gates mirror the canonical segment detector
    # (services/segments.py: MIN_CLIMB_GAIN_M=30, MIN_CLIMB_AVG_GRADIENT=3%,
    # MIN_CLIMB_LENGTH_M=150) so terrain climb counts agree with served
    # segments — a shallower gate here overcounted climbs there.
    climbs: list[dict] = []
    climb_start_idx = None
    climb_gain = 0.0
    climb_dist = 0.0

    for i, grad in enumerate(gradients):
        d_dist = distances[i + 1] - distances[i] if i + 1 < len(distances) else 0
        d_elev = (
            elevations[i + 1] - elevations[i] if i + 1 < len(elevations) else 0
        )

        if grad >= 3.0:  # sustained uphill threshold (canonical 3%)
            if climb_start_idx is None:
                climb_start_idx = i
            climb_gain += max(0, d_elev)
            climb_dist += d_dist
        else:
            if (
                climb_start_idx is not None
                and climb_dist >= 150
                and climb_gain >= 30
            ):
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
    if climb_start_idx is not None and climb_dist >= 150 and climb_gain >= 30:
        avg_climb_grad = (climb_gain / climb_dist * 100) if climb_dist > 0 else 0
        climbs.append(
            {
                "gain_m": round(climb_gain, 1),
                "distance_m": round(climb_dist, 0),
                "avg_gradient_pct": round(avg_climb_grad, 1),
                "category": _climb_category(climb_gain, avg_climb_grad),
            }
        )

    # Classify terrain type. Climb intensity uses climb_rate_pct (total climb
    # per kilometre) rather than the signed mean gradient: on a loop the
    # climbs cancel the descents and the mean reads ~0% no matter how hilly
    # the ride was. avg_gradient_pct is still returned for display.
    total_span = distances[-1] - distances[0] if len(distances) >= 2 else 0.0
    climb_rate_pct = (
        (total_climb / total_span * 100) if total_span > 0 else 0.0
    )
    if len(climbs) == 0 and climb_rate_pct < 1.0:
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
        "climb_rate_pct": round(climb_rate_pct, 2),
        "max_gradient_pct": round(max_grad, 2),
        "total_climb_m": round(total_climb, 1),
        "total_descent_m": round(total_descent, 1),
        "dominant_climb_category": dominant,
        "climb_count": len(climbs),
        "climbs": climbs,
        "rolling_index": round(rolling_index, 3),
    }


def _climb_category(gain_m: float, avg_gradient_pct: float) -> str:
    """Categorise a climb by elevation gain and gradient (Strava-style bands).

    Mirrors ``services.segments.climb_category`` exactly; duplicated here
    (returning "uncategorised" instead of None) because Modal workers import
    stdlib only and cannot import app.services (pitfall 16). Keep the two in
    sync — see tests/test_route_intelligence.py::test_climb_category_matches_canonical.
    """
    if avg_gradient_pct >= 7.5 and gain_m >= 900:
        return "HC"
    elif avg_gradient_pct >= 5.0 and gain_m >= 450:
        return "1"
    elif avg_gradient_pct >= 5.0 and gain_m >= 150:
        return "2"
    elif avg_gradient_pct >= 4.0 and gain_m >= 100:
        return "3"
    elif avg_gradient_pct >= 3.0 and gain_m >= 30:
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


# ── Route similarity graph (Modal worker + public API) ───────────────────────


def _score_route_graph_modal(
    routes_json: str,
    pairs_json: str,
    auto_threshold: float,
    review_floor: float,
    gate: float,
) -> dict:
    """Modal remote worker: score route pairs with the shared pure engine.

    Module-global (Modal rejects closures). ``route_matching`` is mounted into
    the image at ``/root``; import it at call time so the client never needs the
    module importable inside the bare container image. Returns only pairs at or
    above the review floor, each with the full score breakdown.
    """
    import json as _json
    import sys

    sys.path.insert(0, "/root")
    from route_matching import score_route_pair  # type: ignore[import-not-found]

    routes = _json.loads(routes_json)
    pairs = _json.loads(pairs_json)

    out: list[dict] = []
    for i, j in pairs:
        a, b = routes[i], routes[j]
        breakdown = score_route_pair(
            a["polyline"],
            b["polyline"],
            length_a=a.get("distance_meters"),
            length_b=b.get("distance_meters"),
            auto_threshold=auto_threshold,
            review_floor=review_floor,
            gate=gate,
        )
        if breakdown.matched:
            out.append({"a": a["id"], "b": b["id"], **breakdown.to_dict()})
    return {"pairs": out}


def _pairs_for_routes(n: int) -> list[list[int]]:
    """All unordered index pairs ``[i, j]`` with ``i < j``."""
    return [[i, j] for i in range(n) for j in range(i + 1, n)]


def compute_route_similarity_locally(
    routes_data: list[dict],
    pairs: list[list[int]] | None = None,
    *,
    auto_threshold: float = 0.82,
    review_floor: float = 0.55,
    gate: float = 0.45,
) -> dict:
    """Local (non-Modal) similarity graph using the shared engine."""
    from app.services.route_matching import score_route_pair

    if pairs is None:
        pairs = _pairs_for_routes(len(routes_data))

    out: list[dict] = []
    for i, j in pairs:
        a, b = routes_data[i], routes_data[j]
        breakdown = score_route_pair(
            a["polyline"],
            b["polyline"],
            length_a=a.get("distance_meters"),
            length_b=b.get("distance_meters"),
            auto_threshold=auto_threshold,
            review_floor=review_floor,
            gate=gate,
        )
        if breakdown.matched:
            out.append({"a": a["id"], "b": b["id"], **breakdown.to_dict()})
    return {"pairs": out}


def compute_route_similarity_on_modal(
    routes_data: list[dict],
    pairs: list[list[int]] | None = None,
    *,
    auto_threshold: float = 0.82,
    review_floor: float = 0.55,
    gate: float = 0.45,
    chunk_pairs: int = 4000,
    max_failures: int = 3,
) -> dict:
    """Compute a route similarity graph on Modal, falling back to local.

    ``routes_data`` items: ``{id, polyline: [(lat, lng), ...], distance_meters}``.
    ``pairs`` defaults to every unordered pair. Scoring is chunked; after
    ``max_failures`` consecutive Modal errors the remaining chunks run locally
    (RMI-13). Falls back entirely to local scoring when Modal is unconfigured.
    """
    import json as _json
    from pathlib import Path

    if pairs is None:
        pairs = _pairs_for_routes(len(routes_data))
    if not pairs:
        return {"pairs": []}

    if not _modal_configured():
        return compute_route_similarity_locally(
            routes_data,
            pairs,
            auto_threshold=auto_threshold,
            review_floor=review_floor,
            gate=gate,
        )

    import modal

    rm_path = str(
        Path(__file__).resolve().parent.parent / "services" / "route_matching.py"
    )
    image = modal.Image.debian_slim(python_version="3.12").add_local_file(
        rm_path, "/root/route_matching.py"
    )
    app = modal.App("fittrack-route-similarity", image=image)
    remote = app.function(timeout=600, memory=4096)(_score_route_graph_modal)

    routes_json = _json.dumps(routes_data, default=str)
    results: list[dict] = []
    consecutive_failures = 0
    degraded = False

    chunks = [pairs[k : k + chunk_pairs] for k in range(0, len(pairs), chunk_pairs)]
    with app.run():
        for chunk in chunks:
            if degraded:
                break
            try:
                res = remote.remote(
                    routes_json,
                    _json.dumps(chunk),
                    auto_threshold,
                    review_floor,
                    gate,
                )
                results.extend(res.get("pairs", []))
                consecutive_failures = 0
            except Exception as e:
                consecutive_failures += 1
                logger.warning(
                    f"Modal route similarity chunk failed "
                    f"({consecutive_failures}/{max_failures}): {e}"
                )
                if consecutive_failures >= max_failures:
                    degraded = True

    if degraded:
        local = compute_route_similarity_locally(
            routes_data,
            pairs,
            auto_threshold=auto_threshold,
            review_floor=review_floor,
            gate=gate,
        )
        seen = {(p["a"], p["b"]) for p in results}
        for p in local["pairs"]:
            if (p["a"], p["b"]) not in seen:
                results.append(p)
        logger.info(
            f"Route similarity degraded to local "
            f"(Modal results={len(seen)}, total={len(results)})"
        )

    return {"pairs": results}
