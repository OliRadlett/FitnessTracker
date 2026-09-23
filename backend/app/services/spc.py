"""Statistical process control for technique metrics (§3.18 / F5).

Turns a per-exercise metric series (form score, bar speed, bar-path
consistency, …) into an X̄ control chart: mean ± kσ limits and whether the
latest value is a genuine move (outside the limits) or normal noise. This is
what separates a real regression from week-to-week wobble.

Pure — unit-testable without a database.
"""

from __future__ import annotations


def compute_control(values: list, sigma_threshold: float = 2.0) -> dict:
    """Control limits + latest-point status for a metric series (oldest first).

    ``status`` is ``"insufficient"`` (<5 points), ``"normal"``, ``"above"`` or
    ``"below"`` (latest outside mean ± kσ). ``z`` is the latest value's
    z-score.
    """
    vals = [float(v) for v in values if v is not None]
    n = len(vals)
    if n < 5:
        return {
            "n": n, "mean": None, "sigma": None, "ucl": None, "lcl": None,
            "latest": round(vals[-1], 3) if vals else None,
            "z": None, "sigma_threshold": sigma_threshold,
            "status": "insufficient",
        }

    mean = sum(vals) / n
    sigma = (sum((v - mean) ** 2 for v in vals) / n) ** 0.5
    latest = vals[-1]
    if sigma <= 1e-9:
        z, status = 0.0, "normal"
    else:
        z = (latest - mean) / sigma
        if z > sigma_threshold:
            status = "above"
        elif z < -sigma_threshold:
            status = "below"
        else:
            status = "normal"

    return {
        "n": n,
        "mean": round(mean, 3),
        "sigma": round(sigma, 3),
        "ucl": round(mean + sigma_threshold * sigma, 3),
        "lcl": round(mean - sigma_threshold * sigma, 3),
        "latest": round(latest, 3),
        "z": round(z, 2),
        "sigma_threshold": sigma_threshold,
        "status": status,
    }
