"""One-off: apply the R2 bucket CORS rule required for browser uploads.

R2 has no CORS UI — browser presigned PUTs/GETs (the video upload + playback
flow) require a bucket CORS rule set via the S3 API. Run this after creating
the bucket and populating the `R2_*` env vars:

    python fittrack.py up
    python fittrack.py exec backend python -m app.scripts.r2_bootstrap

Idempotent — safe to re-run whenever the app's origins change.
"""

import asyncio

from app.integrations.r2 import configure_bucket_cors


async def main() -> None:
    await configure_bucket_cors()
    print("R2 bucket CORS rule applied.")


if __name__ == "__main__":
    asyncio.run(main())
