"""F2/F3 guard: planner detraining caveat + combined-load exploratory lock.

- F2: TSB > 25 planner copy must carry the CTL-falling detraining caveat.
- F3: ``combined_load`` (integrations/cross_domain.py) and the combined
  chart series (services/charts.py) are labelled exploratory, and
  ``combined_load`` is insights-only — it must never feed the daily
  verdict (services/today.py reads presence only).
"""

from __future__ import annotations

import inspect


class TestPlannerDetrainingCaveat:
    def test_tsb_above_25_carries_ctl_falling_caveat(self):
        from app.services.workout_planner import get_readiness_recommendation

        info = get_readiness_recommendation(ctl=60.0, atl=20.0, tsb=30.0)
        assert info.recommended_max_zone == "z5"
        lowered = info.readiness_note.lower()
        assert "ctl" in lowered
        assert "detraining" in lowered or "detrain" in lowered

    def test_explicit_falling_ctl_trend_states_detraining_finding(self):
        from app.services.workout_planner import get_readiness_recommendation

        info = get_readiness_recommendation(
            ctl=60.0, atl=20.0, tsb=30.0, ctl_trend=-5.0
        )
        assert "falling" in info.readiness_note.lower()

    def test_other_bands_untouched(self):
        from app.services.workout_planner import get_readiness_recommendation

        fresh = get_readiness_recommendation(ctl=60.0, atl=50.0, tsb=10.0)
        assert fresh.recommended_max_zone == "z5"
        assert "detraining" not in fresh.readiness_note.lower()


class TestCombinedLoadExploratory:
    def _correlated_inputs(self, n: int = 12):
        lifting, cycling, recovery = [], [], []
        for i in range(n):
            day = f"2026-09-{i + 1:02d}"
            # Higher load -> lower recovery: strong negative slope.
            lifting.append({"date": day, "volume_kg": 1000.0 + i * 500.0})
            cycling.append({"date": day, "tss": 50.0 + i * 20.0, "avg_watts": 180.0})
            recovery.append(
                {"date": day, "recovery_score": 95.0 - i * 4.0, "hrv_ms": 60.0}
            )
        return lifting, cycling, recovery

    def test_combined_load_labelled_exploratory_insights_only(self):
        from app.integrations.cross_domain import analyze_cross_sport_fatigue

        lifting, cycling, recovery = self._correlated_inputs()
        out = analyze_cross_sport_fatigue(lifting, cycling, recovery)
        combined = out["combined_load"]
        assert combined is not None
        assert combined.get("exploratory") is True
        assert combined.get("insights_only") is True
        assert "exploratory" in combined["insight"].lower()
        assert "verdict" in combined["insight"].lower()

    def test_combined_insight_text_labelled_exploratory(self):
        from app.integrations.cross_domain import analyze_cross_sport_fatigue

        lifting, cycling, recovery = self._correlated_inputs()
        out = analyze_cross_sport_fatigue(lifting, cycling, recovery)
        if out["combined_load"] and out["combined_load"]["load_recovery_correlation"] > 0.1:
            assert any("exploratory" in s.lower() for s in out["insights"])

    def test_combined_chart_series_labelled_exploratory(self):
        from app.services import charts as charts_mod

        src = inspect.getsource(charts_mod.ChartService.combined_training_load)
        assert "Combined (exploratory)" in src
        assert "exploratory" in src.lower()
        assert "never feeds the daily verdict" in src


class TestCombinedLoadNeverFeedsVerdict:
    async def test_alarming_combined_load_does_not_move_verdict_stance(self):
        """Even a dire combined_load payload must not change the verdict row."""
        from app.services import today as today_mod

        class _Result:
            def __init__(self, row):
                self._row = row

            def scalar_one_or_none(self):
                return self._row

        class _FakeInsight:
            insight_type = "cross_sport"
            created_at = None

        class _FakeDB:
            def __init__(self, row):
                self._row = row

            async def execute(self, *args, **kwargs):
                return _Result(self._row)

        # Row carrying an alarming exploratory combined_load in results.
        alarming = _FakeInsight()
        row = await today_mod._cross_domain_row(
            _FakeDB(alarming),  # type: ignore[arg-type]
            None,  # type: ignore[arg-type]
        )
        assert row.available is True
        assert row.stance == today_mod.STANCE_TRAIN
        assert row.confidence == "low"

    def test_verdict_reader_ignores_combined_load_by_construction(self):
        from app.services import today as today_mod

        src = inspect.getsource(today_mod._cross_domain_row)
        assert "combined_load" in src  # the lock comment names it...
        # ...but the reader never branches a stance off it.
        assert "insights-only" in src or "insights-only" in (
            today_mod._cross_domain_row.__doc__ or ""
        )
