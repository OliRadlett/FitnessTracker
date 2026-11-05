"""Time-aware windowing for stream-derived cycling metrics.

A stream's sample interval is not guaranteed to be one second: Strava smart
recording, FIT smart recording and decimated exports all produce irregular
grids, and ``ActivityStream.resolution`` is often ``NULL``. A window measured
in samples is therefore not a window measured in seconds.

These helpers take the ``time`` stream alongside the value stream. They are
pure Python (the backend does not ship numpy at runtime) and deliberately
small: resample the recording to 1 Hz, then reuse the standard 30-second
rolling / best-window definitions.
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from itertools import pairwise

#: A break longer than this is a stop, not a sample interval.
MAX_GAP_S = 5.0


def _finite_pairs(
    time_s: Sequence[float | None], values: Sequence[float | None]
) -> list[tuple[float, float]]:
    pairs: list[tuple[float, float]] = []
    for raw_time, raw_value in zip(time_s, values):
        if raw_time is None or raw_value is None:
            continue
        try:
            t = float(raw_time)
            v = float(raw_value)
        except (TypeError, ValueError):
            continue
        if math.isfinite(t) and math.isfinite(v):
            pairs.append((t, v))
    pairs.sort(key=lambda pair: pair[0])
    return pairs


def resample_1hz(
    time_s: Sequence[float | None], values: Sequence[float | None]
) -> list[float]:
    """Linear 1 Hz resample over the recording span.

    The recording's first and last whole seconds define the grid. Gaps are
    interpolated, matching the reference used by the science bench; a stop
    longer than ``MAX_GAP_S`` is still interpolated here because the existing
    provider NP does the same. ``zone_seconds`` excludes stops explicitly.
    """
    pairs = _finite_pairs(time_s, values)
    if len(pairs) < 2:
        return []
    start = math.ceil(pairs[0][0])
    end = math.floor(pairs[-1][0])
    if end < start:
        return []

    out: list[float] = []
    index = 0
    for second in range(start, end + 1):
        while index + 1 < len(pairs) and pairs[index + 1][0] < second:
            index += 1
        t0, v0 = pairs[index]
        if index + 1 < len(pairs):
            t1, v1 = pairs[index + 1]
            if t1 == t0:
                out.append(v0)
            else:
                out.append(v0 + (v1 - v0) * (second - t0) / (t1 - t0))
        else:
            out.append(v0)
    return out


def normalized_power(
    time_s: Sequence[float | None], power_data: Sequence[float | None]
) -> float | None:
    """NP on a 1 Hz grid: 30 s rolling mean, 4th-power mean, 4th root."""
    resampled = resample_1hz(time_s, power_data)
    if len(resampled) < 31:
        return None
    rolling: list[float] = []
    window = sum(resampled[:30])
    rolling.append(window / 30.0)
    for index in range(1, len(resampled) - 29):
        window = window - resampled[index - 1] + resampled[index + 29]
        rolling.append(window / 30.0)
    return round((sum(value**4 for value in rolling) / len(rolling)) ** 0.25, 1)


def best_power(
    time_s: Sequence[float | None],
    power_data: Sequence[float | None],
    duration_s: int,
) -> float | None:
    """Best mean power over ``duration_s`` seconds on the time axis."""
    resampled = resample_1hz(time_s, power_data)
    if duration_s <= 0 or len(resampled) < duration_s:
        return None
    prefix = [0.0]
    for value in resampled:
        prefix.append(prefix[-1] + value)
    best = 0.0
    for index in range(duration_s, len(prefix)):
        total = prefix[index] - prefix[index - duration_s]
        best = max(best, total)
    return round(best / duration_s, 1)


def best_power_curve(
    time_s: Sequence[float | None],
    power_data: Sequence[float | None],
    durations: Sequence[int],
) -> dict[int, float]:
    """Best mean power for several durations from one resample.

    The power-curve caller asks for a dozen buckets over the same stream;
    resampling once keeps that O(n + buckets×n), not O(buckets×n) with a
    second sort/interpolation per bucket.
    """
    resampled = resample_1hz(time_s, power_data)
    if len(resampled) < 2:
        return {}
    prefix = [0.0]
    for value in resampled:
        prefix.append(prefix[-1] + value)
    out: dict[int, float] = {}
    for duration_s in sorted(set(durations)):
        if duration_s <= 0 or duration_s > len(resampled):
            continue
        best = 0.0
        for index in range(duration_s, len(prefix)):
            total = prefix[index] - prefix[index - duration_s]
            best = max(best, total)
        out[duration_s] = round(best / duration_s, 1)
    return out


def sample_weights(time_s: Sequence[float | None]) -> list[float]:
    """Per-sample duration in seconds, capped so a stop cannot dominate."""
    clean = [float(t) for t in time_s if t is not None and math.isfinite(float(t))]
    if len(clean) < 2:
        return []
    diffs = [b - a for a, b in pairwise(clean)]
    median = sorted(diffs)[len(diffs) // 2] if diffs else 1.0
    return [min(max(delta, 0.0), MAX_GAP_S) for delta in [median, *diffs]]


def zone_seconds(
    power_data: Sequence[float | None],
    time_s: Sequence[float | None],
    ftp: float,
    zones: Sequence[tuple[str, str, float, float]],
) -> dict[str, float]:
    """Seconds per power zone, using each sample's real duration."""
    totals = {zone[0]: 0.0 for zone in zones}
    if not ftp or ftp <= 0:
        return totals
    pairs = _finite_pairs(time_s, power_data)
    if len(pairs) < 2:
        return totals
    for index, (_, watts) in enumerate(pairs):
        if watts <= 0:
            continue
        if index == 0:
            delta = pairs[1][0] - pairs[0][0]
        else:
            delta = pairs[index][0] - pairs[index - 1][0]
        if delta > MAX_GAP_S:
            # A stop is not time in a zone.
            continue
        delta = max(delta, 0.0)
        fraction = watts / ftp
        for zone_id, _, lower, upper in zones:
            if lower <= fraction < upper:
                totals[zone_id] += delta
                break
        else:
            totals[zones[-1][0]] += delta
    return totals
