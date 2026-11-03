"""The Celery application.

Separate from the scheduler so a task module can register on the app without
importing the module that defines every other task body. That import would be a
cycle the moment the first domain module is extracted.

The scheduler imports this name into its own namespace, so existing imports of
``app.tasks.scheduler.celery_app`` keep resolving.
"""

from celery import Celery

from app.config import get_settings

settings = get_settings()

celery_app = Celery(
    "fittrack",
    broker=settings.redis_url,
    backend=settings.redis_url,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    result_expires=3600,
)
