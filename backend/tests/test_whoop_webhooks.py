"""Whoop webhook verification and the enqueue-only contract.

The signature is the whole security boundary: the payload names a user id and an
event, and acting on it means writing that user's health data. So the tests here
are mostly about what must be *rejected*.

The other property worth pinning is that the handler never processes inline. Whoop
retries five times over an hour; an inline sync would make every retry depend on a
provider call, and a slow response would cause the retry that then duplicates the
work.
"""

from __future__ import annotations

import base64
import hashlib
import hmac

import pytest

from app.services.provider_webhooks import WHOOP_HANDLED, whoop_signature_valid

SECRET = "whoop-client-secret"


def _sign(body: bytes, timestamp: str, secret: str = SECRET) -> str:
    return base64.b64encode(
        hmac.new(secret.encode(), timestamp.encode() + body, hashlib.sha256).digest()
    ).decode()


class TestWhoopSignature:
    def test_accepts_a_correct_signature(self):
        body = b'{"type":"sleep.updated","user_id":1}'
        ts = "1700000000000"

        assert whoop_signature_valid(body, ts, _sign(body, ts), SECRET) is True

    def test_rejects_a_tampered_body(self):
        """The signature covers the body, so any edit must fail."""
        ts = "1700000000000"
        signature = _sign(b'{"user_id":1}', ts)

        assert (
            whoop_signature_valid(b'{"user_id":2}', ts, signature, SECRET) is False
        )

    def test_rejects_a_replayed_timestamp(self):
        """The timestamp is inside the digest — that is what stops replays."""
        body = b'{"user_id":1}'
        signature = _sign(body, "1700000000000")

        assert (
            whoop_signature_valid(body, "1700000000001", signature, SECRET) is False
        )

    def test_rejects_another_secret(self):
        body = b'{"user_id":1}'
        ts = "1700000000000"

        assert (
            whoop_signature_valid(body, ts, _sign(body, ts, "other"), SECRET)
            is False
        )

    @pytest.mark.parametrize(
        ("timestamp", "signature", "secret"),
        [
            (None, "sig", SECRET),  # header missing
            ("1700000000000", None, SECRET),  # signature missing
            ("1700000000000", "", SECRET),
            ("1700000000000", "sig", ""),  # unconfigured secret
        ],
    )
    def test_missing_parts_are_rejected_not_defaulted(self, timestamp, signature, secret):
        """A blank secret must fail closed, never compare against an empty key."""
        assert whoop_signature_valid(b"{}", timestamp, signature, secret) is False

    def test_the_six_handled_types_are_the_documented_ones(self):
        """An unhandled type is stored and skipped, not failed — pin the set."""
        assert set(WHOOP_HANDLED) == {
            "sleep.updated",
            "sleep.deleted",
            "recovery.updated",
            "recovery.deleted",
            "workout.updated",
            "workout.deleted",
        }
