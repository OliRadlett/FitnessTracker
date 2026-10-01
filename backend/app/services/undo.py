"""Undo as compensation (plan §8) -- the log, the registry, and the policy.

The distinction this module exists to make: **undo is not a trash can.** There is
no soft-delete infrastructure anywhere in this app, and adding one would impose a
permanent "every read must now exclude deleted rows" tax -- the exact class of
bug the rest of this programme is about.

Destructive operations fall into three classes:

1. **No out-of-band effects** -- editing notes, deleting a warmup template. Row
   restore suffices; no log needed.
2. **In-band derived state** -- ``delete_set`` (volume, PR recalculation). Already
   compensated by the existing recalculation; undo means re-inserting and
   re-running the same compensation in reverse.
3. **Out-of-band side effects** -- a route merge trains the embedding metric; a PR
   notification is *pushed to a device*. Row restoration is the easy half; the
   effect the operation taught or announced elsewhere is the part that needs a
   design.

Only class 3 earns machinery, and it earns *this* machinery: one place holding
the snapshot, the replay guard, and -- the actual reason for the table -- **how
long the operation stays undoable**.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.undo import UndoLog

# How long a destructive operation stays undoable.
#
# This constant is the reason :class:`UndoLog` exists rather than each operation
# having its own table with its own implicit "forever". Centralising it is the
# cross-cutting policy; without it, the second undo surface invents a different
# rule and there is no way to answer "what is still undoable" without reading
# every table.
UNDO_WINDOW_DAYS = 30

UNDO_KIND_ROUTE_MERGE = "route_merge"

# What a restorer is handed, and what it returns.
#
# ``async`` and awaited: restoring touches the database, and this module is
# async throughout (AGENTS conventions).
Restorer = Callable[[AsyncSession, uuid.UUID, dict[str, Any]], Awaitable[Any]]

# kind -> restorer.
#
# A single table with a JSONB payload must NOT become a place where each kind's
# restore is untyped string manipulation against a shape nothing enforces. So
# restore logic lives here, typed per kind, and :func:`undo` refuses a kind with
# no registered restorer instead of pretending to succeed.
RESTORERS: dict[str, Restorer] = {}


def register(kind: str, restorer: Restorer) -> Restorer:
    """Register a restorer for ``kind``. Usable as a decorator."""

    RESTORERS[kind] = restorer
    return restorer


class UndoNotAvailable(Exception):
    """The undo cannot be performed: unknown kind, expired, or already undone.

    One exception for three distinct conditions because the caller's response is
    the same in all three -- there is nothing to undo. Kept as a distinct type
    rather than returning ``None`` so a restorer that *fails* (a parent row has
    since been deleted, plan §3.5) is not silently indistinguishable from "no such
    log".
    """


def undo_deadline(from_now: datetime | None = None) -> datetime:
    """The ``expires_at`` for a claim written now."""
    base = from_now or datetime.now(UTC)
    return base + timedelta(days=UNDO_WINDOW_DAYS)


async def record_undo(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    kind: str,
    payload: dict[str, Any],
    expires_at: datetime | None = None,
) -> UndoLog:
    """Write an undo claim for a completed destructive operation.

    Call this **in the same transaction as the operation**. A claim committed
    for an operation that then rolled back describes something that never
    happened, and one written for an operation whose transaction is still open
    may vanish with it.

    ``payload`` must be **JSON-native**, and that is a real constraint rather
    than a formality: it round-trips through JSONB, so a ``uuid.UUID`` written
    here comes back to the restorer as a ``str``, and a ``datetime`` as an ISO
    string. Restorers must coerce with ``uuid.UUID(value)`` rather than assume
    the type they passed in -- otherwise a restore works in-process and fails the
    first time it is actually read back from the database. The round-trip is
    checked here so the failure names the offending payload instead of surfacing
    later as a driver-level ``TypeError`` at flush time.
    """
    if kind not in RESTORERS:
        # Fail loudly at write time, not at undo time. An operation whose undo
        # cannot be performed should not have been logged as undoable.
        raise ValueError(
            f"no restorer registered for undo kind {kind!r}; "
            f"known kinds: {sorted(RESTORERS)}"
        )
    # Prove it survives the round-trip the restorer will actually do.
    try:
        json.dumps(payload)
    except (TypeError, ValueError) as exc:
        raise ValueError(
            f"undo payload for kind {kind!r} is not JSON-serialisable: {exc}. "
            "Convert UUIDs and datetimes to str -- the payload round-trips "
            "through JSONB, so restorers receive strings, not the objects "
            "passed in here."
        ) from exc

    log = UndoLog(
        user_id=user_id,
        kind=kind,
        payload=payload,
        expires_at=expires_at or undo_deadline(),
    )
    db.add(log)
    await db.flush()
    return log


async def undo(db: AsyncSession, log_id: uuid.UUID, user_id: uuid.UUID) -> Any:
    """Perform an undo. Single-level, server-authoritative, idempotent.

    Ordering matters and is the whole point of this function (plan §3.4):

    1. Load the claim **scoped to this user**, and check ``undone_at IS NULL``
       and ``expires_at > now``.
    2. **Claim it** with a conditional ``UPDATE ... WHERE undone_at IS NULL``,
       asserting ``rowcount == 1``.
    3. *Then* run the restorer.

    Claiming before restoring is what makes a double-clicked undo a no-op rather
    than a double-restore: two concurrent undos both pass step 1, but only one
    wins the conditional update in step 2. The reverse order restores twice.

    Ownership is checked in the same query as the replay guard, so there is no
    window in which another user's log has been loaded.
    """
    log = (
        await db.execute(
            select(UndoLog).where(
                UndoLog.id == log_id,
                UndoLog.user_id == user_id,
                UndoLog.undone_at.is_(None),
            )
        )
    ).scalar_one_or_none()
    if log is None:
        raise UndoNotAvailable("undo not available")

    now = datetime.now(UTC)
    if log.expires_at is not None and log.expires_at <= now:
        raise UndoNotAvailable("undo window expired")

    restorer = RESTORERS.get(log.kind)
    if restorer is None:
        # Unreachable via record_undo (which rejects unregistered kinds), but a
        # row can outlive a kind being removed from the registry.
        raise UndoNotAvailable(f"no restorer for kind {log.kind!r}")

    # Step 2: claim before restore.
    claimed = await db.execute(
        update(UndoLog)
        .where(UndoLog.id == log_id, UndoLog.undone_at.is_(None))
        .values(undone_at=now)
        .execution_options(synchronize_session=False)
    )
    if claimed.rowcount != 1:
        # Lost the race to a concurrent undo. That undo is doing the restore;
        # doing it again here would double-apply.
        raise UndoNotAvailable("already undone")

    return await restorer(db, user_id, dict(log.payload or {}))


async def list_undoable(
    db: AsyncSession, user_id: uuid.UUID, *, kind: str | None = None
) -> list[UndoLog]:
    """This user's live undo claims, newest first.

    "Live" is computed here rather than trusted from a stored flag, so a claim
    that has expired stops being offered the moment it expires instead of at the
    next prune.
    """
    now = datetime.now(UTC)
    stmt = select(UndoLog).where(
        UndoLog.user_id == user_id,
        UndoLog.undone_at.is_(None),
        UndoLog.expires_at > now,
    )
    if kind is not None:
        stmt = stmt.where(UndoLog.kind == kind)
    result = await db.execute(
        # Ties on ``created_at`` are real, not hypothetical: `now()` is the
        # *transaction* timestamp (AGENTS pitfall 28), so two claims written in
        # one operation share it. The id tiebreak makes the order **total and
        # therefore deterministic across calls** -- which is the property this
        # list needs, since it drives an undo button whose order must not shuffle
        # between renders.

        # It does **not** recover insertion order, and it cannot: random UUIDs
        # carry no sequence. Claims written in the same transaction are genuinely
        # indistinguishable by age, so they are presented in an arbitrary-but-stable
        # order rather than a plausible-looking one. If real insertion order is
        # ever needed, the fix is a monotonic column, not a cleverer sort.
        stmt.order_by(UndoLog.created_at.desc(), UndoLog.id.desc())
    )
    return list(result.scalars().all())


async def prune_expired(db: AsyncSession, *, now: datetime | None = None) -> int:
    """Delete claims past their window. Returns the number removed.

    They are audit data only past ``expires_at`` -- the operation cannot be
    reversed, so keeping the row serves nothing except growth. Kept as a task
    rather than a request-path delete so a read never has to clean up.
    """
    cutoff = now or datetime.now(UTC)
    result = await db.execute(delete(UndoLog).where(UndoLog.expires_at <= cutoff))
    return int(result.rowcount or 0)