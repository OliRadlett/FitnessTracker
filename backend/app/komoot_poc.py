"""PoC script to test Komoot API endpoints.

Run inside the backend container:
  python fittrack.py exec backend python scripts/komoot_poc.py

Reads KOMOOT_EMAIL, KOMOOT_PASSWORD, KOMOOT_USER_ID from environment.
"""

import base64
import json
import os

import httpx

EMAIL = os.environ.get("KOMOOT_EMAIL", "")
PASSWORD = os.environ.get("KOMOOT_PASSWORD", "")
USER_ID = os.environ.get("KOMOOT_USER_ID", "")

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/131.0.0.0 Safari/537.36"
)

BASE_URLS = [
    "https://www.komoot.com/api/v007",
    "https://api.komoot.de/v007",
    "https://api.komoot.de/v0.07",
]


def basic_auth_header(email: str, password: str) -> str:
    return base64.b64encode(f"{email}:{password}".encode()).decode()


def headers(auth_type="none", token=""):
    h = {"User-Agent": USER_AGENT, "Accept": "application/hal+json, application/json"}
    if auth_type == "basic":
        h["Authorization"] = f"Basic {basic_auth_header(EMAIL, PASSWORD)}"
    elif auth_type == "bearer":
        h["Authorization"] = f"Bearer {token}"
    return h


def test_endpoint(url, auth_type="none", token="", method="GET", json_body=None):
    """Test a single endpoint and return status + response summary."""
    try:
        with httpx.Client(timeout=15, follow_redirects=True) as client:
            if method == "POST":
                resp = client.post(
                    url, headers=headers(auth_type, token), json=json_body
                )
            else:
                resp = client.get(url, headers=headers(auth_type, token))

            content_type = resp.headers.get("content-type", "")
            body_preview = resp.text[:500]

            result = {
                "url": url,
                "status": resp.status_code,
                "content_type": content_type,
                "body_preview": body_preview,
            }

            if "json" in content_type:
                try:
                    data = resp.json()
                    if isinstance(data, dict):
                        result["keys"] = list(data.keys())[:20]
                        if "_embedded" in data:
                            embedded = data["_embedded"]
                            result["embedded_keys"] = list(embedded.keys())[:10]
                            for k, v in embedded.items():
                                if isinstance(v, list):
                                    result[f"embedded_{k}_count"] = len(v)
                                    if v:
                                        result[f"embedded_{k}_first_keys"] = (
                                            list(v[0].keys())[:15]
                                            if isinstance(v[0], dict)
                                            else str(v[0])[:100]
                                        )
                except Exception:
                    pass

            return result
    except Exception as e:
        return {"url": url, "error": str(e)}


def main():
    print("=" * 80)
    print("Komoot API PoC")
    print("=" * 80)
    print(f"Email: {EMAIL[:3]}***" if EMAIL else "Email: NOT SET")
    print(f"Password: {'***' if PASSWORD else 'NOT SET'}")
    print(f"User ID: {USER_ID or 'NOT SET'}")
    print()

    if not EMAIL or not PASSWORD:
        print("ERROR: Set KOMOOT_EMAIL and KOMOOT_PASSWORD environment variables")
        return

    # ── Test 1: Find working base URL ──────────────────────────────────────
    print("─" * 80)
    print("TEST 1: Find working base URL (unauthenticated)")
    print("─" * 80)
    for base in BASE_URLS:
        url = f"{base}/users/{USER_ID}/tours/?limit=1"
        result = test_endpoint(url)
        print(f"  {base} → {result.get('status', result.get('error', '?'))}")
    print()

    # ── Test 2: Try session login on each base URL ─────────────────────────
    print("─" * 80)
    print("TEST 2: Try session login (POST /account/v1/session)")
    print("─" * 80)
    session_token = None
    for base in BASE_URLS:
        url = f"{base}/account/v1/session"
        result = test_endpoint(
            url, method="POST", json_body={"email": EMAIL, "password": PASSWORD}
        )
        print(
            f"  {base}/account/v1/session → {result.get('status', result.get('error', '?'))}"
        )
        if result.get("status") in (200, 201):
            print(f"    Keys: {result.get('keys', '?')}")
            print(f"    Body: {result.get('body_preview', '')[:200]}")
            try:
                data = json.loads(result.get("body_preview", "{}"))
                session_token = (
                    data.get("token")
                    or data.get("access_token")
                    or data.get("session_token")
                )
            except Exception:
                pass
    print()

    # ── Test 3: Try Basic Auth on each base URL ────────────────────────────
    print("─" * 80)
    print("TEST 3: Try Basic Auth (email:password)")
    print("─" * 80)
    for base in BASE_URLS:
        url = f"{base}/users/{USER_ID}/tours/?limit=1"
        result = test_endpoint(url, auth_type="basic")
        print(
            f"  {base}/users/{USER_ID}/tours/ → {result.get('status', result.get('error', '?'))}"
        )
        if result.get("status") == 200:
            print(f"    Keys: {result.get('keys', '?')}")
            print(f"    Embedded keys: {result.get('embedded_keys', '?')}")
            if "embedded_items_count" in result:
                print(f"    Items count: {result['embedded_items_count']}")
                if "embedded_items_first_keys" in result:
                    print(f"    First item keys: {result['embedded_items_first_keys']}")
    print()

    # ── Test 4: Try Bearer token if we got one ─────────────────────────────
    if session_token:
        print("─" * 80)
        print("TEST 4: Try Bearer token from session login")
        print("─" * 80)
        for base in BASE_URLS:
            url = f"{base}/users/{USER_ID}/tours/?limit=1"
            result = test_endpoint(url, auth_type="bearer", token=session_token)
            print(
                f"  {base}/users/{USER_ID}/tours/ → {result.get('status', result.get('error', '?'))}"
            )
            if result.get("status") == 200:
                print(f"    Keys: {result.get('keys', '?')}")
        print()

    # ── Test 5: Try account endpoint with Basic Auth ───────────────────────
    print("─" * 80)
    print("TEST 5: Try account endpoint with Basic Auth")
    print("─" * 80)
    account_urls = [
        f"https://www.komoot.com/api/v007/account/email/{EMAIL}/",
        "https://www.komoot.com/api/v007/account/v1/users/me",
        "https://www.komoot.com/api/v007/users/me/",
        "https://api.komoot.de/v0.07/account",
        "https://api.komoot.de/v007/account",
    ]
    for url in account_urls:
        result = test_endpoint(url, auth_type="basic")
        print(f"  {url} → {result.get('status', result.get('error', '?'))}")
        if result.get("status") == 200:
            print(f"    Keys: {result.get('keys', '?')}")
            print(f"    Body: {result.get('body_preview', '')[:300]}")
    print()

    # ── Test 6: Try planned tours with type filter ─────────────────────────
    print("─" * 80)
    print("TEST 6: Try planned tours (type=tour_planned)")
    print("─" * 80)
    for base in BASE_URLS:
        url = f"{base}/users/{USER_ID}/tours/?limit=3&type=tour_planned"
        result = test_endpoint(url, auth_type="basic")
        print(f"  {url} → {result.get('status', result.get('error', '?'))}")
        if result.get("status") == 200:
            print(f"    Keys: {result.get('keys', '?')}")
            if "embedded_items_count" in result:
                print(f"    Items count: {result['embedded_items_count']}")
                if "embedded_items_first_keys" in result:
                    print(f"    First item keys: {result['embedded_items_first_keys']}")
    print()

    # ── Test 7: Try recorded tours ─────────────────────────────────────────
    print("─" * 80)
    print("TEST 7: Try recorded tours (no type filter)")
    print("─" * 80)
    for base in BASE_URLS:
        url = f"{base}/users/{USER_ID}/tours/?limit=3"
        result = test_endpoint(url, auth_type="basic")
        print(f"  {url} → {result.get('status', result.get('error', '?'))}")
        if result.get("status") == 200:
            print(f"    Keys: {result.get('keys', '?')}")
            if "embedded_items_count" in result:
                print(f"    Items count: {result['embedded_items_count']}")
                if result["embedded_items_count"] > 0:
                    print(
                        f"    First item keys: {result.get('embedded_items_first_keys', '?')}"
                    )
                    # Print first item details
                    try:
                        data = json.loads(result.get("body_preview", "{}"))
                        first = data["_embedded"]["items"][0]
                        print(
                            f"    First item: id={first.get('id')}, name={first.get('name')}, sport={first.get('sport')}, distance={first.get('distance')}"
                        )
                    except Exception:
                        pass
    print()

    print("=" * 80)
    print("Done!")
    print("=" * 80)


if __name__ == "__main__":
    main()
