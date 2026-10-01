import re  # py3.11+ stdlib
import tomllib
from importlib import metadata
from pathlib import Path

importorskip_rx = re.compile(r'pytest\.importorskip\(\s*["\']([^"\']+)["\']\s*\)')

# Chars that terminate the bare distribution name in a PEP 508 requirement
# ("numpy>=2.0" -> "numpy"); the space also cuts off environment markers.
_PEP508_NAME_END = " >=<~![( "

# Resolve paths relative to this file so the test works regardless of the
# pytest invocation directory (repo root or backend/).
_HERE = Path(__file__).resolve().parent          # backend/tests/
_PPROJECT = _HERE.parent / "pyproject.toml"      # backend/pyproject.toml


def _normalize_dep_name(requirement: str) -> str:
    """Bare, lowercased distribution name from a PEP 508 requirement string.

    "numpy>=2.0" -> "numpy"; "opencv-python-headless>=4.10" -> "opencv-python-headless".
    """
    cut = len(requirement)
    for i, ch in enumerate(requirement):
        if ch in _PEP508_NAME_END:
            cut = i
            break
    return requirement[:cut].lower()


def _declared_dev_deps() -> set[str]:
    with open(_PPROJECT, "rb") as f:
        data = tomllib.load(f)
    return set(data["project"]["optional-dependencies"]["dev"])


def _declared_dev_names() -> set[str]:
    return {_normalize_dep_name(dep) for dep in _declared_dev_deps()}


def _importorskip_targets(directory: Path) -> set[str]:
    found: set[str] = set()
    self_path = Path(__file__).resolve()
    for p in directory.glob("*.py"):
        if p.resolve() == self_path:
            continue  # this guard documents the pattern; don't match our own examples
        text = p.read_text()
        # match pytest.importorskip("X"); pytest.importorskip('X'); import X = pytest.importorskip("Y")
        found.update(m.group(1) for m in importorskip_rx.finditer(text))
    return found


def _offenders(targets: set[str], dev_names: set[str]) -> set[str]:
    """Targets that pull in a declared dev dependency.

    Matches either directly (bare name in the normalized dev-dep set) or via
    importlib.metadata, so an import name that differs from its distribution
    name is still caught (e.g. ``pytest.importorskip("cv2")`` ->
    distribution ``opencv-python-headless``).
    """
    try:
        dist_map = metadata.packages_distributions()
    except Exception:  # BLE001 — metadata lookup failure must not break the guard
        dist_map = {}
    flagged: set[str] = set()
    for target in targets:
        if _normalize_dep_name(target) in dev_names:
            flagged.add(target)
            continue
        provided = {name.lower() for name in dist_map.get(target, [])}
        if provided & dev_names:
            flagged.add(target)
    return flagged


def test_no_importorskip_on_declared_dev_deps():
    targets = _importorskip_targets(_HERE)
    offenders = _offenders(targets, _declared_dev_names())
    assert not offenders, f"tests importorskip declared deps that skip silently: {offenders}"


def test_guard_flags_importorskip_on_declared_dev_deps(tmp_path):
    """The guard must actually fire — regression test for the vacuous version.

    The original check intersected bare import names with full PEP 508 strings
    ("numpy" vs "numpy>=2.0"), which could never match. Prove here that a
    synthetic ``pytest.importorskip("numpy")`` target WOULD be flagged.
    """
    dev_names = _declared_dev_names()

    # Normalization maps the declared PEP 508 specs to bare names.
    assert _normalize_dep_name("numpy>=2.0") == "numpy"
    assert _normalize_dep_name("opencv-python-headless>=4.10") == "opencv-python-headless"
    assert _normalize_dep_name("pytest>=8.0.0") == "pytest"
    assert "numpy" in dev_names
    assert "opencv-python-headless" in dev_names

    # A synthetic importorskip target on a declared dep is flagged ...
    assert _offenders({"numpy"}, dev_names) == {"numpy"}
    # ... including when the import name differs from the distribution name ...
    assert _offenders({"cv2"}, dev_names) == {"cv2"}
    # ... and unrelated targets are not flagged.
    assert _offenders({"some_unrelated_pkg"}, dev_names) == set()

    # End-to-end: scanning a synthetic file that re-adds importorskip("numpy")
    # (written to a tmp dir, not a real test file) is caught by the full pipeline.
    fake = tmp_path / "test_fake_regression.py"
    fake.write_text('import pytest\n\nnp = pytest.importorskip("numpy")\n')
    assert _offenders(_importorskip_targets(tmp_path), dev_names) == {"numpy"}


def test_video_deps_importable():
    import cv2
    import numpy
