"""Per-clip camera estimation from video metadata (services/video_camera.py)."""

import math

import pytest

from app.services.video_camera import (
    FULL_FRAME_DIAGONAL_MM,
    camera_info,
    focal_equiv_mm,
    focal_px_from_tags,
)

# Real tags from the OnePlus 11 5G clip used in the 3D investigation.
ONEPLUS = {
    "com.oplus.product.model": "OnePlus 11 5G",
    "com.oplus.lens.model": "back camera",
    "com.oplus.lens.focal_length": "14.011899",
    "com.oplus.lens.max_aperture_value": "f/2.2",
}


class TestFocalEquiv:
    def test_reads_oneplus_equivalent(self):
        assert focal_equiv_mm(ONEPLUS) == pytest.approx(14.011899)

    def test_missing_is_none(self):
        assert focal_equiv_mm({}) is None
        assert focal_equiv_mm({"com.oplus.lens.focal_length": "abc"}) is None

    def test_implausible_value_rejected(self):
        # a raw 4.3 mm non-equivalent focal would be way outside the range only
        # if < 3; guard the top end too
        assert focal_equiv_mm({"com.oplus.lens.focal_length": "900"}) is None


class TestFocalPx:
    def test_oneplus_1080x1920(self):
        # FOV_diag = 2*atan(43.266/(2*14.01)) = 114.1 deg -> f_px ~ 714
        f = focal_px_from_tags(ONEPLUS, 1080, 1920)
        assert f == pytest.approx(713.7, abs=2.0)
        # horizontal FOV should land in phone-lens territory (not the bogus 18
        # deg the pose fit produced)
        fov_h = 2 * math.degrees(math.atan(1080 / 2 / f))
        assert 65.0 < fov_h < 85.0

    def test_diagonal_scale_is_resolution_independent(self):
        a = focal_px_from_tags(ONEPLUS, 1080, 1920)
        b = focal_px_from_tags(ONEPLUS, 2160, 3840)
        assert b == pytest.approx(2 * a, rel=1e-6)

    def test_none_without_tags(self):
        assert focal_px_from_tags({}, 1080, 1920) is None

    def test_none_with_bad_dimensions(self):
        assert focal_px_from_tags(ONEPLUS, 0, 1920) is None


class TestCameraInfo:
    def test_full_payload(self):
        info = camera_info(ONEPLUS, 1080, 1920)
        assert info["product"] == "OnePlus 11 5G"
        assert info["lens"] == "back camera"
        assert info["focal_equiv_mm"] == pytest.approx(14.011899)
        assert info["focal_px"] == pytest.approx(713.7, abs=2.0)
        assert info["width"] == 1080 and info["height"] == 1920

    def test_empty_tags(self):
        info = camera_info({}, 1080, 1920)
        assert info["focal_px"] is None
        assert info["product"] is None

    def test_full_frame_diagonal_constant(self):
        assert FULL_FRAME_DIAGONAL_MM == pytest.approx(43.266)
