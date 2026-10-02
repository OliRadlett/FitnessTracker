"""The FIT time axis, end to end.

An imported FIT file produced **no** time axis: ``fit_parser`` read eight fields off
each record message and never touched ``timestamp``, and ``STREAM_TYPE_MAP`` had no
``time`` key. So ``segments._time_axis`` — which exists precisely to fix this, and
whose docstring explains why nominal spacing is wrong — always returned ``None`` for
imported rides, and every segment effort fell back to ``duration // len(values)``.

That arithmetic assigns **one** uniform rate to a file that is genuinely multi-rate
(1 Hz power beside 5 s GPS), so segment efforts and VAM on imported routes were
systematically wrong. Which is why the hill leaderboard in the next section cannot be
trusted until this lands.

These tests stub ``fitparse`` (a Cython package that does not build on Windows; CI is
Linux and has it) so the parser module is importable and the import path is drivable
on every platform.
"""

from __future__ import annotations

import importlib
import sys
import types
from datetime import UTC, date, datetime, timedelta

import pytest

from app.api.activities import _observed_resolution
from app.models.activity import ActivityStream
from app.services.segments import _time_axis

pytestmark = pytest.mark.integration


@pytest.fixture
def fit_parser():
    """Import ``app.services.fit_parser`` with ``fitparse`` stubbed, scoped.

    ``fitparse`` is a Cython package that does not build on Windows (CI is Linux
    and has it), so the parser module cannot be imported there at all. Stubbing
    is the only way to exercise it locally.

    Scoped to this fixture deliberately. An earlier version installed the stub in
    ``sys.modules`` at *module import* time, which leaked into every other test
    module in the session: ``test_fit_course.py`` resolved its real ``fitparse``
    import to this stub and failed with a ``TypeError`` three files away.
    Import-time global mutation in a test file is not safe here.
    """
    try:
        importlib.import_module("fitparse")
        return importlib.import_module("app.services.fit_parser")
    except ImportError:
        pass

    stub = types.ModuleType("fitparse")
    stub.FitFile = object  # only the name is needed at import time
    sys.modules["fitparse"] = stub
    try:
        return importlib.import_module("app.services.fit_parser")
    finally:
        # Remove it again: the parser module keeps its own reference, and
        # anything importing fitparse later must get the real thing (or fail
        # honestly) rather than this stub.
        del sys.modules["fitparse"]


def _streams_for(timestamps, **extra):
    """A parsed FIT payload whose ``time`` stream is ``timestamps``."""
    session = {
        "name": "Timed Ride",
        "sport_type": "cycling",
        "start_time": datetime(2026, 9, 20, 9, 0, tzinfo=UTC),
        "duration_seconds": 60,
        "distance_meters": 5000.0,
        "elevation_gain_meters": 50.0,
        "average_heartrate": 140.0,
        "max_heartrate": 160.0,
        "average_power": 200.0,
        "normalized_power": 210.0,
        "average_speed": 8.3,
        "average_cadence": 85.0,
        "calories": 300.0,
        "record_count": len(timestamps),
    }
    streams: dict = {
        "heartrate": [140.0] * len(timestamps),
        "power": [200.0] * len(timestamps),
        "time": list(timestamps),
    }
    streams.update(extra)
    return {"session": session, "streams": streams}


def _import(client, monkeypatch, payload: dict):
    stub = types.ModuleType("app.services.fit_parser")
    stub.parse_fit_file = lambda raw: payload
    monkeypatch.setitem(sys.modules, "app.services.fit_parser", stub)
    return client.post(
        "/api/v1/activities/import-fit",
        files={"file": ("ride.fit", b"fit-bytes", "application/octet-stream")},
    )


# ── Timestamp decoding ─────────────────────────────────────────────────────


class TestEpochSeconds:
    def test_datetime_is_converted(self, fit_parser):
        stamp = datetime(2026, 9, 20, 9, 0, tzinfo=UTC)
        assert fit_parser._epoch_seconds(stamp) == stamp.timestamp()

    def test_naive_datetime_is_treated_as_utc(self, fit_parser):
        """FIT timestamps are absolute; a naive value must not be local time."""
        naive = datetime(2026, 9, 20, 9, 0)
        aware = datetime(2026, 9, 20, 9, 0, tzinfo=UTC)
        assert fit_parser._epoch_seconds(naive) == fit_parser._epoch_seconds(aware)

    def test_raw_fit_milliseconds_are_decoded(self, fit_parser):
        """A uint32 of ms since the FIT epoch, from a decoder that does not convert.

        1000 is 1000 *milliseconds*, i.e. one thousand seconds past the FIT
        epoch — not one second. The magnitude, not a unit field, is what
        distinguishes this from an absolute epoch-seconds value.
        """
        decoded = fit_parser._epoch_seconds(1000.0)
        assert decoded == fit_parser._FIT_EPOCH.timestamp() + 1000.0

    def test_large_millisecond_value_is_scaled(self, fit_parser):
        """A ms epoch value is ~1e9; unscaled it would land in the year 5138."""
        decoded = fit_parser._epoch_seconds(1_757_872_800_000.0)
        assert 1_700_000_000 < decoded < 2_000_000_000

    @pytest.mark.parametrize("value", [None, "nonsense", object()])
    def test_unusable_values_return_none(self, value, fit_parser):
        assert fit_parser._epoch_seconds(value) is None

    def test_bool_is_not_treated_as_a_number(self, fit_parser):
        """bool is an int subclass; True must not become 1 second past the epoch."""
        assert fit_parser._epoch_seconds(True) is None


# ── Observed resolution ────────────────────────────────────────────────────


class TestObservedResolution:
    def test_one_hz(self):
        assert _observed_resolution([0.0, 1.0, 2.0, 3.0, 4.0]) == 1

    def test_five_second_gps(self):
        assert _observed_resolution([0.0, 5.0, 10.0, 15.0, 20.0]) == 5

    def test_median_resists_a_dropout(self):
        """A signal gap must not shift the rate the bulk of samples share.

        This is why the median, not the mean: one 60 s gap among 1 Hz samples
        would drag a mean to ~8 s and mislabel every stream in the file.
        """
        axis = [float(i) for i in range(8)] + [60.0]
        assert _observed_resolution(axis) == 1

    @pytest.mark.parametrize(
        "axis",
        [
            [],
            [5.0],
            [5.0, 4.0, 3.0],
            [None, None],
            # A *partially* missing axis is the dangerous case: filtering the
            # hole out would yield a series shorter than the index-aligned
            # streams it is supposed to describe, misaligning all of them.
            [1.0, None, 2.0, 3.0],
        ],
    )
    def test_unusable_axes_return_none(self, axis):
        assert _observed_resolution(axis) is None

    def test_never_returns_less_than_one(self):
        """Sub-second sampling still has to yield a usable integer resolution."""
        assert _observed_resolution([0.0, 0.25, 0.5, 0.75]) == 1


# ── The stream actually reaches the database ────────────────────────────────


class TestTimeStreamPersisted:
    async def test_import_stores_a_time_stream(self, client, db_session, monkeypatch):
        from sqlalchemy import select

        payload = _streams_for([0.0, 1.0, 2.0, 3.0, 4.0])
        resp = await _import(client, monkeypatch, payload)
        assert resp.status_code == 200, resp.text

        rows = list(
            (
                await db_session.execute(
                    select(ActivityStream).where(
                        ActivityStream.stream_type == "time"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1, "the time axis must be persisted, not discarded"
        assert len(rows[0].data["data"]) == 5

    async def test_time_stream_resolution_is_one(self, client, db_session, monkeypatch):
        from sqlalchemy import select

        payload = _streams_for([0.0, 5.0, 10.0, 15.0, 20.0])
        assert (await _import(client, monkeypatch, payload)).status_code == 200

        rows = list(
            (
                await db_session.execute(
                    select(ActivityStream).where(
                        ActivityStream.stream_type == "time"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert rows[0].resolution == 1, "the axis is one sample per timestamp"

    async def test_other_streams_use_the_observed_rate(
        self, client, db_session, monkeypatch
    ):
        """A 5 Hz file must not label its streams at the old arithmetic rate.

        The old expression was ``duration // len(values)``; with duration 60 and
        5 samples that is 12 s, when the file actually records every 5 s. Every
        stream now carries the real observed spacing.
        """
        from sqlalchemy import select

        payload = _streams_for([0.0, 5.0, 10.0, 15.0, 20.0])
        assert (await _import(client, monkeypatch, payload)).status_code == 200

        rows = list(
            (await db_session.execute(select(ActivityStream))).scalars().all()
        )
        by_type = {r.stream_type: r.resolution for r in rows}
        assert by_type["heartrate"] == 5
        assert by_type["power"] == 5
        assert by_type["time"] == 1

    async def test_missing_time_axis_falls_back_to_arithmetic(
        self, client, db_session, monkeypatch
    ):
        """A file with no timestamps still imports, at the old estimate.

        Better a known-imperfect fallback than a null resolution no consumer can
        interpret.
        """
        from sqlalchemy import select

        payload = _streams_for([0.0, 1.0, 2.0, 3.0, 4.0])
        payload["streams"].pop("time")
        resp = await _import(client, monkeypatch, payload)
        assert resp.status_code == 200, resp.text

        rows = list(
            (await db_session.execute(select(ActivityStream))).scalars().all()
        )
        types = {r.stream_type for r in rows}
        assert "time" not in types
        # duration 60 / 5 samples = 12, the pre-existing behaviour.
        power = next(r for r in rows if r.stream_type == "power")
        assert power.resolution == 12


class TestTimeAxisIsReachable:
    """The point of all of the above: ``_time_axis`` now works for imports.

    Before this, an imported ride always fell through to nominal spacing, so
    every segment effort and VAM computed from it was wrong.
    """

    async def test_time_axis_resolves_for_an_imported_activity(
        self, client, db_session, monkeypatch
    ):
        from sqlalchemy import select

        start = datetime(2026, 9, 20, 9, 0, tzinfo=UTC)
        stamps = [(start + timedelta(seconds=i)).timestamp() for i in range(5)]
        payload = _streams_for(stamps)
        resp = await _import(client, monkeypatch, payload)
        assert resp.status_code == 200, resp.text

        rows = list(
            (
                await db_session.execute(
                    select(ActivityStream).where(
                        ActivityStream.stream_type == "time"
                    )
                )
            )
            .scalars()
            .all()
        )
        axis = _time_axis({"time": rows[0].data["data"]})

        # Previously None. Now a real, normalised-to-elapsed axis.
        assert axis is not None
        assert axis[0] == 0.0
        assert axis == [0.0, 1.0, 2.0, 3.0, 4.0]

    def test_non_monotonic_axis_is_rejected(self):
        """A bad axis must fall back, not produce nonsense spacing.

        ``_time_axis`` requires strictly increasing values and returns None
        otherwise; assert the contract so a future change cannot quietly relax
        it into producing a decreasing axis.
        """
        assert _time_axis({"time": [5.0, 4.0, 3.0]}) is None
        assert _time_axis({"time": [1.0, 1.0, 1.0]}) is None
        assert _time_axis({}) is None
