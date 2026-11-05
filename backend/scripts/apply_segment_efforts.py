"""Apply latlng climb matches to efforts. Dry-run by default.

    cd backend
    python -m scripts.apply_segment_efforts --user <uuid>
    python -m scripts.apply_segment_efforts --user <uuid> --write

Dry-run prints the match count and writes nothing. `--write` inserts one effort
per activity/group, refreshes the touched line's PR totals, and is idempotent:
re-running skips existing attempts. Requires migration 106/107, rebuilt groups
and `latlng` streams. Review the dry-run before using `--write`.
"""

from __future__ import annotations

import argparse
import asyncio
import uuid

from sqlalchemy import select

from app.database import async_session_factory, engine
from app.models.user import User
from app.services.segment_match import apply_user_matches, dry_run_user


async def run(user_id: uuid.UUID | None, write: bool) -> None:
    async with async_session_factory() as db:
        users = (
            [user_id]
            if user_id
            else list((await db.execute(select(User.id))).scalars().all())
        )
        for uid in users:
            if write:
                stats = await apply_user_matches(db, uid)
                await db.commit()
                print(f"{uid}: wrote {stats}")
            else:
                reports = await dry_run_user(db, uid)
                print(f"{uid}: {len(reports)} matches (dry run, nothing written)")
                for r in reports:
                    print(
                        f"  {r['activity'][:28]:28s} {r['group'][:42]:42s} "
                        f"span {r['span_m']/r['climb_m']:.2f} "
                        f"med {r['median_offset_m']:4.1f}m "
                        f"{r['elapsed_seconds']:4.0f}s"
                    )
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", type=uuid.UUID, default=None)
    parser.add_argument(
        "--write",
        action="store_true",
        help="persist matches (default is a dry run)",
    )
    args = parser.parse_args()
    asyncio.run(run(args.user, args.write))


if __name__ == "__main__":
    main()
