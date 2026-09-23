"""Pose-seeded barbell plate detection (§3.18 / T3 v1).

The pose proxy (shoulder/wrist midpoint) can't see the real bar. Plates are
large, roughly circular, high-contrast objects, so a Hough-circle search
**seeded near the pose bar point** finds the plate centre (= the bar) far more
reliably than a global search. Candidates are scored by edge support, interior
darkness (plates are darker than the wall/floor) and proximity to the seed;
weak detections fall back to the pose proxy (never silently mixed).

Detector-agnostic contract: produces the same bar-track shape as
``bar_tracking.bar_track_from_landmarks`` with ``source="detector"``.

Pure OpenCV + NumPy — no MediaPipe import.
"""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

logger = logging.getLogger(__name__)

# Plate radius as a fraction of frame width (a 20 kg plate ≈ 0.45 m).
_MIN_R_FRAC = 0.06
_MAX_R_FRAC = 0.22
# Search window (fraction of the frame) around the pose seed.
_SEARCH_FRAC = 0.30
_MIN_CONFIDENCE = 0.45


def _edge_support(gray: np.ndarray, cx: float, cy: float, r: float, n: int = 72) -> float:
    """Fraction of the circle's perimeter that lies on a strong gradient."""
    import cv2

    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    angles = np.linspace(0, 2 * np.pi, n, endpoint=False)
    xs = np.clip((cx + r * np.cos(angles)).astype(int), 0, gray.shape[1] - 1)
    ys = np.clip((cy + r * np.sin(angles)).astype(int), 0, gray.shape[0] - 1)
    vals = mag[ys, xs]
    if vals.size == 0:
        return 0.0
    mx = float(vals.max())
    if mx < 1e-6:
        return 0.0
    # Fraction of the perimeter on a strong edge (relative to the strongest
    # point on that circle) — a real plate rim is almost entirely strong.
    return float((vals > 0.4 * mx).mean())


def _interior_darkness(gray: np.ndarray, cx: float, cy: float, r: float) -> float:
    """Plates are darker than their surroundings: (outside - inside) / 255."""
    h, w = gray.shape[:2]
    yy, xx = np.ogrid[:h, :w]
    dist2 = (xx - cx) ** 2 + (yy - cy) ** 2
    inside = gray[dist2 <= (0.75 * r) ** 2]
    ring = gray[(dist2 >= (1.2 * r) ** 2) & (dist2 <= (1.7 * r) ** 2)]
    if inside.size == 0 or ring.size == 0:
        return 0.0
    return float(max(0.0, (ring.mean() - inside.mean()) / 255.0))


def detect_bar_circle(
    gray: np.ndarray,
    seed_xy: tuple[float, float],
    min_r_frac: float = _MIN_R_FRAC,
    max_r_frac: float = _MAX_R_FRAC,
    search_frac: float = _SEARCH_FRAC,
) -> dict | None:
    """Find the plate circle nearest ``seed_xy`` (normalised frame coords).

    Returns ``{"x", "y", "r", "confidence"}`` in normalised coords, or ``None``
    when nothing convincing is found.
    """
    import cv2

    h, w = gray.shape[:2]
    sx, sy = int(seed_xy[0] * w), int(seed_xy[1] * h)
    half_x, half_y = int(search_frac * w), int(search_frac * h)
    x0, x1 = max(0, sx - half_x), min(w, sx + half_x)
    y0, y1 = max(0, sy - half_y), min(h, sy + half_y)
    if x1 - x0 < 40 or y1 - y0 < 40:
        return None
    crop = gray[y0:y1, x0:x1]
    min_r = max(8, int(min_r_frac * w))
    max_r = int(max_r_frac * w)
    if max_r <= min_r:
        return None

    blur = cv2.medianBlur(crop, 7)
    circles = cv2.HoughCircles(
        blur,
        cv2.HOUGH_GRADIENT,
        dp=1.2,
        minDist=max(min_r, 40),
        param1=120,
        param2=40,
        minRadius=min_r,
        maxRadius=max_r,
    )
    if circles is None:
        return None

    best = None
    best_score = 0.0
    diag = float(np.hypot(w, h))
    for cx_c, cy_c, r in circles[0][:8]:
        cx, cy = float(cx_c + x0), float(cy_c + y0)
        edge = _edge_support(gray, cx, cy, r)
        dark = _interior_darkness(gray, cx, cy, r)
        prox = 1.0 - min(1.0, float(np.hypot(cx - sx, cy - sy)) / (0.25 * diag))
        # Darkness + edge dominate: the loaded plate is the darkest large
        # circle (a mid-tone background plate near the body must not win), so
        # proximity is only a tie-breaker.
        score = 0.45 * edge + 0.35 * min(1.0, dark * 2.0) + 0.20 * prox
        if score > best_score:
            best_score = score
            best = {"x": cx / w, "y": cy / h, "r": r / w, "confidence": round(score, 3)}
    if best is None or best["confidence"] < _MIN_CONFIDENCE:
        return None
    best["source"] = "detector"
    return best


def _interpolate_gaps(track: list) -> list:
    """Linearly interpolate detector hits across frames with no detection."""
    idx = [i for i, t in enumerate(track) if t and t.get("source") == "detector"]
    if len(idx) < 2:
        return track
    xs = np.array([track[i]["x"] for i in idx], dtype=float)
    ys = np.array([track[i]["y"] for i in idx], dtype=float)
    all_i = np.arange(len(track))
    interp_x = np.interp(all_i, idx, xs)
    interp_y = np.interp(all_i, idx, ys)
    conf = float(np.mean([track[i]["confidence"] for i in idx]))
    for i in range(len(track)):
        if track[i] is None:
            continue
        if track[i].get("source") != "detector":
            track[i] = {
                "x": round(float(interp_x[i]), 4),
                "y": round(float(interp_y[i]), 4),
                "confidence": round(conf * 0.8, 3),  # interpolated: slightly less sure
                "source": "detector",
                "interpolated": True,
            }
    return track


def bar_track_from_frame_paths(
    frame_paths: list,
    landmarks: list,
    exercise: str = "",
    proxy_point=None,
    min_detection_rate: float = 0.6,
) -> list:
    """Detect the plate (bar) per frame, seeded by the previous detection.

    Seeding each frame from the **previous** detection (falling back to the
    pose proxy at the start) keeps the search locked to the moving bar instead
    of re-finding the plate globally. If the detection rate clears
    ``min_detection_rate`` the track is a **pure detector** track with gaps
    interpolated; otherwise the whole track falls back to the pose proxy so the
    two sources are never mixed (which would inject jumps).

    Returns a list aligned to ``frame_paths`` of
    ``{"x","y","confidence","source"}`` or ``None``.
    """
    import cv2

    from app.integrations.bar_tracking import _proxy_point

    def proxy_of(lm):
        return proxy_point(lm) if proxy_point else _proxy_point(lm, exercise)

    hits: list = []
    seed: tuple[float, float] | None = None
    n_detected = 0
    for i, path in enumerate(frame_paths):
        lm = landmarks[i] if i < len(landmarks) else None
        if lm is None:
            hits.append(None)
            continue
        px, py = proxy_of(lm)
        img = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        hit = detect_bar_circle(img, seed or (px, py)) if img is not None else None
        # Sanity: reject a detection that jumped far from the pose proxy
        # (locks onto the rack/floor otherwise).
        if hit is not None and np.hypot(hit["x"] - px, hit["y"] - py) > 0.35:
            hit = None
        # Temporal gate: the bar moves smoothly, so a detection that jumps far
        # from the previous one is a false positive (e.g. the rack upright).
        if hit is not None and seed is not None and np.hypot(
            hit["x"] - seed[0], hit["y"] - seed[1]
        ) > 0.07:
            hit = None
        if hit is not None:
            seed = (hit["x"], hit["y"])
            n_detected += 1
            hits.append(hit)
        else:
            hits.append({"x": float(px), "y": float(py), "confidence": 0.5,
                         "source": "pose_proxy"})

    rate = n_detected / max(1, len(hits))
    logger.info("Bar detection: %d/%d frames (%.0f%%)", n_detected, len(hits), rate * 100)

    if rate < min_detection_rate:
        # Not confident enough — use the pose proxy for the whole track.
        return hits
    return _interpolate_gaps(hits)
