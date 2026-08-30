"""Whoop service — token validation, cycle/recovery sync, sleep sync, workout enrichment.

This service handles:
- Validating Whoop bearer tokens against the profile endpoint
- Syncing Whoop cycle + recovery data into DailyMetric records
- Syncing Whoop sleep data into SleepLog records
- Enriching existing Strava activities with Whoop workout data
- Token expiry detection
"""

import base64
import json
import logging
import time
import uuid
from datetime import UTC, date, datetime, timedelta

import httpx
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.integrations.errors import PermanentAuthError
from app.integrations.whoop_client import whoop_client
from app.models.daily_metric import DailyMetric
from app.models.sleep import SleepLog
from app.models.user import OAuthConnection

logger = logging.getLogger(__name__)

# Pacing between per-cycle recovery API calls. Whoop caps requests at
# 100/min per OAuth client (10k/day) and dev + prod share the same client ID,
# so the per-cycle recovery fetches (the dominant call volume during backfills)
# must be spaced well under the limit: 1.0s ≈ 60/min, leaving headroom for the
# paginated cycle/sleep/workout list calls on top.
_RECOVERY_FETCH_DELAY_SECONDS = 1.0

# ── Date helpers ───────────────────────────────────────────────────────────


def _parse_tz_offset(tz_offset: str | None) -> timedelta:
    """Parse a Whoop timezone_offset string like '+01:00' into a timedelta."""
    if not tz_offset:
        return timedelta(0)
    try:
        sign = 1 if tz_offset[0] == "+" else -1
        parts = tz_offset[1:].split(":")
        return timedelta(hours=sign * int(parts[0]), minutes=sign * int(parts[1]))
    except (ValueError, IndexError):
        return timedelta(0)


def _local_date_from_utc(utc_str: str | None, tz_offset: str | None) -> date | None:
    """Convert a UTC ISO timestamp to a local date using the timezone offset.

    Whoop returns cycle and sleep timestamps in UTC (with 'Z' suffix) and
    includes a ``timezone_offset`` field (e.g. '+01:00'). The recovery date
    shown in the Whoop app corresponds to the **local bedtime** date — i.e.
    the date of ``cycle.start`` when converted to the user's local timezone.
    Using the UTC date or the UTC wake-up date can shift the record by ±1 day
    for cycles whose bedtime crosses a UTC midnight boundary.
    """
    if not utc_str:
        return None
    try:
        utc_dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
        local_dt = utc_dt + _parse_tz_offset(tz_offset)
        return local_dt.date()
    except (ValueError, AttributeError):
        return None


# ── Sport type mapping ──────────────────────────────────────────────────────

_WHOOP_SPORT_MAP: dict[str, str] = {
    "running": "running",
    "cycling": "cycling",
    "swimming": "swimming",
    "weightlifting": "strength",
    "strength_training": "strength",
    "strength_trainer": "strength",
    "powerlifting": "strength",
    "yoga": "other",
    "walking": "walking",
    "hiking": "hiking",
    "rowing": "other",
    "functional_fitness": "strength",
    "crossfit": "strength",
    "basketball": "other",
    "tennis": "other",
    "soccer": "other",
    "football": "other",
    "boxing": "other",
    "hiit": "strength",
}


def _map_whoop_sport_type(sport_name: str | None) -> str:
    """Map Whoop sport name to internal sport type."""
    if not sport_name:
        return "other"
    return _WHOOP_SPORT_MAP.get(sport_name.lower(), "other")


# ── Token helpers ─────────────────────────────────────────────────────────


def decode_token_exp(token: str) -> float | None:
    """Decode the JWT exp claim without verification (for expiry checking only)."""
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return None
        payload_b64 = parts[1]
        # Add padding (only when missing — never over-pad a well-formed segment)
        payload_b64 += "=" * ((4 - len(payload_b64) % 4) % 4)
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        return payload.get("exp")
    except Exception:
        return None


def is_token_expired(token: str, db_expiry: datetime | None = None) -> bool:
    """Check if a Whoop bearer token is expired.

    Checks the JWT exp claim first. Falls back to the database token_expires_at
    if the JWT doesn't have an exp claim. Returns False if neither is available
    (assume valid — the API will return 401 if actually expired).
    """
    exp = decode_token_exp(token)
    if exp is not None:
        return time.time() > exp
    # Fall back to database expiry
    if db_expiry is not None:
        return db_expiry < datetime.now(UTC)
    # No expiry info available — assume valid
    return False


def token_expiry_date(token: str) -> datetime | None:
    """Get the expiry datetime of a Whoop bearer token."""
    exp = decode_token_exp(token)
    if exp is None:
        return None
    return datetime.fromtimestamp(exp, tz=UTC)


# ── Connection helpers ────────────────────────────────────────────────────


async def refresh_if_needed(
    db: AsyncSession, connection: OAuthConnection
) -> OAuthConnection:
    """Refresh the Whoop access token if it's expired (hardened path).

        Row-locked and health-state-aware via
        :func:`app.services.connection_health.refresh_connection`.
    Uses the JWT ``exp`` claim (with DB fallback) for expiry detection.
    """
    from app.integrations.whoop_client import whoop_client
    from app.services.connection_health import refresh_connection

    return await refresh_connection(
        db,
        connection,
        whoop_client,
        is_expired=lambda c: is_token_expired(c.access_token, c.token_expires_at),
    )


async def get_whoop_connection(
    db: AsyncSession, user_id: uuid.UUID
) -> OAuthConnection | None:
    """Get the Whoop OAuth connection for a user."""
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "whoop",
        )
    )
    return result.scalar_one_or_none()


async def validate_and_store_token(
    db: AsyncSession,
    user_id: uuid.UUID,
    token: str,
) -> OAuthConnection:
    """Validate a Whoop bearer token and store/update the connection.

    1. Calls the Whoop profile endpoint to verify the token works
    2. Extracts the Whoop user_id from the profile
    3. Creates or updates the OAuthConnection

    Raises ValueError if the token is invalid or expired.
    """
    # Check expiry locally first
    if is_token_expired(token):
        raise ValueError(
            "Whoop token is expired. Please reconnect via OAuth in Settings."
        )

    # Validate against Whoop API
    try:
        profile = await whoop_client.get_profile(token)
    except Exception as e:
        raise ValueError(f"Whoop token is invalid: {e}")

    whoop_user_id = str(profile.get("user_id", ""))
    if not whoop_user_id:
        raise ValueError("Could not determine Whoop user ID from token")

    expires_at = token_expiry_date(token)

    # Look up existing connection
    result = await db.execute(
        select(OAuthConnection).where(
            OAuthConnection.user_id == user_id,
            OAuthConnection.provider == "whoop",
        )
    )
    connection = result.scalar_one_or_none()

    if connection:
        # Update existing connection
        connection.access_token = token
        connection.token_expires_at = expires_at
        connection.provider_user_id = whoop_user_id
        connection.provider_metadata = profile
    else:
        # Create new connection
        connection = OAuthConnection(
            user_id=user_id,
            provider="whoop",
            access_token=token,
            refresh_token=None,
            token_expires_at=expires_at,
            provider_user_id=whoop_user_id,
            provider_metadata=profile,
        )
        db.add(connection)

    await db.flush()
    logger.info(f"Whoop connection stored for user {user_id}, Whoop ID {whoop_user_id}")
    return connection


# ── Cycle + Recovery sync ──────────────────────────────────────────────────


async def _backfill_missing_recovery(
    db: AsyncSession,
    user_id: uuid.UUID,
    token: str,
    date_min: date | None = None,
    date_max: date | None = None,
) -> int:
    """Retry recovery fetches for DailyMetric records missing recovery_score.

    Shared by sync_whoop_cycles (scheduled) and backfill_whoop_data (on-demand).
    When date_min/date_max are provided, only records within that window are
    retried — preventing the scheduled sync from re-scanning entire history.

    Returns the number of records successfully backfilled.
    """
    import asyncio

    conditions = [
        DailyMetric.user_id == user_id,
        DailyMetric.source == "whoop",
        DailyMetric.recovery_score.is_(None),
        DailyMetric.raw_data.isnot(None),
    ]
    if date_min is not None:
        conditions.append(DailyMetric.metric_date >= date_min)
    if date_max is not None:
        conditions.append(DailyMetric.metric_date <= date_max)

    missing_recovery_result = await db.execute(select(DailyMetric).where(*conditions))
    missing_records = list(missing_recovery_result.scalars().all())
    backfilled = 0
    for dm in missing_records:
        if not dm.raw_data:
            continue
        cycle_id = dm.raw_data.get("id")
        if not cycle_id:
            continue
        try:
            recovery = None
            for _retry in range(3):
                await asyncio.sleep(_RECOVERY_FETCH_DELAY_SECONDS)
                try:
                    recovery = await whoop_client.get_recovery_for_cycle(
                        token, cycle_id
                    )
                    break
                except PermanentAuthError:
                    raise
                except httpx.HTTPStatusError as e:
                    if e.response.status_code in (401, 403):
                        raise
                    if e.response.status_code == 429:
                        logger.warning(
                            f"Rate limited backfilling recovery for cycle {cycle_id}, retry {_retry + 1}/3"
                        )
                        await asyncio.sleep(2.0 * (_retry + 1))
                        continue
                    raise
            else:
                logger.warning(
                    f"Backfill recovery exhausted retries for cycle {cycle_id}"
                )
                continue

            if recovery and recovery.get("score_state") == "SCORED":
                rec_score = recovery.get("score", {})
                rec_recovery = rec_score.get("recovery_score")
                rec_hrv = rec_score.get("hrv_rmssd_milli")
                rec_rhr = rec_score.get("resting_heart_rate")
                rec_rr = rec_score.get("respiratory_rate")
                if rec_recovery is not None:
                    dm.recovery_score = rec_recovery
                if rec_hrv is not None:
                    dm.hrv_ms = rec_hrv
                if rec_rhr is not None:
                    dm.resting_hr = float(rec_rhr)
                if rec_rr is not None:
                    dm.respiratory_rate = rec_rr
                dm.raw_data = {
                    **dm.raw_data,
                    "_recovery": {
                        "recovery_score": rec_recovery,
                        "hrv_rmssd_milli": rec_hrv,
                        "resting_heart_rate": rec_rhr,
                        "respiratory_rate": rec_rr,
                    },
                }
                backfilled += 1
        except PermanentAuthError:
            raise
        except Exception as e:
            logger.warning(f"Backfill recovery failed for cycle {cycle_id}: {e}")
            continue

    return backfilled


async def sync_whoop_cycles(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 500,
    start: str | None = None,
) -> list[DailyMetric]:
    """Sync Whoop cycle + recovery data into DailyMetric records.

    For each cycle with score_state == 'SCORED':
    - Extracts date from cycle.start
    - Maps score.strain → DailyMetric.strain
    - Maps score.kilojoule → DailyMetric.calories (kJ → kcal)
    - Maps score.average_heart_rate → DailyMetric.resting_hr
    - Fetches recovery data per cycle (recovery_score, hrv_ms, resting_hr, respiratory_rate)
    - Stores full cycle in raw_data
    - Upserts based on unique constraint (user_id, metric_date, source='whoop')

    Returns list of upserted DailyMetric records.
    """
    connection = await get_whoop_connection(db, user_id)
    if not connection:
        raise ValueError("No Whoop connection found")

    # Refresh token if needed
    connection = await refresh_if_needed(db, connection)
    token = connection.access_token

    # Fetch cycles from Whoop API
    try:
        cycles = await whoop_client.get_all_cycles(
            token,
            start=start,
            max_records=limit,
        )
    except Exception as e:
        logger.error(f"Failed to fetch Whoop cycles for user {user_id}: {e}")
        raise ValueError(f"Failed to fetch Whoop data: {e}")

    synced: list[DailyMetric] = []

    for cycle in cycles:
        # Only process scored cycles
        if cycle.get("score_state") != "SCORED":
            continue

        score = cycle.get("score")
        if not score:
            continue

        # A Whoop cycle spans a sleep period from bedtime to wake-up.
        # Recovery is dated to the bedtime day in the user's local timezone
        # (matching the Whoop app display), NOT the wake-up day in UTC.
        # Using the UTC end date shifts records by +1 day; using the UTC start
        # date is also wrong for cycles whose bedtime crosses midnight UTC.
        # Apply timezone_offset to the cycle.start timestamp to get the correct
        # local date.
        start_str = cycle.get("start")
        tz_offset = cycle.get("timezone_offset")
        metric_date = _local_date_from_utc(start_str, tz_offset)
        if metric_date is None:
            # Fallback: try end timestamp if start is missing
            metric_date = _local_date_from_utc(cycle.get("end"), tz_offset)
        if metric_date is None:
            continue

        # Map Whoop cycle fields to DailyMetric
        strain = score.get("strain")
        kilojoule = score.get("kilojoule")

        calories = round(kilojoule * 0.239006, 1) if kilojoule else None

        # Fetch recovery data for this cycle with retry
        recovery_score = None
        hrv_ms = None
        # Never fall back to cycle-average HR: a failed recovery fetch must not
        # overwrite a previously-stored real resting HR with average HR.
        resting_hr = None
        resting_hr_from_recovery = False
        respiratory_rate = None

        cycle_id = cycle.get("id")
        if cycle_id:
            import asyncio

            for _retry in range(3):
                try:
                    await asyncio.sleep(
                        _RECOVERY_FETCH_DELAY_SECONDS
                    )  # Rate limit: space recovery fetches
                    recovery = await whoop_client.get_recovery_for_cycle(
                        token, cycle_id
                    )
                    if recovery and recovery.get("score_state") == "SCORED":
                        rec_score = recovery.get("score", {})
                        recovery_score = rec_score.get("recovery_score")
                        hrv_ms = rec_score.get("hrv_rmssd_milli")
                        rr = rec_score.get("resting_heart_rate")
                        if rr is not None:
                            resting_hr = float(rr)
                            resting_hr_from_recovery = True
                        respiratory_rate = rec_score.get("respiratory_rate")
                    break  # Success or no data — move on
                except PermanentAuthError:
                    raise
                except httpx.HTTPStatusError as e:
                    if e.response.status_code in (401, 403):
                        raise PermanentAuthError(
                            "Whoop token is expired. Please reconnect via OAuth in Settings."
                        ) from e
                    if e.response.status_code == 429:
                        logger.warning(
                            f"Rate limited fetching recovery for cycle {cycle_id}, retry {_retry + 1}/3"
                        )
                        await asyncio.sleep(2.0 * (_retry + 1))  # Backoff: 2s, 4s, 6s
                        continue
                    logger.warning(
                        f"Failed to fetch recovery for cycle {cycle_id}: {e}"
                    )
                    break  # Non-rate-limit error — don't retry
                except Exception as e:
                    logger.warning(
                        f"Failed to fetch recovery for cycle {cycle_id}: {e}"
                    )
                    break

        # Merge recovery data into cycle raw_data for reference
        cycle_with_recovery = {**cycle}
        if recovery_score is not None:
            cycle_with_recovery["_recovery"] = {
                "recovery_score": recovery_score,
                "hrv_rmssd_milli": hrv_ms,
                "resting_heart_rate": resting_hr,
                "respiratory_rate": respiratory_rate,
            }

        # Upsert: insert or update on conflict.
        # IMPORTANT: Only overwrite recovery/hrv fields if we have non-null values,
        # to prevent a cycle sync from clobbering recovery data that was already stored
        # from a previous sync where recovery was available. The same protection
        # applies to strain/calories — a sparse payload must not erase earlier data.
        update_fields: dict = {
            "raw_data": cycle_with_recovery,
            "updated_at": datetime.now(UTC),
        }
        if strain:
            update_fields["strain"] = float(strain)
        if calories is not None:
            update_fields["calories"] = calories
        if recovery_score is not None:
            update_fields["recovery_score"] = recovery_score
        if hrv_ms is not None:
            update_fields["hrv_ms"] = hrv_ms
        if resting_hr_from_recovery:
            update_fields["resting_hr"] = resting_hr
        if respiratory_rate is not None:
            update_fields["respiratory_rate"] = respiratory_rate

        stmt = (
            pg_insert(DailyMetric)
            .values(
                user_id=user_id,
                metric_date=metric_date,
                source="whoop",
                recovery_score=recovery_score,
                hrv_ms=hrv_ms,
                resting_hr=resting_hr,
                respiratory_rate=respiratory_rate,
                sleep_duration_minutes=None,  # Populated by sleep sync
                sleep_efficiency=None,  # Populated by sleep sync
                strain=float(strain) if strain else None,
                calories=calories,
                raw_data=cycle_with_recovery,
            )
            .on_conflict_do_update(
                index_elements=["user_id", "metric_date", "source"],
                set_=update_fields,
            )
            .returning(DailyMetric)
        )

        result = await db.execute(stmt)
        metric = result.scalar_one_or_none()
        if metric:
            synced.append(metric)

    # Second pass: fill in missing recovery data for existing DailyMetric records.
    # The range must cover the full incremental window (start → today), not just
    # the dates of cycles fetched *this* run. A cycle whose Whoop `start` (bedtime)
    # falls before the start filter won't be re-fetched, but its DailyMetric
    # (created in an earlier sync when recovery wasn't scored yet) may still be
    # in the window with recovery_score=None. Those stale records must stay in
    # the backfill scope. See BUG-087.
    if start:
        pass_min = datetime.fromisoformat(start.replace("Z", "+00:00")).date()
        pass_max = date.today()
    elif synced:
        synced_dates = sorted({m.metric_date for m in synced})
        pass_min, pass_max = synced_dates[0], synced_dates[-1]
    else:
        pass_min = pass_max = None

    backfilled = await _backfill_missing_recovery(
        db, user_id, token, date_min=pass_min, date_max=pass_max
    )

    # Gap detection: warn if there are days without data inside the synced range.
    # Gaps can indicate missed cycles (device not worn, pagination truncation, etc.)
    if synced:
        synced_dates = sorted({m.metric_date for m in synced})
        min_date, max_date = synced_dates[0], synced_dates[-1]
        all_days = {
            min_date + timedelta(days=i) for i in range((max_date - min_date).days + 1)
        }
        gap_days = sorted(all_days - set(synced_dates))
        if gap_days:
            logger.warning(
                f"Whoop cycle sync gap detection for user {user_id}: "
                f"{len(gap_days)} days without cycle data between {min_date} and {max_date} "
                f"(first few: {[str(d) for d in gap_days[:5]]})"
            )

    await db.flush()
    logger.info(
        f"Whoop cycle+recovery sync complete for user {user_id}: "
        f"{len(synced)} daily metrics synced/updated, {backfilled} missing recoveries backfilled"
    )
    return synced


# ── Sleep sync ─────────────────────────────────────────────────────────────


async def sync_whoop_sleep(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 500,
    start: str | None = None,
) -> list[SleepLog]:
    """Fetch Whoop sleep data and upsert into SleepLog.

    Handles both Whoop v2 (nested stage_summary) and v1 (flat score) formats.

    For each sleep record:
    - sleep_date = record.end date (wake-up date, aligned with recovery cycles)
    - total_sleep_seconds = stage_summary.total_sleep_time_milli / 1000
      (computed from deep+rem+light if missing, or from bounds minus awake)
    - deep_sleep_seconds = stage_summary.total_slow_wave_sleep_time_milli / 1000
    - rem_sleep_seconds = stage_summary.total_rem_sleep_time_milli / 1000
    - light_sleep_seconds = stage_summary.total_light_sleep_time_milli / 1000
    - awake_seconds = stage_summary.total_awake_time_milli / 1000
    - sleep_efficiency = score.sleep_efficiency_percentage
    - sleep_start = record.start
    - sleep_end = record.end
    - raw_data = full record

    Upsert on unique constraint (user_id, sleep_date, source='whoop').
    """
    connection = await get_whoop_connection(db, user_id)
    if not connection:
        raise ValueError("No Whoop connection found")

    # Refresh token if needed
    connection = await refresh_if_needed(db, connection)
    token = connection.access_token

    try:
        sleep_records = await whoop_client.get_all_sleep_activities(
            token,
            start=start,
            max_records=limit,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            logger.warning(
                f"Whoop sleep API not available (404) for user {user_id}. Sleep data requires updated API access."
            )
            return []
        raise ValueError(f"Failed to fetch Whoop sleep data: {e}")
    except Exception as e:
        logger.error(f"Failed to fetch Whoop sleep for user {user_id}: {e}")
        raise ValueError(f"Failed to fetch Whoop sleep data: {e}")

    synced: list[SleepLog] = []

    for record in sleep_records:
        if record.get("score_state") != "SCORED":
            continue

        # Skip naps — we only track overnight sleep. Whoop marks daytime naps
        # with the `nap` boolean; without this guard naps inflate sleep totals.
        if record.get("nap"):
            continue

        score = record.get("score")
        if not score:
            continue

        # Parse start/end times
        start_str = record.get("start")
        end_str = record.get("end")
        if not start_str:
            continue

        try:
            sleep_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            sleep_end = (
                datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                if end_str
                else None
            )
            # Date sleep by the local bedtime date (start + timezone_offset),
            # matching how the Whoop app displays sleep. Using UTC end date
            # can shift the date by +1 for sleeps near midnight UTC.
            tz_offset = record.get("timezone_offset")
            sleep_date = _local_date_from_utc(start_str, tz_offset)
            if sleep_date is None:
                sleep_date = (sleep_end if sleep_end else sleep_start).date()
        except (ValueError, AttributeError):
            continue

        # Map score fields — Whoop v2 nests stage data under score.stage_summary,
        # while v1 / older payloads had flat keys at the score level.
        stage_summary = score.get("stage_summary", {})

        # Prefer v2 nested keys, fall back to v1 flat keys
        total_milli = stage_summary.get("total_sleep_time_milli") or score.get(
            "total_sleep_time_milli"
        )
        deep_milli = (
            stage_summary.get("total_slow_wave_sleep_time_milli")
            or stage_summary.get("slow_wave_sleep_milli")
            or score.get("slow_wave_sleep_milli")
        )
        rem_milli = (
            stage_summary.get("total_rem_sleep_time_milli")
            or stage_summary.get("rem_sleep_milli")
            or score.get("rem_sleep_milli")
        )
        light_milli = (
            stage_summary.get("total_light_sleep_time_milli")
            or stage_summary.get("light_sleep_milli")
            or score.get("light_sleep_milli")
        )
        awake_milli = (
            stage_summary.get("total_awake_time_milli")
            or stage_summary.get("awake_time_milli")
            or score.get("awake_time_milli")
        )
        # v2 uses sleep_efficiency_percentage, v1 used sleep_efficiency
        efficiency = score.get("sleep_efficiency_percentage") or score.get(
            "sleep_efficiency"
        )

        total_sleep_seconds = int(total_milli / 1000) if total_milli else None
        deep_sleep_seconds = int(deep_milli / 1000) if deep_milli else None
        rem_sleep_seconds = int(rem_milli / 1000) if rem_milli else None
        light_sleep_seconds = int(light_milli / 1000) if light_milli else None
        awake_seconds = int(awake_milli / 1000) if awake_milli else None

        # If total_sleep_time_milli is missing (v2 doesn't always include it),
        # compute from individual stage durations
        if total_sleep_seconds is None and any(
            v is not None
            for v in [deep_sleep_seconds, rem_sleep_seconds, light_sleep_seconds]
        ):
            total_sleep_seconds = (
                (deep_sleep_seconds or 0)
                + (rem_sleep_seconds or 0)
                + (light_sleep_seconds or 0)
            )

        # Final fallback: compute from sleep_start / sleep_end bounds minus awake time
        if total_sleep_seconds is None and sleep_start and sleep_end:
            total_in_bed = int((sleep_end - sleep_start).total_seconds())
            awake = awake_seconds or 0
            if total_in_bed > awake:
                total_sleep_seconds = total_in_bed - awake

        # Upsert using unique constraint (user_id, sleep_date, source)
        stmt = (
            pg_insert(SleepLog)
            .values(
                user_id=user_id,
                sleep_date=sleep_date,
                source="whoop",
                total_sleep_seconds=total_sleep_seconds,
                deep_sleep_seconds=deep_sleep_seconds,
                rem_sleep_seconds=rem_sleep_seconds,
                light_sleep_seconds=light_sleep_seconds,
                awake_seconds=awake_seconds,
                sleep_efficiency=efficiency,
                sleep_start=sleep_start,
                sleep_end=sleep_end,
                raw_data=record,
            )
            .on_conflict_do_update(
                index_elements=["user_id", "sleep_date", "source"],
                set_={
                    "total_sleep_seconds": total_sleep_seconds,
                    "deep_sleep_seconds": deep_sleep_seconds,
                    "rem_sleep_seconds": rem_sleep_seconds,
                    "light_sleep_seconds": light_sleep_seconds,
                    "awake_seconds": awake_seconds,
                    "sleep_efficiency": efficiency,
                    "sleep_start": sleep_start,
                    "sleep_end": sleep_end,
                    "raw_data": record,
                    "created_at": datetime.now(UTC),
                },
            )
            .returning(SleepLog)
        )
        result = await db.execute(stmt)
        sleep_log = result.scalar_one_or_none()
        if sleep_log:
            synced.append(sleep_log)

        # Also update DailyMetric with sleep duration and efficiency
        if total_sleep_seconds is not None:
            dm_result = await db.execute(
                select(DailyMetric).where(
                    DailyMetric.user_id == user_id,
                    DailyMetric.metric_date == sleep_date,
                    DailyMetric.source == "whoop",
                )
            )
            dm = dm_result.scalar_one_or_none()
            if dm:
                dm.sleep_duration_minutes = round(total_sleep_seconds / 60, 1)
                dm.sleep_efficiency = efficiency
            else:
                # Create a minimal DailyMetric for the sleep data
                stmt = (
                    pg_insert(DailyMetric)
                    .values(
                        user_id=user_id,
                        metric_date=sleep_date,
                        source="whoop",
                        sleep_duration_minutes=round(total_sleep_seconds / 60, 1),
                        sleep_efficiency=efficiency,
                        raw_data={"sleep_only": True},
                    )
                    .on_conflict_do_update(
                        index_elements=["user_id", "metric_date", "source"],
                        set_={
                            "sleep_duration_minutes": round(
                                total_sleep_seconds / 60, 1
                            ),
                            "sleep_efficiency": efficiency,
                            "updated_at": datetime.now(UTC),
                        },
                    )
                )
                await db.execute(stmt)

    await db.flush()
    logger.info(
        f"Whoop sleep sync complete for user {user_id}: {len(synced)} sleep records"
    )
    return synced


# ── Workout enrichment ─────────────────────────────────────────────────────


async def match_whoop_workout_to_lifting_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    workout_id: str,
    workout_start: datetime,
    workout_end: datetime | None,
    strain: float | None,
    avg_hr: float | None,
    max_hr: float | None,
    kilojoule: float | None,
) -> bool:
    """Attach a strength Whoop workout to a live-tracked LiftingSession.

    Matches on time overlap (>= 50% of the shorter window). Used when no
    Strava activity matched — live sessions have no Strava counterpart, so
    without this rule their strain/HR data would be silently dropped.
    """
    from app.models.lifting import LiftingSession

    if workout_end is None or workout_end <= workout_start:
        return False

    result = await db.execute(
        select(LiftingSession).where(
            LiftingSession.user_id == user_id,
            LiftingSession.started_at.is_not(None),
            LiftingSession.ended_at.is_not(None),
            LiftingSession.whoop_workout_id.is_(None),
            LiftingSession.started_at < workout_end,
            LiftingSession.ended_at > workout_start,
        )
    )
    candidates = result.scalars().all()

    best: LiftingSession | None = None
    best_fraction = 0.0
    workout_duration = (workout_end - workout_start).total_seconds()

    for session in candidates:
        assert session.started_at is not None and session.ended_at is not None
        overlap_start = max(session.started_at, workout_start)
        overlap_end = min(session.ended_at, workout_end)
        overlap = (overlap_end - overlap_start).total_seconds()
        if overlap <= 0:
            continue
        session_duration = (session.ended_at - session.started_at).total_seconds()
        denominator = min(session_duration, workout_duration) or 1.0
        fraction = overlap / denominator
        if fraction >= 0.5 and fraction > best_fraction:
            best = session
            best_fraction = fraction

    if best is None:
        return False

    best.whoop_strain = strain
    best.whoop_avg_hr = int(avg_hr) if avg_hr else None
    best.whoop_max_hr = int(max_hr) if max_hr else None
    best.whoop_kilojoules = kilojoule
    best.whoop_workout_id = workout_id
    await db.flush()
    logger.info(
        f"Attached Whoop workout {workout_id} to lifting session {best.id} "
        f"(overlap {best_fraction:.0%}, strain={strain})"
    )
    return True


async def sync_whoop_workouts(
    db: AsyncSession,
    user_id: uuid.UUID,
    limit: int = 500,
    start: str | None = None,
) -> list:
    """Enrich existing Strava activities with Whoop workout data.

    Strava is the source of truth. Whoop workouts are matched to existing
    Strava activities using the merge_service.find_duplicate_activity() algorithm.

    If a match is found (score >= threshold), the Strava activity is enriched with:
    - Whoop strain score (stored in raw_data)
    - Whoop HR data (fills gaps if Strava doesn't have it)
    - Whoop calories (fills gaps)
    - ActivitySource record created for provenance

    If no match found, the Whoop workout is SKIPPED (not created standalone).

    Returns the list of enriched activities.
    """
    from app.models.activity import ActivitySource
    from app.services.merge_service import find_duplicate_activity, merge_activity

    connection = await get_whoop_connection(db, user_id)
    if not connection:
        raise ValueError("No Whoop connection found")

    # Refresh token if needed
    connection = await refresh_if_needed(db, connection)
    token = connection.access_token

    try:
        workouts = await whoop_client.get_all_workout_activities(
            token,
            start=start,
            max_records=limit,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            logger.warning(
                f"Whoop workout API not available (404) for user {user_id}. Workout data requires updated API access."
            )
            return []
        raise ValueError(f"Failed to fetch Whoop workout data: {e}")
    except Exception as e:
        logger.error(f"Failed to fetch Whoop workouts for user {user_id}: {e}")
        raise ValueError(f"Failed to fetch Whoop workout data: {e}")

    enriched: list = []

    for workout in workouts:
        workout_id = str(workout.get("id", ""))
        if not workout_id:
            continue

        # Check if already synced via ActivitySource
        existing_source = await db.execute(
            select(ActivitySource).where(
                ActivitySource.provider == "whoop",
                ActivitySource.provider_activity_id == workout_id,
            )
        )
        if existing_source.scalar_one_or_none():
            continue

        # Parse workout data
        sport_name = workout.get("sport_name")
        sport_type = _map_whoop_sport_type(sport_name)

        # Parse start date
        start_str = workout.get("start")
        if not start_str:
            logger.warning(f"Skipping Whoop workout {workout_id}: no start date")
            continue

        try:
            start_date = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue

        # Duration in seconds
        end_str = workout.get("end")
        end_date: datetime | None = None
        duration_seconds = None
        if start_str and end_str:
            try:
                end_date = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                duration_seconds = int((end_date - start_date).total_seconds())
            except (ValueError, AttributeError):
                pass

        # Extract score data
        score = workout.get("score", {})
        strain = score.get("strain")
        avg_hr = score.get("average_heart_rate")
        max_hr = score.get("max_heart_rate")
        kilojoule = score.get("kilojoule")
        calories = round(kilojoule * 0.239006, 1) if kilojoule else None

        # Use merge engine to find matching Strava activity
        duplicate = await find_duplicate_activity(
            db,
            user_id,
            sport_type,
            start_date,
            duration_seconds,
            None,  # Whoop doesn't provide distance
        )

        if duplicate:
            # Build enrichment data — Whoop has no GPS/power/distance
            new_data = {
                "average_heartrate": float(avg_hr) if avg_hr else None,
                "max_heartrate": float(max_hr) if max_hr else None,
                "calories": float(calories) if calories else None,
            }

            # Merge into the existing Strava activity
            await merge_activity(
                db,
                duplicate,
                new_data,
                "whoop",
                workout_id,
                raw_data=workout,
            )
            enriched.append(duplicate)
            logger.info(
                f"Enriched activity '{duplicate.name}' with Whoop workout {workout_id} "
                f"(strain={strain})"
            )
        else:
            # No matching Strava activity — skip standalone creation, but if
            # this is a strength workout try to attach it to a live-tracked
            # LiftingSession (time-overlap match).
            attached = False
            if sport_type == "strength":
                attached = await match_whoop_workout_to_lifting_session(
                    db,
                    user_id,
                    workout_id,
                    start_date,
                    end_date,
                    strain,
                    avg_hr,
                    max_hr,
                    kilojoule,
                )
            if not attached:
                logger.debug(
                    f"Skipping Whoop workout {workout_id} ({sport_name}): no matching Strava activity"
                )

    await db.flush()
    logger.info(
        f"Whoop workout enrichment complete for user {user_id}: {len(enriched)} enriched"
    )
    return enriched


# ── Intelligence helpers (Phase 5.2) ────────────────────────────────────────


def compute_readiness(recovery_score: float | None) -> dict:
    """Compute training readiness from a Whoop recovery score.

    Returns {"level": "green"|"yellow"|"red"|"unknown", "message": str}.
    """
    if recovery_score is None:
        return {"level": "unknown", "message": "No recovery data available."}

    if recovery_score >= 67:
        return {"level": "green", "message": "Ready to train hard"}
    elif recovery_score >= 34:
        return {"level": "yellow", "message": "Moderate — listen to your body"}
    else:
        return {"level": "red", "message": "Rest day recommended"}


def compute_sleep_consistency(
    sleep_logs: list[SleepLog],
    window_days: int = 7,
) -> dict:
    """Compute sleep consistency score (0-100) based on bedtime regularity.

    Low std dev of sleep_start times = high consistency.
    0 = very irregular, 100 = perfectly consistent.

    Returns {"score": float, "avg_bedtime": str, "std_minutes": float, "days_analyzed": int}.
    """
    if not sleep_logs:
        return {"score": 0, "avg_bedtime": None, "std_minutes": 0, "days_analyzed": 0}

    # Extract bedtime as minutes from midnight
    bedtimes_minutes: list[float] = []
    for log in sleep_logs:
        if log.sleep_start:
            t = log.sleep_start
            minutes = t.hour * 60 + t.minute
            # If bedtime is before noon, it's past midnight — add 24h worth
            # e.g. 01:30 = 90 min, but we want it relative to evening: 90 + 1440 = 1530
            if minutes < 720:  # before noon = past midnight
                minutes += 1440
            bedtimes_minutes.append(minutes)

    if len(bedtimes_minutes) < 2:
        return {
            "score": 100.0,
            "avg_bedtime": _minutes_to_time_str(bedtimes_minutes[0] % 1440)
            if bedtimes_minutes
            else None,
            "std_minutes": 0,
            "days_analyzed": len(bedtimes_minutes),
        }

    avg = sum(bedtimes_minutes) / len(bedtimes_minutes)
    variance = sum((m - avg) ** 2 for m in bedtimes_minutes) / len(bedtimes_minutes)
    std_minutes = variance**0.5

    # Score: 0 std = 100, 120+ min std = 0
    score = max(0, 100 - (std_minutes / 120) * 100)

    # Normalize avg bedtime back to 24h clock
    avg_display = avg % 1440

    return {
        "score": round(score, 1),
        "avg_bedtime": _minutes_to_time_str(avg_display),
        "std_minutes": round(std_minutes, 1),
        "days_analyzed": len(bedtimes_minutes),
    }


def _minutes_to_time_str(minutes: float) -> str:
    """Convert minutes from midnight to HH:MM string."""
    h = int(minutes) // 60
    m = int(minutes) % 60
    return f"{h:02d}:{m:02d}"


def compute_sleep_debt(
    sleep_logs: list[SleepLog],
    needed_hours: float = 8.0,
    window_days: int = 7,
) -> dict:
    """Calculate cumulative sleep debt over a rolling window.

    Returns {"debt_hours": float, "avg_sleep_hours": float, "days_below_target": int}.
    """
    if not sleep_logs:
        return {"debt_hours": 0, "avg_sleep_hours": 0, "days_below_target": 0}

    total_sleep_hours = 0.0
    days_below = 0
    count = 0

    for log in sleep_logs:
        effective = log.effective_total_sleep_seconds
        if effective:
            hours = effective / 3600
            total_sleep_hours += hours
            count += 1
            if hours < needed_hours:
                days_below += 1

    if count == 0:
        return {"debt_hours": 0, "avg_sleep_hours": 0, "days_below_target": 0}

    avg_sleep = total_sleep_hours / count
    target_total = needed_hours * count
    debt = target_total - total_sleep_hours

    return {
        "debt_hours": round(max(0, debt), 1),
        "avg_sleep_hours": round(avg_sleep, 1),
        "days_below_target": days_below,
    }


def suggest_optimal_bedtime(
    sleep_logs: list[SleepLog],
    recovery_metrics: dict,
) -> dict:
    """Suggest optimal bedtime based on recovery-correlated sleep patterns.

    Analyzes the user's best recovery days (top 25%) and finds the common
    bedtime window.

    Returns {"suggested_bedtime": str, "confidence": str, "message": str, "best_recovery_bedtimes": list}.
    """
    if not sleep_logs:
        return {
            "suggested_bedtime": None,
            "confidence": "low",
            "message": "Not enough sleep data to make a suggestion.",
            "best_recovery_bedtimes": [],
        }

    # Match sleep logs with recovery scores
    scored_logs: list[tuple[SleepLog, float]] = []
    for log in sleep_logs:
        if log.sleep_start and log.sleep_date in recovery_metrics:
            metric = recovery_metrics[log.sleep_date]
            if metric.recovery_score is not None:
                scored_logs.append((log, metric.recovery_score))

    if len(scored_logs) < 4:
        return {
            "suggested_bedtime": None,
            "confidence": "low",
            "message": "Not enough correlated sleep/recovery data.",
            "best_recovery_bedtimes": [],
        }

    # Sort by recovery score descending, take top 25%
    scored_logs.sort(key=lambda x: x[1], reverse=True)
    top_count = max(1, len(scored_logs) // 4)
    top_logs = scored_logs[:top_count]

    # Extract bedtimes from top recovery days
    bedtimes_minutes: list[float] = []
    for log, _ in top_logs:
        t = log.sleep_start
        minutes = t.hour * 60 + t.minute
        if minutes < 720:
            minutes += 1440
        bedtimes_minutes.append(minutes)

    avg_bedtime = sum(bedtimes_minutes) / len(bedtimes_minutes)
    avg_display = avg_bedtime % 1440

    # Compute window (±15 min)
    window_start = _minutes_to_time_str((avg_display - 15) % 1440)
    window_end = _minutes_to_time_str((avg_display + 15) % 1440)

    confidence = "high" if top_count >= 5 else "medium" if top_count >= 3 else "low"

    return {
        "suggested_bedtime": _minutes_to_time_str(avg_display),
        "confidence": confidence,
        "message": (
            f"Your best recovery happens when you sleep between "
            f"{window_start} and {window_end}."
        ),
        "best_recovery_bedtimes": [
            {
                "date": log.sleep_date.isoformat(),
                "bedtime": _minutes_to_time_str(
                    (
                        log.sleep_start.hour * 60
                        + log.sleep_start.minute
                        + (1440 if log.sleep_start.hour < 12 else 0)
                    )
                    % 1440
                ),
                "recovery_score": score,
            }
            for log, score in top_logs
        ],
    }


async def sync_whoop_weight(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> "WeightLog | None":
    """Fetch and store weight from Whoop body measurements.

    Returns the WeightLog record, or None if no weight data available.
    """
    from sqlalchemy.dialects.postgresql import insert as pg_insert

    from app.models.weight import WeightLog

    connection = await get_whoop_connection(db, user_id)
    if not connection:
        return None

    # Refresh token if needed
    connection = await refresh_if_needed(db, connection)

    try:
        body = await whoop_client.get_body_measurements(connection.access_token)
    except Exception as e:
        logger.warning(
            f"Failed to fetch Whoop body measurements for user {user_id}: {e}"
        )
        return None

    weight_kg = body.get("weight_kilogram")
    if not weight_kg:
        return None

    today = date.today()

    stmt = (
        pg_insert(WeightLog)
        .values(
            user_id=user_id,
            date=today,
            weight_kilogram=float(weight_kg),
            source="whoop",
        )
        .on_conflict_do_update(
            index_elements=["user_id", "date", "source"],
            set_={
                "weight_kilogram": float(weight_kg),
            },
        )
        .returning(WeightLog)
    )

    result = await db.execute(stmt)
    weight_log = result.scalar_one_or_none()
    await db.flush()

    if weight_log:
        logger.info(f"Whoop weight synced for user {user_id}: {weight_kg}kg")
    return weight_log


# ── Backfill (historical data) ───────────────────────────────────────────────


async def backfill_whoop_data(
    db: AsyncSession,
    user_id: uuid.UUID,
    months: int = 12,
    *,
    start_dt: datetime | None = None,
    end_dt: datetime | None = None,
) -> dict:
    """Backfill all historical Whoop data for the given time range.

    Fetches cycles (+ recovery), sleep, and workout data from (now - months) to now.
    Uses the Whoop API's start/end date filters and automatic pagination to
    retrieve all records, not just the most recent page.

    Args:
        months: Number of months to look back (ignored if start_dt/end_dt given).
        start_dt: Explicit start of the window (inclusive). Overrides ``months``.
        end_dt: Explicit end of the window (exclusive). Defaults to now.

    Returns a summary dict with counts for each data type.
    """
    connection = await get_whoop_connection(db, user_id)
    if not connection:
        raise ValueError("No Whoop connection found")

    # Refresh token if needed
    connection = await refresh_if_needed(db, connection)
    token = connection.access_token

    # Calculate date range
    if start_dt is not None:
        start_date = start_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    else:
        start_date = (datetime.now(UTC) - timedelta(days=months * 30)).strftime(
            "%Y-%m-%dT%H:%M:%S.000Z"
        )
    end_date: str | None = None
    if end_dt is not None:
        end_date = end_dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")

    synced_cycles = 0
    synced_sleep = 0
    synced_workouts = 0

    # ── 1. Backfill cycles + recovery ─────────────────────────────────────

    try:
        cycles = await whoop_client.get_all_cycles(
            token,
            start=start_date,
            end=end_date,
            max_records=10000,
        )
    except Exception as e:
        logger.error(f"Failed to backfill Whoop cycles for user {user_id}: {e}")
        raise ValueError(f"Failed to fetch Whoop cycle data: {e}")

    for cycle in cycles:
        if cycle.get("score_state") != "SCORED":
            continue

        score = cycle.get("score")
        if not score:
            continue

        # A Whoop cycle spans sleep→wake; recovery is dated to the bedtime
        # day in the user's local timezone (cycle.start + timezone_offset).
        start_str = cycle.get("start")
        tz_offset = cycle.get("timezone_offset")
        metric_date = _local_date_from_utc(start_str, tz_offset)
        if metric_date is None:
            metric_date = _local_date_from_utc(cycle.get("end"), tz_offset)
        if metric_date is None:
            continue

        strain = score.get("strain")
        kilojoule = score.get("kilojoule")
        avg_hr = score.get("average_heart_rate")
        max_hr = score.get("max_heart_rate")
        calories = round(kilojoule * 0.239006, 1) if kilojoule else None

        # Fetch recovery for this cycle
        recovery_score = None
        hrv_ms = None
        # Never fall back to cycle-average HR (see sync_whoop_cycles).
        resting_hr = None
        resting_hr_from_recovery = False
        respiratory_rate = None

        cycle_id = cycle.get("id")
        if cycle_id:
            try:
                import asyncio

                recovery = None
                for _retry in range(3):
                    await asyncio.sleep(
                        _RECOVERY_FETCH_DELAY_SECONDS
                    )  # Rate limit: space recovery fetches
                    try:
                        recovery = await whoop_client.get_recovery_for_cycle(
                            token, cycle_id
                        )
                        break  # Success or no data — move on
                    except PermanentAuthError:
                        raise
                    except httpx.HTTPStatusError as e:
                        if e.response.status_code in (401, 403):
                            raise
                        if e.response.status_code == 429:
                            logger.warning(
                                f"Rate limited backfilling recovery for cycle {cycle_id}, retry {_retry + 1}/3"
                            )
                            await asyncio.sleep(2.0 * (_retry + 1))
                            continue
                        raise
                else:
                    logger.warning(
                        f"Backfill recovery exhausted retries for cycle {cycle_id}"
                    )
                if recovery and recovery.get("score_state") == "SCORED":
                    rec_score = recovery.get("score", {})
                    recovery_score = rec_score.get("recovery_score")
                    hrv_ms = rec_score.get("hrv_rmssd_milli")
                    rr = rec_score.get("resting_heart_rate")
                    if rr is not None:
                        resting_hr = float(rr)
                        resting_hr_from_recovery = True
                    respiratory_rate = rec_score.get("respiratory_rate")
            except PermanentAuthError:
                raise
            except Exception as e:
                logger.warning(f"Failed to fetch recovery for cycle {cycle_id}: {e}")

        cycle_with_recovery = {**cycle}
        if recovery_score is not None:
            cycle_with_recovery["_recovery"] = {
                "recovery_score": recovery_score,
                "hrv_rmssd_milli": hrv_ms,
                "resting_heart_rate": resting_hr,
                "respiratory_rate": respiratory_rate,
            }

        # Build conditional update fields — only overwrite recovery fields
        # if we have non-null values, to prevent clobbering existing data
        # when the recovery fetch fails. strain/calories are protected the
        # same way (a sparse payload must not erase earlier values).
        update_fields: dict = {
            "raw_data": cycle_with_recovery,
            "updated_at": datetime.now(UTC),
        }
        if strain:
            update_fields["strain"] = float(strain)
        if calories is not None:
            update_fields["calories"] = calories
        if recovery_score is not None:
            update_fields["recovery_score"] = recovery_score
        if hrv_ms is not None:
            update_fields["hrv_ms"] = hrv_ms
        if resting_hr_from_recovery:
            update_fields["resting_hr"] = resting_hr
        if respiratory_rate is not None:
            update_fields["respiratory_rate"] = respiratory_rate

        stmt = (
            pg_insert(DailyMetric)
            .values(
                user_id=user_id,
                metric_date=metric_date,
                source="whoop",
                recovery_score=recovery_score,
                hrv_ms=hrv_ms,
                resting_hr=resting_hr,
                respiratory_rate=respiratory_rate,
                sleep_duration_minutes=None,
                sleep_efficiency=None,
                strain=float(strain) if strain else None,
                calories=calories,
                raw_data=cycle_with_recovery,
            )
            .on_conflict_do_update(
                index_elements=["user_id", "metric_date", "source"],
                set_=update_fields,
            )
            .returning(DailyMetric)
        )

        result = await db.execute(stmt)
        if result.scalar_one_or_none():
            synced_cycles += 1

    await db.flush()
    logger.info(
        f"Whoop backfill: {synced_cycles} cycles synced for user {user_id} "
        f"(window {start_date} → {end_date or 'now'})"
    )

    # Second pass: retry recovery fetches for records synced without complete
    # recovery data (rate limits, transient errors). Scoped to the backfill window.
    backfilled = await _backfill_missing_recovery(
        db,
        user_id,
        token,
        date_min=start_date.date() if start_date else None,
        date_max=end_date.date() if end_date else None,
    )

    await db.flush()
    if backfilled:
        logger.info(
            f"Whoop backfill: {backfilled} missing recoveries backfilled for user {user_id}"
        )

    # ── 2. Backfill sleep ─────────────────────────────────────────────────

    try:
        sleep_records = await whoop_client.get_all_sleep_activities(
            token,
            start=start_date,
            end=end_date,
            max_records=10000,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            logger.warning(
                f"Whoop sleep API not available (404) for user {user_id} backfill"
            )
            sleep_records = []
        else:
            raise ValueError(f"Failed to fetch Whoop sleep data: {e}")
    except Exception as e:
        logger.error(f"Failed to backfill Whoop sleep for user {user_id}: {e}")
        raise ValueError(f"Failed to fetch Whoop sleep data: {e}")

    for record in sleep_records:
        if record.get("score_state") != "SCORED":
            continue

        score = record.get("score")
        if not score:
            continue

        start_str = record.get("start")
        end_str = record.get("end")
        if not start_str:
            continue

        try:
            sleep_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
            sleep_end = (
                datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                if end_str
                else None
            )
            # Date sleep by the local bedtime date (start + timezone_offset),
            # matching how the Whoop app displays sleep.
            tz_offset = record.get("timezone_offset")
            sleep_date = _local_date_from_utc(start_str, tz_offset)
            if sleep_date is None:
                sleep_date = (sleep_end if sleep_end else sleep_start).date()
        except (ValueError, AttributeError):
            continue

        # Map score fields — handle both v2 (nested stage_summary) and v1 (flat)
        stage_summary = score.get("stage_summary", {})

        total_milli = stage_summary.get("total_sleep_time_milli") or score.get(
            "total_sleep_time_milli"
        )
        deep_milli = (
            stage_summary.get("total_slow_wave_sleep_time_milli")
            or stage_summary.get("slow_wave_sleep_milli")
            or score.get("slow_wave_sleep_milli")
        )
        rem_milli = (
            stage_summary.get("total_rem_sleep_time_milli")
            or stage_summary.get("rem_sleep_milli")
            or score.get("rem_sleep_milli")
        )
        light_milli = (
            stage_summary.get("total_light_sleep_time_milli")
            or stage_summary.get("light_sleep_milli")
            or score.get("light_sleep_milli")
        )
        awake_milli = (
            stage_summary.get("total_awake_time_milli")
            or stage_summary.get("awake_time_milli")
            or score.get("awake_time_milli")
        )
        efficiency = score.get("sleep_efficiency_percentage") or score.get(
            "sleep_efficiency"
        )

        total_sleep_seconds = int(total_milli / 1000) if total_milli else None
        deep_sleep_seconds = int(deep_milli / 1000) if deep_milli else None
        rem_sleep_seconds = int(rem_milli / 1000) if rem_milli else None
        light_sleep_seconds = int(light_milli / 1000) if light_milli else None
        awake_seconds = int(awake_milli / 1000) if awake_milli else None

        # Compute total from stages if missing
        if total_sleep_seconds is None and any(
            v is not None
            for v in [deep_sleep_seconds, rem_sleep_seconds, light_sleep_seconds]
        ):
            total_sleep_seconds = (
                (deep_sleep_seconds or 0)
                + (rem_sleep_seconds or 0)
                + (light_sleep_seconds or 0)
            )

        # Fallback: compute from sleep bounds minus awake
        if total_sleep_seconds is None and sleep_start and sleep_end:
            total_in_bed = int((sleep_end - sleep_start).total_seconds())
            awake = awake_seconds or 0
            if total_in_bed > awake:
                total_sleep_seconds = total_in_bed - awake

        # BUG-035: Use upsert instead of select+update/insert to avoid race conditions
        await db.execute(
            pg_insert(SleepLog)
            .values(
                user_id=user_id,
                sleep_date=sleep_date,
                source="whoop",
                total_sleep_seconds=total_sleep_seconds,
                deep_sleep_seconds=deep_sleep_seconds,
                rem_sleep_seconds=rem_sleep_seconds,
                light_sleep_seconds=light_sleep_seconds,
                awake_seconds=awake_seconds,
                sleep_efficiency=efficiency,
                sleep_start=sleep_start,
                sleep_end=sleep_end,
                raw_data=record,
            )
            .on_conflict_do_update(
                index_elements=["user_id", "sleep_date", "source"],
                set_={
                    "total_sleep_seconds": total_sleep_seconds,
                    "deep_sleep_seconds": deep_sleep_seconds,
                    "rem_sleep_seconds": rem_sleep_seconds,
                    "light_sleep_seconds": light_sleep_seconds,
                    "awake_seconds": awake_seconds,
                    "sleep_efficiency": efficiency,
                    "sleep_start": sleep_start,
                    "sleep_end": sleep_end,
                    "raw_data": record,
                },
            )
        )

        synced_sleep += 1

        # Also update DailyMetric with sleep duration and efficiency
        if total_sleep_seconds is not None:
            stmt = (
                pg_insert(DailyMetric)
                .values(
                    user_id=user_id,
                    metric_date=sleep_date,
                    source="whoop",
                    sleep_duration_minutes=round(total_sleep_seconds / 60, 1),
                    sleep_efficiency=efficiency,
                    raw_data={"sleep_only": True},
                )
                .on_conflict_do_update(
                    index_elements=["user_id", "metric_date", "source"],
                    set_={
                        "sleep_duration_minutes": round(total_sleep_seconds / 60, 1),
                        "sleep_efficiency": efficiency,
                        "updated_at": datetime.now(UTC),
                    },
                )
            )
            await db.execute(stmt)

    await db.flush()
    logger.info(
        f"Whoop backfill: {synced_sleep} sleep records synced for user {user_id}"
    )

    # ── 3. Backfill workouts (enrichment only) ────────────────────────────

    try:
        workouts = await whoop_client.get_all_workout_activities(
            token,
            start=start_date,
            end=end_date,
            max_records=10000,
        )
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            logger.warning(
                f"Whoop workout API not available (404) for user {user_id} backfill"
            )
            workouts = []
        else:
            raise ValueError(f"Failed to fetch Whoop workout data: {e}")
    except Exception as e:
        logger.error(f"Failed to backfill Whoop workouts for user {user_id}: {e}")
        raise ValueError(f"Failed to fetch Whoop workout data: {e}")

    from app.models.activity import ActivitySource
    from app.services.merge_service import find_duplicate_activity, merge_activity

    for workout in workouts:
        workout_id = str(workout.get("id", ""))
        if not workout_id:
            continue

        # Skip if already synced
        existing_source = await db.execute(
            select(ActivitySource).where(
                ActivitySource.provider == "whoop",
                ActivitySource.provider_activity_id == workout_id,
            )
        )
        if existing_source.scalar_one_or_none():
            continue

        sport_name = workout.get("sport_name")
        sport_type = _map_whoop_sport_type(sport_name)

        start_str = workout.get("start")
        if not start_str:
            continue

        try:
            start_date_dt = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
        except (ValueError, AttributeError):
            continue

        end_str = workout.get("end")
        workout_end_dt: datetime | None = None
        duration_seconds = None
        if start_str and end_str:
            try:
                end_date = datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                workout_end_dt = end_date
                duration_seconds = int((end_date - start_date_dt).total_seconds())
            except (ValueError, AttributeError):
                pass

        score = workout.get("score", {})
        strain = score.get("strain")
        avg_hr = score.get("average_heart_rate")
        max_hr = score.get("max_heart_rate")
        kilojoule = score.get("kilojoule")
        calories_w = round(kilojoule * 0.239006, 1) if kilojoule else None

        duplicate = await find_duplicate_activity(
            db,
            user_id,
            sport_type,
            start_date_dt,
            duration_seconds,
            None,
        )

        if duplicate:
            new_data = {
                "average_heartrate": float(avg_hr) if avg_hr else None,
                "max_heartrate": float(max_hr) if max_hr else None,
                "calories": float(calories_w) if calories_w else None,
            }
            await merge_activity(
                db,
                duplicate,
                new_data,
                "whoop",
                workout_id,
                raw_data=workout,
            )
            synced_workouts += 1
        elif sport_type == "strength":
            attached = await match_whoop_workout_to_lifting_session(
                db,
                user_id,
                workout_id,
                start_date_dt,
                workout_end_dt,
                strain,
                avg_hr,
                max_hr,
                kilojoule,
            )
            if attached:
                synced_workouts += 1

    await db.flush()
    logger.info(
        f"Whoop backfill complete for user {user_id}: "
        f"{synced_cycles} cycles, {synced_sleep} sleep, {synced_workouts} workouts "
        f"(window {start_date} → {end_date or 'now'})"
    )

    return {
        "synced_cycles": synced_cycles,
        "synced_sleep": synced_sleep,
        "synced_workouts": synced_workouts,
        "months": months,
        "detail": (
            f"Backfilled {synced_cycles} daily metrics, "
            f"{synced_sleep} sleep records, and "
            f"{synced_workouts} enriched workouts from Whoop "
            f"(last {months} months)"
        ),
    }


# ── Chunked backfill ──────────────────────────────────────────────────────

_CHUNK_MONTHS = 3  # Each chunk covers 3 months


async def _cleanup_whoop_sleep_data(
    db: AsyncSession, user_id: uuid.UUID, start_dt: datetime, end_dt: datetime
) -> int:
    """Delete existing Whoop sleep logs and sleep-only DailyMetrics in the date range.

    Called before backfill to ensure fresh data with corrected sleep_date
    (wake-up date) rather than the old date (fall-asleep date). Only Whoop
    source data is affected — Strava/Wahoo data remains untouched.
    """
    from app.models.daily_metric import DailyMetric

    start_date = start_dt.date()
    end_date = end_dt.date()

    # Delete SleepLogs with Whoop source in the date range
    sl_result = await db.execute(
        delete(SleepLog).where(
            SleepLog.user_id == user_id,
            SleepLog.source == "whoop",
            SleepLog.sleep_date >= start_date,
            SleepLog.sleep_date <= end_date,
        )
    )
    deleted_sleep = sl_result.rowcount

    # Delete sleep-only DailyMetrics in the date range.
    # A sleep-only metric has no strain/recovery data (raw_data = {"sleep_only": True}).
    # Metrics with cycle data must be preserved — only sleep fields will be updated.
    dm_result = await db.execute(
        delete(DailyMetric).where(
            DailyMetric.user_id == user_id,
            DailyMetric.source == "whoop",
            DailyMetric.metric_date >= start_date,
            DailyMetric.metric_date <= end_date,
            DailyMetric.strain.is_(None),
            DailyMetric.recovery_score.is_(None),
        )
    )
    deleted_metrics = dm_result.rowcount

    total = deleted_sleep + deleted_metrics
    if total > 0:
        logger.info(
            f"Cleaned up {deleted_sleep} Whoop SleepLogs and "
            f"{deleted_metrics} sleep-only DailyMetrics for user {user_id} "
            f"in range {start_date} to {end_date}"
        )
    return total


async def backfill_whoop_chunked(
    db: AsyncSession,
    user_id: uuid.UUID,
    months: int = 12,
    chunk_months: int = _CHUNK_MONTHS,
):
    """Async generator that backfills Whoop data in time-window chunks.

    Yields progress dicts after each chunk is committed::

        {"type": "progress", "chunk": 1, "total_chunks": 4, "synced_cycles": 42, ...}
        ...
        {"type": "complete", "synced_cycles": 150, "synced_sleep": 140, ...}

    Each chunk commits independently so partial progress is preserved
    even if the request is interrupted.
    """
    import asyncio

    now = datetime.now(UTC)
    total_months = months
    # Build list of (start_dt, end_dt) windows, oldest first
    chunks: list[tuple[datetime, datetime]] = []
    cursor = now
    remaining = total_months
    while remaining > 0:
        window = min(remaining, chunk_months)
        chunk_start = cursor - timedelta(days=window * 30)
        chunks.append((chunk_start, cursor))
        cursor = chunk_start
        remaining -= window
    chunks.reverse()  # oldest → newest

    total_chunks = len(chunks)
    agg = {"synced_cycles": 0, "synced_sleep": 0, "synced_workouts": 0}
    chunks_failed = 0

    _CHUNK_DELAY_SECONDS = 5  # Pause between chunks to avoid Whoop rate limits

    # Fresh-start cleanup: delete existing Whoop sleep data in the backfill
    # window so new records with corrected sleep_date (wake-up date) are created
    # rather than upserting onto stale rows with the old date.
    cleanup_start, cleanup_end = chunks[0][0], chunks[-1][1]
    cleaned = await _cleanup_whoop_sleep_data(db, user_id, cleanup_start, cleanup_end)
    if cleaned > 0:
        await db.commit()
        logger.info(
            f"Whoop backfill fresh-start: removed {cleaned} stale records for user {user_id}"
        )

    # Emit an initial progress event so the UI shows a bar immediately. The
    # first real chunk's data fetch (rate-limited recovery lookups) can take
    # a while, and without this the progress bar appears to never load even
    # though the backfill is running.
    yield {
        "type": "progress",
        "chunk": 0,
        "total_chunks": total_chunks,
        "window_start": chunks[0][0].date().isoformat() if chunks else None,
        "window_end": chunks[-1][1].date().isoformat() if chunks else None,
        **agg,
    }

    for i, (chunk_start, chunk_end) in enumerate(chunks, 1):
        # Pause between chunks to respect Whoop rate limits
        if i > 1:
            logger.info(
                f"Whoop backfill: waiting {_CHUNK_DELAY_SECONDS}s before chunk {i}/{total_chunks}"
            )
            await asyncio.sleep(_CHUNK_DELAY_SECONDS)

        logger.info(
            f"Whoop chunked backfill user {user_id}: "
            f"chunk {i}/{total_chunks} ({chunk_start.date()} → {chunk_end.date()})"
        )
        try:
            result = await backfill_whoop_data(
                db,
                user_id,
                months=0,
                start_dt=chunk_start,
                end_dt=chunk_end,
            )
        except Exception as e:
            chunks_failed += 1
            logger.error(f"Whoop backfill chunk {i} failed: {e}")
            yield {
                "type": "error",
                "detail": f"Chunk {i}/{total_chunks} failed: {e}",
                "chunk": i,
                "total_chunks": total_chunks,
                **agg,
            }
            continue
        # This generator owns its session (the SSE endpoint creates it via
        # async_session_factory, not get_db), so commit each chunk explicitly
        # to persist partial progress. BUG-036's "let get_db handle it" does
        # not apply to this path — without this commit, closing the session
        # rolls back every chunk and the backfill reports success while
        # persisting nothing.
        await db.commit()

        agg["synced_cycles"] += result["synced_cycles"]
        agg["synced_sleep"] += result["synced_sleep"]
        agg["synced_workouts"] += result["synced_workouts"]

        yield {
            "type": "progress",
            "chunk": i,
            "total_chunks": total_chunks,
            "window_start": chunk_start.date().isoformat(),
            "window_end": chunk_end.date().isoformat(),
            "chunk_cycles": result["synced_cycles"],
            "chunk_sleep": result["synced_sleep"],
            "chunk_workouts": result["synced_workouts"],
            **agg,
        }

    yield {
        "type": "complete",
        "total_chunks": total_chunks,
        "chunks_failed": chunks_failed,
        "months": total_months,
        **agg,
        "detail": (
            f"Backfilled {agg['synced_cycles']} daily metrics, "
            f"{agg['synced_sleep']} sleep records, and "
            f"{agg['synced_workouts']} enriched workouts from Whoop "
            f"(last {total_months} months, {total_chunks} chunks, "
            f"{chunks_failed} failed)"
        ),
    }
