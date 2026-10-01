"""The unified daily verdict (plan §1).

Five engines already existed and each reached a different conclusion; ``/today``
read only one of them. These tests pin the properties that make composing them
honest rather than merely impressive:

- **Every engine appears in ``consensus``,** whether or not it had something to
  say. A verdict built from the engines that happened to speak reads as unanimous
  agreement, which is the failure mode this section exists to remove.
- **Absence is reported with a reason,** so "runs weekly, not yet" is
  distinguishable from "broken" and from "no weakness found".
- **One failing engine does not lose the verdict.** Each is wrapped
  independently; a verdict that fails because an optional weekly job has not run
  is worse than a thinner one.
- **The headline follows the strongest rest signal, not the average.** Averaging
  "train" and "rest" yields "train, but rest", and the athlete acts on the first
  word.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models.cross_domain import CrossDomainInsight
from app.schemas.dashboard import RestDaySuggestion, TodayVerdict
from app.services import today as today_service

pytestmark = pytest.mark.integration

ENGINES = {
    "rest_day_suggestion",
    "adaptive",
    "deficiency",
    "cross_domain",
    "projection",
}


def _rest_suggestion(
    *, should_rest: bool = False, reasons=None, recovery=None, tsb=None
) -> RestDaySuggestion:
    return RestDaySuggestion(
        should_rest=should_rest,
        reasons=reasons or [],
        latest_recovery=recovery,
        current_tsb=tsb,
    )


def _engines(verdict: dict, name: str) -> list[dict]:
    return [row for row in verdict["consensus"] if row["engine"] == name]


async def _verdict(db_session, user_id, *, rest=None, plan_id=None) -> dict:
    return await today_service.compute_today_verdict(
        db_session, user_id, rest_day_suggestion=rest, plan_id=plan_id
    )


class TestProvenance:
    async def test_every_engine_appears_even_when_silent(self, db_session, test_user):
        """The core of §1: five engines, five rows, regardless of outcome.

        With no plan, no data and no cross-domain run, every engine still has a
        row. If silence produced no row, the consensus would be indistinguishable
        from a verdict where every engine agreed.
        """
        verdict = await _verdict(db_session, test_user.id)
        named = {row["engine"] for row in verdict["consensus"]}
        assert named == ENGINES

    async def test_unavailable_engines_carry_a_reason(self, db_session, test_user):
        verdict = await _verdict(db_session, test_user.id)
        for row in verdict["consensus"]:
            if not row["available"]:
                assert row["reason"], (
                    f"{row['engine']} is unavailable with no reason; the user "
                    "cannot tell a scheduled gap from a failure"
                )

    async def test_cross_domain_absence_is_reported_not_hidden(
        self, db_session, test_user
    ):
        """Cross-domain is this app's thesis, and it used to vanish silently.

        ``GET /cross-domain`` raises 404 when empty, so before this the signal
        simply did not reach ``/today``. Now it is an explicit unavailable row.
        """
        verdict = await _verdict(db_session, test_user.id)
        row = _engines(verdict, "cross_domain")[0]
        assert row["available"] is False
        assert "weekly" in row["reason"].lower()
        assert "sunday" in row["reason"].lower()

    async def test_cross_domain_present_is_reported_as_available(
        self, db_session, test_user
    ):
        db_session.add(
            CrossDomainInsight(
                user_id=test_user.id,
                insight_type="sleep_performance",
                period_start=datetime.now(UTC) - timedelta(days=8),
                period_end=datetime.now(UTC) - timedelta(days=2),
                results=[{"r": 0.6}],
                insights=["Sleep tracks TSS across the block."],
                data_quality="ok",
                created_at=datetime.now(UTC) - timedelta(days=2),
            )
        )
        await db_session.flush()

        verdict = await _verdict(db_session, test_user.id)
        row = _engines(verdict, "cross_domain")[0]
        assert row["available"] is True
        assert row["analyzed_at"] is not None

    async def test_deficiency_with_nothing_wrong_is_available_not_absent(
        self, db_session, test_user
    ):
        """"No weaknesses" is a *finding*. It must not read as "did not run"."""
        verdict = await _verdict(db_session, test_user.id)
        row = _engines(verdict, "deficiency")[0]
        assert row["available"] is True
        assert row["reason"] is not None  # why it voted "train"
        assert "weakness" in row["reason"].lower()


class TestFailOpen:
    async def test_one_broken_engine_does_not_lose_the_verdict(
        self, db_session, test_user, monkeypatch
    ):
        """Each engine degrades alone. The verdict still renders.

        A verdict that 500s because an optional weekly analysis job has not run
        yet would make ``/today`` useless on exactly the days it matters most.
        """

        async def _boom(db, user_id, weeks=8):
            raise RuntimeError("deficiency exploded")

        monkeypatch.setattr("app.services.deficiency.analyze_deficiencies", _boom)

        verdict = await _verdict(db_session, test_user.id)
        assert verdict["headline"], "a broken engine must not blank the headline"
        row = _engines(verdict, "deficiency")[0]
        assert row["available"] is False
        assert "deficiency exploded" in row["reason"]
        # The others still spoke.
        assert {r["engine"] for r in verdict["consensus"]} == ENGINES

    async def test_a_broken_projection_does_not_lose_the_verdict(
        self, db_session, test_user, monkeypatch
    ):
        async def _boom(db, user_id, plan_id, days_ahead=14):
            raise RuntimeError("projection exploded")

        monkeypatch.setattr("app.services.projections.compute_tsb_projection", _boom)
        # A plan id so the projection path is actually entered.
        verdict = await _verdict(db_session, test_user.id, plan_id=uuid.uuid4())
        row = _engines(verdict, "projection")[0]
        assert row["available"] is False
        assert "projection exploded" in row["reason"]
        assert verdict["headline"]


class TestVerdictLogic:
    async def test_recovery_low_makes_it_rest(self, db_session, test_user):
        verdict = await _verdict(
            db_session,
            test_user.id,
            rest=_rest_suggestion(should_rest=True, recovery=32.0, tsb=-30.0),
        )
        assert verdict["should_rest"] is True
        assert "easy" in verdict["headline"].lower()

    async def test_healthy_day_does_not_rest(self, db_session, test_user):
        verdict = await _verdict(
            db_session,
            test_user.id,
            rest=_rest_suggestion(should_rest=False, recovery=82.0, tsb=12.0),
        )
        assert verdict["should_rest"] is False
        assert verdict["headline"]

    async def test_tsb_vote_is_separate_from_the_rest_suggestion(
        self, db_session, test_user
    ):
        """Deeply negative TSB is its own signal, not a rest-day flag.

        ``_suggest_rest_days`` already folds TSB in, but exposing it as its own
        consensus row is what makes a disagreement legible: the reader can see
        that load said rest even when recovery did not.
        """
        verdict = await _verdict(
            db_session, test_user.id, rest=_rest_suggestion(recovery=70.0, tsb=-31.0)
        )
        tsb_row = _engines(verdict, "tsb")
        assert tsb_row, "TSB at or below -25 must be represented"
        assert tsb_row[0]["stance"] == "cut"
        assert tsb_row[0]["confidence"] == "high"

    async def test_a_healthy_tsb_produces_no_vote(self, db_session, test_user):
        """No row for TSB when it is fine — silence means "not a signal"."""
        verdict = await _verdict(
            db_session, test_user.id, rest=_rest_suggestion(recovery=70.0, tsb=8.0)
        )
        assert _engines(verdict, "tsb") == []

    async def test_the_strongest_rest_signal_wins_not_the_average(
        self, db_session, test_user
    ):
        """One engine saying "rest" at high confidence is enough.

        Averaging that against three engines saying "train" produces "train, but
        rest" — and the athlete acts on the first word, which would be the wrong
        one.
        """
        verdict = await _verdict(
            db_session,
            test_user.id,
            rest=_rest_suggestion(should_rest=True, recovery=35.0, tsb=-28.0),
        )
        assert verdict["should_rest"] is True

    async def test_reasons_are_populated_when_resting(self, db_session, test_user):
        verdict = await _verdict(
            db_session,
            test_user.id,
            rest=_rest_suggestion(
                should_rest=True, reasons=["Recovery 38% (below 40)"], recovery=38.0
            ),
        )
        assert verdict["should_rest"] is True
        assert verdict["reasons"], "a rest verdict must say why"


class TestProjection:
    async def test_no_plan_means_no_projection_and_that_is_stated(
        self, db_session, test_user
    ):
        verdict = await _verdict(db_session, test_user.id)
        row = _engines(verdict, "projection")[0]
        assert row["available"] is False
        assert "plan" in row["reason"].lower()
        assert verdict["projected_load"] == []

    async def test_projection_points_are_validated_by_the_schema(
        self, db_session, test_user
    ):
        """The dict the service returns must satisfy ``TodayVerdict``.

        Asserted because the service builds plain dicts and the endpoint
        validates them — a shape drift between the two would surface only as a
        500 on ``/today``, and the fail-open would silently blank the verdict.
        """
        verdict = await _verdict(
            db_session,
            test_user.id,
            rest=_rest_suggestion(),
        )
        validated = TodayVerdict.model_validate(verdict)
        assert validated.headline
        assert {c.engine for c in validated.consensus} == ENGINES

    async def test_projection_with_a_plan_does_not_crash_the_verdict(
        self, db_session, test_user
    ):
        """A plan id that does not exist is a real case, not a test artefact.

        ``compute_tsb_projection`` raises for an unknown plan; the verdict must
        absorb that rather than propagate it.
        """
        verdict = await _verdict(
            db_session, test_user.id, rest=_rest_suggestion(), plan_id=uuid.uuid4()
        )
        row = _engines(verdict, "projection")[0]
        assert row["available"] is False
        assert verdict["headline"]


class TestStanceReduction:
    """The adaptive engine returns actions, not a verdict. Pure function."""

    def test_rest_day_action_becomes_cut(self):
        stance, _ = today_service._stance_from_adaptive(
            {"suggestions": [{"type": "rest_day", "severity": "warning"}]}
        )
        assert stance == "cut"

    def test_reduce_load_becomes_cut(self):
        stance, _ = today_service._stance_from_adaptive(
            {"suggestions": [{"type": "reduce_load", "severity": "warning"}]}
        )
        assert stance == "cut"

    def test_add_easy_becomes_add(self):
        stance, _ = today_service._stance_from_adaptive(
            {"suggestions": [{"type": "add_easy", "severity": "info"}]}
        )
        assert stance == "add"

    def test_no_actions_means_train(self):
        stance, _ = today_service._stance_from_adaptive(
            {"suggestions": [], "fatigue": {"level": "moderate"}}
        )
        assert stance == "train"

    def test_high_fatigue_forces_cut_even_without_actions(self):
        """Fatigue is a signal in its own right, not only via a suggestion."""
        stance, _ = today_service._stance_from_adaptive(
            {"suggestions": [], "fatigue": {"level": "high"}}
        )
        assert stance == "cut"

    def test_missing_keys_do_not_crash_the_reduction(self):
        """Engines return varying shapes; the reduction must not assume."""
        stance, confidence = today_service._stance_from_adaptive({})
        assert stance == "train"
        assert confidence

    def test_critical_severity_raises_confidence(self):
        _, confidence = today_service._stance_from_adaptive(
            {"suggestions": [{"type": "rest_day", "severity": "critical"}]}
        )
        assert confidence == "high"


class TestRestDayUnaffected:
    async def test_legacy_rest_suggestion_still_shapes_the_verdict(
        self, db_session, test_user
    ):
        """Back-compat: the legacy field is an input, not a casualty.

        ``RestDayBanner`` and ``DashboardSummary`` both still read it, so the
        verdict must consume it rather than replace it.
        """
        rest = _rest_suggestion(should_rest=True, recovery=30.0, tsb=-40.0)
        verdict = await _verdict(db_session, test_user.id, rest=rest)
        row = _engines(verdict, "rest_day_suggestion")[0]
        assert row["stance"] == "rest"
        assert row["available"] is True

    async def test_a_missing_rest_suggestion_does_not_crash(
        self, db_session, test_user
    ):
        """``rest_day_suggestion`` is optional in the signature.

        It still gets a row, marked unavailable — "no input" and "nothing to
        say" are different, and emitting nothing would make the four remaining
        engines look unanimous.
        """
        verdict = await _verdict(db_session, test_user.id, rest=None)
        assert verdict["headline"]
        row = _engines(verdict, "rest_day_suggestion")[0]
        assert row["available"] is False
        assert row["reason"]