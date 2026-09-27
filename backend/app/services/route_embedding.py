"""Route embeddings — a fixed-length signature per route plus a self-supervised
metric learned from the merges the app has made (Phase 2).

Stdlib only at module scope (no numpy / app imports) so it can run in the bare
Modal container and locally. The embedding combines:

* a compass-heading histogram (shape/orientation),
* hashed buckets over the matched **road edge set** (the strongest signal — two
  routes on the same roads collide),
* hashed buckets over road names,
* scalar geometry (length, sinuosity, loop, elevation gain, max gradient),
* a terrain one-hot.

``train_metric`` learns a diagonal metric (per-dimension weights) from
positive pairs (routes that were merged / auto-matched) and negative pairs
(dissimilar routes) — the "trained on accumulated merge decisions" layer.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

_M_PER_DEG_LAT = 110_540.0
_M_PER_DEG_LNG = 111_320.0

HEADING_BINS = 8
EDGE_BUCKETS = 16
NAME_BUCKETS = 8
_TERRAIN = ("flat", "rolling", "hilly", "mountainous")

# index layout
_H_OFF = 0
_E_OFF = _H_OFF + HEADING_BINS
_N_OFF = _E_OFF + EDGE_BUCKETS
_S_OFF = _N_OFF + NAME_BUCKETS  # + length, sinuosity, loop, elev, grad
_T_OFF = _S_OFF + 5
FEATURE_DIM = _T_OFF + len(_TERRAIN)


def _stable_hash(value: str, buckets: int) -> int:
    digest = hashlib.md5(value.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % buckets


def _haversine(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6_371_000.0
    lat1_r, lng1_r = math.radians(lat1), math.radians(lng1)
    lat2_r, lng2_r = math.radians(lat2), math.radians(lng2)
    dlat = lat2_r - lat1_r
    dlng = lng2_r - lng1_r
    a = math.sin(dlat / 2) ** 2 + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlng / 2) ** 2
    return r * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _bearing(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1 = math.radians(a[0])
    lat2 = math.radians(b[0])
    dlng = math.radians(b[1] - a[1])
    x = math.sin(dlng) * math.cos(lat2)
    y = math.cos(lat1) * math.sin(lat2) - math.sin(lat1) * math.cos(lat2) * math.cos(dlng)
    return (math.degrees(math.atan2(x, y)) + 360.0) % 360.0


def _gradient_stats(elevation_profile: dict | None) -> tuple[float, float]:
    """Return (climb_m, max_gradient_pct) from a canonical profile, else (0, 0)."""
    if not elevation_profile:
        return 0.0, 0.0
    dists = elevation_profile.get("distance")
    eles = elevation_profile.get("elevation")
    if not dists or not eles or len(dists) < 2 or len(eles) < 2:
        return 0.0, 0.0
    climb = 0.0
    max_grad = 0.0
    n = min(len(dists), len(eles))
    for i in range(1, n):
        dd = dists[i] - dists[i - 1]
        de = eles[i] - eles[i - 1]
        if de > 0:
            climb += de
        if dd > 0:
            max_grad = max(max_grad, abs(de / dd) * 100.0)
    return climb, max_grad


def build_features(
    points: list[tuple[float, float]],
    *,
    edge_set: list[str] | None = None,
    names: list[str] | None = None,
    elevation_profile: dict | None = None,
    elevation_gain_m: float | None = None,
    terrain_type: str | None = None,
) -> list[float]:
    """Build the fixed-length (``FEATURE_DIM``) route feature vector."""
    features = [0.0] * FEATURE_DIM
    if len(points) < 2:
        return features

    # Heading histogram.
    total = 0.0
    for i in range(1, len(points)):
        b = _bearing(points[i - 1], points[i])
        features[_H_OFF + (int(b // 45) % HEADING_BINS)] += 1.0
        total += 1.0
    if total:
        for k in range(HEADING_BINS):
            features[_H_OFF + k] /= total

    # Hashed road-edge buckets.
    if edge_set:
        for e in edge_set:
            features[_E_OFF + _stable_hash(e, EDGE_BUCKETS)] += 1.0
        m = max((features[_E_OFF + k] for k in range(EDGE_BUCKETS)), default=0.0)
        if m:
            for k in range(EDGE_BUCKETS):
                features[_E_OFF + k] /= m

    # Hashed road-name buckets.
    if names:
        for nm in names:
            features[_N_OFF + _stable_hash(nm.lower(), NAME_BUCKETS)] += 1.0
        m = max((features[_N_OFF + k] for k in range(NAME_BUCKETS)), default=0.0)
        if m:
            for k in range(NAME_BUCKETS):
                features[_N_OFF + k] /= m

    # Scalar geometry.
    length = 0.0
    for i in range(1, len(points)):
        length += _haversine(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1])
    straight = _haversine(points[0][0], points[0][1], points[-1][0], points[-1][1])
    sinuosity = (length / straight) if straight > 1.0 else 10.0
    climb, max_grad = _gradient_stats(elevation_profile)
    if elevation_gain_m is not None:
        climb = elevation_gain_m
    features[_S_OFF] = math.log1p(length)
    features[_S_OFF + 1] = min(sinuosity, 20.0) / 20.0
    features[_S_OFF + 2] = 1.0 if straight < 200.0 else 0.0
    features[_S_OFF + 3] = math.log1p(max(climb, 0.0))
    features[_S_OFF + 4] = min(max_grad, 25.0) / 25.0

    # Terrain one-hot.
    if terrain_type in _TERRAIN:
        features[_T_OFF + _TERRAIN.index(terrain_type)] = 1.0

    return features


# ── Metric ───────────────────────────────────────────────────────────────────


def l2_normalize(vec: list[float]) -> list[float]:
    norm = math.sqrt(sum(v * v for v in vec))
    if norm <= 0:
        return list(vec)
    return [v / norm for v in vec]


def cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na <= 0 or nb <= 0:
        return 0.0
    return dot / (na * nb)


@dataclass
class Metric:
    """A learned diagonal metric (per-dimension weights)."""

    weights: list[float]
    version: int = 1

    def to_dict(self) -> dict:
        return {"weights": [round(w, 6) for w in self.weights], "version": self.version}

    @classmethod
    def from_dict(cls, data: dict | None) -> Metric:
        if not data or not data.get("weights"):
            return Metric(weights=[])
        return cls(weights=[float(w) for w in data["weights"]], version=int(data.get("version", 1)))


def _weighted_similarity(a: list[float], b: list[float], w: list[float]) -> float:
    num = 0.0
    den = 0.0
    for d in range(len(a)):
        num += w[d] * (1.0 - abs(a[d] - b[d]))
        den += w[d]
    return num / den if den else 0.0


def train_metric(
    positives: list[tuple[list[float], list[float]]],
    negatives: list[tuple[list[float], list[float]]],
    *,
    dim: int = FEATURE_DIM,
    iters: int = 200,
    lr: float = 0.05,
    margin: float = 0.1,
) -> Metric:
    """Learn per-dimension weights so merged (positive) pairs score above
    dissimilar (negative) pairs, using a pairwise hinge loss.

    Returns a :class:`Metric`; with no training data it defaults to uniform
    weights (i.e. plain cosine over the raw features).
    """
    w = [1.0] * dim
    if not positives or not negatives:
        return Metric(weights=w)

    for _ in range(iters):
        for (pa, pb) in positives:
            for (na, nb) in negatives:
                sp = _weighted_similarity(pa, pb, w)
                sn = _weighted_similarity(na, nb, w)
                if sp < sn + margin:
                    for d in range(dim):
                        w[d] += lr * (
                            (1.0 - abs(pa[d] - pb[d])) - (1.0 - abs(na[d] - nb[d]))
                        )
        w = [max(0.01, x) for x in w]

    # Normalise so weights sum to ``dim`` (keeps scale comparable to uniform).
    total = sum(w)
    if total > 0:
        w = [x * dim / total for x in w]
    return Metric(weights=w)


def embed(features: list[float], metric: Metric | None = None) -> list[float]:
    """Apply the learned metric and L2-normalise to get the final embedding."""
    if metric and len(metric.weights) == len(features):
        weighted = [math.sqrt(max(w, 0.0)) * f for w, f in zip(metric.weights, features)]
        return l2_normalize(weighted)
    return l2_normalize(features)


def embedding_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity between two embeddings (0.0–1.0 clamped at 0)."""
    return max(0.0, cosine(a, b))
