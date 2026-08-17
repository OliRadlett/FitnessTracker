"""Test all possible Whoop API endpoint paths for sleep and workout data.

Reads the OAuth access token from the PostgreSQL database and systematically
tests every plausible URL pattern against the Whoop API.
"""

import io
import sys

# Handle Windows console encoding
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding="utf-8")

import httpx
import psycopg2

# ── Configuration ──────────────────────────────────────────────────────────

DB_CONFIG = {
    "host": "localhost",
    "port": 5432,
    "user": "fittrack",
    "password": "fittrack_dev",
    "dbname": "fittrack",
}

API_BASE = "https://api.prod.whoop.com"


def get_access_token() -> str:
    """Read the most recent Whoop OAuth access token from the database."""
    conn = psycopg2.connect(**DB_CONFIG)
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT access_token FROM oauth_connections "
                "WHERE provider = 'whoop' ORDER BY id DESC LIMIT 1"
            )
            row = cur.fetchone()
            if not row:
                raise RuntimeError("No Whoop OAuth connection found in database")
            return row[0]
    finally:
        conn.close()


def get_a_cycle_id(token: str) -> int | None:
    """Fetch a real cycle ID from the API (or DB) to test cycle-scoped endpoints."""
    # Try the API first
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    try:
        resp = httpx.get(
            f"{API_BASE}/developer/v1/cycle",
            headers=headers,
            params={"limit": 1},
            timeout=15,
        )
        if resp.status_code == 200:
            records = resp.json().get("records", [])
            if records:
                return records[0].get("id")
    except Exception:
        pass

    # Fallback: try DB
    try:
        conn = psycopg2.connect(**DB_CONFIG)
        with conn.cursor() as cur:
            cur.execute("SELECT whoop_cycle_id FROM whoop_cycles LIMIT 1")
            row = cur.fetchone()
            if row:
                return row[0]
    except Exception:
        pass
    finally:
        conn.close()

    return None


def test_endpoint(
    method: str,
    path: str,
    token: str,
    params: dict | None = None,
    label: str = "",
) -> None:
    """Test a single endpoint and print the result."""
    url = f"{API_BASE}{path}"
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}

    try:
        if method == "GET":
            resp = httpx.get(url, headers=headers, params=params or {}, timeout=15)
        else:
            resp = httpx.request(method, url, headers=headers, params=params or {}, timeout=15)

        status = resp.status_code
        body_preview = resp.text[:200].replace("\n", " ")
        marker = "✅" if status == 200 else ("⚠️" if status < 400 else "❌")

        print(f"{marker} [{status}] {label or path}")
        print(f"   URL: {url}")
        if params:
            print(f"   Params: {params}")
        print(f"   Body: {body_preview}")
        print()
    except Exception as e:
        print(f"💥 ERROR {label or path}: {e}")
        print()


def main() -> None:
    print("=" * 80)
    print("Whoop API Endpoint Discovery Script")
    print("=" * 80)
    print()

    # 1. Get token
    print("── Getting OAuth token from database ──")
    token = get_access_token()
    print(f"Token: {token[:20]}...{token[-10:]}")
    print()

    # 2. Verify token works with known-good endpoint
    print("── Sanity check: known-good endpoints ──")
    test_endpoint("GET", "/developer/v1/user/profile/basic", token, label="Profile (known good)")
    test_endpoint("GET", "/developer/v1/cycle", token, params={"limit": 1}, label="Cycles (known good)")

    # 3. Get a real cycle ID for cycle-scoped tests
    cycle_id = get_a_cycle_id(token)
    print(f"── Using cycle ID: {cycle_id} ──")
    print()

    # 4. Test all sleep endpoint variations
    print("=" * 80)
    print("SLEEP ENDPOINTS")
    print("=" * 80)
    print()

    sleep_paths = [
        # Current (broken) path
        ("/developer/v1/activity/sleep", "v1 /developer/v1/activity/sleep (CURRENT)"),
        # v1 without /developer prefix
        ("/v1/activity/sleep", "v1 /v1/activity/sleep"),
        ("/v1/sleep", "v1 /v1/sleep"),
        # v2 paths (per migration guide)
        ("/developer/v2/activity/sleep", "v2 /developer/v2/activity/sleep"),
        ("/v2/activity/sleep", "v2 /v2/activity/sleep"),
        ("/v2/sleep", "v2 /v2/sleep"),
        # Other variations
        ("/developer/v1/sleep", "v1 /developer/v1/sleep"),
        ("/sleep", "/sleep"),
        ("/activity/sleep", "/activity/sleep"),
        ("/developer/v2/sleep", "v2 /developer/v2/sleep"),
        # Developer API patterns
        ("/developer/v1/activity/sleeps", "v1 /developer/v1/activity/sleeps"),
        ("/developer/v2/activity/sleeps", "v2 /developer/v2/activity/sleeps"),
    ]

    for path, label in sleep_paths:
        test_endpoint("GET", path, token, params={"limit": 1}, label=label)

    # 5. Test all workout endpoint variations
    print("=" * 80)
    print("WORKOUT ENDPOINTS")
    print("=" * 80)
    print()

    workout_paths = [
        # Current (broken) path
        ("/developer/v1/activity/workout", "v1 /developer/v1/activity/workout (CURRENT)"),
        # v1 without /developer prefix
        ("/v1/activity/workout", "v1 /v1/activity/workout"),
        ("/v1/workout", "v1 /v1/workout"),
        # v2 paths (per migration guide)
        ("/developer/v2/activity/workout", "v2 /developer/v2/activity/workout"),
        ("/v2/activity/workout", "v2 /v2/activity/workout"),
        ("/v2/workout", "v2 /v2/workout"),
        # Other variations
        ("/developer/v1/workout", "v1 /developer/v1/workout"),
        ("/workout", "/workout"),
        ("/activity/workout", "/activity/workout"),
        ("/developer/v2/workout", "v2 /developer/v2/workout"),
        # Plural variations
        ("/developer/v1/activity/workouts", "v1 /developer/v1/activity/workouts"),
        ("/developer/v2/activity/workouts", "v2 /developer/v2/activity/workouts"),
    ]

    for path, label in workout_paths:
        test_endpoint("GET", path, token, params={"limit": 1}, label=label)

    # 6. Test cycle-scoped endpoints
    if cycle_id:
        print("=" * 80)
        print(f"CYCLE-SCOPED ENDPOINTS (cycle_id={cycle_id})")
        print("=" * 80)
        print()

        cycle_paths = [
            (f"/developer/v1/cycle/{cycle_id}/recovery", "v1 cycle recovery (known good)"),
            (f"/developer/v1/cycle/{cycle_id}/sleep", "v1 cycle/{id}/sleep"),
            (f"/developer/v2/cycle/{cycle_id}/sleep", "v2 cycle/{id}/sleep"),
            (f"/developer/v1/cycle/{cycle_id}/workout", "v1 cycle/{id}/workout"),
            (f"/developer/v2/cycle/{cycle_id}/workout", "v2 cycle/{id}/workout"),
        ]

        for path, label in cycle_paths:
            test_endpoint("GET", path, token, label=label)

    # 7. Test recovery endpoints
    print("=" * 80)
    print("RECOVERY ENDPOINTS")
    print("=" * 80)
    print()

    recovery_paths = [
        ("/developer/v1/recovery", "v1 /developer/v1/recovery"),
        ("/developer/v2/recovery", "v2 /developer/v2/recovery"),
        ("/v1/recovery", "v1 /v1/recovery"),
        ("/v2/recovery", "v2 /v2/recovery"),
    ]

    for path, label in recovery_paths:
        test_endpoint("GET", path, token, params={"limit": 1}, label=label)

    # 8. Summary
    print("=" * 80)
    print("DONE — Review the ✅ results above for working endpoints")
    print("=" * 80)


if __name__ == "__main__":
    main()
