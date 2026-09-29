"""Metric 3D bar tracking — view-independent bar metrics in real units.

`plans/bar-tracking-3d.md` (steps 1-3). The 2D bar-path metrics in
`bar_tracking.py` are image-space, so their horizontal numbers only mean
something in a sagittal view: in a 3/4 view (≈71% of clips) the bar's
front-back travel projects onto image-x, and the image midpoint is
perspective-biased. Here the bar is lifted to **metric 3D** first, so
bar-over-midfoot / net lateral / bar height become millimetre and metre
numbers that do not care which way the camera pointed.

Why this can work at all (verified 2026-09-27, real 3/4 squat clip):

- MediaPipe's *world* landmarks are metric, hip-centred and **camera-axis
  aligned** — fitting image→world over the body gave an x/y pixels-per-metre
  ratio of 1.70 on a 1920x1080 frame (i.e. one isotropic scale, matching the
  image aspect) and correlations of 0.97 (x) / 0.99 (y). So the mapping is a
  weak-perspective camera: a single scale plus a translation, no rotation.
- The bar's **depth** is not observable in 2D at all, so it is anchored to the
  body: the joint the bar is actually at (shoulders for a squat, wrists
  otherwise). Anchoring at the hips instead was measurably worse.
- The **absolute scale** needs two inputs the pose cannot supply, and this
  module refuses to guess them:
  - the lifter's **height** — MediaPipe's world landmarks use an average-body
    prior, so head→heel read 0.87 m on a real ~1.5 m lifter (≈2x small);
  - the clip's **focal length** — the body is far too shallow to identify it
    (fitting a camera to the pose returns a confident but bogus ~18° FOV).
  `services/video_camera.py` derives the focal per clip from the container
  metadata. Without both, `fit_clip_camera` returns ``None`` and the caller
  keeps the 2D metrics.

The bar's position comes from the *detector*'s bar centre (``bar_x``/
``bar_y``, see `bar_detection.bar_track_from_frame_paths``), never the pose
proxy: a pose proxy cannot be lifted to metres, and a single ``plate`` box is
the bar's *end* — in 3D that offset is ~0.6 m, not a fraction of the image.

There is no 3D ground truth yet, so these are labelled ``metric_3d`` and
carry their calibration for inspection. Pure NumPy — unit-testable without
the video stack.
"""

from __future__ import annotations

import logging

import numpy as np

logger = logging.getLogger(__name__)

# MediaPipe pose landmark indices.
_HEAD = 0
_HEEL = (29, 30)
_FOOT_INDEX = (31, 32)
_WRIST = (15, 16)
_SHOULDER = (11, 12)
_HIP = (23, 24)
# Origin for the pixels-per-metre fit: the hip midpoint, i.e. the same point
# MediaPipe centres the world landmarks on.
_ORIGIN = (_HIP[0] + _HIP[1]) // 2

_SQUAT_FAMILY = ("Squat", "Front Squat", "Back Squat")

# Detector bases whose point really is the bar's *centre*. A lone ``plate`` box
# is the bar's end, which is harmless for a per-clip median offset but metres
# wrong once lifted into 3D.
_CENTRE_BASES = ("plate_pair", "barbell")

# A frame is only lifted when its own pixels-per-metre agrees with the clip
# median to within this fraction. A wild one means the pose went bad that
# frame, and every 3D number derived from it would be wrong.
_SCALE_TOLERANCE = 0.30
# Per-frame offsets further than this from the midfoot are dropped outright.
_MAX_OFFSET_M = 1.5
# Robust outlier cut inside a rep, in median-absolute-deviations. The floor
# stops a perfectly steady (zero-MAD) series from being cut to nothing by
# floating-point noise.
_MAD_LIMIT = 4.0
_MAD_FLOOR_MM = 15.0
# Head→heel proxy for standing height, per frame, plausible range.
_MIN_HEAD_HEEL_M = 0.4
_MAX_HEAD_HEEL_M = 2.2
# Percentiles for a rep's top/bottom bar height (max/min are single-frame
# noise; the 10/90 band is the lockout / depth the lifter actually held).
_TOP_PCT = 90.0
_BOTTOM_PCT = 10.0
# Net lateral compares the first/last quarters of a rep: the exact endpoints
# are the noisiest samples in the window.
_END_QUANTILE = 0.25

_MIN_CAMERA_FRAMES = 5
_MIN_REP_POINTS = 4
_MIN_3D_REPS = 2
# A standard men's Olympic barbell is 2.20 m long (women's 2.01 m — passed as
# ``bar_length_m`` where the exercise context makes it the better assumption).
# The bar is the one known-size object already in frame, so its projected
# length is the fallback focal reference when the container carries no lens
# tags (which, measured 2026-09-29, is all 33 fixture clips).
_BAR_LENGTH_M = 2.20
# The solver's depth leverage is the bar's offset from the body plane: a bar
# *in* the plane carries no depth information at all, and near it the
# noise amplification (~Z/offset) explodes. Frames inside this are skipped.
_MIN_DEPTH_OFFSET_M = 0.10
# The bar must read as a bar: much longer across than tall. An end-on (or
# steeply foreshortened) bar images ~square, and its "length" says nothing
# about the focal — those frames are skipped, not corrected.
_MIN_BAR_ASPECT = 4.0
# Clip-level gates for the focal estimate: enough independent frames, a tight
# enough consensus, and a physically plausible phone lens.
_MIN_FOCAL_FRAMES = 10
_FOCAL_SPREAD_LIMIT = 0.25
_FOCAL_RANGE_PX = (300.0, 3000.0)
_FOCAL_MAD_FLOOR_PX = 40.0
# Slack when matching a rep window against frame timestamps. Both series come
# from the same ``frame_times`` list, so this only absorbs float round-trips.
_TIME_EPS = 1e-6


def _mid(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    return (a + b) / 2.0


def _unit(v: np.ndarray) -> np.ndarray:
    n = float(np.linalg.norm(v))
    return v / n if n > 1e-9 else v


def _xy(landmarks) -> np.ndarray:
    return np.array([[p.x, p.y] for p in landmarks], dtype=float)


def _xyz(world) -> np.ndarray:
    return np.array([[p.x, p.y, p.z] for p in world], dtype=float)


def _px_per_m(uv: np.ndarray, xyz: np.ndarray, origin: int) -> float:
    """Least-squares pixels-per-metre of the image against the metric body.

    A weak-perspective fit about a common origin: with the world axes
    camera-aligned, one isotropic scale describes the whole body, and the
    least-squares form is far steadier than any single landmark pair.
    """
    d_img = np.linalg.norm(uv - uv[origin], axis=1)
    d_world = np.linalg.norm(xyz - xyz[origin], axis=1)
    denom = float(d_world @ d_world)
    return float((d_img @ d_world) / denom) if denom > 1e-9 else 0.0


def body_height_scale(world, lifter_height_m: float | None) -> float:
    """Scale factor correcting MediaPipe's average-body prior.

    One robust factor per clip: a per-frame estimate is wrecked by a single
    bad pose. Head→heel stands in for height (the same proxy the prototype was
    validated with). Returns ``1.0`` when the height is unknown — callers must
    treat that as "uncalibrated", not as "already metric".
    """
    if not lifter_height_m or lifter_height_m <= 0:
        return 1.0
    ests: list[float] = []
    for wl in world:
        if wl is None:
            continue
        xyz = _xyz(wl)
        est = float(np.linalg.norm(xyz[_HEAD] - _mid(xyz[_HEEL[0]], xyz[_HEEL[1]])))
        if _MIN_HEAD_HEEL_M < est < _MAX_HEAD_HEEL_M:
            ests.append(est)
    if not ests:
        return 1.0
    measured = float(np.median(ests))
    return float(lifter_height_m) / measured if measured > 1e-6 else 1.0


def fit_clip_scale(
    landmarks: list,
    world: list,
    width: float | None,
    height: float | None,
    lifter_height_m: float | None,
) -> dict | None:
    """Focal-free part of the camera fit: pixels-per-metre from the body.

    The weak-perspective scale (``px_per_m``) is identified by the pose alone —
    only the *absolute* depth (``subject_distance_m``) needs the focal. The
    barbell-length fallback (``estimate_focal_from_bar``) consumes this scale,
    so it lives on its own rather than behind the focal gate in
    :func:`fit_clip_camera`.
    """
    if not lifter_height_m or float(lifter_height_m) <= 0:
        return None
    if not width or not height or float(width) <= 0 or float(height) <= 0:
        return None

    hscale = body_height_scale(world, float(lifter_height_m))
    px_scale = np.array([float(width), float(height)], dtype=float)

    scales: list[float] = []
    for i, lm in enumerate(landmarks):
        wl = world[i] if i < len(world) else None
        if lm is None or wl is None:
            continue
        s = _px_per_m(_xy(lm) * px_scale, _xyz(wl) * hscale, _ORIGIN)
        if s > 1.0:
            scales.append(s)
    if len(scales) < _MIN_CAMERA_FRAMES:
        logger.info(
            "Metric 3D bar path: only %d usable frames to fit the camera",
            len(scales),
        )
        return None

    arr = np.asarray(scales, dtype=float)
    px_per_m = float(np.median(arr))
    if px_per_m <= 1.0:
        return None
    p10, p90 = (float(v) for v in np.percentile(arr, [10, 90]))
    return {
        "height_scale": round(hscale, 4),
        "px_per_m": round(px_per_m, 1),
        "scale_spread": round((p90 - p10) / px_per_m, 3),
        "n_frames": len(scales),
    }


def fit_clip_camera(
    landmarks: list,
    world: list,
    focal_px: float | None,
    width: float | None,
    height: float | None,
    lifter_height_m: float | None,
) -> dict | None:
    """Fit the per-clip weak-perspective camera (step 1).

    ``landmarks``/``world`` are index-aligned lists of per-frame landmarks
    (``None`` where the pose is missing). Returns ``None`` unless **both**
    calibration inputs are present — see the module docstring — or the frame
    geometry is unusable.

    The returned dict doubles as the *diagnostic* for every metric the module
    emits: it is copied into the result so a suspicious number can be traced
    back to the scale that produced it.
    """
    if not focal_px or float(focal_px) <= 0:
        logger.info("Metric 3D bar path: no clip focal — staying in 2D")
        return None
    if not lifter_height_m or float(lifter_height_m) <= 0:
        logger.info(
            "Metric 3D bar path: no lifter height (MediaPipe's world scale is "
            "an average-body prior) — staying in 2D"
        )
        return None
    if not width or not height or float(width) <= 0 or float(height) <= 0:
        return None

    scale = fit_clip_scale(landmarks, world, width, height, lifter_height_m)
    if scale is None:
        return None

    f = float(focal_px)
    px_per_m = float(scale["px_per_m"])
    return {
        "focal_px": round(f, 1),
        "width": int(width),
        "height": int(height),
        # The principal point of a phone camera is the image centre; fitting
        # it from the pose biased it ~300 px on a 1080 frame, which lands
        # directly in the lateral metric.
        "cx": float(width) / 2.0,
        "cy": float(height) / 2.0,
        "height_scale": scale["height_scale"],
        "px_per_m": scale["px_per_m"],
        "subject_distance_m": round(f / px_per_m, 2),
        "scale_spread": scale["scale_spread"],
        "lifter_height_m": round(float(lifter_height_m), 3),
        "n_frames": scale["n_frames"],
    }


def bar_span_px(
    box_w: float | None, box_h: float | None, frame_width: float
) -> float | None:
    """Long-axis pixel extent of a barbell box, or ``None`` when unusable.

    The box is axis-aligned, so for a level bar the long axis *is* the bar's
    projected length. The aspect gate drops end-on / steeply foreshortened
    bars whose "length" carries no focal information (a side-view deadlift
    bar images near-square). ``box_w``/``box_h`` are normalised; the span is
    returned in pixels.
    """
    if box_w is None or box_h is None or not frame_width or frame_width <= 0:
        return None
    w, h = float(box_w), float(box_h)
    if w <= 0 or h <= 0:
        return None
    if max(w, h) / min(w, h) < _MIN_BAR_ASPECT:
        return None
    return max(w, h) * float(frame_width)


def bar_depth_offsets(world: list, exercise: str = "") -> list:
    """Per-frame depth of the joint the bar is held at, in (uncalibrated) metres.

    The same anchor the 3D lift uses — shoulders for a squat, wrists
    otherwise — as a hip-centred world-z series. The caller multiplies by the
    clip's ``height_scale``; kept separate so the estimator stays unit-explicit
    about what is calibrated and what is not. ``None`` where the frame has no
    world landmarks.
    """
    anchor = _SHOULDER if exercise in _SQUAT_FAMILY else _WRIST
    out: list = []
    for wl in world or []:
        if wl is None:
            out.append(None)
            continue
        try:
            xyz = _xyz(wl)
            out.append(float(np.mean(xyz[list(anchor), 2])))
        except (IndexError, TypeError, ValueError):
            out.append(None)
    return out


def _focal_per_frame(
    span_px: float, delta_m: float, px_per_m: float, length_m: float
) -> float | None:
    """Closed-form focal from one frame's bar span.

    The bar images ``span_px`` long at depth ``Z + delta`` while the body fits
    ``px_per_m = f / Z``: eliminating ``Z`` gives ``f = p·Δ / (L − p/s)``.
    Returns ``None`` when the geometry is degenerate (bar in the body plane)
    or inconsistent (the span disagrees in sign with the offset, or implies a
    non-phone lens) rather than a wild number.
    """
    if not (span_px > 0 and px_per_m > 0 and length_m > 0):
        return None
    if abs(delta_m) < _MIN_DEPTH_OFFSET_M:
        return None
    denom = length_m - span_px / px_per_m
    # A consistent frame has numerator and denominator alike in sign (a nearer
    # bar images longer than the body scale predicts, and vice versa).
    if denom == 0 or (span_px * delta_m > 0) != (denom > 0):
        return None
    f = span_px * delta_m / denom
    if not (_FOCAL_RANGE_PX[0] <= f <= _FOCAL_RANGE_PX[1]):
        return None
    return f


def estimate_focal_from_bar(
    spans_px: list,
    deltas_m: list,
    px_per_m: float,
    length_m: float = _BAR_LENGTH_M,
) -> dict | None:
    """Clip-level focal from the barbell's known length (fallback source).

    ``spans_px``/``deltas_m`` are per-frame parallel lists (``None``-tolerant):
    the barbell box's long-axis extent in pixels and the bar anchor's signed
    depth offset from the body plane in *calibrated* metres. Each frame solves
    in closed form; the clip takes the median, MAD-gated like the rep metrics,
    and declines unless enough frames agree tightly. Returns
    ``{"focal_px", "n_frames", "spread", "bar_length_m"}`` or ``None``.

    Per-frame leverage is weak by construction (the bar sits near the body
    plane, so ``Z/offset`` amplifies box noise ~10-30x) — the median over a
    clip is the estimate, and ``spread`` says whether to trust it.
    """
    if not px_per_m or px_per_m <= 0 or not length_m or length_m <= 0:
        return None
    fs: list[float] = []
    for span, delta in zip(spans_px or [], deltas_m or []):
        if span is None or delta is None:
            continue
        try:
            f = _focal_per_frame(
                float(span), float(delta), float(px_per_m), float(length_m)
            )
        except (TypeError, ValueError):
            continue
        if f is not None:
            fs.append(f)
    if len(fs) < _MIN_FOCAL_FRAMES:
        logger.info(
            "Metric 3D bar path: only %d usable barbell frames for the focal",
            len(fs),
        )
        return None

    arr = np.asarray(fs, dtype=float)
    med = float(np.median(arr))
    mad = max(_FOCAL_MAD_FLOOR_PX, 1.4826 * float(np.median(np.abs(arr - med))))
    keep = arr[np.abs(arr - med) <= _MAD_LIMIT * mad]
    if len(keep) < _MIN_FOCAL_FRAMES:
        return None
    p10, p90 = (float(v) for v in np.percentile(keep, [10, 90]))
    med = float(np.median(keep))
    spread = (p90 - p10) / med if med > 0 else float("inf")
    if spread > _FOCAL_SPREAD_LIMIT:
        logger.info("Metric 3D bar path: barbell focal spread %.2f — declining", spread)
        return None
    return {
        "focal_px": round(med, 1),
        "n_frames": len(keep),
        "spread": round(spread, 3),
        "bar_length_m": round(float(length_m), 2),
    }


def remap_reps(pose_reps: list, rep_times: list) -> list:
    """Re-index pose reps from the dense landmark series onto ``rep_times``.

    ``detect_reps_from_pose`` returns ``start_idx``/``end_idx`` into the *dense*
    ``landmarks`` series, but the bar track is aligned to the **detector's**
    frames (``records``), which is a strict subset whenever the lifter missed
    frames — the bench-with-spotter case this pipeline has to survive. Feeding
    one series' indices to the other silently reads the wrong frames, so the
    window is remapped through ``t``: the one coordinate both series share.

    Reps whose window contains no detector frame are dropped.
    """
    # Keep (index, time) pairs rather than filtering: dropping an entry would
    # renumber everything after it and reintroduce exactly the misalignment this
    # function exists to prevent.
    timed = [(i, float(t)) for i, t in enumerate(rep_times) if t is not None]
    if not timed:
        return []

    dropped = 0
    out: list[dict] = []
    for rep in pose_reps or []:
        start_t, end_t = rep.get("start_time"), rep.get("end_time")
        if start_t is None or end_t is None:
            # No window to remap with, so the indices cannot be trusted to
            # mean anything in the track's space. Drop rather than guess.
            dropped += 1
            continue
        start_t, end_t = float(start_t), float(end_t)
        pts = [i for i, t in timed if start_t - _TIME_EPS <= t <= end_t + _TIME_EPS]
        if len(pts) < _MIN_REP_POINTS:
            dropped += 1
            continue
        out.append({**rep, "start_idx": pts[0], "end_idx": pts[-1]})
    if dropped:
        logger.info(
            "Metric 3D bar path: %d/%d reps had no usable window on the "
            "detector's frames",
            dropped,
            len(pose_reps or []),
        )
    return out


def _body_axes(xyz: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """Unit sagittal (fwd) and medio-lateral (lat) axes of the lifter.

    The sagittal axis is heel→toe. The medio-lateral axis is the **hip line**,
    orthogonalised against it — that pairing is what makes the two axes
    view-independent without estimating any rotation (the world landmarks are
    already camera-axis aligned):

    - frontal view: the hip line is across the body, the foot points at the
      camera — the two are already orthogonal;
    - side view: the foot runs along the hip *separation* axis in image terms,
      but in world terms the hip line is the depth axis, so orthogonalising
      recovers it;
    - 3/4 view: in between.

    Taking the lateral axis from the world x axis instead (as the prototype
    did) is degenerate in a side view — the axis it orthogonalises *is* the
    front-back one there, so the cross product vanishes.
    """
    fwd = _unit(xyz[list(_FOOT_INDEX)].mean(axis=0) - xyz[list(_HEEL)].mean(axis=0))
    lat = _unit(xyz[_HIP[0]] - xyz[_HIP[1]])
    return fwd, _unit(lat - fwd * float(fwd @ lat))


def lift_bar_3d(
    landmarks: list,
    world: list,
    bar_track: list,
    camera: dict | None,
    exercise: str = "",
) -> list:
    """Lift each frame's bar position to metric 3D (step 2).

    Returns a list aligned to ``bar_track`` of
    ``{"height_m", "front_back_mm", "lateral_mm", "depth_m", "basis",
    "confidence"}`` or ``None`` for every frame that cannot be trusted
    (no pose, no world landmarks, the bar centre was not resolved, the
    per-frame scale disagrees with the clip, or the offset is implausible).
    """
    track = bar_track or []
    if not camera:
        return [None] * len(track)

    f = float(camera["focal_px"])
    cx, cy = float(camera["cx"]), float(camera["cy"])
    width, height = float(camera["width"]), float(camera["height"])
    px_scale = np.array([width, height], dtype=float)
    hscale = float(camera.get("height_scale") or 1.0)
    ref_px_per_m = float(camera.get("px_per_m") or 0.0)
    # The bar is rigidly coupled to the joint it is actually held at: the
    # shoulders in a squat (bar on the back), the wrists everywhere else.
    anchor = _SHOULDER if exercise in _SQUAT_FAMILY else _WRIST

    out: list = []
    for i, p in enumerate(track):
        lm = landmarks[i] if i < len(landmarks) else None
        wl = world[i] if i < len(world) else None
        if p is None or lm is None or wl is None:
            out.append(None)
            continue
        if p.get("bar_basis") not in _CENTRE_BASES or p.get("bar_x") is None:
            out.append(None)
            continue

        uv = _xy(lm) * px_scale
        xyz = _xyz(wl) * hscale
        s = _px_per_m(uv, xyz, _ORIGIN)
        if s <= 1.0:
            out.append(None)
            continue
        if ref_px_per_m > 0 and abs(s - ref_px_per_m) / ref_px_per_m > _SCALE_TOLERANCE:
            out.append(None)
            continue

        z_body = f / s
        z_bar = z_body + float(np.mean(xyz[list(anchor), 2]))

        bar = np.array(
            [
                (float(p["bar_x"]) * width - cx) * z_bar / f,
                (float(p["bar_y"]) * height - cy) * z_bar / f,
                z_bar,
            ]
        )
        hip = _mid(xyz[_HIP[0]], xyz[_HIP[1]])
        u_hip = float(uv[_HIP[0], 0] + uv[_HIP[1], 0]) / 2.0
        v_hip = float(uv[_HIP[0], 1] + uv[_HIP[1], 1]) / 2.0
        hip_cam = np.array(
            [
                (u_hip - cx) * z_body / f,
                (v_hip - cy) * z_body / f,
                z_body,
            ]
        )
        # The world landmarks are hip-centred *and* axis-aligned with the
        # camera, so a world offset from the hips is already a camera offset.
        # (Index with a *list*: a numpy tuple index is multi-axis, not a row
        # selection.)
        midfoot_cam = hip_cam + (
            _mid(
                xyz[list(_HEEL)].mean(axis=0),
                xyz[list(_FOOT_INDEX)].mean(axis=0),
            )
            - hip
        )

        off = bar - midfoot_cam
        fwd, lat = _body_axes(xyz)
        # Camera +y points down the image, so height above the midfoot is -dy.
        height_m = -float(off[1])
        fb_mm = 1000.0 * float(off @ fwd)
        lat_mm = 1000.0 * float(off @ lat)
        if (
            abs(height_m) > _MAX_OFFSET_M
            or abs(fb_mm) / 1000.0 > _MAX_OFFSET_M
            or abs(lat_mm) / 1000.0 > _MAX_OFFSET_M
        ):
            out.append(None)
            continue

        out.append(
            {
                "height_m": round(height_m, 4),
                "front_back_mm": round(fb_mm, 1),
                "lateral_mm": round(lat_mm, 1),
                "depth_m": round(z_bar, 3),
                "basis": p.get("bar_basis"),
                "confidence": round(float(p.get("confidence") or 0.0), 3),
            }
        )
    return out


def _reject_outliers(points: list[dict]) -> list[dict]:
    """Drop points far from a rep's own median (median-absolute-deviation).

    The plate detector occasionally fires on a rack or a spare plate; a single
    such frame reads ±1 m of lateral. The floor keeps a genuinely steady
    series from being cut by floating-point noise.
    """
    keep = points
    for key in ("front_back_mm", "lateral_mm"):
        vals = np.array([p[key] for p in points], dtype=float)
        med = float(np.median(vals))
        # 1.4826 rescales the MAD to a standard-deviation equivalent.
        mad = max(_MAD_FLOOR_MM, 1.4826 * float(np.median(np.abs(vals - med))))
        limit = _MAD_LIMIT * mad
        keep = [p for p in keep if abs(p[key] - med) <= limit]
    return keep


def analyze_bar_path_3d(
    track3d: list,
    pose_reps: list[dict],
    camera: dict | None = None,
    exercise: str = "",
) -> dict | None:
    """View-independent bar metrics over the detected reps (step 3).

    Returns ``None`` unless at least ``_MIN_3D_REPS`` reps are measurable, so
    the 2D metrics are never displaced by a single-rep fluke. ``camera`` (the
    fit from :func:`fit_clip_camera`) is echoed back as ``calibration`` so a
    surprising number can be traced to the scale behind it.
    """
    if not track3d or not pose_reps:
        return None

    per_rep: list[dict] = []
    n_frames = 0
    for rep in pose_reps:
        start, end = rep.get("start_idx", 0), rep.get("end_idx", 0)
        hi = min(len(track3d), end) + 1
        pts = [track3d[i] for i in range(max(0, start), hi) if track3d[i] is not None]
        if len(pts) < _MIN_REP_POINTS:
            continue
        pts = _reject_outliers(pts)
        if len(pts) < _MIN_REP_POINTS:
            continue

        h = np.array([p["height_m"] for p in pts], dtype=float)
        fb = np.array([p["front_back_mm"] for p in pts], dtype=float)
        la = np.array([p["lateral_mm"] for p in pts], dtype=float)
        k = max(1, int(len(pts) * _END_QUANTILE))
        per_rep.append(
            {
                "rep_number": rep.get("rep_number"),
                "bar_height_top_m": round(float(np.percentile(h, _TOP_PCT)), 3),
                "bar_height_bottom_m": round(float(np.percentile(h, _BOTTOM_PCT)), 3),
                "vertical_range_m": round(
                    float(np.percentile(h, _TOP_PCT) - np.percentile(h, _BOTTOM_PCT)),
                    3,
                ),
                "front_back_mm": round(float(np.median(fb)), 1),
                "lateral_mm": round(float(np.median(la)), 1),
                "net_lateral_mm": round(float(la[-k:].mean() - la[:k].mean()), 1),
                "n_frames": len(pts),
            }
        )
        n_frames += len(pts)

    if len(per_rep) < _MIN_3D_REPS:
        return None

    def _mean(key: str) -> float:
        return float(np.mean([r[key] for r in per_rep]))

    bases = {p["basis"] for p in track3d if p}
    result: dict = {
        "basis": "metric_3d",
        "n_reps": len(per_rep),
        "n_frames": n_frames,
        "bar_height_top_m": round(_mean("bar_height_top_m"), 3),
        "bar_height_bottom_m": round(_mean("bar_height_bottom_m"), 3),
        "vertical_range_m": round(_mean("vertical_range_m"), 3),
        "front_back_mm": round(_mean("front_back_mm"), 1),
        "lateral_mm": round(_mean("lateral_mm"), 1),
        "net_lateral_mm": round(_mean("net_lateral_mm"), 1),
        "per_rep": per_rep,
    }
    if camera:
        result["calibration"] = {
            "focal_px": camera.get("focal_px"),
            # Where the focal came from: container tags or the barbell-length
            # fallback (``estimate_focal_from_bar``). A barbell focal carries
            # the estimator's own spread for inspection.
            "focal_source": camera.get("focal_source", "tags"),
            "focal_spread": camera.get("focal_spread"),
            "subject_distance_m": camera.get("subject_distance_m"),
            "px_per_m": camera.get("px_per_m"),
            "lifter_height_m": camera.get("lifter_height_m"),
            "height_scale": camera.get("height_scale"),
            "scale_spread": camera.get("scale_spread"),
        }
    notes = [
        (
            "Metric 3D: the bar is lifted into real units with this clip's "
            "focal and your height, so these offsets do not depend on the "
            "camera angle."
        ),
    ]
    if len(bases) > 1:
        notes.append(f"Mixed bar-centre sources: {sorted(bases)}.")
    notes.append(
        "Lateral sign follows the pose's own frame, so it is comparable within "
        "a clip but not across cameras."
    )
    notes.append("No 3D ground truth exists yet — treat as indicative.")
    result["note"] = " ".join(notes)
    return result
