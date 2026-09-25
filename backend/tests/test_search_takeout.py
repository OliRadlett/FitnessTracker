"""Unit tests for the Google Takeout video searcher (metadata mode).

Pure stdlib — runs in CI.
"""

import json
import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[2] / "scripts"
sys.path.insert(0, str(SCRIPTS))

from search_takeout import _album_of, search


def _fixture(root: Path) -> Path:
    takeout = root / "Google Photos"
    lifting = takeout / "Albums" / "Lifting"
    misc = takeout / "Photos from 2026"
    lifting.mkdir(parents=True)
    misc.mkdir(parents=True)

    (lifting / "squat_a.mp4").write_bytes(b"x")
    (lifting / "squat_a.mp4.json").write_text(json.dumps({
        "title": "Back squat 150kg",
        "photoTakenTime": {"timestamp": "1740000000"},
    }))
    (lifting / "holiday.mp4").write_bytes(b"x")
    (misc / "random.mp4").write_bytes(b"x")
    return takeout


def test_keyword_filters_to_matching_sidecar(tmp_path):
    takeout = _fixture(tmp_path)
    hits = search(takeout, "squat", None, None, None, content=False, min_lift_score=0.6)
    names = {c.path.name for c in hits}
    assert names == {"squat_a.mp4"}
    assert hits[0].title == "Back squat 150kg"


def test_album_name_is_searchable(tmp_path):
    takeout = _fixture(tmp_path)
    hits = search(takeout, "lifting", None, None, None, content=False, min_lift_score=0.6)
    assert {c.path.name for c in hits} == {"squat_a.mp4", "holiday.mp4"}


def test_no_keyword_returns_all_videos(tmp_path):
    takeout = _fixture(tmp_path)
    hits = search(takeout, None, None, None, None, content=False, min_lift_score=0.6)
    assert len(hits) == 3


def test_album_of_reads_albums_folder(tmp_path):
    takeout = _fixture(tmp_path)
    assert _album_of(takeout / "Albums" / "Lifting" / "squat_a.mp4", takeout) == "Lifting"
