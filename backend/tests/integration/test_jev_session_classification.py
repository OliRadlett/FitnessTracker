"""Jev strength-session classification (split / lift / intent).

Run with:  pytest tests/integration/test_jev_session_classification.py -m integration
"""

from __future__ import annotations

from datetime import date

import pytest

from app.integrations import jev_client
from app.integrations.jev_client import JevAnswer, JevResult
from app.models.lifting import LiftingSession, LiftingSet
from app.services import jev_classification

pytestmark = pytest.mark.integration


def _result(
    *,
    split="legs",
    split_conf=0.8,
    lift="squat",
    lift_conf=0.8,
    intent="max_strength",
    intent_conf=0.8,
) -> JevResult:
    return JevResult(
        answers={
            "session_split": JevAnswer("choice", choice=split, confidence=split_conf),
            "session_lift": JevAnswer("choice", choice=lift, confidence=lift_conf),
            "session_class": JevAnswer("choice", choice=intent, confidence=intent_conf),
        },
        model="jev-test",
        computed_at="2026-10-15T00:00:00Z",
    )


def _session(user_id, *, focus="squat", notes=None, sets=None) -> LiftingSession:
    session = LiftingSession(
        user_id=user_id, session_date=date.today(), focus=focus, notes=notes
    )
    for i, (name, kg, reps, rpe) in enumerate(sets or []):
        session.sets.append(
            LiftingSet(
                exercise_name=name,
                set_number=i + 1,
                order_index=i,
                weight_kg=kg,
                reps=reps,
                rpe=rpe,
            )
        )
    return session


class TestClassification:
    async def test_stores_labels_and_is_idempotent(
        self, db_session, test_user, monkeypatch
    ):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)

        async def fake_decide(state, questions, **kwargs):
            return _result()

        monkeypatch.setattr(jev_client, "decide", fake_decide)

        session = _session(
            test_user.id,
            notes="Heavy squats, felt strong.",
            sets=[("Back Squat", 150.0, 3, 9.0), ("Leg Press", 180.0, 10, 8.0)],
        )
        db_session.add(session)
        await db_session.flush()

        assert await jev_classification.classify_lifting_session(
            db_session, test_user.id, session
        )
        assert session.session_split == "legs"
        assert session.session_lift == "squat"
        assert session.session_class == "max_strength"
        payload = session.ai_classification
        assert payload["source"] == "jev"
        assert payload["taxonomy_version"] == jev_classification.TAXONOMY_VERSION
        assert payload["content_hash"]
        assert payload["session_split"]["label"] == "legs"

        # Same content + model + taxonomy → no-op.
        assert not await jev_classification.classify_lifting_session(
            db_session, test_user.id, session
        )

    async def test_noop_when_unconfigured(self, db_session, test_user, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: False)
        session = _session(test_user.id, sets=[("Back Squat", 100.0, 5, 8.0)])
        db_session.add(session)
        await db_session.flush()

        assert not await jev_classification.classify_lifting_session(
            db_session, test_user.id, session
        )
        assert session.ai_classification is None
        assert session.session_split is None

    async def test_noop_without_sets(self, db_session, test_user, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)
        session = _session(test_user.id, notes="no sets yet")
        db_session.add(session)
        await db_session.flush()
        # Production callers eager-load sets (selectinload); mimic that so the
        # async lazy-load guard isn't tripped (AGENTS pitfall 32).
        await db_session.refresh(session, ["sets"])

        assert not await jev_classification.classify_lifting_session(
            db_session, test_user.id, session
        )
        assert session.ai_classification is None

    async def test_editing_a_set_reclassifies(self, db_session, test_user, monkeypatch):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)

        async def fake_decide(state, questions, **kwargs):
            return _result()

        monkeypatch.setattr(jev_client, "decide", fake_decide)

        session = _session(test_user.id, sets=[("Back Squat", 140.0, 5, 8.0)])
        db_session.add(session)
        await db_session.flush()
        assert await jev_classification.classify_lifting_session(
            db_session, test_user.id, session
        )
        first_hash = session.ai_classification["content_hash"]

        # Change a set → content hash changes → re-classify.
        session.sets[0].reps = 3
        await db_session.flush()
        assert await jev_classification.classify_lifting_session(
            db_session, test_user.id, session
        )
        assert session.ai_classification["content_hash"] != first_hash

    async def test_low_confidence_axis_is_provisional_only(
        self, db_session, test_user, monkeypatch
    ):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)

        async def fake_decide(state, questions, **kwargs):
            # split is below the 0.60 floor; lift/intent are confident.
            return _result(split_conf=0.5)

        monkeypatch.setattr(jev_client, "decide", fake_decide)

        session = _session(test_user.id, sets=[("Back Squat", 140.0, 3, 9.0)])
        db_session.add(session)
        await db_session.flush()
        assert await jev_classification.classify_lifting_session(
            db_session, test_user.id, session
        )
        # Not asserted in the typed column...
        assert session.session_split is None
        # ...but recorded provisionally for audit.
        assert session.ai_classification["session_split"]["provisional"] == "legs"
        # The other axes are unaffected.
        assert session.session_lift == "squat"
        assert session.session_class == "max_strength"

    async def test_rule_disagreement_is_flagged(
        self, db_session, test_user, monkeypatch
    ):
        monkeypatch.setattr(jev_client, "is_configured", lambda: True)

        async def fake_decide(state, questions, **kwargs):
            # Rule on a bench session says lift=bench; Jev says squat.
            return _result(lift="squat")

        monkeypatch.setattr(jev_client, "decide", fake_decide)

        session = _session(test_user.id, sets=[("Bench Press", 100.0, 3, 8.0)])
        db_session.add(session)
        await db_session.flush()
        assert await jev_classification.classify_lifting_session(
            db_session, test_user.id, session
        )
        payload = session.ai_classification
        assert payload["rule"]["session_lift"] == "bench"
        assert payload["disagreement"] is True
        assert "session_lift" in payload["disagreement_axes"]
        # The label is still Jev's (a disagreement never overrides silently).
        assert session.session_lift == "squat"


def test_build_classification_thresholds():
    # 0.70 → asserted; 0.45 → provisional (no label); 0.3 → dropped entirely.
    result = JevResult(
        answers={
            "session_split": JevAnswer("choice", choice="push", confidence=0.70),
            "session_lift": JevAnswer("choice", choice="bench", confidence=0.45),
            "session_class": JevAnswer("choice", choice="max_strength", confidence=0.30),
        },
        model="jev-test",
        computed_at="z",
    )
    payload = jev_classification.build_classification(
        result, "hash", "jev-latest", {"session_split": "pull"}
    )
    assert payload["source"] == "jev" and payload["model"] == "jev-latest"
    assert payload["session_split"]["label"] == "push"
    assert payload["session_lift"]["label"] is None
    assert payload["session_lift"]["provisional"] == "bench"
    assert "session_class" not in payload  # below the provisional floor
    assert payload["disagreement"] is True  # push vs rule "pull"


class TestRuleLabels:
    def test_split(self, test_user):
        push = _session(test_user.id, sets=[("Bench Press", 100, 8, 8), ("Incline Press", 80, 8, 8)])
        assert jev_classification.rule_labels(push)["session_split"] == "push"
        pull = _session(test_user.id, sets=[("Barbell Row", 80, 8, 8), ("Lat Pulldown", 60, 10, 8)])
        assert jev_classification.rule_labels(pull)["session_split"] == "pull"
        # "leg press" must resolve to legs, not push.
        legs = _session(test_user.id, sets=[("Leg Press", 180, 10, 8), ("Leg Curl", 50, 12, 8)])
        assert jev_classification.rule_labels(legs)["session_split"] == "legs"
        # push + pull with no legs → upper
        upper = _session(test_user.id, sets=[("Bench Press", 100, 8, 8), ("Barbell Row", 80, 8, 8)])
        assert jev_classification.rule_labels(upper)["session_split"] == "upper"

    def test_lift(self, test_user):
        assert jev_classification.rule_labels(
            _session(test_user.id, sets=[("Back Squat", 150, 3, 9)])
        )["session_lift"] == "squat"
        assert jev_classification.rule_labels(
            _session(test_user.id, sets=[("Romanian Deadlift", 120, 5, 8)])
        )["session_lift"] == "deadlift"
        assert jev_classification.rule_labels(
            _session(test_user.id, sets=[("Face Pull", 25, 15, 7)])
        )["session_lift"] == "accessory"

    def test_intent_by_average_reps(self, test_user):
        assert jev_classification.rule_labels(
            _session(test_user.id, sets=[("Back Squat", 150, 3, 9)])
        )["session_class"] == "max_strength"
        assert jev_classification.rule_labels(
            _session(test_user.id, sets=[("Back Squat", 100, 10, 8)])
        )["session_class"] == "volume_hypertrophy"
        assert jev_classification.rule_labels(
            _session(test_user.id, sets=[("Leg Press", 80, 20, 7)])
        )["session_class"] == "accessory_conditioning"
        assert jev_classification.rule_labels(_session(test_user.id))["session_class"] is None
