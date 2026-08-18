import logging
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from sqlalchemy import text

from app.config import get_settings
from app.database import engine, Base, async_session_factory
from app.logging_config import correlation_id, setup_logging

settings = get_settings()

# ── Logging ────────────────────────────────────────────────────────────
setup_logging(debug=settings.debug)
logger = logging.getLogger(__name__)

# ── Rate limiting ──────────────────────────────────────────────────────
# Global default: 100 requests/minute per IP
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=["100/minute"],
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting FitTrack API (debug=%s)", settings.debug)

    # Create any brand-new tables from models (for fresh installs).
    # Schema changes are handled by Alembic migrations (see 016_cleanup_self_heal.py
    # for the migration that replaced the old inline self-heal logic).
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield
    await engine.dispose()
    logger.info("FitTrack API shutdown complete")


app = FastAPI(
    title="FitTrack API",
    description="Fitness Tracker for Powerlifting & Cycling",
    version="0.1.0",
    lifespan=lifespan,
)

# ── Rate limiting middleware ───────────────────────────────────────────
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# ── CORS ──────────────────────────────────────────────────────────────
# CSRF protection is intentionally omitted.  The API uses JWT Bearer tokens
# sent via the Authorization header (not cookies), so browsers do not attach
# them automatically on cross-origin requests.  Combined with CORS origin
# restrictions below, this effectively mitigates CSRF without needing
# additional CSRF tokens or SameSite cookie attributes.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins.split(","),
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Total-Count"],
)


# ── Correlation ID middleware ──────────────────────────────────────────
@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    """Generate a UUID correlation ID for every request and inject into log context."""
    request_id = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    token = correlation_id.set(request_id)
    try:
        response = await call_next(request)
        response.headers["X-Request-ID"] = request_id
        return response
    finally:
        correlation_id.reset(token)


# ── Stricter rate limit for auth/token endpoints (20 req/min) ─────────
@app.middleware("http")
async def auth_rate_limit_middleware(request: Request, call_next):
    """Apply a stricter 20 req/min limit on auth/token endpoints."""
    if request.url.path.startswith("/api/v1/auth"):
        rate_key = get_remote_address(request)
        if not limiter.limiter.hit("20/minute", rate_key, "auth"):
            return Response(
                content='{"detail":"Rate limit exceeded for auth endpoints"}',
                status_code=429,
                media_type="application/json",
            )
    return await call_next(request)


@app.get("/health")
async def health_check():
    """Health check that verifies database and Redis connectivity."""
    db_ok = False
    redis_ok = False

    # Database ping
    try:
        async with async_session_factory() as session:
            await session.execute(text("SELECT 1"))
            db_ok = True
    except Exception:
        pass

    # Redis ping
    try:
        import redis.asyncio as aioredis
        r = aioredis.from_url(settings.redis_url)
        await r.ping()
        await r.aclose()
        redis_ok = True
    except Exception:
        pass

    if db_ok and redis_ok:
        return {"status": "ok", "db": "ok", "redis": "ok"}

    return Response(
        content='{"status":"degraded","db":"%s","redis":"%s"}'
        % ("ok" if db_ok else "error", "ok" if redis_ok else "error"),
        status_code=503,
        media_type="application/json",
    )


# ── Prometheus metrics ───────────────────────────────────────────────
from prometheus_fastapi_instrumentator import Instrumentator

Instrumentator(
    should_respect_env_var=True,
    excluded_handlers=["/health", "/metrics"],
).instrument(app).expose(app, endpoint="/metrics")

# ── API routers ─────────────────────────────────────────────────────
# All routes are versioned under /api/v1/. See docs/api-versioning.md
# for the versioning and deprecation policy.
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
from app.api.metrics import router as metrics_router
from app.api.goals import router as goals_router
from app.api.training_plans import router as training_plans_router
from app.api.events import router as events_router

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
app.include_router(metrics_router, prefix="/api/v1/metrics", tags=["metrics"])
app.include_router(goals_router, prefix="/api/v1/goals", tags=["goals"])
app.include_router(training_plans_router, prefix="/api/v1/training-plans", tags=["training-plans"])
app.include_router(events_router, prefix="/api/v1/events", tags=["events"])
