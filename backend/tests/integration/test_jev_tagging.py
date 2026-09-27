"""Jev lifting-note tagging (Phase 1).

Run with:  pytest tests/integration/test_jev_tagging.py -m integration
"""

from __future__ import annotations

from datetime import date

import pytest

from app.integrations import jev_client
from app.integrations.jev_client import JevAnswer, JevResult
from app.models.lifting import LiftingSession
from app.services import jev_tagging

pytestmark = pytest.mark.integration


def _result(*, pain=0.85, fatigue=0.2, pr=0.1, outcome="grind", outcome_conf=0.7, energy=1.0):
    return JevResult(
        answers={
            "pain_injury": JevAnswer("noul", noul=pain, confidence=0.8),
            "high_fatigue": JevAnswer("noul", noul=fatigue, confidence=0.8),
            "pr_mention": JevAnswer("noul", noul=pr, confidence=0.8),
            "outcome": JevAnswer("choice", choice=outcome, confidence=outcome_conf),
            "energy": JevAnswer("score", score=energy, confidence=0.6),
        },
        model="jev-test",
        computed_at="2026-09-27T00:00:00Z",
    )


async def _fake_decide(state, questions, **kwargs):
    return _result()


def _session(user_id, notes: str) -> LiftingSession:
    return LiftingSession(
        user_id=user_id, session_date=date.today(), focus="squat", notes=notes
    )


class TestTagging:
    async def test_stores_tags_and_is_idempotent(self, db_session, test_user, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)
        monkeypatch.setattr(jev_client, "decide", _fake_decide)

        session = _session(test_user.id, "Left knee felt sore after set 3. Grinded.")
        db_session.add(session)
        await db_session.flush()

        assert await jev_tagging.tag_lifting_session(db_session, test_user.id, session)
        tags = session.ai_tags
        assert tags["source"] == "jev"
        assert tags["pain_injury"] == 0.85
        assert tags["outcome"] == "grind"
        assert tags["note_hash"]

        # Same note + model → no-op.
        assert not await jev_tagging.tag_lifting_session(
            db_session, test_user.id, session
        )

    async def test_noop_when_unconfigured(self, db_session, test_user, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: False)
        session = _session(test_user.id, "anything at all")
        db_session.add(session)
        await db_session.flush()

        assert not await jev_tagging.tag_lifting_session(
            db_session, test_user.id, session
        )
        assert session.ai_tags is None

    async def test_empty_note_is_skipped(self, db_session, test_user, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)
        session = _session(test_user.id, "   ")
        db_session.add(session)
        await db_session.flush()
        assert not await jev_tagging.tag_lifting_session(
            db_session, test_user.id, session
        )


def test_build_tags_thresholds():
    # pain below the 0.40 storage floor is dropped; a ≤0.60-confidence choice
    # is not stored; energy is always stored.
    tags = jev_tagging.build_tags(
        _result(pain=0.3, fatigue=0.5, pr=0.6, outcome="grind", outcome_conf=0.4, energy=2.0),
        "hash",
        "jev-latest",
    )
    assert "pain_injury" not in tags
    assert tags["high_fatigue"] == 0.5
    assert tags["pr_mention"] == 0.6
    assert "outcome" not in tags
    assert tags["energy"] == 2.0


class TestHealthCrossCheck:
    async def test_pain_tag_does_not_escalate_without_numeric_signal(
        self, db_session, test_user
    ):
        """A pain tag with no volume/rest signal must not add the evidence line
        (a tag never creates an alert on its own)."""
        session = _session(test_user.id, "knee sore")
        session.ai_tags = {"source": "jev", "pain_injury": 0.9}
        db_session.add(session)
        await db_session.flush()

        from app.services.health_analysis import analyze_injury_risk

        result = await analyze_injury_risk(db_session, test_user.id)
        assert result is not None
        assert "Free-text pain mentions" not in result["evidence"]
