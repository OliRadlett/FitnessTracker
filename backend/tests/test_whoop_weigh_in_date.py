"""A Whoop weigh-in belongs to the user's local day, not the server's.

Whoop's body measurement payload has no timestamp, so the sync used to date the
row with the server's ``date.today()``. For anyone east or west of the server
that writes the weigh-in to the wrong calendar day. The offset comes from the
account's most recent cycle, which is the only offset Whoop exposes.
"""

from datetime import UTC, date, datetime

from app.services.whoop import _weigh_in_date


def test_weigh_in_uses_the_local_day():
    # 23:30 UTC on 1 January is 01:30 on 2 January at +02:00.
    moment = datetime(2026, 1, 1, 23, 30, tzinfo=UTC)
    assert _weigh_in_date(moment, "+02:00") == date(2026, 1, 2)


def test_weigh_in_can_fall_on_the_previous_local_day():
    # 00:30 UTC on 2 January is 18:30 on 1 January at -06:00.
    moment = datetime(2026, 1, 2, 0, 30, tzinfo=UTC)
    assert _weigh_in_date(moment, "-06:00") == date(2026, 1, 1)


def test_weigh_in_falls_back_to_utc_without_an_offset():
    moment = datetime(2026, 1, 1, 23, 30, tzinfo=UTC)
    assert _weigh_in_date(moment, None) == date(2026, 1, 1)
