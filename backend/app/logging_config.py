"""Structured JSON logging with request correlation IDs."""

import logging
import sys
import uuid
from contextvars import ContextVar
from typing import Any

from pythonjsonlogger import json as jsonlogger

# Context variable for request correlation ID
correlation_id: ContextVar[str] = ContextVar("correlation_id", default="")


class CorrelationIdFilter(logging.Filter):
    """Inject correlation_id into every log record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.correlation_id = correlation_id.get("")
        return True


class StructuredJsonFormatter(jsonlogger.JsonFormatter):
    """JSON log formatter with consistent field naming."""

    def add_fields(
        self,
        log_record: dict[str, Any],
        record: logging.LogRecord,
        message_dict: dict[str, Any],
    ) -> None:
        super().add_fields(log_record, record, message_dict)
        # Ensure consistent field names
        log_record["level"] = record.levelname
        log_record["logger"] = record.name
        log_record["correlation_id"] = getattr(record, "correlation_id", "")


def setup_logging(*, debug: bool = False) -> None:
    """Configure structured JSON logging for production, readable logs for dev.

    Args:
        debug: When True, use DEBUG level with human-readable format.
               When False, use INFO level with structured JSON output.
    """
    root = logging.getLogger()
    # Clear existing handlers to avoid duplicates on reload
    root.handlers.clear()

    level = logging.DEBUG if debug else logging.INFO
    root.setLevel(level)

    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)

    correlation_filter = CorrelationIdFilter()
    handler.addFilter(correlation_filter)

    if debug:
        formatter = logging.Formatter(
            "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
    else:
        formatter = StructuredJsonFormatter(
            "%(asctime)s %(level)s %(name)s %(message)s",
            rename_fields={"asctime": "timestamp"},
        )

    handler.setFormatter(formatter)
    root.addHandler(handler)

    # Quiet down noisy third-party loggers
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.DEBUG if debug else logging.WARNING
    )
