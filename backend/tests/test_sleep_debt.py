"""Sleep debt should be measured against the requirement, not a constant.

Whoop publishes a per-night requirement — a personal baseline plus the night's
debt, recent strain and recent naps — and ``sync_whoop_sleep`` has always stored
the whole payload in ``SleepLog.raw_data``. Nothing read it, so the app scored
every night against a flat 8 hours. That is not a rounding difference: a 7-hour
night after a heavy session is not debt, and scoring it as debt hides the reason
the requirement was higher.

These tests pin the priority order (provider requirement per night, falling back
per night rather than per window) and the fact that a night without the payload
still counts.
"""

from __future__ import annotations

import pytest

from app.models.sleep import SleepLog
from app.services.whoop import compute_sleep_debt, whoop_sleep_need


def _log(
    total_hours: float,
    *,
    baseline: float | None = None,
    debt: float | None = None,
    strain: float | None = None,
    nap: float | None = None,
    performance: float | None = None,
) -> SleepLog:
    """A SleepLog carrying (or not) Whoop's sleep_need decomposition."""
    needed: dict[str, int] = {}
    for key, value in (
        ("baseline", baseline),
        ("need_from_sleep_debt", debt),
        ("need_from_recent_strain", strain),
        ("need_from_recent_nap", nap),
    ):
        if value is not None:
            needed[f"{key}_milli"] = int(value * 3_600_000)

    score: dict = {}
    if needed:
        score["sleep_needed"] = needed
    if performance is not None:
        score["sleep_performance_percentage"] = performance

    return SleepLog(
        total_sleep_seconds=int(total_hours * 3600),
        raw_data={"score": score} if score else None,
    )


class TestSleepNeedExtraction:
    def test_sums_the_provider_components(self):
        need = whoop_sleep_need(
            _log(7.0, baseline=8.0, debt=0.25, strain=0.5, nap=0.0, performance=84.0)
        )

        assert need is not None
        assert need["need_hours"] == pytest.approx(8.75)
        assert need["baseline_hours"] == pytest.approx(8.0)
        assert need["strain_component_hours"] == pytest.approx(0.5)
        assert need["performance_percent"] == 84.0

    def test_a_partial_decomposition_still_yields_a_requirement(self):
        """Whoop omits zero components rather than sending zeros."""
        need = whoop_sleep_need(_log(7.0, baseline=8.2, strain=0.4))

        assert need is not None
        assert need["need_hours"] == pytest.approx(8.6)
        assert need["debt_component_hours"] is None

    @pytest.mark.parametrize(
        "log",
        [
            _log(7.0),  # no payload at all
            SleepLog(total_sleep_seconds=25200, raw_data={}),
            SleepLog(total_sleep_seconds=25200, raw_data={"score": {}}),
        ],
    )
    def test_missing_payload_is_none_not_zero(self, log):
        """A missing requirement must fall back, never count as "needed nothing"."""
        assert whoop_sleep_need(log) is None


class TestSleepDebt:
    def test_falls_back_to_the_flat_target_without_provider_data(self):
        logs = [_log(7.5), _log(7.5), _log(7.5)]

        debt = compute_sleep_debt(logs, needed_hours=8.0)

        assert debt["debt_hours"] == pytest.approx(1.5)
        assert debt["days_below_target"] == 3
        assert debt["provider_nights"] == 0
        assert debt["nights_counted"] == 3

    def test_prefers_the_provider_requirement_for_the_night(self):
        """8.75h needed, 7.5h slept = 1.25h of debt, not the 0.5h a flat 8h implies.

        ``debt_hours`` is reported to one decimal (an hours figure for a UI), so
        1.25 surfaces as 1.2. The point of the test is which requirement was used,
        not the last digit.
        """
        logs = [_log(7.5, baseline=8.0, strain=0.5, nap=0.0, debt=0.25)]

        debt = compute_sleep_debt(logs, needed_hours=8.0)

        assert debt["debt_hours"] == pytest.approx(1.2)
        assert debt["days_below_target"] == 1
        assert debt["provider_nights"] == 1

    def test_a_short_night_that_met_a_lower_requirement_is_not_debt(self):
        """The case a flat target gets wrong in the other direction.

        A 7h night with a 7h requirement is not debt, but an 8h default would
        count it as an hour short — and `days_below_target` would nag about it.
        """
        logs = [_log(7.0, baseline=7.0)]

        debt = compute_sleep_debt(logs, needed_hours=8.0)

        assert debt["debt_hours"] == 0
        assert debt["days_below_target"] == 0

    def test_mixed_window_falls_back_per_night_not_per_window(self):
        """An older night without the payload still counts, at the flat target."""
        logs = [
            _log(8.0, baseline=9.0),  # 1h short of its own 9h requirement
            _log(7.0),  # no payload → 1h short of the flat 8h target
        ]

        debt = compute_sleep_debt(logs, needed_hours=8.0)

        assert debt["debt_hours"] == pytest.approx(2.0)
        assert debt["provider_nights"] == 1
        assert debt["nights_counted"] == 2
        assert debt["avg_sleep_hours"] == pytest.approx(7.5)

    def test_reports_the_most_recent_decomposition(self):
        logs = [
            _log(8.0, baseline=7.5),
            _log(8.0, baseline=8.5, strain=0.5),
        ]

        need = compute_sleep_debt(logs)["sleep_need"]

        assert need is not None
        assert need["baseline_hours"] == pytest.approx(8.5)

    def test_empty_window_is_zeroes_not_a_crash(self):
        assert compute_sleep_debt([]) == {
            "debt_hours": 0,
            "avg_sleep_hours": 0,
            "days_below_target": 0,
            "nights_counted": 0,
            "provider_nights": 0,
            "sleep_need": None,
        }

    def test_nights_without_a_duration_are_skipped(self):
        logs = [_log(7.0), SleepLog(total_sleep_seconds=None, raw_data=None)]

        debt = compute_sleep_debt(logs, needed_hours=8.0)

        assert debt["nights_counted"] == 1
        assert debt["debt_hours"] == pytest.approx(1.0)
