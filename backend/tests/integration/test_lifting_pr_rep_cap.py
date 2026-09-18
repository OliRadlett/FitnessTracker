"""PR rep-range guard: high-rep sets must not contend for 1RM records.

Brzycki (``weight × 36/(37−reps)``) inflates rapidly beyond ~10 reps, so only
sets with ``1..MAX_REPS_FOR_1RM_PR`` reps may create or move a 1RM PR
(``services/lifting.py``). These tests run against the real test database.
Run with: pytest tests/integration/test_lifting_pr_rep_cap.py -m integration
"""

from __future__ import annotations

from datetime import date

import pytest

from app.schemas.lifting import (
    LiftingSessionCreate,
    LiftingSetCreate,
    PersonalRecordCreate,
)
from app.services import lifting as lifting_service

pytestmark = pytest.mark.integration


def _session_with_sets(*sets: tuple[float, int]) -> LiftingSessionCreate:
    return LiftingSessionCreate(
        session_date=date.today(),
        focus="legs",
        sets=[
            LiftingSetCreate(
                exercise_name="Back Squat",
                set_number=i + 1,
                weight_kg=w,
                reps=r,
            )
            for i, (w, r) in enumerate(sets)
        ],
    )


class TestHighRepSetsDoNotContend:
    async def test_backoff_set_does_not_dethrone_true_pr(self, db_session, test_user):
        """100×5 (e1RM 112.5) then 60×20 (raw 127.1) → PR stays 100×5."""
        session = await lifting_service.create_session(
            db_session, test_user.id, _session_with_sets((100.0, 5))
        )
        prs = await lifting_service.get_prs(db_session, test_user.id, "Back Squat")
        assert len(prs) == 1
        assert (prs[0].weight_kg, prs[0].reps) == (100.0, 5)

        await lifting_service.add_set(
            db_session,
            session.id,
            test_user.id,
            LiftingSetCreate(
                exercise_name="Back Squat",
                set_number=2,
                weight_kg=60.0,
                reps=20,
            ),
        )
        prs = await lifting_service.get_prs(db_session, test_user.id, "Back Squat")
        assert len(prs) == 1
        assert (prs[0].weight_kg, prs[0].reps) == (100.0, 5)
        assert prs[0].estimated_1rm == pytest.approx(112.5)

    async def test_high_rep_only_session_creates_no_pr(self, db_session, test_user):
        """A session with only a 60×20 set must not create any PR row."""
        await lifting_service.create_session(
            db_session, test_user.id, _session_with_sets((60.0, 20))
        )
        prs = await lifting_service.get_prs(db_session, test_user.id, "Back Squat")
        assert prs == []

    async def test_low_rep_progression_still_records_pr(self, db_session, test_user):
        """100×5 then 105×5 → PR moves to 105×5 (guard must not block real PRs)."""
        session = await lifting_service.create_session(
            db_session, test_user.id, _session_with_sets((100.0, 5))
        )
        await lifting_service.add_set(
            db_session,
            session.id,
            test_user.id,
            LiftingSetCreate(
                exercise_name="Back Squat",
                set_number=2,
                weight_kg=105.0,
                reps=5,
            ),
        )
        prs = await lifting_service.get_prs(db_session, test_user.id, "Back Squat")
        assert len(prs) == 1
        assert (prs[0].weight_kg, prs[0].reps) == (105.0, 5)

    async def test_deleting_true_pr_does_not_fall_back_to_high_rep(
        self, db_session, test_user
    ):
        """After the 100×5 set is deleted, the remaining 60×20 must not
        become the PR — the record is removed instead."""
        session = await lifting_service.create_session(
            db_session, test_user.id, _session_with_sets((100.0, 5), (60.0, 20))
        )
        heavy = next(s for s in session.sets if s.weight_kg == 100.0)
        assert await lifting_service.delete_set(db_session, heavy.id, test_user.id)
        prs = await lifting_service.get_prs(db_session, test_user.id, "Back Squat")
        assert prs == []


class TestManualPrRepGuard:
    async def test_manual_pr_rejects_high_reps(self, db_session, test_user):
        with pytest.raises(ValueError, match="1–12 reps"):
            await lifting_service.create_manual_pr(
                db_session,
                test_user.id,
                PersonalRecordCreate(
                    exercise_name="Back Squat",
                    record_type="1rm",
                    weight_kg=60.0,
                    reps=20,
                    achieved_date=date.today(),
                ),
            )

    async def test_manual_pr_api_returns_400_for_high_reps(self, client):
        resp = await client.post(
            "/api/v1/lifting/prs",
            json={
                "exercise_name": "Back Squat",
                "record_type": "1rm",
                "weight_kg": 60.0,
                "reps": 20,
                "achieved_date": str(date.today()),
            },
        )
        assert resp.status_code == 400
