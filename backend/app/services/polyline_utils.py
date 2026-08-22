"""Polyline encoding/decoding and geospatial utilities.

Implements Google's Encoded Polyline Algorithm:
https://developers.google.com/maps/documentation/utilities/polylinealgorithm

Also provides Haversine distance calculation and polyline sampling for
route deduplication shape comparison.
"""

import math
from collections.abc import Sequence

# ── Polyline encode / decode ─────────────────────────────────────────────────


def decode_polyline(encoded: str) -> list[tuple[float, float]]:
    """Decode a Google-encoded polyline string into a list of (lat, lng) tuples."""
    points: list[tuple[float, float]] = []
    index = 0
    lat = 0
    lng = 0

    while index < len(encoded):
        # Latitude
        shift = 0
        result = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lat += ~(result >> 1) if (result & 1) else (result >> 1)

        # Longitude
        shift = 0
        result = 0
        while True:
            b = ord(encoded[index]) - 63
            index += 1
            result |= (b & 0x1F) << shift
            shift += 5
            if b < 0x20:
                break
        lng += ~(result >> 1) if (result & 1) else (result >> 1)

        points.append((lat / 1e5, lng / 1e5))

    return points


def encode_polyline(points: Sequence[tuple[float, float]]) -> str:
    """Encode a list of (lat, lng) tuples into a Google-encoded polyline string."""
    encoded = []
    prev_lat = 0
    prev_lng = 0

    for lat, lng in points:
        lat_i = int(round(lat * 1e5))
        lng_i = int(round(lng * 1e5))

        dlat = lat_i - prev_lat
        dlng = lng_i - prev_lng

        prev_lat = lat_i
        prev_lng = lng_i

        for v in [dlat, dlng]:
            v = ~(v << 1) if v < 0 else v << 1
            while v >= 0x20:
                encoded.append(chr((0x20 | (v & 0x1F)) + 63))
                v >>= 5
            encoded.append(chr(v + 63))

    return "".join(encoded)


# ── Haversine distance ───────────────────────────────────────────────────────

_EARTH_RADIUS_M = 6_371_000  # mean Earth radius in meters


def haversine_distance(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Compute the great-circle distance in meters between two points."""
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


# ── Polyline total distance ──────────────────────────────────────────────────


def polyline_total_distance(encoded: str) -> float:
    """Compute the total distance in meters of an encoded polyline."""
    points = decode_polyline(encoded)
    if len(points) < 2:
        return 0.0

    total = 0.0
    for i in range(1, len(points)):
        total += haversine_distance(
            points[i - 1][0],
            points[i - 1][1],
            points[i][0],
            points[i][1],
        )
    return total


# ── Polyline sampling (for shape comparison) ─────────────────────────────────


def _cumulative_distances(points: list[tuple[float, float]]) -> list[float]:
    """Compute cumulative distance along a polyline."""
    cum = [0.0]
    for i in range(1, len(points)):
        cum.append(
            cum[-1]
            + haversine_distance(
                points[i - 1][0],
                points[i - 1][1],
                points[i][0],
                points[i][1],
            )
        )
    return cum


def sample_polyline(encoded: str, n_points: int = 20) -> list[tuple[float, float]]:
    """Sample N evenly-spaced points along an encoded polyline."""
    points = decode_polyline(encoded)
    if len(points) <= n_points:
        return points

    cum = _cumulative_distances(points)
    total = cum[-1]
    if total == 0:
        return [points[0]] * n_points

    step = total / (n_points - 1)
    sampled: list[tuple[float, float]] = [points[0]]
    target_dist = step
    idx = 1

    for _ in range(n_points - 2):
        while idx < len(cum) and cum[idx] < target_dist:
            idx += 1
        if idx >= len(points):
            break

        # Interpolate between points[idx-1] and points[idx]
        seg_len = cum[idx] - cum[idx - 1]
        if seg_len == 0:
            frac = 0.0
        else:
            frac = (target_dist - cum[idx - 1]) / seg_len
        frac = max(0.0, min(1.0, frac))

        lat = points[idx - 1][0] + frac * (points[idx][0] - points[idx - 1][0])
        lng = points[idx - 1][1] + frac * (points[idx][1] - points[idx - 1][1])
        sampled.append((lat, lng))
        target_dist += step

    sampled.append(points[-1])
    return sampled


def shape_similarity(encoded1: str, encoded2: str, n_points: int = 20) -> float:
    """Compute shape similarity between two polylines (0.0–1.0).

    Samples N evenly-spaced points from each and computes the average
    distance between corresponding points, normalised so that:
    - avg distance < 100m → 1.0
    - avg distance < 500m → linearly interpolated
    - avg distance >= 500m → 0.0
    """
    sample1 = sample_polyline(encoded1, n_points)
    sample2 = sample_polyline(encoded2, n_points)

    # Use the shorter sample count
    n = min(len(sample1), len(sample2))
    if n == 0:
        return 0.0

    total_dist = 0.0
    for i in range(n):
        total_dist += haversine_distance(
            sample1[i][0],
            sample1[i][1],
            sample2[i][0],
            sample2[i][1],
        )

    avg_dist = total_dist / n

    if avg_dist <= 100:
        return 1.0
    elif avg_dist >= 500:
        return 0.0
    else:
        return 1.0 - (avg_dist - 100) / 400


# ── Provider-specific conversions ────────────────────────────────────────────


def komoot_coordinates_to_polyline(coordinates: list[dict]) -> str:
    """Convert Komoot's embedded coordinate resource to an encoded polyline.

    Komoot returns coordinates as a list of dicts with 'lat', 'lng', 'alt' keys.
    """
    points = [(c["lat"], c["lng"]) for c in coordinates]
    return encode_polyline(points)


def komoot_coordinate_array_to_polyline(coord_array: list[list[float]]) -> str:
    """Convert Komoot's alternative coordinate array format [[lng, lat, alt], ...].

    Note: Komoot sometimes returns [longitude, latitude, altitude] order.
    """
    points = [(c[1], c[0]) for c in coord_array if len(c) >= 2]
    return encode_polyline(points)


def wahoo_points_to_polyline(points: list[list[float]]) -> str:
    """Convert Wahoo's point arrays to an encoded polyline.

    Wahoo returns points as [[lat, lng, elevation], ...].
    """
    coords = [(p[0], p[1]) for p in points if len(p) >= 2]
    return encode_polyline(coords)


def extract_elevation_profile_from_wahoo_points(
    points: list[list[float]],
) -> dict | None:
    """Extract an elevation profile from Wahoo point arrays.

    Points are expected as [[lat, lng, elevation], ...].
    Returns a dict suitable for Route.elevation_profile:
        {"distance": [0, 100, 200, ...], "elevation": [100, 105, 110, ...]}
    or None if no elevation data is available.
    """
    if not points or len(points) < 2:
        return None

    distances: list[float] = [0.0]
    elevations: list[float | None] = []
    cumulative = 0.0

    for i, pt in enumerate(points):
        if len(pt) < 2:
            continue

        lat, lng = pt[0], pt[1]
        ele = pt[2] if len(pt) >= 3 else None
        elevations.append(ele)

        if i > 0:
            prev_lat, prev_lng = points[i - 1][0], points[i - 1][1]
            cumulative += haversine_distance(prev_lat, prev_lng, lat, lng)
            distances.append(cumulative)

    # Ensure arrays are same length
    min_len = min(len(distances), len(elevations))
    if min_len < 2:
        return None

    return {
        "distance": distances[:min_len],
        "elevation": elevations[:min_len],
    }
