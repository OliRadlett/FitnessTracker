"""GPX service — generate and parse GPX 1.1 files."""

import xml.etree.ElementTree as ET
from datetime import UTC, datetime

from app.models.route import Route
from app.services.polyline_utils import decode_polyline

# ── GPX generation ───────────────────────────────────────────────────────────

GPX_NS = "http://www.topografix.com/GPX/1/1"
GPX_SCHEMA = "http://www.topografix.com/GPX/1/1/gpx.xsd"


def route_to_gpx(route: Route) -> str:
    """Generate a GPX 1.1 XML string from a Route object.

    Decodes the encoded_polyline, pairs with elevation_profile data,
    and produces a valid GPX document with <trk>/<trkseg>/<trkpt> elements.
    """
    points = decode_polyline(route.encoded_polyline)
    elevations: list[float | None] = []

    if route.elevation_profile and "elevations" in route.elevation_profile:
        raw_ele = route.elevation_profile["elevations"]
        elevations = [float(e) if e is not None else None for e in raw_ele]
    else:
        elevations = [None] * len(points)

    # Ensure elevations list matches points length
    while len(elevations) < len(points):
        elevations.append(None)

    # Build GPX XML
    root = ET.Element("gpx")
    root.set("version", "1.1")
    root.set("creator", "FitTrack")
    root.set("xmlns", GPX_NS)
    root.set("xsi:schemaLocation", f"{GPX_NS} {GPX_SCHEMA}")
    root.set("xmlns:xsi", "http://www.w3.org/2001/XMLSchema-instance")

    # Metadata
    metadata = ET.SubElement(root, "metadata")
    name_elem = ET.SubElement(metadata, "name")
    name_elem.text = route.name
    time_elem = ET.SubElement(metadata, "time")
    time_elem.text = (
        route.created_at.strftime("%Y-%m-%dT%H:%M:%SZ")
        if route.created_at
        else datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    )

    # Track
    trk = ET.SubElement(root, "trk")
    trk_name = ET.SubElement(trk, "name")
    trk_name.text = route.name
    trk_type = ET.SubElement(trk, "type")
    trk_type.text = route.sport_type

    # Track segment
    trkseg = ET.SubElement(trk, "trkseg")
    for i, (lat, lng) in enumerate(points):
        trkpt = ET.SubElement(trkseg, "trkpt")
        trkpt.set("lat", f"{lat:.7f}")
        trkpt.set("lon", f"{lng:.7f}")

        ele = elevations[i] if i < len(elevations) else None
        if ele is not None:
            ele_elem = ET.SubElement(trkpt, "ele")
            ele_elem.text = f"{ele:.1f}"

    # Pretty print
    ET.indent(root, space="  ")
    xml_str = ET.tostring(root, encoding="unicode", xml_declaration=False)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n{xml_str}\n'


def activity_to_gpx(activity) -> str | None:
    """Generate a GPX 1.1 XML string from an Activity object.

    Uses the activity's raw_data to extract the summary_polyline.
    Returns None if no GPS data is available.
    """
    if not activity.raw_data:
        return None

    map_data = activity.raw_data.get("map", {})
    polyline = map_data.get("summary_polyline") or map_data.get("polyline")
    if not polyline:
        return None

    points = decode_polyline(polyline)
    if not points:
        return None

    # Build GPX XML
    root = ET.Element("gpx")
    root.set("version", "1.1")
    root.set("creator", "FitTrack")
    root.set("xmlns", GPX_NS)

    metadata = ET.SubElement(root, "metadata")
    name_elem = ET.SubElement(metadata, "name")
    name_elem.text = activity.name or "Activity"
    time_elem = ET.SubElement(metadata, "time")
    time_elem.text = (
        activity.start_date.strftime("%Y-%m-%dT%H:%M:%SZ")
        if activity.start_date
        else ""
    )

    trk = ET.SubElement(root, "trk")
    trk_name = ET.SubElement(trk, "name")
    trk_name.text = activity.name or "Activity"
    trk_type = ET.SubElement(trk, "type")
    trk_type.text = activity.sport_type or "cycling"

    trkseg = ET.SubElement(trk, "trkseg")
    for lat, lng in points:
        trkpt = ET.SubElement(trkseg, "trkpt")
        trkpt.set("lat", f"{lat:.7f}")
        trkpt.set("lon", f"{lng:.7f}")

    ET.indent(root, space="  ")
    xml_str = ET.tostring(root, encoding="unicode", xml_declaration=False)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n{xml_str}\n'


# ── GPX parsing ──────────────────────────────────────────────────────────────


def parse_gpx(gpx_xml: str, *, include_timestamps: bool = False) -> dict:
    """Parse a GPX 1.1 XML string and extract route data.

    Args:
        gpx_xml: The GPX XML string to parse.
        include_timestamps: If True, also extract ``<time>`` elements from
            track points and return them in the result dict.

    Returns:
        {
            "name": str,
            "sport_type": str,
            "points": [(lat, lng), ...],
            "elevations": [float | None, ...],
            "timestamps": [datetime | None, ...]  # only when include_timestamps=True
        }

    Raises ValueError if the GPX is invalid or contains no track points.
    """
    try:
        root = ET.fromstring(gpx_xml)
    except ET.ParseError as e:
        raise ValueError(f"Invalid GPX XML: {e}") from e

    # Handle namespace
    ns_prefix = f"{{{GPX_NS}}}" if root.tag.startswith(f"{{{GPX_NS}}}") else ""

    # Extract name from metadata or first track
    name = ""
    metadata = root.find(f"{ns_prefix}metadata")
    if metadata is not None:
        name_elem = metadata.find(f"{ns_prefix}name")
        if name_elem is not None and name_elem.text:
            name = name_elem.text.strip()

    # Extract sport type from first track
    sport_type = "cycling"
    trk = root.find(f"{ns_prefix}trk")
    if trk is not None:
        if not name:
            trk_name = trk.find(f"{ns_prefix}name")
            if trk_name is not None and trk_name.text:
                name = trk_name.text.strip()
        trk_type = trk.find(f"{ns_prefix}type")
        if trk_type is not None and trk_type.text:
            raw_type = trk_type.text.strip().lower()
            type_map = {
                "cycling": "cycling",
                "biking": "cycling",
                "road cycling": "cycling",
                "mountain biking": "cycling",
                "running": "running",
                "walking": "walking",
                "hiking": "hiking",
                "swimming": "swimming",
            }
            sport_type = type_map.get(raw_type, raw_type)

    # Extract track points
    points: list[tuple[float, float]] = []
    elevations: list[float | None] = []
    timestamps: list[datetime | None] = []

    for trkseg in root.iter(f"{ns_prefix}trkseg"):
        for trkpt in trkseg.findall(f"{ns_prefix}trkpt"):
            lat = trkpt.get("lat")
            lon = trkpt.get("lon")
            if lat is None or lon is None:
                continue
            points.append((float(lat), float(lon)))

            ele_elem = trkpt.find(f"{ns_prefix}ele")
            if ele_elem is not None and ele_elem.text:
                try:
                    elevations.append(float(ele_elem.text))
                except ValueError:
                    elevations.append(None)
            else:
                elevations.append(None)

            if include_timestamps:
                time_elem = trkpt.find(f"{ns_prefix}time")
                if time_elem is not None and time_elem.text:
                    try:
                        timestamps.append(
                            datetime.fromisoformat(
                                time_elem.text.replace("Z", "+00:00")
                            )
                        )
                    except (ValueError, AttributeError):
                        timestamps.append(None)
                else:
                    timestamps.append(None)

    # Also check for <rte> (route) elements if no tracks found
    if not points:
        for rte in root.iter(f"{ns_prefix}rte"):
            if not name:
                rte_name = rte.find(f"{ns_prefix}name")
                if rte_name is not None and rte_name.text:
                    name = rte_name.text.strip()
            for rtept in rte.findall(f"{ns_prefix}rtept"):
                lat = rtept.get("lat")
                lon = rtept.get("lon")
                if lat is None or lon is None:
                    continue
                points.append((float(lat), float(lon)))
                ele_elem = rtept.find(f"{ns_prefix}ele")
                if ele_elem is not None and ele_elem.text:
                    try:
                        elevations.append(float(ele_elem.text))
                    except ValueError:
                        elevations.append(None)
                else:
                    elevations.append(None)

                if include_timestamps:
                    time_elem = rtept.find(f"{ns_prefix}time")
                    if time_elem is not None and time_elem.text:
                        try:
                            timestamps.append(
                                datetime.fromisoformat(
                                    time_elem.text.replace("Z", "+00:00")
                                )
                            )
                        except (ValueError, AttributeError):
                            timestamps.append(None)
                    else:
                        timestamps.append(None)

    if not points:
        raise ValueError("GPX file contains no track or route points")

    result: dict = {
        "name": name or "Imported Route",
        "sport_type": sport_type,
        "points": points,
        "elevations": elevations,
    }
    if include_timestamps:
        result["timestamps"] = timestamps
    return result
