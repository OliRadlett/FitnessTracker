"""Weekly label aggregation for the Jev session-label charts."""

from __future__ import annotations

from datetime import date

from app.services.charts import _weekly_label_counts


def test_zero_fills_weeks_and_counts_labels():
    rows = [
        (date(2026, 1, 5), "max_strength"),  # Monday, week of 2026-01-05
        (date(2026, 1, 7), "max_strength"),  # Wednesday, same week
        (date(2026, 1, 12), "volume_hypertrophy"),  # next week
    ]
    weeks, counts = _weekly_label_counts(
        rows, ("max_strength", "volume_hypertrophy", "deload")
    )
    assert weeks == ["2026-01-05", "2026-01-12"]
    assert counts["max_strength"] == [2, 0]
    assert counts["volume_hypertrophy"] == [0, 1]
    # A label with no sessions is still a zero-filled series.
    assert counts["deload"] == [0, 0]


def test_empty_rows():
    weeks, counts = _weekly_label_counts([], ("max_strength",))
    assert weeks == []
    assert counts["max_strength"] == []


def test_unknown_and_null_labels_do_not_count():
    rows = [(date(2026, 1, 5), None), (date(2026, 1, 5), "bogus")]
    weeks, counts = _weekly_label_counts(rows, ("max_strength",))
    assert weeks == ["2026-01-05"]
    assert counts["max_strength"] == [0]
