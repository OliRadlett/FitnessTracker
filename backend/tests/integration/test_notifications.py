"""Integration tests for in-app notifications (Feature 1).

Covers the ``notify()`` service contract (dedup + preference gating) and the
wire-ins: health-alert creation, PR creation, and the notifications API
(list / mark-read / read-all / preferences round-trip).

Run with:  pytest tests/integration/test_notifications.py -m integration
"""

from __future__ import annotations

from datetime import date

import pytest
from sqlalchemy import select

pytestmark = [pytest.mark.integration, pytest.mark.cheap]


# ── notify() service contract ────────────────────────────────────────────


class TestNotifyService:
    async def test_dedup_same_key_creates_one_row(self, db_session, test_user):
        from app.services.notifications import notify

        await notify(
            db_session,
            test_user.id,
            type="pr",
            title="Squat PR",
            body="200.0 kg × 1 — e1RM 200.0 kg",
            severity="success",
            link="/lifting",
            dedup_key="pr:Back Squat:2026-08-26",
        )
        await notify(
            db_session,
            test_user.id,
            type="pr",
            title="Squat PR",
            body="200.0 kg × 1 — e1RM 200.0 kg",
            severity="success",
            link="/lifting",
            dedup_key="pr:Back Squat:2026-08-26",
        )
        await db_session.flush()

        from app.models.notification import Notification

        result = await db_session.execute(select(Notification))
        assert len(list(result.scalars().all())) == 1

    async def test_disabled_type_is_gated(self, db_session, test_user):
        from app.models.notification import Notification
        from app.services.notifications import notify

        test_user.notification_preferences = {"pr": False}
        await db_session.flush()

        created = await notify(
            db_session,
            test_user.id,
            type="pr",
            title="Squat PR",
            body="200.0 kg × 1",
            dedup_key="pr:gated",
        )
        assert created is None

        # Other types still fire.
        created = await notify(
            db_session,
            test_user.id,
            type="health_alert",
            title="Overtraining Risk",
            body="Load elevated.",
            dedup_key="alert:gated",
        )
        assert created is not None

        result = await db_session.execute(
            select(Notification).where(Notification.user_id == test_user.id)
        )
        rows = list(result.scalars().all())
        assert len(rows) == 1
        assert rows[0].type == "health_alert"

    async def test_nulls_fall_back_to_all_on(self, db_session, test_user):
        """A user with NULL preferences (pre-migration) gets notifications."""
        from app.services.notifications import notify

        assert test_user.notification_preferences is None
        created = await notify(
            db_session,
            test_user.id,
            type="plan_reminder",
            title="Today's plan",
            body="Squat day",
        )
        assert created is not None


# ── Wire-ins ──────────────────────────────────────────────────────────────


class TestHealthAlertWireIn:
    async def test_new_alert_notifies_once(self, db_session, test_user):
        from app.models.notification import Notification
        from app.services.health_analysis import upsert_alert

        analysis = {
            "alert_type": "overtraining",
            "severity": "warning",
            "title": "Overtraining Risk",
            "description": "Training load is elevated — consider a rest day.",
            "evidence": {"TSB": -30, "recovery": 35},
        }

        created = await upsert_alert(db_session, test_user.id, analysis)
        assert created is True
        await db_session.flush()

        result = await db_session.execute(
            select(Notification).where(Notification.user_id == test_user.id)
        )
        rows = list(result.scalars().all())
        assert len(rows) == 1
        assert rows[0].type == "health_alert"
        assert rows[0].link == "/dashboard"

        # Re-upserting the same alert must not duplicate the notification.
        created_again = await upsert_alert(db_session, test_user.id, analysis)
        assert created_again is False
        result = await db_session.execute(
            select(Notification).where(Notification.user_id == test_user.id)
        )
        assert len(list(result.scalars().all())) == 1

    async def test_severity_none_never_notifies(self, db_session, test_user):
        from app.models.notification import Notification
        from app.services.health_analysis import upsert_alert

        analysis = {
            "alert_type": "overtraining",
            "severity": "none",
            "title": "OK",
            "description": "All clear.",
            "evidence": {},
        }
        created = await upsert_alert(db_session, test_user.id, analysis)
        assert created is False
        result = await db_session.execute(
            select(Notification).where(Notification.user_id == test_user.id)
        )
        assert len(list(result.scalars().all())) == 0


class TestPrWireIn:
    async def test_manual_pr_creates_notification(self, db_session, test_user):
        from app.models.notification import Notification
        from app.schemas.lifting import PersonalRecordCreate
        from app.services.lifting import create_manual_pr

        await create_manual_pr(
            db_session,
            test_user.id,
            PersonalRecordCreate(
                exercise_name="Deadlift",
                record_type="1rm",
                weight_kg=220.0,
                reps=1,
                achieved_date=date.today(),
            ),
        )
        await db_session.flush()

        result = await db_session.execute(
            select(Notification).where(Notification.user_id == test_user.id)
        )
        rows = list(result.scalars().all())
        assert len(rows) == 1
        assert rows[0].type == "pr"
        assert "Deadlift" in rows[0].title
        assert rows[0].link == "/lifting"

    async def test_non_improving_manual_pr_does_not_notify(self, db_session, test_user):
        from app.models.notification import Notification
        from app.schemas.lifting import PersonalRecordCreate
        from app.services.lifting import create_manual_pr

        # First PR establishes the record.
        await create_manual_pr(
            db_session,
            test_user.id,
            PersonalRecordCreate(
                exercise_name="Bench Press",
                record_type="1rm",
                weight_kg=100.0,
                reps=1,
                achieved_date=date.today(),
            ),
        )
        # A worse attempt returns the existing PR unchanged — no notification.
        await create_manual_pr(
            db_session,
            test_user.id,
            PersonalRecordCreate(
                exercise_name="Bench Press",
                record_type="1rm",
                weight_kg=80.0,
                reps=1,
                achieved_date=date.today(),
            ),
        )
        await db_session.flush()

        result = await db_session.execute(
            select(Notification).where(Notification.user_id == test_user.id)
        )
        assert len(list(result.scalars().all())) == 1


# ── API ───────────────────────────────────────────────────────────────────


class TestNotificationsApi:
    async def test_preferences_round_trip(self, client):
        resp = await client.get("/api/v1/notifications/preferences")
        assert resp.status_code == 200
        prefs = resp.json()
        assert prefs["pr"] is True

        resp = await client.patch(
            "/api/v1/notifications/preferences", json={"pr": False}
        )
        assert resp.status_code == 200
        assert resp.json()["pr"] is False
        assert resp.json()["health_alert"] is True

        resp = await client.get("/api/v1/notifications/preferences")
        assert resp.json()["pr"] is False

    async def test_list_mark_read_read_all(self, client, db_session, test_user):
        from app.models.notification import Notification
        from app.services.notifications import notify

        for i in range(3):
            await notify(
                db_session,
                test_user.id,
                type="pr",
                title=f"PR {i}",
                body=f"Body {i}",
                severity="success",
                link="/lifting",
                dedup_key=f"pr:test:{i}",
            )
        await db_session.flush()

        resp = await client.get("/api/v1/notifications")
        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 3
        assert all(item["read"] is False for item in items)

        # Mark one read.
        first_id = items[0]["id"]
        resp = await client.patch(f"/api/v1/notifications/{first_id}/read")
        assert resp.status_code == 200
        assert resp.json()["read"] is True

        # Unread filter excludes it.
        resp = await client.get("/api/v1/notifications?unread_only=true")
        assert len(resp.json()) == 2

        # Mark all read.
        resp = await client.post("/api/v1/notifications/read-all")
        assert resp.status_code == 200
        assert resp.json()["marked"] == 2
        resp = await client.get("/api/v1/notifications?unread_only=true")
        assert resp.json() == []