"""One-off: merge the 19 km "home loop" cluster into a single Course.

Ten routes in the 18.8–21.5 km band all start at home and are the same course
to the user's mind ("the loop") with different lines/sections. They should be
one Course, but classified ``variant`` — NOT ``identical`` — so the similarity
metric never learns that routes 14% apart in length are the same. The user
wants *tight* tolerance globally; this cluster is a deliberate exception.

Surviving primary: ``42de2b16`` (Evening Ride) — a clean closed loop (0.0 m
polyline gap, ``is_loop=true``), coverage 1.0 with 298 edges, richest
provenance (komoot + strava). ``01bbb927`` has more rides (31) but is an open
trace with a 579 m start/end gap, and merge now adopts geometry coherently, so
the loop is the better survivor.

Usage:
    python -m app.scripts.merge_home_loop_cluster --dry-run
    python -m app.scripts.merge_home_loop_cluster
"""

import argparse
import asyncio
import uuid

from sqlalchemy import select

from app.database import task_session
from app.models.route import Route
from app.services.route_service import merge_routes

USER_ID = uuid.UUID("6ad6480b-daad-41b1-8166-b9d8bd2559ab")

# Surviving Course (clean closed loop, richest provenance).
PRIMARY = uuid.UUID("42de2b16-7218-4d97-8abf-16352ef6c78c")

# Absorbed into the primary, all classified `variant`.
DUPLICATES = [
    "f8907e05-2400-4c93-baac-4bd555020434",  # Afternoon Ride 18.83 km
    "4bfb556b-1423-45a4-aede-15632d3e3c92",  # Cycling        18.83 km
    "1512e202-2ac7-4a14-adf0-32a0a7e48f67",  # Cycling        18.88 km
    "01bbb927-cf61-44c4-83f3-ce5d9c20ca9c",  # Cycling        19.05 km (31 rides)
    "772a55e3-9391-46a6-8d4c-d25159e397c8",  # Evening Ride   20.24 km
    "807a90bb-a01a-4984-8e35-0b678009c377",  # Afternoon Ride 20.60 km
    "ea027aa5-53d7-4f54-8e5c-e9651431becd",  # Cycling        20.89 km
    "ad5e2fd2-e6f7-46e7-8294-b800a72305cb",  # Cycling        21.42 km
    "3b71a222-3f58-4773-b823-059eaa213024",  # Lunch Ride     21.50 km
]


async def _run(dry_run: bool) -> None:
    async with task_session() as db:
        primary = (
            await db.execute(select(Route).where(Route.id == PRIMARY))
        ).scalar_one_or_none()
        if primary is None:
            print(f"ABORT: primary {PRIMARY} not found")
            return
        print(f"primary: {primary.name} ({primary.distance_meters:.0f} m)")

        merged = 0
        for raw_id in DUPLICATES:
            dup_id = uuid.UUID(raw_id)
            dup = (
                await db.execute(select(Route).where(Route.id == dup_id))
            ).scalar_one_or_none()
            if dup is None:
                print(f"  skip {raw_id[:8]}: already gone")
                continue

            # Re-read the primary each round: a prior merge may have replaced its
            # geometry (and cleared its road_match).
            primary = (
                await db.execute(select(Route).where(Route.id == PRIMARY))
            ).scalar_one()

            if dry_run:
                n_acts = len(
                    (
                        await db.execute(
                            select(Route.id).where(Route.id == dup_id)
                        )
                    ).all()
                )
                print(
                    f"  WOULD MERGE {raw_id[:8]} {dup.name!r} "
                    f"({dup.distance_meters:.0f} m, is_loop={dup.is_loop}) -> variant"
                )
                continue

            result = await merge_routes(
                db,
                PRIMARY,
                dup_id,
                USER_ID,
                # `variant`: grouped as one Course, but must NOT train the
                # matcher that these are the same route.
                merge_kind="variant",
            )
            if result is not None:
                merged += 1
                print(
                    f"  merged {raw_id[:8]} {dup.name!r} "
                    f"({dup.distance_meters:.0f} m) -> variant"
                )

        if dry_run:
            print("\nDRY RUN — nothing written.")
            await db.rollback()
            return

        await db.commit()
        final = (
            await db.execute(select(Route).where(Route.id == PRIMARY))
        ).scalar_one()
        print(
            f"\nmerged {merged} routes. surviving Course: {final.name} "
            f"({final.distance_meters:.0f} m, is_loop={final.is_loop})"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    asyncio.run(_run(args.dry_run))


if __name__ == "__main__":
    main()
