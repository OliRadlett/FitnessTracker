"""Backfill the `latlng` stream for rides that predate the request.

    cd backend
    $env:DATABASE_URL = "postgresql+asyncpg://.../fittrack"
    python -m scripts.backfill_latlng --limit 3 --delay 1

Run with no `--limit` for the whole account. Strava's default quota is 100
requests / 15 min; `--delay 9` keeps a full 205-ride run inside it (~30 min).
The function selects only missing streams, so an interrupted run can be re-run.
"""

from __future__ import annotations

import argparse
import asyncio
import uuid

from sqlalchemy import select

from app.database import async_session_factory, engine
from app.models.user import User
from app.services.strava.sync import backfill_latlng_streams


async def run(user_id: uuid.UUID | None, limit: int | None, delay: float) -> None:
    async with async_session_factory() as db:
        users = (
            [user_id]
            if user_id
            else list((await db.execute(select(User.id))).scalars().all())
        )
        for uid in users:
            stats = await backfill_latlng_streams(
                db, uid, limit=limit, delay_seconds=delay
            )
            print(f"{uid}: {stats}")
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", type=uuid.UUID, default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=0.0)
    args = parser.parse_args()
    asyncio.run(run(args.user, args.limit, args.delay))


if __name__ == "__main__":
    main()
