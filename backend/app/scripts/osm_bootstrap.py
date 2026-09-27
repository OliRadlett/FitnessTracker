"""One-off bootstrap: cache an OSM region extract in the Modal OSM Volume.

Phase 2 map-matching reads road data from a Modal Volume. Run this once (on a
machine with Modal credentials) before the weekly ``map_match_routes`` task can
do anything:

    python -m app.scripts.osm_bootstrap europe/united-kingdom great-britain

``geofabrik_path`` is the path on download.geofabrik.de (without
``-latest.osm.pbf``); ``region`` is the logical key stored in the Volume and
referenced by ``OSM_REGION`` (default ``great-britain``).
"""

import sys


def main() -> None:
    from app.integrations.route_road_graph import bootstrap_osm_region_on_modal

    geofabrik_path = sys.argv[1] if len(sys.argv) > 1 else "europe/united-kingdom"
    region = sys.argv[2] if len(sys.argv) > 2 else "great-britain"
    dest = bootstrap_osm_region_on_modal(region, geofabrik_path)
    print(f"OSM extract cached: {dest}")


if __name__ == "__main__":
    main()
