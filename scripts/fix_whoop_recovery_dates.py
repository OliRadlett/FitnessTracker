#!/usr/bin/env python3
"""Fix Whoop recovery DailyMetric records that were assigned to the wrong date.

Bug: sync_whoop_cycles() and backfill_whoop_data() derived metric_date from
the cycle end time in UTC (BUG-086 fix), but Whoop displays recovery by the
local bedtime date (cycle.start + timezone_offset). For cycles whose bedtime
crosses UTC midnight (e.g. start at 23:07 UTC +01:00 → local 00:07 next day),
this shifts the record to the wrong day.

This script shifts affected records to the correct local bedtime date,
merging conflicts when multiple records map to the same date.

Usage:
    1. Stop the Celery worker + beat to prevent writes during migration.
    2. python fittrack.py exec backend python scripts/fix_whoop_recovery_dates.py --dry-run
    3. CONFIRM_FIX=yes python fittrack.py exec backend python scripts/fix_whoop_recovery_dates.py

Idempotent: records already at the correct date are skipped.
"""

import argparse
import asyncio
import logging
import os
from datetime import date, datetime, timezone, timedelta

from app.database import async_session_factory
from app.models.daily_metric import DailyMetric
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as pg_insert

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
)
logger = logging.getLogger("fix_whoop_recovery_dates")

UTC = timezone.utc

DATA_COLS = [
    "recovery_score",
    "hrv_ms",
    "resting_hr",
    "respiratory_rate",
    "sleep_duration_minutes",
    "sleep_efficiency",
    "strain",
    "calories",
]


def _parse_tz_offset(tz_str: str | None) -> timedelta:
    """Parse a timezone offset string like '+01:00' into a timedelta."""
    if not tz_str:
        return timedelta(0)
    try:
        sign = 1 if tz_str[0] == "+" else -1
        parts = tz_str[1:].split(":")
        return timedelta(hours=sign * int(parts[0]), minutes=sign * int(parts[1]))
    except (ValueError, IndexError):
        return timedelta(0)


def _resolve_correct_date(raw_data: dict | None) -> date | None:
    """Return the correct local bedtime date for a DailyMetric.

    Uses cycle.start (bedtime) + timezone_offset to compute the local date,
    matching how the Whoop app displays recovery. Falls back to cycle.end
    if start is missing, then to the UTC date. Returns None if the date
    cannot be determined.
    """
    if not raw_data or not isinstance(raw_data, dict):
        return None
    tz_offset = raw_data.get("timezone_offset")
    start_str = raw_data.get("start")
    date_str = start_str or raw_data.get("end")
    if not date_str:
        return None
    try:
        utc_dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
        local_dt = utc_dt + _parse_tz_offset(tz_offset)
        return local_dt.date()
    except (ValueError, AttributeError):
        return None


def _count_valuable_fields(dm: DailyMetric) -> int:
    """Count how many data columns have non-null values (proxy for completeness)."""
    count = 0
    for col in DATA_COLS:
        if getattr(dm, col, None) is not None:
            count += 1
    return count


def _merge_raw_data(*records: DailyMetric) -> dict | None:
    """Merge raw_data dicts from multiple records. Earliest record wins."""
    merged = {}
    for dm in records:
        if dm.raw_data and isinstance(dm.raw_data, dict):
            merged.update(dm.raw_data)
    return merged if merged else None


async def fix_whoop_recovery_dates(dry_run: bool = True):
    async with async_session_factory() as db:
        result = await db.execute(
            select(DailyMetric).where(DailyMetric.source == "whoop")
        )
        records = list(result.scalars().all())
        logger.info(f"Found {len(records)} total Whoop DailyMetric records")

        # Compute correct_date for each record
        correct_dates: dict[object, date | None] = {}
        skip_count = 0
        unfixable = 0
        for dm in records:
            correct_date = _resolve_correct_date(dm.raw_data)
            correct_dates[dm.id] = correct_date
            if correct_date is None:
                unfixable += 1
            elif dm.metric_date == correct_date:
                skip_count += 1

        logger.info(f"Records already correct: {skip_count}")
        logger.info(f"Records unfixable (no start/end in raw_data): {unfixable}")

        # Build target groups: (user_id, correct_date) -> list of DailyMetric
        groups: dict[tuple, list[DailyMetric]] = {}
        for dm in records:
            correct_date = correct_dates[dm.id]
            if correct_date is None:
                continue
            if dm.metric_date == correct_date:
                continue  # already correct, but still include in group
            key = (dm.user_id, correct_date)
            groups.setdefault(key, []).append(dm)

        # Also include already-correct records that are at the same target date
        # (they might need to be merged with shifting records)
        for dm in records:
            correct_date = correct_dates[dm.id]
            if correct_date is None or dm.metric_date != correct_date:
                continue
            key = (dm.user_id, correct_date)
            if key in groups:
                # This date is a target for some shifting records
                groups[key].append(dm)

        needing_fix = sum(len(v) for v in groups.values())
        logger.info(f"Records needing fix or merge: {needing_fix}")

        shift_count = 0
        conflict_count = 0
        merge_count = 0

        # Process targets in reverse date order so chains resolve correctly
        # (newer dates processed first, freeing dates for older records)
        sorted_keys = sorted(groups.keys(), key=lambda k: k[1], reverse=True)

        for key in sorted_keys:
            user_id, target_date = key
            recs = groups[key]

            if len(recs) == 1 and recs[0].metric_date == target_date:
                # The only record at this target is already correct — skip
                continue
            elif len(recs) == 1:
                # Simple shift
                dm = recs[0]
                logger.info(
                    f"  SHIFT: user={user_id} {dm.metric_date} -> {target_date} "
                    f"(recovery={dm.recovery_score}, hrv={dm.hrv_ms})"
                )
                shift_count += 1
                if not dry_run:
                    # Delete old position, upsert at correct position
                    await db.execute(delete(DailyMetric).where(DailyMetric.id == dm.id))
                    await db.execute(
                        pg_insert(DailyMetric)
                        .values(
                            user_id=dm.user_id,
                            metric_date=target_date,
                            source=dm.source,
                            recovery_score=dm.recovery_score,
                            hrv_ms=dm.hrv_ms,
                            resting_hr=dm.resting_hr,
                            respiratory_rate=dm.respiratory_rate,
                            sleep_duration_minutes=dm.sleep_duration_minutes,
                            sleep_efficiency=dm.sleep_efficiency,
                            strain=dm.strain,
                            calories=dm.calories,
                            raw_data=dm.raw_data,
                            created_at=dm.created_at,
                            updated_at=datetime.now(UTC),
                        )
                        .on_conflict_do_update(
                            index_elements=["user_id", "metric_date", "source"],
                            set_={
                                "recovery_score": dm.recovery_score,
                                "hrv_ms": dm.hrv_ms,
                                "resting_hr": dm.resting_hr,
                                "respiratory_rate": dm.respiratory_rate,
                                "sleep_duration_minutes": dm.sleep_duration_minutes,
                                "sleep_efficiency": dm.sleep_efficiency,
                                "strain": dm.strain,
                                "calories": dm.calories,
                                "raw_data": dm.raw_data,
                                "updated_at": datetime.now(UTC),
                            },
                        )
                    )

            else:
                # Conflict / merge: multiple records for the same target date
                conflict_count += 1
                recs_sorted = sorted(recs, key=_count_valuable_fields, reverse=True)
                target = recs_sorted[0]
                sources = recs_sorted[1:]
                logger.info(
                    f"  CONFLICT: user={user_id} date={target_date} "
                    f"({len(recs)} records, target id={target.id} "
                    f"from {target.metric_date})"
                )
                for src in sources:
                    merge_count += 1
                    logger.info(
                        f"    MERGE: id={src.id} date={src.metric_date} "
                        f"-> into {target.id} ({target.metric_date} -> {target_date})"
                    )
                if not dry_run:
                    merged_raw = _merge_raw_data(*recs_sorted)
                    updates = {}
                    for col in DATA_COLS:
                        tv = getattr(target, col, None)
                        for src in sources:
                            sv = getattr(src, col, None)
                            if tv is None and sv is not None:
                                tv = sv
                                updates[col] = sv
                    updates["metric_date"] = target_date
                    updates["updated_at"] = datetime.now(UTC)
                    updates["raw_data"] = merged_raw

                    # Delete all source records first
                    for src in sources:
                        await db.execute(
                            delete(DailyMetric).where(DailyMetric.id == src.id)
                        )
                    # Then update target (delete + re-insert to handle unique constraint)
                    await db.execute(
                        delete(DailyMetric).where(DailyMetric.id == target.id)
                    )
                    await db.execute(
                        pg_insert(DailyMetric)
                        .values(
                            user_id=target.user_id,
                            metric_date=target_date,
                            source=target.source,
                            recovery_score=updates.get(
                                "recovery_score", target.recovery_score
                            ),
                            hrv_ms=updates.get("hrv_ms", target.hrv_ms),
                            resting_hr=updates.get("resting_hr", target.resting_hr),
                            respiratory_rate=updates.get(
                                "respiratory_rate", target.respiratory_rate
                            ),
                            sleep_duration_minutes=updates.get(
                                "sleep_duration_minutes", target.sleep_duration_minutes
                            ),
                            sleep_efficiency=updates.get(
                                "sleep_efficiency", target.sleep_efficiency
                            ),
                            strain=updates.get("strain", target.strain),
                            calories=updates.get("calories", target.calories),
                            raw_data=merged_raw,
                            created_at=target.created_at,
                            updated_at=datetime.now(UTC),
                        )
                        .on_conflict_do_update(
                            index_elements=["user_id", "metric_date", "source"],
                            set_={
                                "recovery_score": updates.get(
                                    "recovery_score", target.recovery_score
                                ),
                                "hrv_ms": updates.get("hrv_ms", target.hrv_ms),
                                "resting_hr": updates.get(
                                    "resting_hr", target.resting_hr
                                ),
                                "respiratory_rate": updates.get(
                                    "respiratory_rate", target.respiratory_rate
                                ),
                                "sleep_duration_minutes": updates.get(
                                    "sleep_duration_minutes",
                                    target.sleep_duration_minutes,
                                ),
                                "sleep_efficiency": updates.get(
                                    "sleep_efficiency", target.sleep_efficiency
                                ),
                                "strain": updates.get("strain", target.strain),
                                "calories": updates.get("calories", target.calories),
                                "raw_data": merged_raw,
                                "updated_at": datetime.now(UTC),
                            },
                        )
                    )

        if not dry_run:
            await db.commit()

        logger.info(f"Total shifts applied: {shift_count}")
        logger.info(f"Total conflicts resolved: {conflict_count}")
        logger.info(f"Total records merged: {merge_count}")
        logger.info("Fix complete.")


async def main():
    parser = argparse.ArgumentParser(
        description="Fix Whoop recovery DailyMetric dates (start -> end)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        default=False,
        help="Show what would be changed without writing to the database",
    )
    args = parser.parse_args()

    if not args.dry_run:
        confirm = os.environ.get("CONFIRM_FIX", "").lower()
        if confirm != "yes":
            logger.warning(
                "This will modify data. Set CONFIRM_FIX=yes to proceed.\n"
                "Example:\n"
                "  CONFIRM_FIX=yes python fittrack.py exec backend "
                "python scripts/fix_whoop_recovery_dates.py"
            )
            return

    await fix_whoop_recovery_dates(dry_run=args.dry_run)


if __name__ == "__main__":
    asyncio.run(main())
