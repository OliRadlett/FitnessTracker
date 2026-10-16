"""Activity purpose read — Jev `purpose` tag exposure on `ActivityRead`.

The tag lives in ``Activity.context["tags"]["purpose"]`` (written by
``services.jev_tagging.tag_activity``). These are pure checks of the reader.
"""

from __future__ import annotations

from types import SimpleNamespace

from app.api.activities import _activity_purpose


def test_purpose_read_from_context():
    activity = SimpleNamespace(context={"tags": {"purpose": "commute"}})
    assert _activity_purpose(activity) == "commute"


def test_purpose_none_when_absent():
    assert _activity_purpose(SimpleNamespace(context=None)) is None
    assert _activity_purpose(SimpleNamespace(context={})) is None
    assert _activity_purpose(SimpleNamespace(context={"tags": {}})) is None
    # A ride block without tags (Jev unset) must not yield a purpose.
    assert (
        _activity_purpose(SimpleNamespace(context={"ride": {"power_zones": []}}))
        is None
    )
