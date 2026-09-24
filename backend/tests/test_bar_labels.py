"""Unit tests for the bar-detection label schema (T3).

Pure stdlib — runs in CI without numpy.
"""

import sys
from pathlib import Path

import pytest

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from bar_labels import (
    box_from_xyxy,
    box_to_xyxy_norm,
    clamp_box,
    load_jsonl,
    make_box,
    make_record,
    to_yolo_rows,
    write_jsonl,
)


def test_box_from_xyxy_normalises_and_centres():
    b = box_from_xyxy(960, 540, 1152, 756, "plate", 1920, 1080)
    assert b["x"] == pytest.approx(0.55, abs=1e-4)
    assert b["y"] == pytest.approx(0.6, abs=1e-4)
    assert b["w"] == pytest.approx(0.1, abs=1e-4)
    assert b["h"] == pytest.approx(0.2, abs=1e-4)


def test_xyxy_roundtrip():
    b = make_box(0.5, 0.5, 0.2, 0.3, "barbell")
    assert box_to_xyxy_norm(b) == pytest.approx((0.4, 0.35, 0.6, 0.65))


def test_clamp_box_stays_in_frame():
    out = clamp_box(make_box(0.95, 0.5, 0.2, 0.2, "plate"))
    x1, _y1, x2, _y2 = box_to_xyxy_norm(out)
    assert x1 >= 0.0
    assert x2 <= 1.0


def test_unknown_label_rejected():
    with pytest.raises(ValueError):
        make_box(0.5, 0.5, 0.1, 0.1, "bicycle")


def test_write_load_roundtrip(tmp_path):
    recs = [
        make_record("frames/a_0001.jpg", 1920, 1080,
                    [make_box(0.5, 0.2, 0.1, 0.3, "plate", "human")], "Back Squat", "side"),
    ]
    path = tmp_path / "labels.jsonl"
    write_jsonl(path, recs)
    assert load_jsonl(path) == recs


def test_prepare_dataset_writes_yolo_layout(tmp_path):
    from train_bar_detector import prepare_dataset

    (tmp_path / "frames").mkdir()
    (tmp_path / "frames" / "a.jpg").write_bytes(b"not-a-real-jpeg")
    labels = tmp_path / "labels.jsonl"
    write_jsonl(labels, [
        make_record("frames/a.jpg", 100, 100,
                    [make_box(0.5, 0.5, 0.2, 0.2, "plate", "human")]),
    ])
    out = prepare_dataset([(tmp_path, labels)], tmp_path / "ds", val_frac=0.5)
    assert (out / "data.yaml").exists()
    txt = list((out / "labels").rglob("*.txt"))
    assert len(txt) == 1
    assert txt[0].read_text().startswith("1 ")  # plate = class 1


def test_to_yolo_rows_uses_label_indices():
    rec = make_record("x.jpg", 100, 100, [
        make_box(0.5, 0.5, 0.2, 0.2, "barbell"),
        make_box(0.5, 0.5, 0.2, 0.2, "plate"),
        make_box(0.5, 0.5, 0.2, 0.2, "person"),
    ])
    rows = to_yolo_rows(rec)
    assert rows[0].startswith("0 ")
    assert rows[1].startswith("1 ")
    assert rows[2].startswith("2 ")
