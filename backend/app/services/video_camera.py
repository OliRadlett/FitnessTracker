"""Per-clip camera estimation from video metadata (`plans/bar-tracking-3d.md`).

Videos are shot on **different lenses**, so the focal length is a property of
the clip, not of the user. Phone containers carry the lens focal as a 35 mm
equivalent (e.g. OnePlus/Oppo `com.oplus.lens.focal_length = 14.01`), from which
the focal in pixels follows:

    FOV_diag = 2 * atan(FULL_FRAME_DIAGONAL_MM / (2 * f_equiv))
    f_px     = (diag_px / 2) / tan(FOV_diag / 2)

The pose cannot supply this: fitting a camera to MediaPipe's world landmarks
yields a confident but bogus ~18 deg FOV, because MediaPipe's world ``z`` is a
learned body estimate, not a perspective measurement (verified 2026-09-27).

Pure functions — no ffmpeg/DB here; the caller runs `ffprobe` and passes tags.
"""

from __future__ import annotations

import math

FULL_FRAME_DIAGONAL_MM = 43.266  # 36 x 24 mm

# Container tags carrying a 35 mm-equivalent focal length (mm). Vendors differ;
# add new ones here rather than special-casing call sites.
FOCAL_EQUIV_KEYS = (
    "com.oplus.lens.focal_length",  # OnePlus / Oppo
    "com.vivo.lens.focal_length",
    "com.xiaomi.lens.focal_length",
)
PRODUCT_KEYS = ("com.oplus.product.model", "com.xiaomi.product.model")
LENS_KEYS = ("com.oplus.lens.model", "com.vivo.lens.model")


def _as_float(value: object) -> float | None:
    try:
        return float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return None


def _first(tags: dict, keys: tuple[str, ...]) -> str | None:
    for key in keys:
        value = tags.get(key)
        if value:
            return str(value)
    return None


def focal_equiv_mm(tags: dict) -> float | None:
    """35 mm-equivalent focal length (mm) from container tags, if plausible."""
    for key in FOCAL_EQUIV_KEYS:
        value = _as_float(tags.get(key))
        # 3-300 mm equivalent spans ultra-wide to super-tele; anything else is
        # a raw (non-equivalent) focal or garbage.
        if value is not None and 3.0 <= value <= 300.0:
            return value
    return None


def focal_px_from_tags(tags: dict, width: int, height: int) -> float | None:
    """Focal length in pixels for a ``width`` x ``height`` frame.

    ``None`` when the container carries no usable focal — callers fall back to a
    default FOV rather than guessing from the pose.
    """
    f_equiv = focal_equiv_mm(tags)
    if f_equiv is None or width <= 0 or height <= 0:
        return None
    fov_diag = 2.0 * math.atan(FULL_FRAME_DIAGONAL_MM / (2.0 * f_equiv))
    diag_px = math.hypot(width, height)
    return (diag_px / 2.0) / math.tan(fov_diag / 2.0)


def camera_info(tags: dict, width: int, height: int) -> dict:
    """The per-clip camera facts worth persisting alongside an analysis."""
    return {
        "product": _first(tags, PRODUCT_KEYS),
        "lens": _first(tags, LENS_KEYS),
        "focal_equiv_mm": focal_equiv_mm(tags),
        "focal_px": (
            round(f, 1) if (f := focal_px_from_tags(tags, width, height)) else None
        ),
        "width": width,
        "height": height,
    }
