"""Rebuild ``segment_groups`` for one user (or every user).

Run from ``backend/`` with a host DATABASE_URL:

    $env:DATABASE_URL = "postgresql+asyncpg://fittrack:fittrack_dev@localhost:5432/fittrack"
    python -m scripts.rebuild_segment_groups

The service is idempotent. It never deletes groups and never overwrites a
``display_name``; it refreshes the generated metrics/profile and re-points every
segment/effort at its group. Run it once after migration 106, and after any
bulk route/segment re-import.
"""

from __future__ import annotations

import argparse
import asyncio
import uuid

from sqlalchemy import select

from app.database import async_session_factory, engine
from app.models.user import User
from app.services.segment_groups import rebuild_user_groups


async def run(user_id: uuid.UUID | None) -> None:
    async with async_session_factory() as db:
        if user_id is None:
            users = list((await db.execute(select(User.id))).scalars().all())
        else:
            users = [user_id]

        for uid in users:
            stats = await rebuild_user_groups(db, uid)
            await db.commit()
            print(
                f"{uid}: groups={stats['groups']} segments={stats['segments']} "
                f"efforts={stats['efforts']}"
            )

    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", type=uuid.UUID, default=None)
    args = parser.parse_args()
    asyncio.run(run(args.user))


if __name__ == "__main__":
    main()
