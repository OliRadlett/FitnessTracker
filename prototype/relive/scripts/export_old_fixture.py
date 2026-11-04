"""Export the Lake Geneva hero ride into the old Replay3D dev-harness format.

The old viewer reads `frontend/public/dev-fixtures/act{1,2}.json` (gitignored).
This keeps the comparison on the same real ride instead of the synthetic
visual fixtures.

Run from the repo root:
    python prototype/relive/scripts/export_old_fixture.py
"""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
HERO = ROOT / "data" / "hero-ride.json"
RAW = ROOT / "data" / "hero-ride.raw.json"
OUT = ROOT.parents[1] / "frontend" / "public" / "dev-fixtures"


def main() -> None:
    hero = json.loads(HERO.read_text(encoding="utf-8"))
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    streams = hero["streams"]
    weather = hero["weather"]

    fixture = {
        "id": "lake-geneva",
        "name": "Lake Geneva Loop",
        # Normalized daylight for the comparison: the real ride started in fog
        # at 09:33 local, which makes the old viewer's low sun very dark. The
        # Google 3D world is fixed daylight, so give the old viewer its best
        # lighting and note the normalization in the report.
        "start_date": "2026-10-27T12:00:00+00:00",
        "distance_meters": hero["stats"]["distanceM"],
        "encoded_polyline": raw["activity"]["polyline"],
        "streams": [
            {"stream_type": "velocity", "data": {"data": streams["v"]}},
            {"stream_type": "altitude", "data": {"data": streams["alt"]}},
            {"stream_type": "heartrate", "data": {"data": streams["hr"]}},
        ],
        "weather_conditions": "clear",
        "weather_temperature": 18,
        "weather_wind_speed_kmh": 8,
        "weather_wind_direction": "W",
        "weather_precipitation_mm": 0,
    }

    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "act1.json").write_text(json.dumps(fixture), encoding="utf-8")
    second = {**fixture, "id": "lake-geneva-b"}
    (OUT / "act2.json").write_text(json.dumps(second), encoding="utf-8")
    print(f"wrote {OUT / 'act1.json'} and act2.json")


if __name__ == "__main__":
    main()
