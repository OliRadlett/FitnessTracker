"""The Wahoo route sync must report an honest merged count.

``merged_count`` is returned by the API, but it was initialised, logged and
returned without ever being incremented, so it always read zero. The count now
derives from a prefetch of the user's existing Wahoo source ids, which is the
meaning Komoot already gives the same counter.
"""

from app.services.wahoo import _count_already_known


def test_counts_the_routes_we_already_stored():
    assert _count_already_known(["a", "b", "c"], {"a", "c"}) == 2


def test_a_first_sync_merges_nothing():
    assert _count_already_known(["a", "b"], set()) == 0
