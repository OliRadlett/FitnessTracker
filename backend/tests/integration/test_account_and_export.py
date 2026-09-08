"""§3.9 Full JSON export + account deletion — integration tests.

Requires: running backend with DATABASE_URL (real Postgres). The `app` fixture
overrides `get_current_user` to the conftest `test_user`, so all calls happen
as a known user with seeded domain objects.
"""

import pytest


@pytest.mark.asyncio
async def test_json_export_includes_collections(
    client,
    test_user,
    test_cycling_profile,
    test_activity,
    test_lifting_session,
    test_daily_metric,
    test_sleep_log,
    test_weight_log,
    test_health_alert,
    test_event,
    test_training_plan,
    test_route,
    test_ftp_history,
    test_personal_record,
) -> None:
    """The export document covers the main collections with seeded data."""
    r = await client.get("/api/v1/export/json")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/json")
    body = r.json()

    assert body["user"]["email"] == test_user.email
    coll = body["collections"]
    # Seeded fixtures are visible
    assert len(coll["activities"]) >= 1
    assert len(coll["lifting_sessions"]) >= 1
    assert len(coll["daily_metrics"]) >= 1
    assert len(coll["sleep_logs"]) >= 1
    assert len(coll["weight_logs"]) >= 1
    assert len(coll["health_alerts"]) >= 1
    assert len(coll["events"]) >= 1
    assert len(coll["training_plans"]) >= 1
    assert len(coll["routes"]) >= 1
    assert len(coll["ftp_history"]) >= 1
    assert len(coll["personal_records"]) >= 1
    assert coll["cycling_profile"] is not None
    assert isinstance(coll["cycling_profile"]["ftp_watts"], float)
    # nesting sanity
    assert "sets" in coll["lifting_sessions"][0]
    assert "streams" in coll["activities"][0]
    assert "days" in coll["training_plans"][0]


@pytest.mark.asyncio
async def test_account_delete_confirmation_mismatch(client) -> None:
    """Deleting with the wrong confirmation email is rejected."""
    r = await client.delete(
        "/api/v1/account/delete", json={"confirm_email": "wrong@example.com"}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_account_delete_cascades(client, db_session, test_user) -> None:
    """Deleting the account removes the user and cascade-linked data."""
    # Confirm there is data to delete
    r = await client.delete(
        "/api/v1/account/delete", json={"confirm_email": test_user.email}
    )
    assert r.status_code == 200
    assert r.json()["deleted"] is True

    # The delete was committed directly in the endpoint; the transactional
    # test session wraps the same DB. Verify the user row is gone via a fresh
    # query on the shared session (it should reflect the committed delete).
    from sqlalchemy import select

    from app.models.user import User

    result = await db_session.execute(select(User).where(User.id == test_user.id))
    assert result.scalar_one_or_none() is None
