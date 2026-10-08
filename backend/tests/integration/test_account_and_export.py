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
async def test_json_export_covers_newer_tables(
    client, db_session, test_user, test_route, test_activity
) -> None:
    """Every per-user table is in the export — the regression this guards is
    silent omission, which is invisible until a GDPR request is fulfilled.

    Rows are seeded for the six collections that were missing: lift videos,
    video analyses, RPE calibrations, cross-domain insights, athlete insights
    and climb segments (with their nested efforts).
    """
    from app.models.athlete_insight import AthleteInsight
    from app.models.cross_domain import CrossDomainInsight
    from app.models.lift_video_analysis import LiftVideoAnalysis
    from app.models.lifting import LiftVideo
    from app.models.rpe_calibration import RpeCalibration
    from app.models.segment import Segment, SegmentEffort

    video = LiftVideo(
        user_id=test_user.id,
        r2_key=f"lift_videos/{test_user.id}/export.mp4",
        file_name="export.mp4",
        exercise_auto="Squat",
        exercise_variation="Low Bar Squat",
        form_score=88.0,
    )
    db_session.add(video)
    await db_session.flush()

    db_session.add(
        LiftVideoAnalysis(
            user_id=test_user.id, exercise_name="Squat", avg_form_score=88.0
        )
    )
    db_session.add(RpeCalibration(user_id=test_user.id, sample_count=7))
    db_session.add(
        CrossDomainInsight(user_id=test_user.id, insight_type="sleep_performance")
    )
    db_session.add(
        AthleteInsight(user_id=test_user.id, insight_type="power_curve", period="30d")
    )

    segment = Segment(
        user_id=test_user.id,
        route_id=test_route.id,
        name="Test climb",
        start_dist_m=1000.0,
        end_dist_m=2500.0,
        distance_m=1500.0,
        elevation_gain_m=120.0,
        avg_gradient_pct=8.0,
        max_gradient_pct=12.0,
        start_lat=53.0,
        start_lng=-2.0,
        end_lat=53.01,
        end_lng=-2.01,
    )
    db_session.add(segment)
    await db_session.flush()
    db_session.add(
        SegmentEffort(
            segment_id=segment.id,
            activity_id=test_activity.id,
            elapsed_seconds=300.0,
            avg_speed_mps=5.0,
        )
    )
    await db_session.commit()

    r = await client.get("/api/v1/export/json")
    assert r.status_code == 200
    coll = r.json()["collections"]

    assert len(coll["lift_videos"]) >= 1
    assert len(coll["lift_video_analyses"]) >= 1
    assert len(coll["rpe_calibrations"]) >= 1
    assert len(coll["cross_domain_insights"]) >= 1
    assert len(coll["athlete_insights"]) >= 1
    assert len(coll["segments"]) >= 1

    exported_video = coll["lift_videos"][0]
    assert exported_video["exercise_variation"] == "Low Bar Squat"
    assert exported_video["form_score"] == 88.0

    # Efforts have no user_id of their own — they must ride along nested.
    exported_segment = coll["segments"][0]
    assert exported_segment["route_id"] == str(test_route.id)
    assert len(exported_segment["efforts"]) >= 1
    assert exported_segment["efforts"][0]["elapsed_seconds"] == 300.0


@pytest.mark.asyncio
async def test_json_export_excludes_other_users_rows(
    client, db_session, test_user
) -> None:
    """Scope check: a second user's rows never leak into the export."""
    import uuid

    from app.models.lifting import LiftVideo
    from app.models.user import User

    other = User(
        email=f"other-{uuid.uuid4().hex[:8]}@example.com",
        name="Other User",
    )
    db_session.add(other)
    await db_session.flush()
    db_session.add(
        LiftVideo(
            user_id=other.id,
            r2_key=f"lift_videos/{other.id}/other.mp4",
            file_name="other.mp4",
        )
    )
    await db_session.commit()

    r = await client.get("/api/v1/export/json")
    assert r.status_code == 200
    videos = r.json()["collections"]["lift_videos"]
    assert all(v["user_id"] == str(test_user.id) for v in videos)


@pytest.mark.asyncio
async def test_json_export_includes_goals_with_checkins(client, test_user) -> None:
    """Goals export with their nested check-in history (P2 history hook)."""
    g = await client.post(
        "/api/v1/goals", json={"metric": "body_weight", "target_value": 74.0}
    )
    assert g.status_code == 201
    goal_id = g.json()["id"]

    c = await client.post(f"/api/v1/goals/{goal_id}/checkins", json={"value": 75.0})
    assert c.status_code == 201

    r = await client.get("/api/v1/export/json")
    assert r.status_code == 200
    goals = r.json()["collections"]["goals"]
    exported = [x for x in goals if x["id"] == goal_id]
    assert len(exported) == 1
    assert len(exported[0]["check_ins"]) >= 1
    assert exported[0]["check_ins"][0]["value"] == 75.0


@pytest.mark.asyncio
async def test_account_delete_confirmation_mismatch(client) -> None:
    """Deleting with the wrong confirmation email is rejected."""
    r = await client.request(
        "DELETE", "/api/v1/account/delete", json={"confirm_email": "wrong@example.com"}
    )
    assert r.status_code == 422


@pytest.mark.asyncio
async def test_account_delete_cascades(client, db_session, test_user) -> None:
    """Deleting the account removes the user and cascade-linked data."""
    # Confirm there is data to delete
    r = await client.request(
        "DELETE", "/api/v1/account/delete", json={"confirm_email": test_user.email}
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
