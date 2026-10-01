import re  # py3.11+ stdlib
import tomllib
from pathlib import Path

importorskip_rx = re.compile(r'pytest\.importorskip\(\s*["\']([^"\']+)["\']\s*\)')

# Resolve paths relative to this file so the test works regardless of the
# pytest invocation directory (repo root or backend/).
_HERE = Path(__file__).resolve().parent          # backend/tests/
_PPROJECT = _HERE.parent / "pyproject.toml"      # backend/pyproject.toml


def _declared_dev_deps() -> set[str]:
    with open(_PPROJECT, "rb") as f:
        data = tomllib.load(f)
    return set(data["project"]["optional-dependencies"]["dev"])


def _importorskip_targets(directory: Path) -> set[str]:
    found: set[str] = set()
    for p in directory.glob("*.py"):
        text = p.read_text()
        # match pytest.importorskip("X"); pytest.importorskip('X'); import X = pytest.importorskip("Y")
        found.update(m.group(1) for m in importorskip_rx.finditer(text))
    return found


def test_no_importorskip_on_declared_dev_deps():
    targets = _importorskip_targets(_HERE)
    offenders = targets & _declared_dev_deps()
    assert not offenders, f"tests importorskip declared deps that skip silently: {offenders}"


def test_video_deps_importable():
    import cv2
    import numpy
