"""Unit tests for the seeded plate tracker helpers (T3 fallback)."""

import sys
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import track_bars as tb  # noqa: E402


def test_clip_and_frame_parses_index():
    assert tb._clip_and_frame("frames/abc_0012.jpg") == ("abc", 12)


def test_xyxy_from_normalised_box():
    box = {"x": 0.5, "y": 0.5, "w": 0.2, "h": 0.4}
    assert tb._xyxy(box, 100, 100) == (40, 30, 60, 70)


def test_match_finds_a_translated_template():
    import cv2

    gray = np.zeros((60, 60), dtype=np.uint8)
    gray[20:30, 20:30] = 255  # a bright 10x10 square
    template = gray[20:30, 20:30].copy()
    nxt, score = tb._match(cv2, gray, template, (18, 18, 28, 28), 60, 60)
    assert score > 0.9
    assert nxt[0] == 20 and nxt[1] == 20
