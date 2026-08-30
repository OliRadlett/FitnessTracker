#!/usr/bin/env python3
"""Fix Whoop data: re-sync all cycles and sleep with correct local-start dates.

The BUG-086 fix changed metric_date from cycle.start to cycle.end (in UTC),
which was wrong. Whoop dates recovery by the bedtime date in the user's
local timezone (cycle.start + timezone_offset), not the wake-up date.

This script:
1. Fetches all Whoop cycles with their recovery data
2. Re-creates DailyMetric records at the correct local-start dates
3. Fetches all Whoop sleep activities and creates/updates SleepLog records
4. Removes duplicate records caused by the end-based date bug
"""

import argparse
import asyncio
import logging
import os
from datetime import UTC, date, datetime, timedelta, timezone
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import async_session_factory
from app.integrations.whoop_client import whoop_client
from app.models.daily_metric import DailyMetric
from app.models.sleep import SleepLog
from app.models.user import OAuthConnection
from app.services.connection_health import refresh_connection
from app.services.whoop import refresh_if_needed

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("fix_whoop_sync")

utc = timezone.utc


def _parse_tz_offset(tz_str: str | None) -> timedelta:
    if not tz_str:
        return timedelta(0)
    try:
        sign = 1 if tz_str[0] == "+" else -1
        parts = tz_str[1:].split(":")
        return timedelta(hours=sign * int(parts[0]), minutes=sign * int(parts[1]))
    except (ValueError, IndexError):
        return timedelta(0)


def _local_start_date(utc_str: str | None, tz_offset: str | None) -> date | None:
    if not utc_str:
        return None
    try:
        utc_dt = datetime.fromisoformat(utc_str.replace("Z", "+00:00"))
        local_dt = utc_dt + _parse_tz_offset(tz_offset)
        return local_dt.date()
    except (ValueError, AttributeError):
        return None


async def main_async(dry_run: bool):
    """Main entry: fetch all cycles+sleep from Whoop and rewrite DailyMetric + SleepLog."""
    import uuid as uuid_mod

    async with async_session_factory() as db:
        conn = await db.execute(
            select(OAuthConnection).where(OAuthConnection.provider == "whoop")
        )
        c = conn.scalar_one()
        c = await refresh_if_needed(db, c)
        token = c.access_token
        user_uuid = c.user_id

        start_iso = "2026-08-21T00:00:00.000Z"
        end_iso = "2026-08-31T23:59:59.000Z"

        # ── Fetch cycles ──────────────────────────────────────
        import asyncio

        cycles = await whoop_client.get_all_cycles(
            token, start=start_iso, end=end_iso, max_records=1000
        )
        logger.info(f"Fetched {len(cycles)} cycles from Whoop API")

        # Build map of cycle_id -> recovery_score
        cycle_recoveries: dict[int, dict] = {}
        for cyc in cycles:
            cid = cyc.get("id")
            if not cid:
                continue
            await asyncio.sleep(1.0)  # rate limit
            try:
                recovery = await whoop_client.get_recovery_for_cycle(token, cid)
                if recovery:
                    cycle_recoveries[cid] = recovery
            except Exception as e:
                logger.warning(f"Failed to fetch recovery for cycle {cid}: {e}")

        # ── Delete existing whoop DailyMetrics in range ─────────
        delete_start = date(2026, 8, 21)
        delete_end = date(2026, 8, 31)
        del_result = await db.execute(
            delete(DailyMetric).where(
                DailyMetric.user_id == user_uuid,
                DailyMetric.source == "whoop",
                DailyMetric.metric_date >= delete_start,
                DailyMetric.metric_date <= delete_end,
            )
        )
        logger.info(
            f"Deleted {del_result.rowcount} existing whoop DailyMetrics in range"
        )

        # ── Re-create DailyMetrics with correct local-start dates ──────────
        synced = 0
        for cyc in cycles:
            if cyc.get("score_state") != "SCORED":
                continue
            score = cyc.get("score")
            if not score:
                continue

            start_str = cyc.get("start")
            tz_offset = cyc.get("timezone_offset")
            metric_date = _local_start_date(start_str, tz_offset)
            if metric_date is None:
                # Fallback to end
                metric_date = _local_start_date(cyc.get("end"), tz_offset)
            if metric_date is None:
                continue
            if metric_date < delete_start or metric_date > delete_end:
                continue

            strain = score.get("strain")
            kilojoule = score.get("kilojoule")
            calories = round(kilojoule * 0.239006, 1) if kilojoule else None

            recovery_score = None
            hrv_ms = None
            resting_hr = None
            respiratory_rate = None

            cid = cyc.get("id")
            rec = cycle_recoveries.get(cid)
            if rec and rec.get("score_state") == "SCORED":
                rec_score = rec.get("score", {})
                recovery_score = rec_score.get("recovery_score")
                hrv_ms = rec_score.get("hrv_rmssd_milli")
                rhr = rec_score.get("resting_heart_rate")
                if rhr is not None:
                    resting_hr = float(rhr)
                respiratory_rate = rec_score.get("respiratory_rate")

            cycle_with_recovery = {**cyc}
            if recovery_score is not None or rec:
                cycle_with_recovery["_recovery"] = {
                    "recovery_score": recovery_score,
                    "hrv_rmssd_milli": hrv_ms,
                    "resting_heart_rate": resting_hr,
                    "respiratory_rate": respiratory_rate,
                }

            update_fields: dict = {
                "raw_data": cycle_with_recovery,
                "updated_at": datetime.now(utc),
            }
            if strain:
                update_fields["strain"] = float(strain)
            if calories is not None:
                update_fields["calories"] = calories
            if recovery_score is not None:
                update_fields["recovery_score"] = recovery_score
            if hrv_ms is not None:
                update_fields["hrv_ms"] = hrv_ms
            if resting_hr is not None:
                update_fields["resting_hr"] = resting_hr
            if respiratory_rate is not None:
                update_fields["respiratory_rate"] = respiratory_rate

            stmt = (
                pg_insert(DailyMetric)
                .values(
                    user_id=user_uuid,
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
            )
            await db.execute(stmt)
            synced += 1

        # ── Fetch sleep activities and re-sync ────────────────
        sleep_records = await whoop_client.get_all_sleep_activities(
            token, start=start_iso, end=end_iso, max_records=1000
        )
        logger.info(f"Fetched {len(sleep_records)} sleep activities from Whoop API")

        # Delete existing whoop SleepLogs in range
        del_sl = await db.execute(
            delete(SleepLog).where(
                SleepLog.user_id == user_uuid,
                SleepLog.source == "whoop",
                SleepLog.sleep_date >= delete_start,
                SleepLog.sleep_date <= delete_end,
            )
        )
        logger.info(f"Deleted {del_sl.rowcount} existing whoop SleepLogs in range")

        sleep_synced = 0
        for record in sleep_records:
            if record.get("score_state") != "SCORED":
                continue
            if record.get("nap"):
                continue

            score = record.get("score")
            if not score:
                continue

            start_str = record.get("start")
            tz_offset = record.get("timezone_offset")
            sleep_date = _local_start_date(start_str, tz_offset)
            if sleep_date is None:
                sleep_date = _local_start_date(record.get("end"), tz_offset)
            if sleep_date is None:
                continue
            if sleep_date < delete_start or sleep_date > delete_end:
                continue

            end_str = record.get("end")
            try:
                sleep_start = datetime.fromisoformat(start_str.replace("Z", "+00:00"))
                sleep_end = (
                    datetime.fromisoformat(end_str.replace("Z", "+00:00"))
                    if end_str
                    else None
                )
            except (ValueError, AttributeError):
                continue

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

            if total_sleep_seconds is None and any(
                v is not None
                for v in [deep_sleep_seconds, rem_sleep_seconds, light_sleep_seconds]
            ):
                total_sleep_seconds = (
                    (deep_sleep_seconds or 0)
                    + (rem_sleep_seconds or 0)
                    + (light_sleep_seconds or 0)
                )

            if total_sleep_seconds is None and sleep_start and sleep_end:
                total_in_bed = int((sleep_end - sleep_start).total_seconds())
                awake = awake_seconds or 0
                if total_in_bed > awake:
                    total_sleep_seconds = total_in_bed - awake

            await db.execute(
                pg_insert(SleepLog)
                .values(
                    user_id=user_uuid,
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
            sleep_synced += 1

            # Also update DailyMetric with sleep duration and efficiency
            if total_sleep_seconds is not None:
                await db.execute(
                    pg_insert(DailyMetric)
                    .values(
                        user_id=user_uuid,
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
                            "updated_at": datetime.now(utc),
                        },
                    )
                )

        if not dry_run:
            await db.commit()

        logger.info(f"Synced {synced} DailyMetrics, {sleep_synced} SleepLogs")
        logger.info("Fix complete!")


async def main():
    parser = argparse.ArgumentParser(
        description="Fix Whoop data: re-sync all cycles+sleep with local-start dates"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Show what would be done without writing to the database",
    )
    args = parser.parse_args()

    if not args.dry_run:
        confirm = os.environ.get("CONFIRM_FIX", "").lower()
        if confirm != "yes":
            logger.warning("This will modify data. Set CONFIRM_FIX=yes to proceed.")
            return

    await main_async(args.dry_run)


if __name__ == "__main__":
    asyncio.run(main())
