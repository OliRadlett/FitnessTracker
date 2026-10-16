"""C6 — the undo surface for a deleted plan day.

Deleting a day records a `plan_day_delete` claim in the same transaction; the
undo surface lists it and restores the day.
"""

from __future__ import annotations

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


class TestPlanDayUndo:
    async def test_delete_then_undo_restores_the_day(
        self, client, test_training_plan
    ):
        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        day = resp.json()["days"][0]
        day_id, day_date = day["id"], day["day_date"]

        # Delete → a claim is written in the same transaction.
        resp = await client.delete(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{day_id}"
        )
        assert resp.status_code == 204

        claims = (await client.get("/api/v1/undo")).json()
        claim = next((c for c in claims if c["kind"] == "plan_day_delete"), None)
        assert claim is not None, claims

        # Undo → the day is recreated.
        resp = await client.post(f"/api/v1/undo/{claim['id']}")
        assert resp.status_code == 200
        assert resp.json()["undone"] is True

        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        assert day_date in [d["day_date"] for d in resp.json()["days"]]

    async def test_undo_is_single_level(self, client, test_training_plan):
        """A second undo of the same claim is 409, not a second restore."""
        resp = await client.get(f"/api/v1/training-plans/{test_training_plan.id}")
        day_id = resp.json()["days"][0]["id"]
        await client.delete(
            f"/api/v1/training-plans/{test_training_plan.id}/days/{day_id}"
        )
        claims = (await client.get("/api/v1/undo")).json()
        claim = next(c for c in claims if c["kind"] == "plan_day_delete")

        assert (await client.post(f"/api/v1/undo/{claim['id']}")).status_code == 200
        assert (await client.post(f"/api/v1/undo/{claim['id']}")).status_code == 409
