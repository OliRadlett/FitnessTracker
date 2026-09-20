"""QW4 — TSS provenance: power-TSS vs hrTSS must be distinguishable.

Covers:
- ``auto_compute_tss_for_activity`` stamps ``tss_source`` ('power' vs 'hr').
- ``infer_tss_source`` backfill heuristic (conservative: unknown → None).
- Serializers carry the field (ActivityRead, RideMetricsRead, context round-trip).
- ``POST /cycling/recalculate-tss`` threads the branch through (``by_source``).
- Activities CSV export includes the ``tss_source`` column.

Run with:
pytest tests/integration/test_tss_source.py -m integration
"""

from __future__ import annotations

import uuid
from datetime import UTC, date, datetime, timedelta

import pytest

from app.models.activity import Activity, ActivityStream
from app.models.cycling import CyclingProfile
from app.models.daily_metric import DailyMetric
from app.schemas.activity import ActivityRead, RideMetricsRead
from app.services.activity_context import (
    context_to_ride_metrics,
    ride_context_from_analysis,
)
from app.services.cycling.tss import (
    auto_compute_tss_for_activity,
    infer_tss_source,
)

pytestmark = pytest.mark.integration


async def _power_ride(db_session, user_id) -> Activity:
    activity = Activity(
        user_id=user_id,
        source="strava",
        sport_type="cycling",
        name="Power Ride",
        start_date=datetime.now(UTC) - timedelta(days=1),
        duration_seconds=3600,
        average_power=200.0,
        normalized_power=210.0,
        provider_activity_id=f"strava_pwr_{uuid.uuid4().hex[:8]}",
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _hr_only_ride(db_session, user_id) -> Activity:
    activity = Activity(
        user_id=user_id,
        source="strava",
        sport_type="cycling",
        name="HR-only Ride",
        start_date=datetime.now(UTC) - timedelta(days=1),
        duration_seconds=3600,
        average_heartrate=150.0,
        provider_activity_id=f"strava_hr_{uuid.uuid4().hex[:8]}",
    )
    db_session.add(activity)
    await db_session.flush()
    return activity


async def _profile_with_lthr(db_session, user_id, ftp=None) -> CyclingProfile:
    profile = CyclingProfile(user_id=user_id, ftp_watts=ftp, lactate_threshold_hr=170.0)
    db_session.add(profile)
    await db_session.flush()
    return profile


async def _recent_resting_hr(db_session, user_id) -> DailyMetric:
    metric = DailyMetric(
        user_id=user_id,
        metric_date=date.today() - timedelta(days=1),
        source="whoop",
        resting_hr=58.0,
    )
    db_session.add(metric)
    await db_session.flush()
    return metric


# ── auto-compute stamps the branch ──────────────────────────────────────────


class TestAutoComputeSource:
    async def test_power_branch_sets_power_source(self, db_session, test_user):
        activity = await _power_ride(db_session, test_user.id)

        tss = await auto_compute_tss_for_activity(db_session, activity, 250.0)

        assert tss is not None and tss > 0
        assert activity.tss_source == "power"

    async def test_hr_branch_sets_hr_source(self, db_session, test_user):
        await _profile_with_lthr(db_session, test_user.id, ftp=None)
        await _recent_resting_hr(db_session, test_user.id)
        activity = await _hr_only_ride(db_session, test_user.id)

        tss = await auto_compute_tss_for_activity(db_session, activity, None)

        assert tss == pytest.approx(67.5, abs=0.5)
        assert activity.tss_source == "hr"

    async def test_existing_tss_leaves_source_untouched(self, db_session, test_user):
        activity = await _power_ride(db_session, test_user.id)
        activity.tss = 80.0
        activity.tss_source = None

        tss = await auto_compute_tss_for_activity(db_session, activity, 250.0)

        assert tss == 80.0
        assert activity.tss is not None
        assert activity.tss_source is None


# ── backfill heuristic ──────────────────────────────────────────────────────


def _bare_activity(**kwargs) -> Activity:
    base = {
        "user_id": uuid.uuid4(),
        "source": "strava",
        "sport_type": "cycling",
        "name": "Heuristic Ride",
        "start_date": datetime.now(UTC) - timedelta(days=10),
    }
    base.update(kwargs)
    return Activity(**base)


class TestInferTssSource:
    def test_power_data_plus_stream_is_power(self):
        a = _bare_activity(tss=80.0, normalized_power=210.0, average_power=200.0)
        assert infer_tss_source(a, has_power_stream=True) == "power"

    def test_power_data_without_stream_falls_to_hr_when_hr_present(self):
        # Conservative: without stream evidence we cannot prove the power
        # branch ran, so HR evidence wins over an unprovable power claim.
        a = _bare_activity(tss=80.0, average_power=200.0, average_heartrate=150.0)
        assert infer_tss_source(a, has_power_stream=False) == "hr"

    def test_hr_only_is_hr(self):
        a = _bare_activity(tss=67.5, average_heartrate=150.0)
        assert infer_tss_source(a) == "hr"

    def test_power_only_without_stream_is_unknown(self):
        a = _bare_activity(tss=80.0, average_power=200.0)
        assert infer_tss_source(a, has_power_stream=False) is None

    def test_tss_without_any_evidence_is_unknown(self):
        a = _bare_activity(tss=80.0)
        assert infer_tss_source(a) is None

    def test_null_tss_is_unknown(self):
        a = _bare_activity(tss=None, normalized_power=210.0, average_heartrate=150.0)
        assert infer_tss_source(a, has_power_stream=True) is None


# ── serializers carry the field ─────────────────────────────────────────────


class TestSerializers:
    def test_activity_read_carries_tss_source(self):
        # Model-level: ActivityRead exposes tss_source via ActivityBase.
        assert "tss_source" in ActivityRead.model_fields

    def test_ride_metrics_accepts_tss_source(self):
        m = RideMetricsRead(tss=80.0, tss_source="power")
        assert m.tss_source == "power"
        assert RideMetricsRead().tss_source is None

    def test_context_round_trip_preserves_source(self):
        analysis = {
            "power_zones": [],
            "tss_breakdown": {"total_tss": 80.0, "tss_per_hour": 80.0},
        }
        ctx = ride_context_from_analysis(analysis, None, 250, 80.0, tss_source="power")
        out = context_to_ride_metrics(ctx)
        assert out is not None
        assert out["tss_source"] == "power"

    def test_context_override_wins_for_pre_migration_cache(self):
        # Rows cached before migration 062 have no stored source; the live
        # column value must win when the reader passes it.
        analysis = {
            "power_zones": [],
            "tss_breakdown": {"total_tss": 67.5, "tss_per_hour": 67.5},
        }
        ctx = ride_context_from_analysis(analysis, None, None, 67.5)
        assert context_to_ride_metrics(ctx)["tss_source"] is None
        out = context_to_ride_metrics(ctx, tss_source="hr")
        assert out is not None
        assert out["tss_source"] == "hr"


# ── HTTP surface ────────────────────────────────────────────────────────────


class TestRecalculateEndpoint:
    async def test_recalculate_threads_source(
        self, client, db_session, test_user, test_cycling_profile
    ):
        """force=true recomputes from power data and reports the branch split."""
        activity = Activity(
            user_id=test_user.id,
            source="strava",
            sport_type="cycling",
            name="Recalc Ride",
            start_date=datetime.now(UTC) - timedelta(days=1),
            duration_seconds=3600,
            average_power=200.0,
            normalized_power=210.0,
            tss=None,
            tss_source=None,
            provider_activity_id=f"strava_recalc_{uuid.uuid4().hex[:8]}",
        )
        db_session.add(activity)
        await db_session.flush()

        resp = await client.post(
            "/api/v1/cycling/recalculate-tss", params={"force": True}
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["updated"] >= 1
        assert body["by_source"].get("power", 0) >= 1

        await db_session.refresh(activity)
        assert activity.tss is not None
        assert activity.tss_source == "power"


class TestActivityListCarriesSource:
    async def test_list_item_badges_source(self, client, db_session, test_activity):
        test_activity.tss_source = "power"
        await db_session.flush()

        resp = await client.get("/api/v1/activities")
        assert resp.status_code == 200
        items = resp.json()
        match = [a for a in items if a["id"] == str(test_activity.id)]
        assert len(match) == 1
        assert match[0]["tss_source"] == "power"


class TestCsvExportCarriesSource:
    async def test_activities_csv_has_tss_source_column(
        self, client, db_session, test_activity
    ):
        test_activity.tss_source = "hr"
        await db_session.flush()

        resp = await client.get("/api/v1/export/activities/csv")
        assert resp.status_code == 200
        lines = resp.text.splitlines()
        header = lines[0].split(",")
        assert "tss_source" in header
        idx = header.index("tss_source")
        assert any(row.split(",")[idx] == "hr" for row in lines[1:])


class TestTrainingLoadBalanceEstimateLabel:
    async def test_lifting_series_labeled_estimate(
        self, client, test_multiple_activities
    ):
        resp = await client.get("/api/v1/charts/training_load_balance?weeks=16")
        assert resp.status_code == 200
        names = [s["name"] for s in resp.json()["series"]]
        lifting = [n for n in names if "ift" in n]
        assert lifting, names
        assert "estimate" in lifting[0].lower()


class TestMergeMarksProviderSource:
    async def test_merge_tss_sets_provider_source(self, db_session, test_user):
        """A TSS arriving inside a provider payload is labeled 'provider'."""
        from app.services.merge_service import merge_activity

        activity = Activity(
            user_id=test_user.id,
            source="strava",
            sport_type="cycling",
            name="Merge Ride",
            start_date=datetime.now(UTC) - timedelta(days=1),
            duration_seconds=3600,
            tss=None,
            tss_source=None,
            provider_activity_id=f"strava_merge_{uuid.uuid4().hex[:8]}",
        )
        db_session.add(activity)
        await db_session.flush()

        await merge_activity(
            db_session,
            activity,
            {"tss": 95.0},
            "wahoo",
            f"wahoo_{uuid.uuid4().hex[:8]}",
        )
        assert activity.tss == 95.0
        assert activity.tss_source == "provider"


class TestBackfillSqlParity:
    async def test_power_row_with_stream_infers_power(self, db_session, test_user):
        """DB-level parity for the 062 SQL: power + watts stream → 'power'."""
        activity = await _power_ride(db_session, test_user.id)
        activity.tss = 70.0
        stream = ActivityStream(
            activity_id=activity.id,
            stream_type="watts",
            data={"data": [200] * 60},
            resolution=10,
        )
        db_session.add(stream)
        await db_session.flush()

        assert infer_tss_source(activity, has_power_stream=True) == "power"
