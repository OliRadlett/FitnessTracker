"""Queue lift videos for processing.

Usage:
    python -m scripts.queue_videos               # pending videos only
    python -m scripts.queue_videos --all          # every video with an R2 source
    python -m scripts.queue_videos --all --force  # reset status + requeue (reprocess)
"""

import argparse
import asyncio

from app.database import async_session_factory
from app.models.lifting import LiftVideo
from app.tasks.scheduler import process_lift_video
from sqlalchemy import select, update


async def queue_videos(all_videos: bool, force: bool) -> None:
    async with async_session_factory() as db:
        query = select(LiftVideo.id).where(LiftVideo.r2_key.isnot(None))
        if not all_videos:
            query = query.where(LiftVideo.analysis_status == "pending")
        ids = [str(v) for v in (await db.execute(query)).scalars().all()]

        if force and ids:
            await db.execute(
                update(LiftVideo)
                .where(LiftVideo.id.in_(ids))
                .values(analysis_status=None)
            )
            await db.commit()

        for video_id in ids:
            print(f"Queueing video {video_id}...")
            process_lift_video.delay(video_id)

        print(f"Queued {len(ids)} videos")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--all", action="store_true",
                    help="queue every video with an R2 source, not just pending")
    ap.add_argument("--force", action="store_true",
                    help="reset analysis_status so completed videos are reprocessed")
    args = ap.parse_args()
    asyncio.run(queue_videos(args.all, args.force))


if __name__ == "__main__":
    main()
