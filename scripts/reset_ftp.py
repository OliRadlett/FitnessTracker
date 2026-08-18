"""Reset FTP values in the database."""
import asyncio
from app.database import async_session_factory
from sqlalchemy import text


async def reset():
    async with async_session_factory() as db:
        # Clear FTP and LTHR from cycling profiles
        result = await db.execute(text(
            "UPDATE cycling_profiles SET ftp_watts = NULL, lactate_threshold_hr = NULL"
        ))
        print(f"Cleared FTP/LTHR from {result.rowcount} cycling profile(s)")

        # Delete FTP history
        result = await db.execute(text("DELETE FROM ftp_history"))
        print(f"Deleted {result.rowcount} FTP history record(s)")

        await db.commit()
        print("Reset complete!")


if __name__ == "__main__":
    asyncio.run(reset())
