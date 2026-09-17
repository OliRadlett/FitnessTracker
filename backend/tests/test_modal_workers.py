"""Modal remote workers must live at module global scope.

Modal raises ``InvalidError`` for functions defined inside other functions
(closures carry ``<locals>`` in ``__qualname__`` and cannot be serialized).
This test guards the five Modal dispatch modules against regressing to the
closure pattern: each worker must be a module-level function with no free
variables.
"""

import inspect

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
