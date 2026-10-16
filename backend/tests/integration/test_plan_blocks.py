"""C1 — plan blocks: containment, non-overlap, and that a block owns no days.

The two rules that need the plan loaded are both here, because both are the kind
of thing that looks fine on a single field and is wrong on the pair: a block
outside its plan, and a block sharing a day with a sibling.
"""

from __future__ import annotations

import uuid
from datetime import timedelta

import pytest

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


def _payload(plan, start_offset: int, end_offset: int, name: str = "Base") -> dict:
    return {
        "name": name,
        "focus": "base",
        "start_date": (plan.start_date + timedelta(days=start_offset)).isoformat(),
        "end_date": (plan.start_date + timedelta(days=end_offset)).isoformat(),
        "target_tss_per_week": 350.0,
        "notes": None,
    }


class TestPlanBlocks:
    async def test_create_list_edit_delete(self, client, test_training_plan):
        plan = test_training_plan
        base = f"/api/v1/training-plans/{plan.id}/blocks"

        assert (await client.get(base)).json() == []

        resp = await client.post(base, json=_payload(plan, 0, 6))
        assert resp.status_code == 201, resp.text
        block = resp.json()
        assert block["name"] == "Base"

        assert (
            await client.post(base, json=_payload(plan, 7, 13, name="Build"))
        ).status_code == 201

        listed = (await client.get(base)).json()
        assert [b["name"] for b in listed] == ["Base", "Build"]

        # A PATCH changes only what it names.
        resp = await client.patch(f"{base}/{block['id']}", json={"name": "Base 1"})
        assert resp.status_code == 200, resp.text
        assert resp.json()["name"] == "Base 1"
        assert resp.json()["focus"] == "base"

        assert (await client.delete(f"{base}/{block['id']}")).status_code == 204
        assert [b["name"] for b in (await client.get(base)).json()] == ["Build"]

    async def test_overlap_is_409(self, client, test_training_plan):
        plan = test_training_plan
        base = f"/api/v1/training-plans/{plan.id}/blocks"

        assert (
            await client.post(base, json=_payload(plan, 0, 13))
        ).status_code == 201

        # Shares day 13 — the ranges are inclusive, so a shared boundary is an
        # overlap rather than a handoff.
        resp = await client.post(base, json=_payload(plan, 13, 20, name="Build"))
        assert resp.status_code == 409, resp.text
        assert "overlap" in resp.json()["detail"].lower()

    async def test_outside_the_plan_is_400(self, client, test_training_plan):
        plan = test_training_plan
        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/blocks",
            json={
                "name": "Too long",
                "start_date": plan.start_date.isoformat(),
                "end_date": (plan.end_date + timedelta(days=1)).isoformat(),
            },
        )
        assert resp.status_code == 400, resp.text

    async def test_backwards_range_is_400(self, client, test_training_plan):
        plan = test_training_plan
        resp = await client.post(
            f"/api/v1/training-plans/{plan.id}/blocks",
            json=_payload(plan, 10, 5),
        )
        assert resp.status_code == 400, resp.text

    async def test_editing_into_an_overlap_is_409(self, client, test_training_plan):
        """The range an edit would *produce* is validated, not just the field it names."""
        plan = test_training_plan
        base = f"/api/v1/training-plans/{plan.id}/blocks"

        a = (await client.post(base, json=_payload(plan, 0, 6))).json()
        b = (
            await client.post(base, json=_payload(plan, 7, 13, name="Build"))
        ).json()

        resp = await client.patch(
            f"{base}/{b['id']}",
            json={"start_date": (plan.start_date + timedelta(days=6)).isoformat()},
        )
        assert resp.status_code == 409, resp.text

        # An empty PATCH leaves both where they are, so it must still pass.
        assert (await client.patch(f"{base}/{a['id']}", json={})).status_code == 200

    async def test_deleting_a_block_leaves_its_days(self, client, test_training_plan):
        """A block labels a range; it does not own the days inside it."""
        plan = test_training_plan
        base = f"/api/v1/training-plans/{plan.id}/blocks"

        before = len(
            (await client.get(f"/api/v1/training-plans/{plan.id}")).json()["days"]
        )
        block = (await client.post(base, json=_payload(plan, 0, 6))).json()
        assert (await client.delete(f"{base}/{block['id']}")).status_code == 204
        after = len(
            (await client.get(f"/api/v1/training-plans/{plan.id}")).json()["days"]
        )
        assert after == before

    async def test_unknown_plan_is_404(self, client):
        resp = await client.get(f"/api/v1/training-plans/{uuid.uuid4()}/blocks")
        assert resp.status_code == 404, resp.text
