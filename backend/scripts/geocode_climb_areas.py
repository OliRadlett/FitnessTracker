"""Backfill climb areas from Nominatim (1 req/s, cached on the group).

    cd backend
    python -m scripts.geocode_climb_areas --user <uuid>

Run once after the group backfill. Idempotent: only groups with ``area IS NULL``
are requested, so a re-run is cheap. Attribution: OpenStreetMap contributors
(ODbL); the page footer carries it.
"""

from __future__ import annotations

import argparse
import asyncio
import uuid

from sqlalchemy import select

from app.database import async_session_factory, engine
from app.models.user import User
from app.services.climb_geocoding import geocode_missing_areas


async def run(user_id: uuid.UUID | None, limit: int | None) -> None:
    async with async_session_factory() as db:
        users = (
            [user_id]
            if user_id
            else list((await db.execute(select(User.id))).scalars().all())
        )
        for uid in users:
            stats = await geocode_missing_areas(db, uid, limit=limit)
            print(f"{uid}: {stats}")
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", type=uuid.UUID, default=None)
    parser.add_argument("--limit", type=int, default=None)
    args = parser.parse_args()
    asyncio.run(run(args.user, args.limit))


if __name__ == "__main__":
    main()
