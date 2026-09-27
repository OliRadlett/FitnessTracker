"""One-off bootstrap: cache OSM road data in the Modal OSM Volume.

Phase 2 map-matching reads road data from a Modal Volume. Run this once (on a
machine with Modal credentials) before the weekly ``map_match_routes`` task can
do anything:

    # just cache the full regional extract (legacy)
    python -m app.scripts.osm_bootstrap europe/united-kingdom great-britain

    # parse + cache the road graph for the routes' bbox (recommended, fast)
    python -m app.scripts.osm_bootstrap --build great-britain \
        --bbox 54.8,-4.3,56.2,-1.5 --clip

``--build`` writes ``{region}-roads.geojson`` into the Volume, which the weekly
matcher prefers (so it never scans the whole PBF). ``--clip`` additionally
fetches a bbox-clipped extract from Geofabrik/OpenStreetMap.de (smaller, faster
parse); ``--bbox`` accepts ``min_lat,min_lng,max_lat,max_lng`` or the word
``routes`` (computed from the routes in the ``DATABASE_URL`` DB).
"""

import argparse
import sys


def _bbox_from_arg(value: str) -> tuple[float, float, float, float]:
    if value == "routes":
        from app.scripts._route_bbox import compute_route_bbox

        return compute_route_bbox()
    parts = [float(p) for p in value.split(",")]
    if len(parts) != 4:
        raise SystemExit("--bbox must be min_lat,min_lng,max_lat,max_lng")
    return parts[0], parts[1], parts[2], parts[3]


def main() -> None:
    parser = argparse.ArgumentParser(description="Cache OSM data in the Modal volume")
    parser.add_argument("geofabrik_path", nargs="?", default="europe/united-kingdom")
    parser.add_argument("region", nargs="?", default="great-britain")
    parser.add_argument(
        "--build",
        action="store_true",
        help="parse the PBF and cache {region}-roads.geojson (recommended)",
    )
    parser.add_argument(
        "--clip",
        action="store_true",
        help="with --build, fetch a bbox-clipped extract first (faster parse)",
    )
    parser.add_argument(
        "--bbox",
        default="routes",
        help="min_lat,min_lng,max_lat,max_lng, or 'routes' (default)",
    )
    args = parser.parse_args()

    if args.build:
        from app.integrations.route_road_graph import build_road_graph_on_modal

        bbox = _bbox_from_arg(args.bbox)
        result = build_road_graph_on_modal(
            args.region,
            bbox,
            geofabrik_path=args.geofabrik_path if args.clip else None,
        )
        print(f"Road graph cached: {result}")
        return

    from app.integrations.route_road_graph import bootstrap_osm_region_on_modal

    dest = bootstrap_osm_region_on_modal(args.region, args.geofabrik_path)
    print(f"OSM extract cached: {dest}")


if __name__ == "__main__":
    main()
