"""Modal remote workers must live at module global scope.

Modal raises ``InvalidError`` for functions defined inside other functions
(closures carry ``<locals>`` in ``__qualname__`` and cannot be serialized).
This test guards the five Modal dispatch modules against regressing to the
closure pattern: each worker must be a module-level function with no free
variables.
"""

import inspect
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from app.integrations import (
    cross_domain,
    power_models,
    route_intelligence,
    segment_intelligence,
    weather_analysis,
)

WORKERS = [
    (power_models, "_fit_power_models_modal"),
    (segment_intelligence, "_analyze_segments_modal"),
    (weather_analysis, "_analyze_weather_modal"),
    (cross_domain, "_analyze_cross_domain_modal"),
    (route_intelligence, "_analyze_routes_modal"),
]

# Modal workers defined in a module that is NOT mounted standalone but shares
# the app package. The road-graph workers must not import app.config at module
# scope or inside the worker (pitfall #33: bare image lacks pydantic_settings).
_ROAD_GRAPH_WORKERS = (
    "app.integrations.route_road_graph",
    ("_match_routes_road_modal", "_build_road_graph_modal", "_download_osm_region"),
)


def test_road_graph_workers_avoid_app_config():
    """The road-graph Modal workers must not touch app.config (pitfall #33)."""
    import ast

    import app.integrations.route_road_graph as rr

    src = Path(rr.__file__).read_text(encoding="utf-8")
    tree = ast.parse(src)

    for name in _ROAD_GRAPH_WORKERS[1]:
        fn = next(
            (n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == name),
            None,
        )
        assert fn is not None, f"{name} missing"
        # Walk only real import statements (docstrings mentioning app.config are
        # fine — the guard is about imports inside the Modal container).
        for node in ast.walk(fn):
            if isinstance(node, ast.Import):
                mods = [a.name for a in node.names]
            elif isinstance(node, ast.ImportFrom):
                mods = [node.module or ""]
            else:
                continue
            for mod in mods:
                top = mod.split(".")[0]
                assert top not in ("pydantic_settings",), (
                    f"{name} imports {mod} (pitfall #33)"
                )
                assert not mod.startswith("app.config"), (
                    f"{name} imports {mod} (pitfall #33)"
                )

@pytest.mark.parametrize("module,fn_name", WORKERS)
def test_modal_worker_is_module_scope(module, fn_name):
    fn = getattr(module, fn_name, None)
    assert fn is not None, f"{module.__name__} missing {fn_name}"
    assert inspect.isfunction(fn), f"{fn_name} is not a plain function"
    # No "<locals>" in qualname => defined at module top level, not in a closure.
    assert "<locals>" not in fn.__qualname__, f"{fn_name} is a closure"
    # No free variables => closes over no local state.
    assert not fn.__code__.co_freevars, (
        f"{fn_name} closes over {fn.__code__.co_freevars}"
    )


# Modules `_get_modal_image` mounts into the video container.
MOUNTED_MODULES = (
    "video_analysis.py",
    "pose_analysis.py",
    "person_tracking.py",
    "bar_tracking.py",
    "pose_track.py",
    "biomechanics.py",
    "bar_detection.py",
    "bar_tracking_3d.py",
)

# Mounted modules that live outside ``app/integrations``, as
# ``(mount source, module directory)`` relative to the backend root. These are
# not on the ``MOUNTED_MODULES`` path walk, so they need their own resolution.
MOUNTED_EXTRA = (
    ("app/services/video_camera.py", "services"),
)

# Top-level import name -> pip package name, for third-party imports.
_IMPORT_TO_PIP = {
    "cv2": "opencv-python-headless",
    "numpy": "numpy",
    "mediapipe": "mediapipe",
    "onnxruntime": "onnxruntime",
    "httpx": "httpx",
    "google": "protobuf",  # the protobuf runtime mediapipe imports
    "PIL": "pillow",
}


def _third_party_imports(path: Path) -> set[str]:
    import ast

    names: set[str] = set()
    for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
        if isinstance(node, ast.Import):
            names.update(a.name.split(".")[0] for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            if node.level == 0 and node.module:
                names.add(node.module.split(".")[0])
    return {
        n for n in names
        if n not in sys.stdlib_module_names and n != "app" and not n.startswith("_")
    }


def test_mounted_modules_third_party_imports_are_installed():
    """Every third-party import of a mounted module must be in the image.

    A runtime dep the Modal image lacks only fails at call time *inside* the
    container — and because `bar_detection` imports `onnxruntime` lazily, a
    missing runtime aborted the whole pose analysis (2026-09-27). This imports
    nothing; it just parses the mounted sources.
    """
    from app.integrations.modal_client import _MODAL_PIP_PACKAGES

    installed = {
        p.split(">=")[0].split("==")[0].split("<")[0].strip()
        for p in _MODAL_PIP_PACKAGES
    }
    backend_root = Path(__file__).resolve().parent.parent
    paths = [backend_root / "app" / "integrations" / n for n in MOUNTED_MODULES]
    paths += [backend_root / sub / Path(rel).name for rel, sub in MOUNTED_EXTRA]
    missing: dict[str, set[str]] = {}
    for path in paths:
        if not path.exists():
            continue
        for imp in _third_party_imports(path):
            pkg = _IMPORT_TO_PIP.get(imp, imp)
            if pkg not in installed:
                missing.setdefault(path.name, set()).add(imp)
    assert not missing, (
        f"mounted modules import packages the Modal image does not install "
        f"(add them to _MODAL_PIP_PACKAGES): {missing}"
    )


def test_mounted_modules_exist_and_are_referenced_by_the_image():
    """Every module the pipeline imports must actually be mounted.

    A module present in the repo but absent from the image only fails at call
    time *inside* the container, with the rest of the analysis already lost
    (pitfall #34 — this is how the `onnxruntime` and the pose/bar-tracking
    imports each silently killed a whole video). This resolves the mount list
    against the real files and against ``_get_modal_image``'s own targets.
    """
    from app.integrations import modal_client

    src = Path(modal_client.__file__).read_text(encoding="utf-8")
    backend_root = Path(__file__).resolve().parent.parent

    for name in MOUNTED_MODULES:
        path = backend_root / "app" / "integrations" / name
        assert path.exists(), f"{name} is mounted but does not exist"
        assert f"/root/app/integrations/{name}" in src, (
            f"{name} is not mounted into the Modal image"
        )
    for rel, sub in MOUNTED_EXTRA:
        path = backend_root / "app" / sub / Path(rel).name
        assert path.exists(), f"{rel} is mounted but does not exist"
        assert f"/root/app/{sub}/{path.name}" in src, (
            f"{rel} is not mounted into the Modal image"
        )


def test_bar_tracking_3d_imports_only_installed_packages():
    """``bar_tracking_3d`` must stay pure NumPy (it is mounted into the video
    container alongside the heavy modules)."""
    path = (
        Path(__file__).resolve().parent.parent
        / "app" / "integrations" / "bar_tracking_3d.py"
    )
    assert _third_party_imports(path) <= {"numpy"}


def test_modal_image_installs_onnxruntime():
    """The video Modal image must install ``onnxruntime``.

    The T3 learned bar detector (``bar_detection.detect_bars_onnx``) imports
    ``onnxruntime`` lazily, so a missing runtime only fails at call time inside
    the container — and because the ONNX branch is taken whenever
    ``VIDEO_BAR_DETECTOR_MODEL`` is set, it aborted the whole pose analysis
    (production regression 2026-09-27).
    """
    from app.integrations.modal_client import _MODAL_PIP_PACKAGES

    names = {p.split(">=")[0].split("==")[0].strip() for p in _MODAL_PIP_PACKAGES}
    assert "onnxruntime" in names


def test_worker_modules_import_without_config_or_pydantic():
    """The Modal remote container imports each worker module from a bare image.

    Regression guard for the failure where every compute Modal job crash-looped
    with ``ModuleNotFoundError: pydantic_settings`` because the modules imported
    ``app.config`` at import time. Blocking ``app.config`` / ``pydantic`` in a
    fresh interpreter simulates the remote image — if a worker module drags any
    of them in at module scope, this import fails.
    """
    module_names = sorted(module.__name__ for module, _ in WORKERS)
    code = textwrap.dedent(
        f"""
        import importlib
        import sys

        BLOCKED = ("app.config", "pydantic", "pydantic_settings")

        class _Blocker:
            def find_spec(self, name, path=None, target=None):
                if name in BLOCKED:
                    raise ModuleNotFoundError(name)
                return None

        sys.meta_path.insert(0, _Blocker())

        for name in {module_names!r}:
            importlib.import_module(name)

        print("IMPORT_OK")
        """
    )
    backend_root = Path(__file__).resolve().parent.parent
    env = dict(os.environ)
    existing = env.get("PYTHONPATH", "")
    env["PYTHONPATH"] = (
        f"{backend_root}{os.pathsep}{existing}" if existing else str(backend_root)
    )
    result = subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        env=env,
    )
    assert result.returncode == 0, result.stderr
    assert "IMPORT_OK" in result.stdout
