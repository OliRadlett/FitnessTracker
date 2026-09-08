"""§3.14 Race-day prep PDF report — integration tests.

Requires: running backend with DATABASE_URL (real Postgres). The `app` fixture
overrides `get_current_user`/`get_db` to the conftest `test_user` session, so
all calls happen as a known user with seeded domain objects.
"""

import uuid

import pytest


@pytest.mark.asyncio
async def test_event_report_pdf_without_plan(client, test_event) -> None:
    """Without a linked plan the report still renders with the baseline sections."""
    r = await client.get(f"/api/v1/export/event-report/{test_event.id}")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("application/pdf")
    body = r.content
    assert body.startswith(b"%PDF")
    assert len(body) > 1000


@pytest.mark.asyncio
async def test_event_report_linked_plan(
    client, test_training_plan, test_event, db_session
) -> None:
    """Linking a plan adds readiness/conformity/taper sections and still renders."""
    test_training_plan.event_id = test_event.id
    test_training_plan.end_date = test_event.event_date
    await db_session.flush()

    r = await client.get(f"/api/v1/export/event-report/{test_event.id}")
    assert r.status_code == 200
    assert r.content.startswith(b"%PDF")


@pytest.mark.asyncio
async def test_event_report_not_found(client) -> None:
    """Unknown event id → 404."""
    r = await client.get(f"/api/v1/export/event-report/{uuid.uuid4()}")
    assert r.status_code == 404
    assert r.json()["detail"] == "Event not found"
