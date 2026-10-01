"""Tests for ``update_set`` write-path invariants.

``exercise_name`` is the de facto key for every lifting view (chart registry,
PR correlation, video correlation, volume/e1RM trends, CSV export). Two write
paths stored the canonical form (``create_session``, ``add_set``) while
``update_set`` wrote the raw client string — so a single PATCH could fork a set
off the exercise's entire history, and ``_recalculate_pr_after_set_change``
would then mint a ``PersonalRecord`` for an exercise that never existed.

These tests drive ``update_set`` with a fake session, matching the mock-based
pattern already used in ``test_retry.py`` (the suite has no async DB fixture).
"""

from datetime import date
from types import SimpleNamespace

import pytest

from app.schemas.lifting import LiftingSetUpdate
from app.services.exercise_db import normalise_exercise_name
from app.services.lifting import _MUTABLE_SET_FIELDS, update_set

# ── Fakes ────────────────────────────────────────────────────────────────────


class _FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value

    def scalar_one(self):
        return self._value

    def all(self):
        return self._value or []


class _FakeSession:
    """Minimal AsyncSession stand-in recording mutations.

    The first ``execute`` always resolves the target ``LiftingSet``; every
    subsequent ``execute`` takes the next value from ``execute_results``, so a
    test hands back a different row per query the service makes after the
    lookup. Tests therefore cannot forget to provide the row under test.
    """

    def __init__(self, *, set_row=None, session_row=None, execute_results=None):
        self._session_row = session_row
        self._queue = [set_row, *(execute_results or [])]
        self.flushed = 0
        self.added = []
        self.deleted = []

    async def execute(self, stmt):
        if self._queue:
            return _FakeResult(self._queue.pop(0))
        return _FakeResult(None)

    async def get(self, model, pk):
        return self._session_row

    async def flush(self):
        self.flushed += 1

    def add(self, obj):
        self.added.append(obj)

    async def delete(self, obj):
        self.deleted.append(obj)


def _set(**overrides):
    base = {
        "session_id": "sess-1",
        "session_date": date(2026, 10, 1),
        "exercise_name": "Bench Press",
        "set_number": 1,
        "weight_kg": 100.0,
        "reps": 5,
        "rpe": None,
        "is_warmup": False,
        "is_amrap": False,
        "notes": None,
        "total_volume_kg": 0.0,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


# ── Core regression: exercise_name is normalised on PATCH ────────────────────


@pytest.mark.asyncio
class TestUpdateSetNormalisesExerciseName:
    async def test_lowercase_alias_becomes_canonical(self):
        """The bug: 'bench' was persisted raw, forking the set off 'Bench Press'."""
        db = _FakeSession(set_row=_set(), session_row=_set(total_volume_kg=500.0))

        result = await update_set(
            db,
            set_id="set-1",
            user_id="user-1",
            data=LiftingSetUpdate(exercise_name="bench"),
        )

        assert result.exercise_name == "Bench Press"

    @pytest.mark.parametrize(
        "raw,expected",
        [
            ("bench", "Bench Press"),
            ("  bench  ", "Bench Press"),
            ("BENCH", "Bench Press"),
            ("bp", "Bench Press"),
            ("flat bench", "Bench Press"),
            ("squat", "Back Squat"),
            ("Bench Press", "Bench Press"),
        ],
    )
    async def test_normalisation_table(self, raw, expected):
        db = _FakeSession(set_row=_set(), session_row=_set(total_volume_kg=500.0))

        result = await update_set(
            db,
            set_id="set-1",
            user_id="user-1",
            data=LiftingSetUpdate(exercise_name=raw),
        )

        assert result.exercise_name == expected
        # Never worse than the raw input: normalise is idempotent on its output.
        assert normalise_exercise_name(result.exercise_name) == result.exercise_name

    async def test_canonical_name_preserved_when_unchanged(self):
        db = _FakeSession(set_row=_set(), session_row=_set(total_volume_kg=500.0))

        result = await update_set(
            db,
            set_id="set-1",
            user_id="user-1",
            data=LiftingSetUpdate(exercise_name="Bench Press", weight_kg=105.0),
        )

        assert result.exercise_name == "Bench Press"
        assert result.weight_kg == 105.0

    async def test_no_phantom_pr_for_forked_name(self):
        """A forked name must not mint a second PersonalRecord.

        ``_recalculate_pr_after_set_change`` runs on the *new* name. If that name
        is non-canonical it queries for a PR of an exercise that has no history,
        finds none, and creates one from this single set — a record for a lift the
        user never performed under that name.
        """
        target = _set()
        # execute order after the set lookup:
        #   1) _recalculate_pr_after_set_change -> PersonalRecord lookup
        #   2) _recalculate_pr_after_set_change -> best remaining set lookup
        existing_pr = SimpleNamespace(
            exercise_name="Bench Press", estimated_1rm=110.0, weight_kg=100.0, reps=5
        )
        # A weaker set, so the "improved" branch is not taken.
        best_set = _set(weight_kg=90.0, reps=5)
        db = _FakeSession(
            set_row=target,
            session_row=_set(total_volume_kg=450.0),
            execute_results=[existing_pr, best_set],
        )

        result = await update_set(
            db,
            set_id="set-1",
            user_id="user-1",
            data=LiftingSetUpdate(exercise_name="bench"),
        )

        assert result.exercise_name == "Bench Press"
        # No PR created and none removed: the canonical name's record is untouched.
        assert db.added == []
        assert db.deleted == []
        # The PR that was recalculated belongs to the canonical exercise.
        assert existing_pr.exercise_name == "Bench Press"

    async def test_none_exercise_name_not_normalised(self):
        """A null must stay null rather than crashing the normaliser."""
        db = _FakeSession(set_row=_set(), session_row=_set(total_volume_kg=500.0))

        result = await update_set(
            db,
            set_id="set-1",
            user_id="user-1",
            data=LiftingSetUpdate(exercise_name=None, notes="belt on"),
        )

        assert result.exercise_name is None
        assert result.notes == "belt on"


# ── Allowlist drift guard ────────────────────────────────────────────────────


class TestMutableFieldAllowlist:
    def test_every_schema_field_is_allowlisted(self):
        """Guards the blanket-setattr hazard.

        The loop in ``update_set`` skips anything outside the allowlist, so a new
        ``LiftingSetUpdate`` field added without updating the allowlist would be
        silently ignored at runtime. Fail here instead.
        """
        schema_fields = set(LiftingSetUpdate.model_fields)
        missing = schema_fields - _MUTABLE_SET_FIELDS
        assert not missing, (
            f"LiftingSetUpdate fields not in _MUTABLE_SET_FIELDS: {sorted(missing)}. "
            "Either add them to the allowlist or handle them explicitly."
        )

    def test_allowlist_has_no_fields_absent_from_schema(self):
        """Stale allowlist entries hide typos (a field nothing can ever set)."""
        extra = _MUTABLE_SET_FIELDS - set(LiftingSetUpdate.model_fields)
        assert not extra, f"Stale entries in _MUTABLE_SET_FIELDS: {sorted(extra)}"

    def test_id_and_timestamps_are_not_mutable(self):
        """Identity and creation time must never be client-writable."""
        for protected in ("id", "created_at", "session_id"):
            assert protected not in _MUTABLE_SET_FIELDS


# ── Surrounding logic still works (update_set had zero prior coverage) ────────


@pytest.mark.asyncio
class TestUpdateSetVolumeAndWarmup:
    async def test_weight_change_updates_session_volume(self):
        session_row = _set(total_volume_kg=1000.0)
        db = _FakeSession(
            set_row=_set(weight_kg=100.0, reps=5), session_row=session_row
        )

        await update_set(
            db,
            set_id="set-1",
            user_id="user-1",
            data=LiftingSetUpdate(weight_kg=120.0),
        )

        # 1000 - (100*5) + (120*5) = 1100
        assert session_row.total_volume_kg == 1100.0

    async def test_promoting_to_warmup_removes_volume(self):
        session_row = _set(total_volume_kg=1000.0)
        db = _FakeSession(
            set_row=_set(weight_kg=100.0, reps=5, is_warmup=False),
            session_row=session_row,
        )

        await update_set(
            db,
            set_id="set-1",
            user_id="user-1",
            data=LiftingSetUpdate(is_warmup=True),
        )

        assert session_row.total_volume_kg == 500.0

    async def test_volume_never_goes_negative(self):
        session_row = _set(total_volume_kg=100.0)
        db = _FakeSession(
            set_row=_set(weight_kg=100.0, reps=5), session_row=session_row
        )

        await update_set(
            db,
            set_id="set-1",
            user_id="user-1",
            data=LiftingSetUpdate(weight_kg=10.0),
        )

        assert session_row.total_volume_kg == 0.0

    async def test_missing_set_returns_none(self):
        db = _FakeSession(set_row=None)

        result = await update_set(
            db,
            set_id="missing",
            user_id="user-1",
            data=LiftingSetUpdate(weight_kg=100.0),
        )

        assert result is None
        assert db.flushed == 0
