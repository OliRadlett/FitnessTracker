"""``UndoLog`` -- the compensation log's invariants (plan §8, §2.3-§2.4).

Purely about the *mechanism*, because that is what this section is: the
mechanism, the replay guard, the retention policy, and the refusal to guess.

The invariants that matter, and why each is easy to get wrong:

- **Claim before restore.** Two concurrent undos both pass a naive
  read-then-check. Only a conditional ``UPDATE ... WHERE undone_at IS NULL``
  makes the second a no-op instead of a double-restore. This is the single
  ordering in the whole design, and it is asserted by actually racing two undos.
- **Ownership in the same query as the replay guard.** Checking ownership and
  liveness in two queries leaves a window; here it is one.
- **Expiry is computed, not stored.** A claim stops being offered the moment it
  expires, not at the next prune.
- **An unregistered kind is refused at write time.** An operation whose undo
  cannot be performed should not be logged as undoable.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import func, select

from app.models.undo import UndoLog
from app.services import undo as undo_service

pytestmark = pytest.mark.integration

# A stand-in operation with an out-of-band effect: it "announces" something, and
# undo must retract that too. That mirrors the real §2.2 case (a PR notification
# is *pushed*, so deleting the row does not unsend it) closely enough to be a
# useful smoke test of the dispatch.
ANNOUNCEMENTS: set[str] = set()
RESTORE_CALLS: list[uuid.UUID] = []


async def _restore_announce(
    db, user_id: uuid.UUID, payload: dict[str, Any]
) -> dict[str, Any]:
    # Coerce rather than assume: the payload round-trips through JSONB, so the
    # marker_id comes back as a str even if the caller passed a UUID. A restorer
    # that skipped this would work in-process and fail on first real read-back.
    RESTORE_CALLS.append(uuid.UUID(payload["marker_id"]))
    ANNOUNCEMENTS.discard(payload["marker"])
    return {"restored": payload["marker"]}


async def _restore_broken(db, user_id: uuid.UUID, payload: dict[str, Any]) -> None:
    """Stands in for plan §3.5: the parent row has since been deleted."""
    raise RuntimeError("parent no longer exists")


undo_service.register("test_announce", _restore_announce)
undo_service.register("test_broken", _restore_broken)


@pytest.fixture(autouse=True)
def _clean_registry():
    """Restore the registry so a test's registrations do not leak."""
    snapshot = dict(undo_service.RESTORERS)
    ANNOUNCEMENTS.clear()
    RESTORE_CALLS.clear()
    yield
    undo_service.RESTORERS.clear()
    undo_service.RESTORERS.update(snapshot)


async def _claim(db_session, user_id, *, kind="test_announce", payload=None, **kw):
    return await undo_service.record_undo(
        db_session,
        user_id=user_id,
        kind=kind,
        payload=payload
        or {
            "marker": f"m-{uuid.uuid4().hex[:8]}",
            # A string, because the payload is JSON-native. See record_undo.
            "marker_id": str(uuid.uuid4()),
        },
        **kw,
    )


async def _rows(db_session, user_id) -> list[UndoLog]:
    result = await db_session.execute(
        select(UndoLog).where(UndoLog.user_id == user_id)
    )
    return list(result.scalars().all())


class TestRecording:
    async def test_records_the_snapshot_and_a_deadline(
        self, db_session, test_user
    ):
        log = await _claim(db_session, test_user.id)
        assert log.kind == "test_announce"
        assert "marker" in log.payload
        assert log.undone_at is None

    async def test_default_window_is_thirty_days(self, db_session, test_user):
        """The cross-cutting policy lives here, not per operation."""
        before = datetime.now(UTC)
        log = await _claim(db_session, test_user.id)
        # `undo_deadline()` stamps its own `now()`, a few microseconds after
        # `before`, so the upper bound is inclusive of that gap rather than
        # exactly 30 days.
        delta = log.expires_at - before
        assert timedelta(days=29, hours=23) < delta <= timedelta(days=30, seconds=1)

    async def test_expiry_can_be_overridden(self, db_session, test_user):
        soon = datetime.now(UTC) + timedelta(hours=1)
        log = await _claim(db_session, test_user.id, expires_at=soon)
        assert log.expires_at == soon

    async def test_unregistered_kind_is_refused_at_write_time(
        self, db_session, test_user
    ):
        """An operation that cannot be undone must not be logged as undoable.

        Failing here rather than at undo time is the whole point: the alternative
        is a claim that looks undoable in the UI for a month and then fails.
        """
        with pytest.raises(ValueError, match="no restorer registered"):
            await _claim(db_session, test_user.id, kind="never_registered")
        assert await _rows(db_session, test_user.id) == []

    async def test_a_rolled_back_operation_leaves_no_claim(
        self, db_session, test_user
    ):
        """The claim must commit with the operation, not before or after it.

        A claim for an operation that rolled back describes something that never
        happened, so an undo of it would "restore" nothing.

        Uses ``begin_nested()`` for the undo rather than a bare
        ``rollback()``: the fixture's session is wrapped in a transaction that a
        bare rollback would close out from under the harness, which is AGENTS
        pitfall 33 in the flesh. A savepoint is the scoped version of the same
        thing and leaves the outer transaction usable.
        """
        savepoint = await db_session.begin_nested()
        await _claim(db_session, test_user.id)
        assert len(await _rows(db_session, test_user.id)) == 1
        await savepoint.rollback()

        assert await _rows(db_session, test_user.id) == []


class TestPerformingUndo:
    async def test_runs_the_restorer_and_marks_the_claim(
        self, db_session, test_user
    ):
        log = await _claim(db_session, test_user.id)
        ANNOUNCEMENTS.add(log.payload["marker"])

        result = await undo_service.undo(db_session, log.id, test_user.id)

        assert result == {"restored": log.payload["marker"]}
        assert log.payload["marker"] not in ANNOUNCEMENTS, (
            "the out-of-band announcement must be retracted too -- restoring the "
            "row alone is the easy half and is what the existing merge undo's "
            "embedding note is about"
        )
        await db_session.refresh(log)
        assert log.undone_at is not None

    async def test_second_undo_is_a_no_op(self, db_session, test_user):
        """The idempotency guard. A double-clicked undo must not restore twice."""
        log = await _claim(db_session, test_user.id)
        ANNOUNCEMENTS.add(log.payload["marker"])

        await undo_service.undo(db_session, log.id, test_user.id)
        RESTORE_CALLS.clear()

        with pytest.raises(undo_service.UndoNotAvailable):
            await undo_service.undo(db_session, log.id, test_user.id)
        assert RESTORE_CALLS == [], "the restorer must not run a second time"

    async def test_concurrent_undos_restore_exactly_once(
        self, db_session, test_user
    ):
        """The claim must be visible *before* the restore runs.

        This is tested by **re-entrancy** rather than by ``asyncio.gather``. Two
        coroutines sharing one ``AsyncSession`` do not actually race: SQLAlchemy
        serialises them on a single connection, so attempt B's SELECT always runs
        after attempt A's UPDATE and sees ``undone_at`` already set — whichever
        order the claim happens in. A gather-based test of this passes against the
        *buggy* claim-after-restore implementation, which is worse than no test.

        Re-entrancy removes that false comfort. The restorer itself attempts a
        nested undo of the same claim, which is exactly what a concurrent request
        that slipped past the initial read looks like from inside. It can only be
        refused if the claim was already made:

        - claim **before** restore → nested undo sees ``undone_at`` set → refused,
          restorer runs once.
        - claim **after** restore (the bug) → nested undo finds the claim still
          open → runs again → restorer runs twice.
        """
        nested_results: list[str] = []

        async def _reentrant(db, user_id, payload):
            RESTORE_CALLS.append(uuid.UUID(payload["marker_id"]))
            try:
                await undo_service.undo(db, uuid.UUID(payload["log_id"]), user_id)
                nested_results.append("undone")
            except undo_service.UndoNotAvailable:
                nested_results.append("refused")
            ANNOUNCEMENTS.discard(payload["marker"])
            return {"restored": payload["marker"]}

        undo_service.register("test_reentrant", _reentrant)

        log = await undo_service.record_undo(
            db_session,
            user_id=test_user.id,
            kind="test_reentrant",
            payload={
                "marker": f"m-{uuid.uuid4().hex[:8]}",
                "marker_id": str(uuid.uuid4()),
            },
        )
        # The nested attempt must target this very claim. `record_undo` flushed,
        # so the id is known now; patch it into the payload the restorer reads.
        log.payload = {**log.payload, "log_id": str(log.id)}
        await db_session.flush()

        await undo_service.undo(db_session, log.id, test_user.id)

        assert nested_results == ["refused"], (
            "the nested undo was not refused, so the claim was not visible before "
            "the restore ran -- that is claim-after-restore, and two concurrent "
            "requests would both restore"
        )
        assert len(RESTORE_CALLS) == 1, f"restorer ran {len(RESTORE_CALLS)} times"

    async def test_another_users_claim_is_unavailable(self, db_session, test_user):
        """Ownership is checked in the same query as the replay guard.

        A separate check would leave a window in which another user's log has
        been loaded and only then rejected.
        """
        log = await _claim(db_session, test_user.id)
        stranger = uuid.uuid4()
        with pytest.raises(undo_service.UndoNotAvailable):
            await undo_service.undo(db_session, log.id, stranger)
        assert RESTORE_CALLS == []

    async def test_unknown_claim_is_unavailable(self, db_session, test_user):
        with pytest.raises(undo_service.UndoNotAvailable):
            await undo_service.undo(db_session, uuid.uuid4(), test_user.id)

    async def test_expired_claim_is_refused(self, db_session, test_user):
        """An expired claim is audit data only."""
        log = await _claim(
            db_session,
            test_user.id,
            expires_at=datetime.now(UTC) - timedelta(seconds=1),
        )
        with pytest.raises(undo_service.UndoNotAvailable, match="expired"):
            await undo_service.undo(db_session, log.id, test_user.id)
        assert RESTORE_CALLS == []

    async def test_claim_expiring_exactly_now_is_refused(
        self, db_session, test_user
    ):
        """Boundary is inclusive, so ``expires_at == now`` is already closed."""
        log = await _claim(db_session, test_user.id, expires_at=datetime.now(UTC))
        with pytest.raises(undo_service.UndoNotAvailable):
            await undo_service.undo(db_session, log.id, test_user.id)

    async def test_a_non_serialisable_payload_is_refused(self, db_session, test_user):
        """A UUID in the payload fails here, naming the payload.

        Without this check it fails at flush time as a driver-level
        ``TypeError``, and only after the operation that wrote it has run.
        """
        with pytest.raises(ValueError, match="JSON-serialisable"):
            await undo_service.record_undo(
                db_session,
                user_id=test_user.id,
                kind="test_announce",
                payload={"marker_id": uuid.uuid4()},  # a UUID, not a str
            )
        assert await _rows(db_session, test_user.id) == []

    async def test_a_failing_restorer_surfaces(self, db_session, test_user):
        """A restore that fails must not read as "nothing to undo".

        Plan §3.5: the parent row may have been deleted since the snapshot was
        taken. That is a real failure and is deliberately a different exception
        from ``UndoNotAvailable`` so the caller cannot confuse it with "no such
        claim".
        """
        log = await _claim(db_session, test_user.id, kind="test_broken", payload={})
        with pytest.raises(RuntimeError, match="parent no longer exists"):
            await undo_service.undo(db_session, log.id, test_user.id)

    async def test_a_kind_whose_restorer_was_removed_is_unavailable(
        self, db_session, test_user
    ):
        """A row can outlive a kind being dropped from the registry.

        ``record_undo`` refuses an unregistered kind, but a row written while the
        kind existed must not restore through a missing handler.
        """
        log = await _claim(db_session, test_user.id)
        del undo_service.RESTORERS["test_announce"]
        with pytest.raises(undo_service.UndoNotAvailable, match="no restorer"):
            await undo_service.undo(db_session, log.id, test_user.id)
        assert RESTORE_CALLS == []


class TestListing:
    async def test_lists_live_claims(self, db_session, test_user):
        first = await _claim(db_session, test_user.id)
        second = await _claim(db_session, test_user.id)

        live = await undo_service.list_undoable(db_session, test_user.id)
        assert {log.id for log in live} == {first.id, second.id}

    async def test_list_order_is_deterministic(self, db_session, test_user):
        """Total order, because this list drives an undo button.

        Two claims in one transaction share ``created_at`` (``now()`` is the
        transaction timestamp, pitfall 28), so the order must be broken by id or
        it reshuffles between renders. What is *not* claimed is insertion order:
        random UUIDs carry no sequence, so same-transaction claims are presented
        in an arbitrary-but-stable order. The test asserts stability, and says so,
        rather than asserting an ordering the schema cannot support.
        """
        await _claim(db_session, test_user.id)
        await _claim(db_session, test_user.id)
        await _claim(db_session, test_user.id)

        first = await undo_service.list_undoable(db_session, test_user.id)
        second = await undo_service.list_undoable(db_session, test_user.id)
        assert [log.id for log in first] == [log.id for log in second]
        assert len({log.id for log in first}) == 3

    async def test_excludes_expired_and_undone(self, db_session, test_user):
        live = await _claim(db_session, test_user.id)
        expired = await _claim(
            db_session,
            test_user.id,
            expires_at=datetime.now(UTC) - timedelta(minutes=1),
        )
        done = await _claim(db_session, test_user.id)
        await undo_service.undo(db_session, done.id, test_user.id)

        ids = {log.id for log in await undo_service.list_undoable(db_session, test_user.id)}
        assert ids == {live.id}
        assert expired.id not in ids
        assert done.id not in ids

    async def test_can_filter_by_kind(self, db_session, test_user):
        await _claim(db_session, test_user.id, kind="test_broken", payload={})
        keep = await _claim(db_session, test_user.id)

        found = await undo_service.list_undoable(
            db_session, test_user.id, kind="test_announce"
        )
        assert [log.id for log in found] == [keep.id]

    async def test_does_not_leak_another_users_claims(self, db_session, test_user):
        await _claim(db_session, test_user.id)
        assert await undo_service.list_undoable(db_session, uuid.uuid4()) == []


class TestPruning:
    async def test_removes_expired_and_keeps_live(self, db_session, test_user):
        live = await _claim(db_session, test_user.id)
        gone = await _claim(
            db_session,
            test_user.id,
            expires_at=datetime.now(UTC) - timedelta(days=1),
        )

        removed = await undo_service.prune_expired(db_session)

        assert removed == 1
        assert {log.id for log in await _rows(db_session, test_user.id)} == {live.id}
        assert gone.id not in {log.id for log in await _rows(db_session, test_user.id)}

    async def test_an_undone_but_unexpired_claim_is_kept(self, db_session, test_user):
        """Retaining an undone claim is deliberate.

        It is the audit record that the operation happened *and* was reversed,
        which is more informative than deleting it.
        """
        log = await _claim(db_session, test_user.id)
        await undo_service.undo(db_session, log.id, test_user.id)

        assert await undo_service.prune_expired(db_session) == 0
        assert len(await _rows(db_session, test_user.id)) == 1


class TestRegistration:
    def test_register_returns_the_restorer_unchanged(self):
        async def handler(db, user_id, payload):  # pragma: no cover
            return None

        assert undo_service.register("k", handler) is handler
        assert undo_service.RESTORERS["k"] is handler

    def test_the_default_window_is_a_single_named_constant(self):
        """Not a literal repeated at call sites -- that is how two operations end
        up with two retention rules, which is the thing this table exists to
        prevent."""
        assert undo_service.UNDO_WINDOW_DAYS == 30
        assert undo_service.undo_deadline(
            datetime(2026, 1, 1, tzinfo=UTC)
        ) == datetime(2026, 1, 31, tzinfo=UTC)


class TestModelRegistration:
    def test_registered_in_models_package(self):
        """AGENTS pitfall 14: not in ``__init__`` means invisible to create_all.

        The integration harness builds the schema with ``create_all``, so a model
        missing from the package import would simply have no table -- and the
        tests above would fail with UndefinedTable, which is the intended alarm.
        Assert the registration directly so the reason is on record.
        """
        import app.models as models_pkg

        assert "UndoLog" in models_pkg.__all__
        assert hasattr(models_pkg, "UndoLog")