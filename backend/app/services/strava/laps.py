"""Normalize Strava's laps into the shape this app stores.

Strava returns more fields than we need, names them in its own vocabulary, and
omits whichever ones the device did not record. Normalizing on write means the
consumer (``session_analysis``) never learns Strava's field names, and a
provider change shows up in one file rather than in the analysis code.

Kept deliberately small: no ``start_index``/``end_index`` in the stored document.
They are offsets into a stream we already store separately, and a lap document
that outlives a re-imported stream would silently point at the wrong samples.
Time and distance are the durable facts.
"""

from __future__ import annotations

_LAP_FIELDS = (
    ("elapsed_time", "elapsed_s"),
    ("moving_time", "moving_s"),
    ("distance", "distance_m"),
    ("average_watts", "avg_power"),
    ("average_heartrate", "avg_hr"),
    ("average_speed", "avg_speed"),
    ("max_speed", "max_speed"),
    ("total_elevation_gain", "elevation_gain_m"),
    ("average_cadence", "avg_cadence"),
)


def normalize_laps(raw: list[dict] | None) -> list[dict] | None:
    """Project Strava laps onto our stored shape, preserving order.

    Returns ``None`` when there is nothing to store, so a lap-less ride keeps a
    NULL column rather than an empty list — the difference between "Strava had no
    laps" and "we asked and got none" is not one any consumer needs to make, but
    NULL is what an absent value should look like in Postgres.

    A lap whose numbers are all missing is dropped: it is a device artefact, and
    it would otherwise become a zero-length segment in the pacing read.
    """
    if not raw:
        return None

    laps: list[dict] = []
    for position, lap in enumerate(raw):
        if not isinstance(lap, dict):
            continue
        entry: dict = {"index": lap.get("lap_index", position)}
        for source, target in _LAP_FIELDS:
            value = lap.get(source)
            if value is not None:
                try:
                    entry[target] = float(value)
                except (TypeError, ValueError):
                    continue
        # A lap needs at least a duration or a distance to mean anything.
        if entry.get("elapsed_s") or entry.get("distance_m"):
            laps.append(entry)

    return laps or None
