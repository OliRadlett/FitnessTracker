from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

settings = get_settings()

engine = create_async_engine(
    settings.database_url,
    echo=False,  # Use logging.getLogger("sqlalchemy.engine").setLevel(DEBUG) when needed
    pool_size=settings.db_pool_size,
    max_overflow=settings.db_max_overflow,
)

async_session_factory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
)


class Base(DeclarativeBase):
    pass


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with async_session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()


@asynccontextmanager
async def task_session() -> AsyncGenerator[AsyncSession, None]:
    """Create a fresh engine + session for a Celery task invocation.

    Celery workers are synchronous; each task calls ``asyncio.run()`` which
    creates a **new** event loop.  The module-level ``engine`` pool is bound
    to whichever loop first used it, so subsequent loops hit
    ``InterfaceError: another operation is in progress`` or
    ``Future attached to a different loop``.

    This context manager creates a throwaway engine scoped to the current
    loop, uses it for the session, and disposes it on exit — eliminating
    cross-loop pool conflicts entirely.
    """
    task_engine = create_async_engine(
        settings.database_url,
        echo=False,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
    )
    task_factory = async_sessionmaker(
        task_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    try:
        async with task_factory() as session:
            yield session
    finally:
        await task_engine.dispose()
