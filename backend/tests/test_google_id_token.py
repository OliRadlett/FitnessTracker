"""Google ID token verification for native sign-in.

These tests sign real tokens with a generated RSA key and install a matching
JWKS, so they exercise the actual jose signature path rather than mocking it.
"""

import base64
import time

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from jose import jwt

from app.services import google_id

AUDIENCE = "test-web-client.apps.googleusercontent.com"
KID = "test-key-1"


def _b64u(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@pytest.fixture(scope="module")
def signing_key():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    numbers = key.public_key().public_numbers()
    jwks = {
        KID: {
            "kty": "RSA",
            "alg": "RS256",
            "use": "sig",
            "kid": KID,
            "n": _b64u(numbers.n),
            "e": _b64u(numbers.e),
        }
    }
    return pem, jwks


@pytest.fixture(autouse=True)
def installed_keys(signing_key):
    _, jwks = signing_key
    google_id._reset_cache()
    google_id._install_keys(jwks)
    yield
    google_id._reset_cache()


def _claims(**overrides) -> dict:
    now = int(time.time())
    base = {
        "iss": "https://accounts.google.com",
        "aud": AUDIENCE,
        "sub": "1234567890",
        "email": "oli@example.com",
        "email_verified": True,
        "iat": now,
        "exp": now + 3600,
    }
    base.update(overrides)
    return base


def _token(pem: str, claims: dict, kid: str = KID) -> str:
    return jwt.encode(claims, pem, algorithm="RS256", headers={"kid": kid})


async def test_valid_token_returns_claims(signing_key):
    pem, _ = signing_key
    claims = await google_id.verify_google_id_token(_token(pem, _claims()), AUDIENCE)

    assert claims["email"] == "oli@example.com"
    assert claims["sub"] == "1234567890"


async def test_wrong_audience_is_rejected(signing_key):
    pem, _ = signing_key
    token = _token(pem, _claims(aud="someone-elses-client"))

    with pytest.raises(google_id.GoogleTokenError):
        await google_id.verify_google_id_token(token, AUDIENCE)


async def test_expired_token_is_rejected(signing_key):
    pem, _ = signing_key
    token = _token(pem, _claims(exp=int(time.time()) - 60))

    with pytest.raises(google_id.GoogleTokenError):
        await google_id.verify_google_id_token(token, AUDIENCE)


async def test_wrong_issuer_is_rejected(signing_key):
    pem, _ = signing_key
    token = _token(pem, _claims(iss="https://evil.example"))

    with pytest.raises(google_id.GoogleTokenError):
        await google_id.verify_google_id_token(token, AUDIENCE)


async def test_unknown_key_id_is_rejected(signing_key):
    pem, _ = signing_key
    token = _token(pem, _claims(), kid="not-a-google-key")

    with pytest.raises(google_id.GoogleTokenError, match="not recognised"):
        await google_id.verify_google_id_token(token, AUDIENCE)


async def test_unverified_email_is_rejected(signing_key):
    pem, _ = signing_key
    token = _token(pem, _claims(email_verified=False))

    with pytest.raises(google_id.GoogleTokenError, match="not verified"):
        await google_id.verify_google_id_token(token, AUDIENCE)


async def test_symmetric_algorithm_is_rejected():
    # A token claiming HS256 must never reach signature verification.
    token = jwt.encode(_claims(), "some-shared-secret", algorithm="HS256")

    with pytest.raises(google_id.GoogleTokenError, match="algorithm"):
        await google_id.verify_google_id_token(token, AUDIENCE)


async def test_token_signed_by_a_different_key_is_rejected(signing_key):
    pem, _ = signing_key
    other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    other_pem = other.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    token = _token(other_pem, _claims(), kid=KID)

    with pytest.raises(google_id.GoogleTokenError):
        await google_id.verify_google_id_token(token, AUDIENCE)
