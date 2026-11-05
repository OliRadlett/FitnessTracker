"""Dry-run the latlng climb matcher; writes nothing by default.

    cd backend
    python -m scripts.match_segment_efforts --user <uuid>

Requires migration 106, rebuilt groups, and `latlng` streams (the 189-ride
backfill). Output is a JSON report per activity/group with the evidence
(median offset, span ratio, time) so a false match can be seen before it becomes
a PR. `--write` is deliberately not implemented yet; the first pass is review.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import uuid

from sqlalchemy import select

from app.database import async_session_factory, engine
from app.models.user import User
from app.services.segment_match import dry_run_user


async def run(user_id: uuid.UUID | None, out: str | None) -> None:
    async with async_session_factory() as db:
        users = (
            [user_id]
            if user_id
            else list((await db.execute(select(User.id))).scalars().all())
        )
        for uid in users:
            reports = await dry_run_user(db, uid)
            reports.sort(key=lambda r: (r["activity"], r["group"]))
            print(f"{uid}: {len(reports)} matches")
            for r in reports:
                print(
                    f"  {r['activity'][:28]:28s} {r['group'][:42]:42s} "
                    f"span {r['span_m']/r['climb_m']:.2f} "
                    f"med {r['median_offset_m']:4.1f}m "
                    f"{r['elapsed_seconds']:4.0f}s"
                )
            if out:
                # CLI-only: the whole command is one short-lived process.
                with open(out, "a", encoding="utf-8") as f:  # noqa: ASYNC230
                    f.write(json.dumps({"user_id": str(uid), "matches": reports}) + "\n")
                print(f"  wrote {out}")
    await engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user", type=uuid.UUID, default=None)
    parser.add_argument("--out", default=None)
    args = parser.parse_args()
    asyncio.run(run(args.user, args.out))


if __name__ == "__main__":
    main()
