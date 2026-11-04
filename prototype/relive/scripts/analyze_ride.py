"""Analyze the Lake Geneva hero ride and render a route overview.

Reads the raw production export + the high-resolution latlng stream, computes
the profile stats we need for the prototype (bounds, ascent, steepest 1 km,
fastest 1 km, pauses), and writes a route PNG for the reference board.

Run from the repo root:
    python prototype/relive/scripts/analyze_ride.py
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
RAW = ROOT / "data" / "hero-ride.raw.json"
LATLNG = ROOT / "data" / "hero-ride-latlng.json"
OUT = ROOT / "reference" / "route-overview.png"
FIXTURE = ROOT / "data" / "hero-ride.json"

# Lakeside towns for offline nearest-place labels.
TOWNS = [
    ("Geneva", 46.2044, 6.1432),
    ("Nyon", 46.3833, 6.2397),
    ("Rolle", 46.4583, 6.3333),
    ("Morges", 46.5117, 6.4986),
    ("Lausanne", 46.5197, 6.6323),
    ("Vevey", 46.4628, 6.8417),
    ("Montreux", 46.4312, 6.9107),
    ("Villeneuve", 46.3983, 6.9265),
    ("Evian", 46.4000, 6.5833),
    ("Thonon", 46.3700, 6.4800),
    ("Yvoire", 46.3700, 6.3260),
    ("Hermance", 46.3000, 6.2500),
    ("Coppet", 46.3167, 6.1833),
]


def haversine_m(lat1, lng1, lat2, lng2):
    r = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def nearest_town(lat: float, lng: float) -> str:
    best = min(TOWNS, key=lambda t: haversine_m(lat, lng, t[1], t[2]))
    return best[0]


def main() -> None:
    raw = json.loads(RAW.read_text())
    streams = json.loads(LATLNG.read_text())

    t = np.asarray(streams["time"], dtype=float)
    d = np.asarray(streams["distance"], dtype=float)
    ll = np.asarray(streams["latlng"], dtype=float)
    alt = np.asarray(streams["altitude"], dtype=float)
    v = np.asarray(streams["velocity_smooth"], dtype=float)
    hr = np.asarray(streams["heartrate"], dtype=float)

    lat, lng = ll[:, 0], ll[:, 1]
    n = len(t)

    # Smoothed grade over ~200 m. np.gradient needs strictly increasing x.
    order = np.argsort(d, kind="stable")
    d_s, alt_s = d[order], alt[order]
    keep = np.concatenate(([True], np.diff(d_s) > 0))
    d_u, alt_u = d_s[keep], alt_s[keep]
    grade_u = np.gradient(alt_u, d_u) * 100.0
    # Moving average in sample space; ~200 m at ~17 m spacing.
    win = max(3, int(200 / max(1.0, np.median(np.diff(d_u)))))
    if win % 2 == 0:
        win += 1
    kernel = np.ones(win) / win
    grade_smooth_u = np.convolve(grade_u, kernel, mode="same")

    # Back to original sample order (nearest unique-distance sample).
    idx = np.searchsorted(d_u, d, side="left").clip(0, len(d_u) - 1)
    grade = grade_smooth_u[idx]

    # Steepest / fastest 1 km windows.
    def window_stat(target_m: float, values: np.ndarray, reducer) -> tuple[int, int, float]:
        best = (0, 0, -1e9 if reducer == np.max else 1e9)
        j = 0
        for i in range(n):
            while j < n and d[j] - d[i] < target_m:
                j += 1
            if j >= n:
                break
            val = reducer(values[i : j + 1])
            if (reducer == np.max and val > best[2]) or (reducer == np.min and val < best[2]):
                best = (i, j, float(val))
        return best

    climb_i, climb_j, climb_grade = window_stat(1000, grade, np.max)
    desc_i, desc_j, desc_grade = window_stat(1000, grade, np.min)

    # Fastest 1 km: max (distance / elapsed time) over a 1 km window.
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
    fast_j = int(np.searchsorted(d, d[fast_i] + 1000, side="left").clip(0, n - 1))

    hi_i = int(np.argmax(alt))
    lo_i = int(np.argmin(alt))

    # Total ascent from the smoothed profile.
    ascent = float(np.clip(np.diff(alt_u), 0, None).sum())
    descent = float(np.clip(-np.diff(alt_u), 0, None).sum())

    # Pauses: elapsed time gaps with near-zero speed.
    dt = np.diff(t)
    paused = (dt > 60) & (v[:-1] < 0.5)
    pause_total = float(dt[paused].sum())
    pause_count = int(paused.sum())

    bounds = {
        "minLat": float(lat.min()),
        "maxLat": float(lat.max()),
        "minLng": float(lng.min()),
        "maxLng": float(lng.max()),
    }

    print(f"activity: {raw['activity']['name']}  {raw['activity']['start_date']}")
    print(f"samples: {n}  distance: {d[-1]:.0f} m  elapsed: {t[-1]:.0f} s  moving: {raw['activity']['duration_seconds']} s")
    print(f"bounds: {bounds}")
    print(f"altitude: {alt.min():.1f} .. {alt.max():.1f} m  ascent: {ascent:.0f} m  descent: {descent:.0f} m")
    print(f"steepest 1 km: {climb_grade:.2f}%  at {d[climb_i]/1000:.1f} km  ({nearest_town(lat[climb_i], lng[climb_i])})")
    print(f"steepest descent 1 km: {desc_grade:.2f}%  at {d[desc_i]/1000:.1f} km  ({nearest_town(lat[desc_i], lng[desc_i])})")
    print(f"fastest 1 km: {speed_window[fast_i]*3.6:.1f} km/h at {d[fast_i]/1000:.1f} km  ({nearest_town(lat[fast_i], lng[fast_i])})")
    print(f"highest: {alt[hi_i]:.1f} m at {d[hi_i]/1000:.1f} km  ({nearest_town(lat[hi_i], lng[hi_i])})")
    print(f"lowest: {alt[lo_i]:.1f} m at {d[lo_i]/1000:.1f} km  ({nearest_town(lat[lo_i], lng[lo_i])})")
    print(f"pauses: {pause_count}  total pause time: {pause_total/60:.0f} min")
    print(f"start: {nearest_town(lat[0], lng[0])}  end: {nearest_town(lat[-1], lng[-1])}")

    # Key points for the six camera poses.
    def nearest_index(target_lat: float, target_lng: float) -> int:
        return int(
            np.argmin(
                (lat - target_lat) ** 2
                + ((lng - target_lng) * math.cos(math.radians(target_lat))) ** 2
            )
        )

    key_points = {
        "start": 0,
        "lausanne": nearest_index(46.5197, 6.6323),
        "montreux": nearest_index(46.4312, 6.9107),
        "evian": nearest_index(46.4000, 6.5833),
        "climb": int(climb_i),
        "summit": int(hi_i),
        "fastest": int(fast_i),
        "end": n - 1,
    }

    fixture = {
        "id": raw["activity"]["id"],
        "name": "Lake Geneva Loop",
        "date": raw["activity"]["start_date"],
        "timezone": raw["activity"]["timezone"],
        "stats": {
            "distanceM": float(d[-1]),
            "movingS": int(raw["activity"]["duration_seconds"]),
            "elapsedS": float(t[-1]),
            "elevationGainM": float(raw["activity"]["elevation_gain_meters"]),
            "ascentM": round(ascent, 1),
            "descentM": round(descent, 1),
            "avgSpeedMps": float(raw["activity"]["average_speed"]),
            "avgHr": float(raw["activity"]["average_heartrate"]),
            "avgPowerW": raw["activity"]["average_power"],
            "calories": raw["activity"]["calories"],
            "pauseCount": pause_count,
            "pauseS": round(pause_total, 1),
        },
        "weather": raw["activity"]["weather"],
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
                "place": nearest_town(lat[climb_i], lng[climb_i]),
            },
            "descent": {
                "startIdx": int(desc_i),
                "endIdx": int(desc_j),
                "startD": round(float(d[desc_i]), 1),
                "endD": round(float(d[desc_j]), 1),
                "dropM": round(float(alt[desc_i] - alt[desc_j]), 1),
                "gradePct": round(float(desc_grade), 2),
                "place": nearest_town(lat[desc_i], lng[desc_i]),
            },
            "fastestKm": {
                "startIdx": int(fast_i),
                "endIdx": int(fast_j),
                "startD": round(float(d[fast_i]), 1),
                "speedKmh": round(float(speed_window[fast_i]) * 3.6, 1),
                "place": nearest_town(lat[fast_i], lng[fast_i]),
            },
            "highest": {
                "idx": int(hi_i),
                "altM": round(float(alt[hi_i]), 1),
                "place": nearest_town(lat[hi_i], lng[hi_i]),
            },
            "lowest": {
                "idx": int(lo_i),
                "altM": round(float(alt[lo_i]), 1),
                "place": nearest_town(lat[lo_i], lng[lo_i]),
            },
        },
    }
    FIXTURE.write_text(json.dumps(fixture, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {FIXTURE} ({FIXTURE.stat().st_size / 1e6:.2f} MB)")

    # Route overview PNG.
    w, h = 1200, 900
    margin = 50
    lat_mid = math.radians((bounds["minLat"] + bounds["maxLat"]) / 2)
    span_lat = bounds["maxLat"] - bounds["minLat"]
    span_lng = (bounds["maxLng"] - bounds["minLng"]) * math.cos(lat_mid)
    scale = min((w - 2 * margin) / span_lng, (h - 2 * margin) / span_lat)
    ox = (w - span_lng * scale) / 2
    oy = (h - span_lat * scale) / 2

    def xy(la, ln):
        x = ox + (ln - bounds["minLng"]) * math.cos(lat_mid) * scale
        y = oy + (bounds["maxLat"] - la) * scale
        return x, y

    img = Image.new("RGB", (w, h), "#0b1220")
    draw = ImageDraw.Draw(img)
    # Graticule every 0.1 degrees.
    for la in np.arange(math.floor(bounds["minLat"] * 10) / 10, bounds["maxLat"] + 0.1, 0.1):
        y = xy(la, bounds["minLng"])[1]
        draw.line([(margin, y), (w - margin, y)], fill="#16243a", width=1)
        draw.text((8, y - 6), f"{la:.1f}", fill="#51637d")
    for ln in np.arange(math.floor(bounds["minLng"] * 10) / 10, bounds["maxLng"] + 0.1, 0.1):
        x = xy(bounds["minLat"], ln)[0]
        draw.line([(x, margin), (x, h - margin)], fill="#16243a", width=1)
        draw.text((x - 12, h - 30), f"{ln:.1f}", fill="#51637d")

    # Route, colored by grade.
    for i in range(n - 1):
        g = grade[i]
        if g > 2:
            color = "#ff6b4a"
        elif g < -2:
            color = "#4aa8ff"
        else:
            color = "#d7e3f4"
        draw.line([xy(lat[i], lng[i]), xy(lat[i + 1], lng[i + 1])], fill=color, width=3)

    def marker(i, color, label):
        x, y = xy(lat[i], lng[i])
        draw.ellipse([x - 7, y - 7, x + 7, y + 7], fill=color, outline="#0b1220", width=2)
        draw.text((x + 10, y - 8), label, fill=color)

    marker(0, "#3ddc84", "start")
    marker(n - 1, "#ff4d6d", "end")
    marker(hi_i, "#ffb020", f"high {alt[hi_i]:.0f} m")
    marker(climb_i, "#b388ff", f"steepest {climb_grade:.1f}%")

    # Town labels.
    for name, tla, tln in TOWNS:
        if bounds["minLat"] <= tla <= bounds["maxLat"] and bounds["minLng"] <= tln <= bounds["maxLng"]:
            x, y = xy(tla, tln)
            draw.text((x + 6, y + 4), name, fill="#7f93ad")

    draw.text((margin, 20), "Lake Geneva loop — 2026-10-27 — 174.8 km", fill="#d7e3f4")
    draw.text((margin, 38), "orange >2% grade, blue <-2%, white flat", fill="#7f93ad")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    img.save(OUT)
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
