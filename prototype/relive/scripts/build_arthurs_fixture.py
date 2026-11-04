"""Build the Arthur's Seat fixture from the raw production export.

Reads `data/arthurs-raw.json` (metadata + streams + latlng for the main ride
and the ghost laps) and writes `data/arthurs.json` with `main` and `ghosts`.

Run from `prototype/relive`:
    python scripts/build_arthurs_fixture.py
"""

from __future__ import annotations

import json
import math
from datetime import datetime
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "arthurs-raw.json"
OUT = ROOT / "data" / "arthurs.json"

LABELS = {
    "overview": "Overview",
    "lausanne": "Start",
    "montreux": "Mid",
    "climb": "Climb",
    "summit": "Summit",
    "close": "Close",
}


def nearest_index(values: np.ndarray, target: float) -> int:
    return int(np.argmin(np.abs(values - target)))


def build_ride(payload: dict, ride_id: str, ride_name: str) -> dict:
    activity = payload["activity"]
    streams = payload["streams"]
    t = np.asarray(streams["time"], dtype=float)
    d = np.asarray(streams["distance"], dtype=float)
    ll = np.asarray(streams["latlng"], dtype=float)
    alt = np.asarray(streams["altitude"], dtype=float)
    v = np.asarray(streams["velocity_smooth"], dtype=float)
    hr = np.asarray(streams["heartrate"], dtype=float)
    watts = (
        np.asarray(streams["watts"], dtype=float) if "watts" in streams else None
    )
    cadence = (
        np.asarray(streams["cadence"], dtype=float)
        if "cadence" in streams
        else None
    )
    lat, lng = ll[:, 0], ll[:, 1]
    n = len(t)

    # Smoothed grade over ~100 m.
    order = np.argsort(d, kind="stable")
    d_s, alt_s = d[order], alt[order]
    keep = np.concatenate(([True], np.diff(d_s) > 0))
    d_u, alt_u = d_s[keep], alt_s[keep]
    grade_u = np.gradient(alt_u, d_u) * 100.0
    spacing = max(1.0, float(np.median(np.diff(d_u))))
    win = max(3, int(100 / spacing))
    if win % 2 == 0:
        win += 1
    grade_smooth_u = np.convolve(grade_u, np.ones(win) / win, mode="same")
    idx = np.searchsorted(d_u, d, side="left").clip(0, len(d_u) - 1)
    grade = grade_smooth_u[idx]

    def window_stat(target_m: float, values: np.ndarray, reducer) -> tuple[int, int, float]:
        best = (0, 0, -1e9 if reducer == np.max else 1e9)
        j = 0
        for i in range(n):
            while j < n and d[j] - d[i] < target_m:
                j += 1
            if j >= n:
                break
            val = reducer(values[i : j + 1])
            if (reducer == np.max and val > best[2]) or (
                reducer == np.min and val < best[2]
            ):
                best = (i, j, float(val))
        return best

    climb_i, climb_j, climb_grade = window_stat(500, grade, np.max)
    desc_i, desc_j, desc_grade = window_stat(500, grade, np.min)

    speed_window = np.full(n, np.nan)
    j = 0
    for i in range(n):
        while j < n and d[j] - d[i] < 1000:
            j += 1
        if j >= n:
            break
        dt = t[j] - t[i]
        if dt > 0:
            speed_window[i] = (d[j] - d[i]) / dt
    fast_i = int(np.nanargmax(speed_window))
    fast_j = int(
        np.searchsorted(d, d[fast_i] + 1000, side="left").clip(0, n - 1)
    )

    hi_i = int(np.argmax(alt))
    lo_i = int(np.argmin(alt))
    ascent = float(np.clip(np.diff(alt_u), 0, None).sum())
    descent = float(np.clip(-np.diff(alt_u), 0, None).sum())
    dt = np.diff(t)
    paused = (dt > 60) & (v[:-1] < 0.5)
    pause_total = float(dt[paused].sum())
    pause_count = int(paused.sum())

    max_d = float(d[-1])
    key_points = {
        "start": 0,
        "lausanne": nearest_index(d, max_d * 0.25),
        "montreux": nearest_index(d, max_d * 0.5),
        "climb": int(climb_i),
        "summit": int(hi_i),
        "fastest": int(fast_i),
        "close": int(climb_i),
        "end": n - 1,
    }

    bounds = {
        "minLat": float(lat.min()),
        "maxLat": float(lat.max()),
        "minLng": float(lng.min()),
        "maxLng": float(lng.max()),
    }

    return {
        "id": ride_id,
        "activityId": payload["activity"]["id"],
        "name": ride_name,
        "date": activity["start_date"],
        "timezone": "Europe/London",
        "poseLabels": LABELS,
        "stats": {
            "distanceM": round(max_d, 1),
            "movingS": int(activity["duration_seconds"] or 0),
            "elapsedS": round(float(t[-1] - t[0]), 1),
            "elevationGainM": float(activity["elevation_gain_meters"] or 0),
            "ascentM": round(ascent, 1),
            "descentM": round(descent, 1),
            "avgSpeedMps": float(activity["average_speed"] or 0),
            "avgHr": float(activity["average_heartrate"] or 0),
            "avgPowerW": activity["average_power"],
            "calories": activity["calories"],
            "pauseCount": pause_count,
            "pauseS": round(pause_total, 1),
        },
        "weather": {
            "temperature_c": activity["weather_temperature"],
            "conditions": activity["weather_conditions"],
            "wind_speed_kmh": activity["weather_wind_speed_kmh"],
            "wind_direction_deg": activity["weather_wind_direction_deg"],
            "precipitation_mm": activity["weather_precipitation_mm"],
        },
        "bounds": bounds,
        "streams": {
            "t": [round(float(x), 1) for x in t],
            "d": [round(float(x), 1) for x in d],
            "lat": [round(float(x), 5) for x in lat],
            "lng": [round(float(x), 5) for x in lng],
            "alt": [round(float(x), 1) for x in alt],
            "v": [round(float(x), 2) for x in v],
            "hr": [int(round(float(x))) for x in hr],
            "grade": [round(float(x), 2) for x in grade],
            **(
                {"watts": [int(round(float(x))) for x in watts]}
                if watts is not None
                else {}
            ),
            **(
                {"cadence": [int(round(float(x))) for x in cadence]}
                if cadence is not None
                else {}
            ),
        },
        "keyPoints": key_points,
        "highlights": {
            "climb": {
                "startIdx": int(climb_i),
                "endIdx": int(climb_j),
                "startD": round(float(d[climb_i]), 1),
                "endD": round(float(d[climb_j]), 1),
                "gainM": round(float(alt[climb_j] - alt[climb_i]), 1),
                "gradePct": round(float(climb_grade), 2),
                "place": "Arthur's Seat",
            },
            "descent": {
                "startIdx": int(desc_i),
                "endIdx": int(desc_j),
                "startD": round(float(d[desc_i]), 1),
                "endD": round(float(d[desc_j]), 1),
                "dropM": round(float(alt[desc_i] - alt[desc_j]), 1),
                "gradePct": round(float(desc_grade), 2),
                "place": "Arthur's Seat",
            },
            "fastestKm": {
                "startIdx": int(fast_i),
                "endIdx": int(fast_j),
                "startD": round(float(d[fast_i]), 1),
                "speedKmh": round(float(speed_window[fast_i]) * 3.6, 1),
                "place": "Edinburgh",
            },
            "highest": {
                "idx": int(hi_i),
                "altM": round(float(alt[hi_i]), 1),
                "place": "Arthur's Seat",
            },
            "lowest": {
                "idx": int(lo_i),
                "altM": round(float(alt[lo_i]), 1),
                "place": "Edinburgh",
            },
        },
    }


def main() -> None:
    raw = json.loads(RAW.read_text(encoding="utf-8"))
    fixture = {
        "main": build_ride(raw["main"], "arthurs-main", "Arthur's Seat Lap"),
        "ghosts": [],
    }
    for payload in raw["ghosts"]:
        date = datetime.fromisoformat(payload["activity"]["start_date"])
        short = f"{date.day} {date.strftime('%b')}"
        fixture["ghosts"].append(
            build_ride(
                payload,
                f"arthurs-ghost-{date.date().isoformat()}",
                f"Arthur's Seat · {short}",
            )
        )
    OUT.write_text(json.dumps(fixture, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB)")
    print(
        "main",
        fixture["main"]["date"],
        fixture["main"]["stats"]["distanceM"],
        fixture["main"]["stats"]["movingS"],
        "climb",
        fixture["main"]["highlights"]["climb"]["gradePct"],
    )
    for ghost in fixture["ghosts"]:
        print(
            ghost["id"],
            ghost["date"],
            ghost["stats"]["distanceM"],
            ghost["stats"]["movingS"],
        )


if __name__ == "__main__":
    main()
