"""A retracted PR must retract its announcement too.

Deleting the set that set a PR deleted the ``PersonalRecord`` and said nothing.
That left the user with two wrong states, in opposite directions:

* a **stale** "Bench Press PR" notification for a record that no longer exists;
* and, because ``notify`` dedups on ``pr:{exercise}:{date}``, the stale row
  **permanently suppressed** any future notification for that key — so re-logging
  the same lift on the same date produced silence.

One delete fixes both, plus a compensating ``pr_revoked`` row. The compensating
row is not redundant: the original was delivered by web push, which has already
reached the device and cannot be unsent.

Note the asymmetry this fixes in the source: the *downgrade* branch was already
handled ("a set deletion that lowers it must not fire a 'new PR' notification",
``lifting.py``). The adjacent retraction branch was not.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models.lifting import PersonalRecord
from app.models.notification import Notification

pytestmark = pytest.mark.integration


async def _make_pr_session(client, *, exercise: str, weight: float, reps: int = 5):
    """Create a session whose single set is a PR for ``exercise``."""
    return await client.post(
        "/api/v1/lifting/sessions",
        json={
            "session_date": date.today().isoformat(),
            "sets": [
                {
                    "exercise_name": exercise,
                    "set_number": 1,
                    "weight_kg": weight,
                    "reps": reps,
                }
            ],
        },
    )


async def _notifications(db_session, user_id) -> list[Notification]:
    rows = await db_session.execute(
        select(Notification).where(Notification.user_id == user_id)
    )
    return list(rows.scalars().all())


async def _prs(db_session, user_id) -> list[PersonalRecord]:
    rows = await db_session.execute(
        select(PersonalRecord).where(PersonalRecord.user_id == user_id)
    )
    return list(rows.scalars().all())


class TestPrRetraction:
    async def test_pr_notification_is_removed_with_the_record(
        self, client, db_session, test_user
    ):
        body = await _make_pr_session(client, exercise="Bench Press", weight=100.0)
        assert body.status_code == 201, body.text
        set_id = body.json()["sets"][0]["id"]

        # The achievement announced itself.
        before = await _notifications(db_session, test_user.id)
        assert [n.type for n in before] == ["pr"]

        assert (
            await client.delete(f"/api/v1/lifting/sets/{set_id}")
        ).status_code == 204

        assert await _prs(db_session, test_user.id) == []
        # No notification claims a PR that no longer exists.
        assert [n.type for n in await _notifications(db_session, test_user.id)] == [
            "pr_revoked"
        ]

    async def test_retraction_emits_a_correction(self, client, db_session, test_user):
        """The push already reached the device, so the reversal must be stated."""
        body = await _make_pr_session(client, exercise="Deadlift", weight=180.0)
        set_id = body.json()["sets"][0]["id"]

        await client.delete(f"/api/v1/lifting/sets/{set_id}")

        revoked = [
            n
            for n in await _notifications(db_session, test_user.id)
            if n.type == "pr_revoked"
        ]
        assert len(revoked) == 1
        note = revoked[0]
        # Names the exercise and is not styled as an achievement.
        assert "Deadlift" in note.title
        assert note.severity == "info"
        # No dedup_key: a retraction must never be suppressed, even twice.
        assert note.dedup_key is None

    async def test_re_earning_the_same_pr_is_announced_again(
        self, client, db_session, test_user
    ):
        """The regression that made the stale row so costly.

        Without the dedup key being freed, the re-earned PR is silently muted —
        the same workout logged twice reports a PR only the first time.
        """
        body = await _make_pr_session(client, exercise="Back Squat", weight=140.0)
        set_id = body.json()["sets"][0]["id"]
        await client.delete(f"/api/v1/lifting/sets/{set_id}")

        # The same lift, same date, logged again.
        again = await _make_pr_session(client, exercise="Back Squat", weight=140.0)
        assert again.status_code == 201, again.text

        types = [n.type for n in await _notifications(db_session, test_user.id)]
        # The fresh achievement is announced, not deduped away.
        assert types.count("pr") == 1
        assert types.count("pr_revoked") == 1
        assert await _prs(db_session, test_user.id)

    async def test_lowering_a_pr_still_fires_nothing(
        self, client, db_session, test_user
    ):
        """The pre-existing downgrade branch must not regress.

        Deleting the *best* set lowers the PR rather than removing it. That case
        was already handled and must stay silent — it is not a retraction.
        """
        best = await _make_pr_session(client, exercise="Bench Press", weight=100.0)
        weaker = await _make_pr_session(client, exercise="Bench Press", weight=80.0)
        assert best.status_code == 201 and weaker.status_code == 201

        best_set = best.json()["sets"][0]["id"]
        await client.delete(f"/api/v1/lifting/sets/{best_set}")

        # PR survives at the lower weight, and no retraction is announced.
        prs = await _prs(db_session, test_user.id)
        assert len(prs) == 1
        assert prs[0].weight_kg == 80.0
        types = [n.type for n in await _notifications(db_session, test_user.id)]
        assert "pr_revoked" not in types

    async def test_no_pr_no_notification_noise(self, client, db_session, test_user):
        """A high-rep set is not a PR candidate, so deleting it announces nothing."""
        body = await _make_pr_session(
            client, exercise="Bench Press", weight=60.0, reps=20
        )
        set_id = body.json()["sets"][0]["id"]

        await client.delete(f"/api/v1/lifting/sets/{set_id}")

        assert await _notifications(db_session, test_user.id) == []

    async def test_warmup_set_deletion_is_silent(self, client, db_session, test_user):
        """Warmups never contend for records, so nothing to retract."""
        resp = await client.post(
            "/api/v1/lifting/sessions",
            json={
                "session_date": date.today().isoformat(),
                "sets": [
                    {
                        "exercise_name": "Bench Press",
                        "set_number": 1,
                        "weight_kg": 100.0,
                        "reps": 5,
                    },
                    {
                        "exercise_name": "Bench Press",
                        "set_number": 2,
                        "weight_kg": 20.0,
                        "reps": 10,
                        "is_warmup": True,
                    },
                ],
            },
        )
        sets = resp.json()["sets"]
        warmup = next(s for s in sets if s["is_warmup"])

        await client.delete(f"/api/v1/lifting/sets/{warmup['id']}")

        # PR untouched, no correction.
        assert len(await _prs(db_session, test_user.id)) == 1
        assert "pr_revoked" not in [
            n.type for n in await _notifications(db_session, test_user.id)
        ]

    async def test_retraction_never_commits_mid_way(self):
        """Both or neither (§3.2), asserted structurally.

        A behavioural test needs a rollback scoped tighter than the harness's own
        wrapping transaction, which its fixtures do not allow — so this checks the
        invariant where it actually lives: in the code shape. There must be no
        ``commit`` between the notification delete and the PR delete, or a
        partial failure would desynchronise the record from its announcement.
        Same approach as ``test_migration_dialect_types.py``, which AST-walks the
        chain for properties a round-trip cannot catch.
        """
        import ast
        import inspect

        from app.services import lifting as lifting_module

        tree = ast.parse(inspect.getsource(lifting_module))

        def commits_in(fn_name: str) -> list[str]:
            for node in ast.walk(tree):
                if not isinstance(node, (ast.AsyncFunctionDef, ast.FunctionDef)):
                    continue
                if node.name != fn_name:
                    continue
                return [
                    f"{fn_name}:{inner.lineno}"
                    for inner in ast.walk(node)
                    if isinstance(inner, ast.Attribute) and inner.attr == "commit"
                ]
            raise AssertionError(f"{fn_name} not found in lifting.py")

        assert commits_in("_revoke_pr_notification") == []
        assert commits_in("_recalculate_pr_after_set_change") == []

    async def test_manual_pr_creation_uses_the_same_dedup_key(
        self, client, db_session, test_user
    ):
        """The revoke path keys on exactly what the notify path writes.

        If the two formats ever drift, the retraction silently finds nothing and
        the whole fix becomes a no-op — so this pins the shared format.
        """
        from app.services.lifting import _pr_dedup_key

        body = await _make_pr_session(client, exercise="Bench Press", weight=100.0)
        set_id = body.json()["sets"][0]["id"]

        prs = await _prs(db_session, test_user.id)
        assert len(prs) == 1
        expected = f"pr:Bench Press:{prs[0].achieved_date}"
        assert _pr_dedup_key(prs[0]) == expected
        # And that is the key the notification actually carries.
        pr_note = next(
            n for n in await _notifications(db_session, test_user.id) if n.type == "pr"
        )
        assert pr_note.dedup_key == expected

        await client.delete(f"/api/v1/lifting/sets/{set_id}")
        # The row that key identified is gone.
        assert not [
            n
            for n in await _notifications(db_session, test_user.id)
            if n.dedup_key == expected
        ]
