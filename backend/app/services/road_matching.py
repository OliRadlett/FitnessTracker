"""Road-match persistence + route-embedding helpers (Phase 2).

Thin glue between the pure ``road_graph`` / ``route_embedding`` engines, the
``Route``/``RouteMatchMetric`` rows, and the weekly Celery tasks.
"""

from __future__ import annotations

import logging
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.route_road_graph import ROAD_MATCH_VERSION
from app.models.activity import Activity
from app.models.route import Route, RouteMatchMetric, RouteMergeLog
from app.services.polyline_utils import decode_polyline
from app.services.road_graph import edge_jaccard, snap_polyline
from app.services.route_embedding import (
    Metric,
    build_features,
    embed,
    embedding_similarity,
    train_metric,
)
from app.services.route_quarantine import active_routes_clause

logger = logging.getLogger(__name__)

# Sentinel for "we looked and there is no geometry to match". Distinct from
# NULL, which means "never attempted" and is what the weekly task selects.
#
# Zero is safe because ROAD_MATCH_VERSION is 1 and the column is only ever
# compared against None anywhere in the codebase, so a sentinel row is
# excluded from the retry set by simply being non-NULL.
ROAD_MATCH_VERSION_NO_GEOMETRY = 0


def _terrain_type(route: Route) -> str | None:
    tc = route.terrain_classification
    if isinstance(tc, dict):
        return tc.get("terrain_type")
    return None


def route_features(route: Route) -> list[float]:
    """Build the embedding feature vector for a route (from its stored match)."""
    road = route.road_match or {}
    return build_features(
        decode_polyline(route.encoded_polyline),
        edge_set=road.get("edge_set"),
        names=road.get("names"),
        elevation_profile=route.elevation_profile,
        elevation_gain_m=route.elevation_gain_meters,
        terrain_type=_terrain_type(route),
    )


def store_road_matches(db: AsyncSession, routes: list[Route], matches: dict) -> int:
    """Persist Modal road matches + feature vectors onto the routes. Returns count."""
    stored = 0
    for route in routes:
        match = matches.get(str(route.id))
        if not match:
            continue
        match = {**match, "version": ROAD_MATCH_VERSION}
        route.road_match = match
        route.road_match_version = ROAD_MATCH_VERSION
        route.road_embedding = {
            "version": ROAD_MATCH_VERSION,
            "features": route_features(route),
        }
        stored += 1
    return stored


def store_activity_road_matches(
    db: AsyncSession, activities: list[Activity], matches: dict
) -> int:
    """Persist Modal road matches onto activities. Returns count.

    Mirrors :func:`store_road_matches` for routes. The activity's
    ``road_match`` stores the OSM edge set (with coverage, names, version)
    so rides can be compared edge-to-edge for section-repeat / lap detection.
    The ``road_embedding`` stores a compact summary for the similarity graph.
    """
    stored = 0
    for activity in activities:
        match = matches.get(str(activity.id))
        if not match:
            continue
        match = {**match, "version": ROAD_MATCH_VERSION}
        activity.road_match = match
        activity.road_match_version = ROAD_MATCH_VERSION
        edge_set = match.get("edge_set")
        activity.road_embedding = {
            "version": ROAD_MATCH_VERSION,
            "edge_set_size": len(edge_set) if edge_set else 0,
        }
        stored += 1
    return stored


async def load_metric(db: AsyncSession, user_id: uuid.UUID) -> Metric:
    row = (
        await db.execute(
            select(RouteMatchMetric).where(RouteMatchMetric.user_id == user_id)
        )
    ).scalar_one_or_none()
    if row is None:
        return Metric(weights=[])
    return Metric(weights=[float(w) for w in (row.weights or [])], version=row.version)


def road_signals(
    a: Route, b: Route, metric: Metric
) -> tuple[float | None, float | None]:
    """Return ``(road_jaccard, embedding_similarity)`` for a route pair.

    Either element is ``None`` when the corresponding data is missing.
    """
    road_j: float | None = None
    ra, rb = a.road_match or {}, b.road_match or {}
    if ra.get("edge_set") and rb.get("edge_set"):
        road_j = edge_jaccard(ra["edge_set"], rb["edge_set"])

    emb: float | None = None
    fa = (a.road_embedding or {}).get("features")
    fb = (b.road_embedding or {}).get("features")
    if fa and fb:
        emb = embedding_similarity(embed(fa, metric), embed(fb, metric))

    return road_j, emb


async def train_metric_from_history(
    db: AsyncSession, user_id: uuid.UUID, *, max_negatives: int = 40
) -> Metric:
    """Train and persist the diagonal metric from accumulated merge decisions.

    Positives are only the **``identical``** merges — route pairs the user
    confirmed are the same route recorded twice. The log stores both embeddings
    (the duplicate's in ``snapshot``, the primary's in ``breakdown``) because the
    duplicate's Route row is deleted on merge, so its embedding would otherwise
    be unrecoverable.

    **``variant`` merges are deliberately excluded.** A variant merge ("same kind
    of ride", e.g. 3 laps vs 5 laps of one circuit) is not evidence that two
    routes are the same; training on it would widen matching and cause
    over-merging. Unclassified (``merge_kind`` NULL) rows are skipped rather than
    assumed identical, but still exclude their routes from the negative pool.

    This supersedes the earlier ``route_similarity.tier == "auto"`` source, which
    was always empty: auto-merged pairs are removed from that table when the
    duplicate is deleted.

    Negatives are sampled from live route pairs that were **not** merged.
    Merge-mates (a primary and anything it absorbed) are excluded so the same
    route's variants never become negatives. Requires ≥3 positives; otherwise
    the existing/uniform metric is kept.
    """
    merge_rows = (
        await db.execute(
            select(RouteMergeLog).where(RouteMergeLog.user_id == user_id)
        )
    ).scalars().all()

    positives: list[tuple[list[float], list[float]]] = []
    merged_ids: set[uuid.UUID] = set()
    for row in merge_rows:
        # Only *identical* merges are duplicates worth learning from. A
        # "variant" merge (same kind of ride, e.g. different lap counts of a
        # circuit) must never teach the matcher that distinct routes match.
        # Unclassified rows are skipped too — we do not assume identity.
        if row.merge_kind != "identical":
            merged_ids.add(row.merged_route_id)
            continue
        dup_features = (row.snapshot or {}).get("road_embedding", {}) or {}
        prim_features = (row.breakdown or {}).get("primary_embedding", {}) or {}
        fa = dup_features.get("features")
        fb = prim_features.get("features")
        if fa and fb and len(fa) == len(fb):
            positives.append((fa, fb))
        merged_ids.add(row.merged_route_id)

    # Quarantined routes stay out of the metric entirely. They would land
    # in the negatives pool below, teaching the matcher that real courses
    # are dissimilar to each other. See app/services/route_quarantine.py.
    routes = (
        await db.execute(
            select(Route).where(Route.user_id == user_id, active_routes_clause())
        )
    ).scalars().all()
    features = {
        r.id: r.road_embedding.get("features")
        for r in routes
        if r.road_embedding and r.road_embedding.get("features")
    }
    if len(features) < 4 or len(positives) < 3:
        return await load_metric(db, user_id)

    # Negatives: live pairs that were neither merged nor merge-mates. Any route
    # that participated in a merge is excluded from the negative pool to avoid
    # training against a route whose variant we deliberately absorbed.
    negatives: list[tuple[list[float], list[float]]] = []
    ids = [rid for rid in features if rid not in merged_ids]
    for i in range(len(ids)):
        for j in range(i + 1, len(ids)):
            negatives.append((features[ids[i]], features[ids[j]]))
            if len(negatives) >= max_negatives:
                break
        if len(negatives) >= max_negatives:
            break
    if len(negatives) < 3:
        return await load_metric(db, user_id)

    metric = train_metric(positives, negatives)

    row = (
        await db.execute(
            select(RouteMatchMetric).where(RouteMatchMetric.user_id == user_id)
        )
    ).scalar_one_or_none()
    if row is None:
        row = RouteMatchMetric(user_id=user_id)
        db.add(row)
    from datetime import UTC, datetime

    row.weights = metric.weights
    row.version = metric.version
    row.n_positives = len(positives)
    row.n_negatives = len(negatives)
    row.trained_at = datetime.now(UTC)
    await db.flush()
    logger.info(
        f"Route metric trained for user {user_id}: "
        f"{len(positives)} pos / {len(negatives)} neg"
    )
    return metric


def snap_routes_locally(routes: list[Route]) -> dict:
    """Local fallback: no OSM, so no road match. (Kept for symmetry/tests.)"""
    result: dict = {}
    for route in routes:
        result[str(route.id)] = None
    return result


__all__ = [
    "load_metric",
    "road_signals",
    "route_features",
    "snap_polyline",
    "snap_routes_locally",
    "store_activity_road_matches",
    "store_road_matches",
    "train_metric_from_history",
]
