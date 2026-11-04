"""Mint a backend JWT for local QA, so the production pages can be driven
headlessly without going through Google/GitHub OAuth.

Reads SECRET_KEY from the repo `.env` (or the environment), writes the token to
the path given as argv[1], and prints nothing but the token's expiry — never the
token itself.

Usage (from prototype/relive):
    python qa/mint-token.py ../../.tmp/qa-token.txt [user-email]
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
BACKEND = REPO / "backend"


def load_env() -> None:
    env_file = REPO / ".env"
    if not env_file.exists():
        return
    for line in env_file.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def main() -> None:
    if len(sys.argv) < 2:
        raise SystemExit("usage: mint-token.py <output-path> [email]")
    out_path = Path(sys.argv[1])
    email = sys.argv[2] if len(sys.argv) > 2 else "o.radlett@gmail.com"

    load_env()
    os.environ.setdefault("DEBUG", "true")
    # `.env` targets the compose service name (`@db:`); this script runs on the
    # host, where the same database is published on localhost.
    database_url = os.environ.get("DATABASE_URL", "")
    if "@db:" in database_url:
        os.environ["DATABASE_URL"] = database_url.replace("@db:", "@localhost:")
    sys.path.insert(0, str(BACKEND))

    from sqlalchemy import select  # noqa: PLC0415

    from app.database import task_session  # noqa: PLC0415
    from app.models.user import User  # noqa: PLC0415
    from app.services.auth import create_access_token  # noqa: PLC0415

    async def lookup() -> str:
        async with task_session() as db:
            result = await db.execute(select(User).where(User.email == email))
            user = result.scalar_one_or_none()
            if user is None:
                raise SystemExit(f"no user with email {email}")
            return str(user.id)

    user_id = asyncio.run(lookup())
    token = create_access_token(uuid.UUID(user_id))
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(token, encoding="utf-8")
    exp = datetime.now(timezone.utc) + timedelta(days=7)
    print(f"wrote token for {email} ({user_id[:8]}…), expires ~{exp:%Y-%m-%d}")


if __name__ == "__main__":
    main()
