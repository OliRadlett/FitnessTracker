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
