"""Unit tests for the route-embedding module (no DB)."""

import math

from app.services.route_embedding import (
    FEATURE_DIM,
    build_features,
    cosine,
    embed,
    embedding_similarity,
    l2_normalize,
    train_metric,
)

_LAT0 = 55.0
_COS = math.cos(math.radians(_LAT0))


def _line(km: float, heading_east: bool = True, n: int = 40):
    pts = []
    for i in range(n):
        frac = i / (n - 1)
        if heading_east:
            pts.append((_LAT0, frac * km * 1000.0 / (111_320.0 * _COS)))
        else:
            pts.append((_LAT0 + frac * km * 1000.0 / 110_540.0, 0.0))
    return pts


def test_feature_dim_and_determinism():
    pts = _line(20.0)
    f1 = build_features(pts, edge_set=["a", "b"], names=["High St"])
    f2 = build_features(pts, edge_set=["a", "b"], names=["High St"])
    assert len(f1) == FEATURE_DIM
    assert f1 == f2


def test_cosine_identical_is_one():
    f = build_features(_line(10.0))
    assert abs(cosine(f, f) - 1.0) < 1e-9


def test_shared_edges_score_higher_than_disjoint():
    pts = _line(20.0)
    edges = [f"e{i}" for i in range(10)]
    base = build_features(pts, edge_set=edges, names=["A"])
    same = build_features(pts, edge_set=edges, names=["A"])
    other = build_features(pts, edge_set=[f"z{i}" for i in range(10)], names=["B"])
    assert cosine(base, same) > cosine(base, other)


def test_train_metric_separates_positives_from_negatives():
    pts = _line(20.0)
    edges = [f"e{i}" for i in range(12)]
    near = build_features(pts, edge_set=edges, names=["A"])
    near2 = [v + 0.01 for v in near]
    positives = [(near, near2)]

    negatives = []
    for k in range(5):
        far = build_features(
            _line(5.0 + k, heading_east=(k % 2 == 0)),
            edge_set=[f"x{k}_{i}" for i in range(12)],
            names=[f"Road{k}"],
        )
        negatives.append((near, far))

    metric = train_metric(positives, negatives, iters=100)
    assert len(metric.weights) == FEATURE_DIM

    pos_sim = embedding_similarity(embed(near, metric), embed(near2, metric))
    neg_sims = [
        embedding_similarity(embed(near, metric), embed(far, metric))
        for _, far in negatives
    ]
    assert pos_sim > max(neg_sims)


def test_embed_is_unit_length():
    f = build_features(_line(10.0))
    e = embed(f, None)
    assert abs(math.sqrt(sum(x * x for x in e)) - 1.0) < 1e-9


def test_l2_normalize_zero_vector_safe():
    assert l2_normalize([0.0, 0.0]) == [0.0, 0.0]


def test_route_features_accepts_a_route_like_object():
    """Regression: road_matching.route_features passed a kwarg build_features
    doesn't accept (elevation_gain_meters vs elevation_gain_m), so every
    Phase-2 matcher run rolled back after a successful Modal match."""
    import types

    from app.services.polyline_utils import encode_polyline
    from app.services.road_matching import route_features

    route = types.SimpleNamespace(
        encoded_polyline=encode_polyline(_line(12.0)),
        road_match={"edge_set": ["e1", "e2"], "names": ["High St"]},
        elevation_profile={"distance": [0, 1000], "elevation": [10, 60]},
        elevation_gain_meters=50.0,
        terrain_classification={"terrain_type": "rolling"},
    )

    features = route_features(route)
    assert len(features) == FEATURE_DIM
    assert any(features)  # non-trivial

