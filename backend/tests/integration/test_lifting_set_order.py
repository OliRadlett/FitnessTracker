"""Explicit performance order for lifting sets.

Two defects made the stored order unusable:

1. ``LiftingSession.sets`` ordered by ``created_at``, which cannot express
   order. Postgres ``now()`` is the *transaction* timestamp, so every set
   inserted by one ``create_session`` call shares a value and the returned order
   is whatever the database happens to produce. ``api/export.py`` sidestepped it
   by re-sorting alphabetically by ``exercise_name`` on export — evidence the
   stored order was not trusted.

2. ``set_number`` was client-supplied with no enforcement, so a session could
   legitimately contain 1, 1, 3. A superset ("bench 1-3 then row 1-3") was
   therefore not expressible as data.

Migration 092 adds ``lifting_sets.order_index``; these tests pin both the
ordering guarantee and the numbering discipline it enables.
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select

from app.models.lifting import LiftingSet
from app.models.user import User

pytestmark = pytest.mark.integration


# The backfill statement from migration 092, kept verbatim here so the test
# exercises the SQL that actually ships. Duplicated rather than imported because
# importing a migration module runs its revision metadata at import time, and the
# test asserts on behaviour, not on the file's constants. If the migration
# changes, this must change with it.
_BACKFILL_SQL = """
        WITH within_exercise AS (
            SELECT
                id,
                session_id,
                exercise_name,
                created_at,
                row_number() OVER w AS rank_in_exercise
            FROM lifting_sets
            WHERE order_index IS NULL
            WINDOW w AS (
                PARTITION BY session_id, exercise_name
                ORDER BY set_number, created_at, id
            )
        ),
        exercise_start AS (
            SELECT
                session_id,
                exercise_name,
                created_at AS start_created_at,
                id AS start_id
            FROM within_exercise
            WHERE rank_in_exercise = 1
        )
        UPDATE lifting_sets AS ls
        SET order_index = laid_out.new_order
        FROM (
            SELECT
                we.id,
                row_number() OVER (
                    PARTITION BY we.session_id
                    ORDER BY
                        es.start_created_at,
                        es.start_id,
                        we.rank_in_exercise,
                        we.id
                ) - 1 AS new_order
            FROM within_exercise AS we
            JOIN exercise_start AS es
              ON es.session_id = we.session_id
             AND es.exercise_name = we.exercise_name
        ) AS laid_out
        WHERE ls.id = laid_out.id
          AND ls.order_index IS NULL
"""


def _set(session_id, exercise: str, number: int, **overrides) -> LiftingSet:
    base = {
        "session_id": session_id,
        "exercise_name": exercise,
        "set_number": number,
        "weight_kg": 100.0,
        "reps": 5,
        "is_warmup": False,
        "is_amrap": False,
    }
    base.update(overrides)
    return LiftingSet(**base)


async def _session(client, user, sets_spec, **kwargs):
    """Create a session through the API and return its JSON body."""
    payload = {
        "session_date": "2026-10-01",
        "sets": [
            {
                "exercise_name": exercise,
                "set_number": number,
                "weight_kg": weight,
                "reps": 5,
            }
            for exercise, number, weight in sets_spec
        ],
        **kwargs,
    }
    resp = await client.post("/api/v1/lifting/sessions", json=payload)
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── Order is explicit, not inferred ────────────────────────────────────────


class TestCreateSessionOrdering:
    async def test_order_index_follows_submitted_order(self, client, test_user):
        """Sets read back in the order they were performed.

        Before migration 092 every set in this request shared one created_at, so
        this assertion was a coin flip.
        """
        body = await _session(
            client,
            test_user,
            [
                ("Back Squat", 1, 100.0),
                ("Back Squat", 2, 100.0),
                ("Bench Press", 1, 60.0),
                ("Bench Press", 2, 60.0),
            ],
        )
        assert [s["order_index"] for s in body["sets"]] == [0, 1, 2, 3]
        assert [s["exercise_name"] for s in body["sets"]] == [
            "Back Squat",
            "Back Squat",
            "Bench Press",
            "Bench Press",
        ]

    async def test_interleaved_exercises_keep_submitted_order(self, client, test_user):
        """A superset is exactly this: A, B, A, B performed in sequence."""
        body = await _session(
            client,
            test_user,
            [
                ("Bench Press", 1, 60.0),
                ("Row", 1, 40.0),
                ("Bench Press", 2, 60.0),
                ("Row", 2, 40.0),
            ],
        )
        assert [s["exercise_name"] for s in body["sets"]] == [
            "Bench Press",
            "Row",
            "Bench Press",
            "Row",
        ]
        assert [s["order_index"] for s in body["sets"]] == [0, 1, 2, 3]

    async def test_set_number_is_compacted_per_exercise(self, client, test_user):
        """1, 1, 3 submitted for one exercise becomes 1, 2, 3.

        The ambiguity this removes is what made a superset inexpressible.
        """
        body = await _session(
            client,
            test_user,
            [("Back Squat", 1, 100.0), ("Back Squat", 1, 100.0), ("Back Squat", 3, 100.0)],
        )
        squat = [s for s in body["sets"] if s["exercise_name"] == "Back Squat"]
        assert sorted(s["set_number"] for s in squat) == [1, 2, 3]

    async def test_numbering_is_per_exercise_not_global(self, client, test_user):
        body = await _session(
            client,
            test_user,
            [
                ("Back Squat", 1, 100.0),
                ("Bench Press", 1, 60.0),
                ("Back Squat", 2, 100.0),
            ],
        )
        by_exercise: dict[str, list[int]] = {}
        for s in body["sets"]:
            by_exercise.setdefault(s["exercise_name"], []).append(s["set_number"])
        assert sorted(by_exercise["Back Squat"]) == [1, 2]
        assert by_exercise["Bench Press"] == [1]

    async def test_add_set_appends_after_existing(self, client, test_user):
        """A live-tracked set lands at the end, not at a tie."""
        body = await _session(client, test_user, [("Back Squat", 1, 100.0)])

        resp = await client.post(
            f"/api/v1/lifting/sessions/{body['id']}/sets",
            json={
                "exercise_name": "Back Squat",
                "set_number": 2,
                "weight_kg": 100.0,
                "reps": 5,
            },
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["order_index"] == 1

        # And the session reads back with the appended set last, not tied.
        reloaded = (await client.get(f"/api/v1/lifting/sessions/{body['id']}")).json()
        assert [s["order_index"] for s in reloaded["sets"]] == [0, 1]

    async def test_reload_preserves_order(self, client, test_user):
        """Order survives a round trip, not just the create response."""
        body = await _session(
            client,
            test_user,
            [("Deadlift", 1, 140.0), ("Bench Press", 1, 60.0), ("Row", 1, 40.0)],
        )

        resp = await client.get(f"/api/v1/lifting/sessions/{body['id']}")

        assert resp.status_code == 200, resp.text
        reloaded = resp.json()
        assert [s["exercise_name"] for s in reloaded["sets"]] == [
            "Deadlift",
            "Bench Press",
            "Row",
        ]


# ── Reorder endpoint ───────────────────────────────────────────────────────


class TestReorderEndpoint:
    async def test_reorders_sets(self, client, test_user):
        body = await _session(
            client,
            test_user,
            [("Back Squat", 1, 100.0), ("Bench Press", 1, 60.0), ("Row", 1, 40.0)],
        )
        ids = [s["id"] for s in body["sets"]]
        reversed_ids = list(reversed(ids))

        resp = await client.patch(
            f"/api/v1/lifting/sessions/{body['id']}/reorder",
            json={"set_ids": reversed_ids},
        )

        assert resp.status_code == 200, resp.text
        updated = resp.json()
        assert [s["id"] for s in updated["sets"]] == reversed_ids
        assert [s["order_index"] for s in updated["sets"]] == [0, 1, 2]

    async def test_is_idempotent(self, client, test_user):
        """Re-sending the current order succeeds and changes nothing."""
        body = await _session(
            client, test_user, [("Back Squat", 1, 100.0), ("Bench Press", 1, 60.0)]
        )
        ids = [s["id"] for s in body["sets"]]

        first = await client.patch(
            f"/api/v1/lifting/sessions/{body['id']}/reorder", json={"set_ids": ids}
        )
        second = await client.patch(
            f"/api/v1/lifting/sessions/{body['id']}/reorder", json={"set_ids": ids}
        )

        assert first.status_code == 200
        assert second.status_code == 200
        assert [s["order_index"] for s in second.json()["sets"]] == [0, 1]

    async def test_partial_list_is_422(self, client, test_user):
        """A subset cannot express a reorder, so it is rejected, not guessed."""
        body = await _session(
            client, test_user, [("Back Squat", 1, 100.0), ("Bench Press", 1, 60.0)]
        )
        ids = [s["id"] for s in body["sets"]]

        resp = await client.patch(
            f"/api/v1/lifting/sessions/{body['id']}/reorder",
            json={"set_ids": [ids[0]]},
        )

        assert resp.status_code == 422
        assert "exactly once" in resp.json()["detail"]

    async def test_extra_unknown_id_is_422(self, client, test_user):
        body = await _session(client, test_user, [("Back Squat", 1, 100.0)])
        ids = [s["id"] for s in body["sets"]] + [str(uuid.uuid4())]

        resp = await client.patch(
            f"/api/v1/lifting/sessions/{body['id']}/reorder", json={"set_ids": ids}
        )

        assert resp.status_code == 422

    async def test_duplicated_id_is_422(self, client, test_user):
        """A duplicate would silently drop a set, so it is rejected."""
        body = await _session(
            client, test_user, [("Back Squat", 1, 100.0), ("Bench Press", 1, 60.0)]
        )
        ids = [s["id"] for s in body["sets"]]

        resp = await client.patch(
            f"/api/v1/lifting/sessions/{body['id']}/reorder",
            json={"set_ids": [ids[0], ids[0]]},
        )

        assert resp.status_code == 422

    async def test_empty_list_is_rejected(self, client, test_user):
        body = await _session(client, test_user, [("Back Squat", 1, 100.0)])

        resp = await client.patch(
            f"/api/v1/lifting/sessions/{body['id']}/reorder", json={"set_ids": []}
        )

        assert resp.status_code == 422

    async def test_unknown_session_is_404(self, client):
        resp = await client.patch(
            f"/api/v1/lifting/sessions/{uuid.uuid4()}/reorder",
            json={"set_ids": [str(uuid.uuid4())]},
        )
        assert resp.status_code == 404

    async def test_another_users_session_is_404(
        self, client, db_session, test_user
    ):
        """Ownership is enforced, and 404 (not 403) so sessions are not probeable."""
        mine = await _session(client, test_user, [("Back Squat", 1, 100.0)])
        mine_ids = [s["id"] for s in mine["sets"]]

        other = User(email="other-reorder@example.com", name="Other")
        db_session.add(other)
        await db_session.flush()

        # Swap the authenticated user mid-test via the override the harness set.
        from app.services.auth import get_current_user

        app_instance = client._transport.app  # type: ignore[attr-defined]
        app_instance.dependency_overrides[get_current_user] = lambda: other

        try:
            resp = await client.patch(
                f"/api/v1/lifting/sessions/{mine['id']}/reorder",
                json={"set_ids": mine_ids},
            )
        finally:
            app_instance.dependency_overrides[get_current_user] = lambda: test_user

        assert resp.status_code == 404

    async def test_reorder_does_not_change_volume_or_prs(self, client, test_user):
        """Ordering is presentation only — not a training change."""
        from app.models.lifting import PersonalRecord

        body = await _session(
            client,
            test_user,
            [("Back Squat", 1, 100.0), ("Back Squat", 2, 100.0)],
        )
        volume_before = body["total_volume_kg"]

        pr_resp = await client.get("/api/v1/lifting/prs")
        prs_before = pr_resp.json()

        ids = [s["id"] for s in reversed(body["sets"])]
        resp = await client.patch(
            f"/api/v1/lifting/sessions/{body['id']}/reorder", json={"set_ids": ids}
        )

        assert resp.status_code == 200
        assert resp.json()["total_volume_kg"] == volume_before

        prs_after = (await client.get("/api/v1/lifting/prs")).json()
        assert [p["estimated_1rm"] for p in prs_after] == [
            p["estimated_1rm"] for p in prs_before
        ]

    async def test_reorder_persists_across_reload(self, client, test_user):
        body = await _session(
            client,
            test_user,
            [("Back Squat", 1, 100.0), ("Bench Press", 1, 60.0), ("Row", 1, 40.0)],
        )
        ids = [s["id"] for s in body["sets"]]
        target = [ids[2], ids[0], ids[1]]

        await client.patch(
            f"/api/v1/lifting/sessions/{body['id']}/reorder", json={"set_ids": target}
        )

        reloaded = (await client.get(f"/api/v1/lifting/sessions/{body['id']}")).json()
        assert [s["id"] for s in reloaded["sets"]] == target


# ── Numbering discipline on delete ─────────────────────────────────────────


class TestDeleteRenumbers:
    async def test_deleting_first_set_closes_the_gap(self, client, test_user):
        """Delete set 1 of 1-3 and the rest must become 1-2, not 2-3."""
        body = await _session(
            client,
            test_user,
            [
                ("Back Squat", 1, 100.0),
                ("Back Squat", 2, 100.0),
                ("Back Squat", 3, 100.0),
            ],
        )
        squat = [s for s in body["sets"] if s["exercise_name"] == "Back Squat"]
        first = min(squat, key=lambda s: s["set_number"])

        resp = await client.delete(f"/api/v1/lifting/sets/{first['id']}")
        assert resp.status_code == 204, resp.text

        reloaded = (await client.get(f"/api/v1/lifting/sessions/{body['id']}")).json()
        remaining = [
            s["set_number"] for s in reloaded["sets"] if s["exercise_name"] == "Back Squat"
        ]
        assert sorted(remaining) == [1, 2]

    async def test_deleting_middle_set_renumbers_down(self, client, test_user):
        body = await _session(
            client,
            test_user,
            [
                ("Back Squat", 1, 100.0),
                ("Back Squat", 2, 100.0),
                ("Back Squat", 3, 100.0),
            ],
        )
        squat = sorted(
            (s for s in body["sets"] if s["exercise_name"] == "Back Squat"),
            key=lambda s: s["set_number"],
        )
        middle = squat[1]

        await client.delete(f"/api/v1/lifting/sets/{middle['id']}")

        reloaded = (await client.get(f"/api/v1/lifting/sessions/{body['id']}")).json()
        remaining = sorted(
            s["set_number"] for s in reloaded["sets"] if s["exercise_name"] == "Back Squat"
        )
        assert remaining == [1, 2]

    async def test_delete_leaves_other_exercises_alone(self, client, test_user):
        body = await _session(
            client,
            test_user,
            [
                ("Back Squat", 1, 100.0),
                ("Back Squat", 2, 100.0),
                ("Bench Press", 1, 60.0),
                ("Bench Press", 2, 60.0),
            ],
        )
        squat = [s for s in body["sets"] if s["exercise_name"] == "Back Squat"]
        await client.delete(f"/api/v1/lifting/sets/{squat[0]['id']}")

        reloaded = (await client.get(f"/api/v1/lifting/sessions/{body['id']}")).json()
        bench = sorted(
            s["set_number"] for s in reloaded["sets"] if s["exercise_name"] == "Bench Press"
        )
        assert bench == [1, 2]


# ── Editing an exercise renumbers both groups ──────────────────────────────


class TestEditRenumbers:
    async def test_moving_a_set_compacts_both_exercises(
        self, client, test_user
    ):
        body = await _session(
            client,
            test_user,
            [
                ("Back Squat", 1, 100.0),
                ("Back Squat", 2, 100.0),
                ("Bench Press", 1, 60.0),
            ],
        )
        squat = sorted(
            (s for s in body["sets"] if s["exercise_name"] == "Back Squat"),
            key=lambda s: s["set_number"],
        )
        moving = squat[1]  # squat set 2 -> becomes bench set 2

        resp = await client.patch(
            f"/api/v1/lifting/sets/{moving['id']}",
            json={"exercise_name": "Bench Press"},
        )
        assert resp.status_code == 200, resp.text

        reloaded = (await client.get(f"/api/v1/lifting/sessions/{body['id']}")).json()
        by_exercise: dict[str, list[int]] = {}
        for s in reloaded["sets"]:
            by_exercise.setdefault(s["exercise_name"], []).append(s["set_number"])
        # Squat lost its 2nd set, so it must renumber to just 1.
        assert sorted(by_exercise["Back Squat"]) == [1]
        # Bench gained a set, so it must be contiguous 1-2.
        assert sorted(by_exercise["Bench Press"]) == [1, 2]

    async def test_normalised_move_keeps_numbering_contiguous(
        self, client, test_user
    ):
        """A lowercase alias still moves the set (Wave 0.2 normalisation)."""
        body = await _session(
            client,
            test_user,
            [("Back Squat", 1, 100.0), ("bench", 1, 60.0)],
        )
        squat = next(s for s in body["sets"] if s["exercise_name"] == "Back Squat")
        bench = next(s for s in body["sets"] if s["exercise_name"] == "Bench Press")

        resp = await client.patch(
            f"/api/v1/lifting/sets/{bench['id']}", json={"exercise_name": "squat"}
        )

        assert resp.status_code == 200
        reloaded = (await client.get(f"/api/v1/lifting/sessions/{body['id']}")).json()
        squat_numbers = sorted(
            s["set_number"] for s in reloaded["sets"] if s["exercise_name"] == "Back Squat"
        )
        assert squat_numbers == [1, 2]
        assert squat["id"] in {s["id"] for s in reloaded["sets"]}


# ── Route ordering (pitfall 13) ───────────────────────────────────────────


class TestRouteOrdering:
    def test_reorder_registered_above_bare_dynamic_routes(self):
        """A static path below ``/{param}`` is shadowed and 422s.

        The /orphans incident: the handler existed, the docs claimed the order
        was right, and requests still 422'd. So this asserts the decorator
        *index*, not that the handler is defined.
        """
        from app.api.lifting import router

        paths = [r.path for r in router.routes]
        reorder_index = paths.index("/sessions/{session_id}/reorder")
        shadowing = [
            i
            for i, p in enumerate(paths)
            if i < reorder_index and p.count("/") == 1 and p.startswith("/{")
        ]
        assert not shadowing, (
            f"/sessions/{{session_id}}/reorder at {reorder_index} is shadowed by "
            f"{[paths[i] for i in shadowing]}"
        )


class TestBackfillMigration:
    """Migration 092's backfill must be idempotent and produce a total order.

    The backfill is raw SQL, so it is exercised directly rather than through the
    model. The integration fixture builds schema with ``create_all``, not alembic,
    so this is the only coverage the statement gets.
    """

    async def _seed_legacy(self, db_session, test_user):
        """Insert pre-migration rows: order_index NULL, created_at all equal."""
        from datetime import date as _date

        from app.models.lifting import LiftingSession

        session = LiftingSession(user_id=test_user.id, session_date=_date(2026, 9, 1))
        db_session.add(session)
        await db_session.flush()

        # One transaction, so every created_at is identical — precisely the
        # condition that made the original ordering unusable.
        rows = [
            _set(session.id, "Back Squat", 1),
            _set(session.id, "Back Squat", 2),
            _set(session.id, "Bench Press", 1),
            _set(session.id, "Deadlift", 1),
        ]
        for row in rows:
            row.order_index = None
            db_session.add(row)
        await db_session.flush()
        return session

    async def _run_backfill(self, db_session) -> None:
        """Execute the backfill exactly as migration 092 does.

        ``expire_all`` afterwards because a raw UPDATE bypasses the ORM: without
        it the identity map keeps serving the pre-backfill objects and later
        reads would report stale ``order_index`` values.
        """
        from sqlalchemy import text

        await db_session.execute(text(_BACKFILL_SQL))
        db_session.expire_all()

    async def test_backfill_assigns_a_total_order(
        self, db_session, test_user
    ):
        session = await self._seed_legacy(db_session, test_user)
        session_id = session.id

        await self._run_backfill(db_session)

        rows = list(
            (
                await db_session.execute(
                    select(LiftingSet)
                    .where(LiftingSet.session_id == session_id)
                    .order_by(LiftingSet.order_index)
                )
            )
            .scalars()
            .all()
        )
        # Every row numbered, contiguously from 0 — no gaps, no duplicates.
        assert sorted(r.order_index for r in rows) == [0, 1, 2, 3]
        # Each exercise's own set_number order is preserved within the session.
        squat = [r for r in rows if r.exercise_name == "Back Squat"]
        assert [r.order_index for r in squat] == sorted(
            r.order_index for r in squat
        )

    async def test_backfill_is_idempotent(self, db_session, test_user):
        """Re-running must not renumber — a scheduler repeat or a retry."""
        session = await self._seed_legacy(db_session, test_user)
        session_id = session.id

        await self._run_backfill(db_session)
        first = {
            r.id: r.order_index
            for r in (
                await db_session.execute(
                    select(LiftingSet).where(LiftingSet.session_id == session_id)
                )
            )
            .scalars()
            .all()
        }

        await self._run_backfill(db_session)
        second = {
            r.id: r.order_index
            for r in (
                await db_session.execute(
                    select(LiftingSet).where(LiftingSet.session_id == session_id)
                )
            )
            .scalars()
            .all()
        }

        assert first == second

    async def test_backfill_does_not_clobber_existing_order(
        self, db_session, test_user
    ):
        """A user-chosen order written after the column landed must survive."""
        session = await self._seed_legacy(db_session, test_user)
        session_id = session.id
        rows = list(
            (
                await db_session.execute(
                    select(LiftingSet).where(LiftingSet.session_id == session_id)
                )
            )
            .scalars()
            .all()
        )
        keeper_id = rows[0].id
        rows[0].order_index = 99  # as a reorder would set it
        await db_session.flush()

        await self._run_backfill(db_session)

        stored = (
            await db_session.execute(
                select(LiftingSet.order_index).where(LiftingSet.id == keeper_id)
            )
        ).scalar_one()
        assert stored == 99

    async def test_backfill_keeps_each_session_separate(
        self, db_session, test_user
    ):
        """Numbering restarts per session — two sessions must not interleave."""
        from datetime import date as _date

        from app.models.lifting import LiftingSession

        first = await self._seed_legacy(db_session, test_user)
        first_id = first.id
        second = LiftingSession(user_id=test_user.id, session_date=_date(2026, 9, 2))
        db_session.add(second)
        await db_session.flush()
        second_id = second.id
        for number in (1, 2):
            row = _set(second_id, "Bench Press", number)
            row.order_index = None
            db_session.add(row)
        await db_session.flush()

        await self._run_backfill(db_session)

        for session_id, expected in ((first_id, 4), (second_id, 2)):
            indexes = [
                r.order_index
                for r in (
                    await db_session.execute(
                        select(LiftingSet).where(LiftingSet.session_id == session_id)
                    )
                )
                .scalars()
                .all()
            ]
            assert sorted(indexes) == list(range(expected))
