"""Smoke test for the synthetic bar-frame renderer (T3 dataset).

Needs numpy + opencv (the video venv / Modal image); skipped in CI.
"""

import sys
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
cv2 = pytest.importorskip("cv2")

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "scripts"))

import render_synthetic_bars as rs


def test_renders_a_labelled_frame(tmp_path):
    (tmp_path / "frames").mkdir()
    rng = np.random.default_rng(0)
    rec = rs.render_one(rng, 0, tmp_path, "Back Squat", "side")
    assert (tmp_path / "frames" / "syn_00000.jpg").exists()
    assert rec["w"] == rs.W and rec["h"] == rs.H
    labels = {b["label"] for b in rec["boxes"]}
    assert "plate" in labels
    assert "barbell" in labels
