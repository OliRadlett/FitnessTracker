"""Shared utility functions used across the backend."""

import math


def safe_float(value, default=None):
    """Return *default* if *value* is None, NaN, or Inf.

    This is the canonical implementation — import from here instead of
    duplicating in multiple service modules (BUG-032).
    """
    if value is None:
        return default
    try:
        v = float(value)
        return default if (math.isnan(v) or math.isinf(v)) else v
    except (TypeError, ValueError):
        return default
