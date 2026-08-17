from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.database import engine, Base

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    from sqlalchemy import inspect, text
    async with engine.begin() as conn:
        def _check_and_migrate(sync_conn):
            inspector = inspect(sync_conn)
            tables = inspector.get_table_names()

            # If no tables exist at all, create everything from models
            if not tables:
                Base.metadata.create_all(sync_conn)
                return

            # Self-heal: add missing columns/tables that migrations may have missed
            existing_cols = {c["name"] for c in inspector.get_columns("activities")} if "activities" in tables else set()
            if "activities" in tables and "route_id" not in existing_cols:
                sync_conn.execute(text("ALTER TABLE activities ADD COLUMN IF NOT EXISTS route_id UUID"))
                sync_conn.execute(text("CREATE INDEX IF NOT EXISTS ix_activities_route_id ON activities(route_id)"))

            if "activity_sources" not in tables:
                sync_conn.execute(text("""
                    CREATE TABLE IF NOT EXISTS activity_sources (
                        id UUID PRIMARY KEY,
                        activity_id UUID NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
                        provider VARCHAR(50) NOT NULL,
                        provider_activity_id VARCHAR(255) NOT NULL,
                        provider_name VARCHAR(500),
                        raw_data JSONB,
                        synced_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL,
                        CONSTRAINT uq_activity_source_provider UNIQUE (provider, provider_activity_id)
                    )
                """))
                sync_conn.execute(text("CREATE INDEX IF NOT EXISTS ix_activity_sources_activity_id ON activity_sources(activity_id)"))

            lifting_cols = {c["name"] for c in inspector.get_columns("lifting_sets")} if "lifting_sets" in tables else set()
            if "lifting_sets" in tables and "created_at" not in lifting_cols:
                sync_conn.execute(text("ALTER TABLE lifting_sets ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL"))

        await conn.run_sync(_check_and_migrate)

        # Create any brand-new tables from models
        await conn.run_sync(Base.metadata.create_all)

    yield
    await engine.dispose()


app = FastAPI(
    title="FitTrack API",
    description="Fitness Tracker for Powerlifting & Cycling",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
async def health_check():
    return {"status": "ok"}


# Import and include routers
from app.api.auth import router as auth_router
from app.api.connections import router as connections_router
from app.api.activities import router as activities_router
from app.api.lifting import router as lifting_router
from app.api.charts import router as charts_router
from app.api.dashboard import router as dashboard_router
from app.api.webhooks import router as webhooks_router
from app.api.routes import router as routes_router
from app.api.cycling import router as cycling_router
from app.api.export import router as export_router

app.include_router(auth_router, prefix="/api/v1/auth", tags=["auth"])
app.include_router(connections_router, prefix="/api/v1/connections", tags=["connections"])
app.include_router(activities_router, prefix="/api/v1/activities", tags=["activities"])
app.include_router(lifting_router, prefix="/api/v1/lifting", tags=["lifting"])
app.include_router(charts_router, prefix="/api/v1/charts", tags=["charts"])
app.include_router(dashboard_router, prefix="/api/v1/dashboard", tags=["dashboard"])
app.include_router(webhooks_router, prefix="/api/v1/webhooks", tags=["webhooks"])
app.include_router(routes_router, prefix="/api/v1/routes", tags=["routes"])
app.include_router(cycling_router, prefix="/api/v1/cycling", tags=["cycling"])
app.include_router(export_router, prefix="/api/v1/export", tags=["export"])
