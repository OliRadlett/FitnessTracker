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


# ── Learned detector (ONNX) ──────────────────────────────────────────────────
# Class order must match scripts/bar_labels.LABELS.
ONNX_LABELS = ("barbell", "plate", "person")
_ONNX_SESSION = None


def _load_onnx(model_path: str):
    global _ONNX_SESSION
    if _ONNX_SESSION is None:
        import onnxruntime as ort

        _ONNX_SESSION = ort.InferenceSession(
            model_path, providers=["CPUExecutionProvider"]
        )
    return _ONNX_SESSION


def detect_bars_onnx(image_bgr, model_path: str, input_size: int = 640,
                     conf: float = 0.35) -> list:
    """Run the trained YOLO detector (exported with ``nms=True``).

    Returns ``[{"label","x","y","w","h","confidence"}]`` in normalised coords.
    """
    import cv2
    import numpy as np

    session = _load_onnx(model_path)
    # Use the model's own input size (exports differ: 640, 512, …).
    shape = session.get_inputs()[0].shape
    if len(shape) == 4 and isinstance(shape[2], int) and shape[2] > 0:
        input_size = int(shape[2])
    h0, w0 = image_bgr.shape[:2]
    scale = min(input_size / w0, input_size / h0)
    nw, nh = int(round(w0 * scale)), int(round(h0 * scale))
    canvas = np.full((input_size, input_size, 3), 114, np.uint8)
    pad_x, pad_y = (input_size - nw) // 2, (input_size - nh) // 2
    canvas[pad_y:pad_y + nh, pad_x:pad_x + nw] = cv2.resize(image_bgr, (nw, nh))

    blob = canvas[:, :, ::-1].astype(np.float32) / 255.0  # BGR -> RGB
    blob = np.transpose(blob, (2, 0, 1))[None]
    out = session.run(None, {session.get_inputs()[0].name: blob})[0]
    dets = out[0] if out.ndim == 3 else out

    boxes = []
    for det in dets:
        if len(det) < 6:
            continue
        x1, y1, x2, y2, score, cls = (float(v) for v in det[:6])
        if score < conf:
            continue
        ci = int(cls)
        if not (0 <= ci < len(ONNX_LABELS)):
            continue
        x1 = (x1 - pad_x) / scale
        x2 = (x2 - pad_x) / scale
        y1 = (y1 - pad_y) / scale
        y2 = (y2 - pad_y) / scale
        boxes.append({
            "label": ONNX_LABELS[ci],
            "x": round(((x1 + x2) / 2) / w0, 4),
            "y": round(((y1 + y2) / 2) / h0, 4),
            "w": round(abs(x2 - x1) / w0, 4),
            "h": round(abs(y2 - y1) / h0, 4),
            "confidence": round(score, 3),
        })
    return boxes


def bar_track_from_frames_onnx(frame_paths: list, model_path: str,
                               conf: float = 0.35) -> list:
    """Bar track from the learned detector: per frame, the highest-confidence
    plate/barbell box centre, or ``None``."""
    import cv2

    track: list = []
    for path in frame_paths:
        img = cv2.imread(str(path))
        if img is None:
            track.append(None)
            continue
        dets = detect_bars_onnx(img, model_path, conf=conf)
        candidates = [d for d in dets if d["label"] in ("plate", "barbell")]
        if candidates:
            best = max(candidates, key=lambda d: d["confidence"])
            track.append({"x": best["x"], "y": best["y"],
                          "confidence": best["confidence"], "source": "detector"})
        else:
            track.append(None)
    return track


def _fill_gaps_onnx(track: list) -> list:
    """Linearly interpolate the ONNX track across frames with no detection."""
    hit_idx = [i for i, t in enumerate(track) if t and t.get("source") == "detector"]
    if len(hit_idx) < 2:
        return track
    xs = np.array([track[i]["x"] for i in hit_idx], dtype=float)
    ys = np.array([track[i]["y"] for i in hit_idx], dtype=float)
    conf = float(np.mean([track[i]["confidence"] for i in hit_idx]))
    all_i = np.arange(len(track))
    ix = np.interp(all_i, hit_idx, xs)
    iy = np.interp(all_i, hit_idx, ys)
    for i in range(len(track)):
        if track[i] is not None and track[i].get("source") == "detector":
            continue
        track[i] = {
            "x": round(float(ix[i]), 4),
            "y": round(float(iy[i]), 4),
            "confidence": round(conf * 0.8, 3),
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
    model_path: str | None = None,
) -> list:
    """Detect the plate (bar) per frame, seeded by the previous detection.

    Seeding each frame from the **previous** detection (falling back to the
    pose proxy at the start) keeps the search locked to the moving bar instead
    of re-finding the plate globally. If the detection rate clears
    ``min_detection_rate`` the track is a **pure detector** track with gaps
    interpolated; otherwise the whole track falls back to the pose proxy so the
    two sources are never mixed (which would inject jumps).

    When ``model_path`` is given the **learned ONNX detector** is used first;
    if it fires on too few frames (<20%) the classical detector runs instead.

    Returns a list aligned to ``frame_paths`` of
    ``{"x","y","confidence","source"}`` or ``None``.
    """
    if model_path:
        onnx_track = bar_track_from_frames_onnx(frame_paths, model_path)
        rate = sum(1 for t in onnx_track if t) / max(1, len(onnx_track))
        logger.info("ONNX bar detection: %.0f%% of frames", rate * 100)
        if rate >= 0.2:
            return _fill_gaps_onnx(onnx_track)
        logger.info("ONNX detection sparse — falling back to classical detector")

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


# ── Seeded plate tracker (human-anchored bar path) ───────────────────────────


def _match_template(cv2, gray, template, prev, pad: float = 0.35):
    """Best ``template`` location in a window around ``prev`` (x1,y1,x2,y2)."""
    h, w = gray.shape[:2]
    x1, y1, x2, y2 = prev
    bw, bh = x2 - x1, y2 - y1
    mx, my = int(bw * pad) + 8, int(bh * pad) + 8
    sx1, sy1 = max(0, x1 - mx), max(0, y1 - my)
    sx2, sy2 = min(w, x2 + mx), min(h, y2 + my)
    if sx2 - sx1 < bw or sy2 - sy1 < bh:
        return None, 0.0
    res = cv2.matchTemplate(gray[sy1:sy2, sx1:sx2], template, cv2.TM_CCOEFF_NORMED)
    _mn, score, _ml, loc = cv2.minMaxLoc(res)
    nx, ny = sx1 + loc[0], sy1 + loc[1]
    return (nx, ny, nx + bw, ny + bh), float(score)


def track_plate_from_seed(
    frame_paths: list,
    seed_frame_pos: int,
    seed_box: dict,
    min_score: float = 0.45,
) -> list:
    """Template-match the plate across frames, seeded by a human ``seed_box``.

    Used when a user marks the plate on one frame ("set bar position"): the
    plate is a high-contrast, smoothly-moving object, so template matching
    yields a **real bar path** with no trained model. Tracks forwards then
    backwards from the seed.

    Returns a per-frame ``{"x","y","confidence","source":"tracker"}`` (plate
    centre) or ``None``, aligned to ``frame_paths``.
    """
    import cv2

    n = len(frame_paths)
    if not (0 <= seed_frame_pos < n):
        return [None] * n
    img0 = cv2.imread(str(frame_paths[seed_frame_pos]), cv2.IMREAD_GRAYSCALE)
    if img0 is None:
        return [None] * n
    h, w = img0.shape[:2]
    x1 = int((seed_box["x"] - seed_box["w"] / 2) * w)
    x2 = int((seed_box["x"] + seed_box["w"] / 2) * w)
    y1 = int((seed_box["y"] - seed_box["h"] / 2) * h)
    y2 = int((seed_box["y"] + seed_box["h"] / 2) * h)
    if x2 - x1 < 4 or y2 - y1 < 4:
        return [None] * n
    template = img0[y1:y2, x1:x2].copy()

    out: list = [None] * n

    def _store(i: int, xyxy, score: float) -> None:
        bx1, by1, bx2, by2 = xyxy
        out[i] = {
            "x": round(((bx1 + bx2) / 2) / w, 4),
            "y": round(((by1 + by2) / 2) / h, 4),
            "confidence": round(score, 3),
            "source": "tracker",
        }

    _store(seed_frame_pos, (x1, y1, x2, y2), 1.0)
    for direction in (1, -1):
        prev = (x1, y1, x2, y2)
        i = seed_frame_pos + direction
        while 0 <= i < n:
            gray = cv2.imread(str(frame_paths[i]), cv2.IMREAD_GRAYSCALE)
            if gray is None:
                break
            nxt, score = _match_template(cv2, gray, template, prev)
            if nxt is None or score < min_score:
                break
            _store(i, nxt, score)
            prev = nxt
            i += direction
    return out
