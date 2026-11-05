"""Health-event CRUD + alert-overlap validation."""

import pytest

pytestmark = pytest.mark.integration


@pytest.mark.asyncio
async def test_health_event_crud_and_validation(client, test_user):
    created = await client.post(
        "/api/v1/metrics/health-events",
        json={
            "event_type": "illness",
            "start_date": "2026-01-10",
            "end_date": "2026-01-14",
            "severity": "moderate",
            "note": "flu",
        },
    )
    assert created.status_code == 201
    event_id = created.json()["id"]

    listed = await client.get("/api/v1/metrics/health-events")
    assert listed.status_code == 200
    assert [row["id"] for row in listed.json()] == [event_id]

    patched = await client.patch(
        f"/api/v1/metrics/health-events/{event_id}",
        json={"severity": "severe"},
    )
    assert patched.status_code == 200
    assert patched.json()["severity"] == "severe"

    validation = await client.get("/api/v1/metrics/health-events/validation")
    assert validation.status_code == 200
    assert validation.json()["events"] == 1

    deleted = await client.delete(f"/api/v1/metrics/health-events/{event_id}")
    assert deleted.status_code == 204
    assert (await client.get("/api/v1/metrics/health-events")).json() == []


@pytest.mark.asyncio
async def test_health_event_rejects_reversed_dates(client, test_user):
    response = await client.post(
        "/api/v1/metrics/health-events",
        json={
            "event_type": "injury",
            "start_date": "2026-02-10",
            "end_date": "2026-02-01",
            "severity": "mild",
        },
    )
    assert response.status_code == 422
