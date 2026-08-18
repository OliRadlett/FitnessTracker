"""Shared retry logic with exponential backoff for integration API calls."""

import asyncio
import logging

import httpx

logger = logging.getLogger(__name__)

# Default retry configuration
MAX_RETRIES = 3
INITIAL_BACKOFF_SECONDS = 1.0
BACKOFF_MULTIPLIER = 2.0

# HTTP status codes that are safe to retry
_RETRYABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}


async def retry_request(
    func,
    *args,
    max_retries: int = MAX_RETRIES,
    initial_backoff: float = INITIAL_BACKOFF_SECONDS,
    backoff_multiplier: float = BACKOFF_MULTIPLIER,
    **kwargs,
):
    """Execute an async HTTP function with exponential backoff retry.

    Retries on:
    - httpx.TimeoutException
    - httpx.ConnectError
    - HTTP status codes: 408, 429, 500, 502, 503, 504

    Does NOT retry on:
    - 4xx client errors (except 408 and 429)
    - Auth errors (401, 403)

    Args:
        func: Async callable to execute.
        *args, **kwargs: Arguments passed to func.
        max_retries: Maximum number of retry attempts.
        initial_backoff: Seconds to wait before first retry.
        backoff_multiplier: Multiplier for each subsequent backoff.

    Returns:
        The return value of func on success.

    Raises:
        The last exception if all retries are exhausted.
    """
    last_exception = None
    backoff = initial_backoff

    for attempt in range(max_retries + 1):
        try:
            return await func(*args, **kwargs)
        except httpx.TimeoutException as e:
            last_exception = e
            if attempt < max_retries:
                logger.warning(
                    f"Request timeout (attempt {attempt + 1}/{max_retries + 1}), "
                    f"retrying in {backoff:.1f}s..."
                )
                await asyncio.sleep(backoff)
                backoff *= backoff_multiplier
        except httpx.ConnectError as e:
            last_exception = e
            if attempt < max_retries:
                logger.warning(
                    f"Connection error (attempt {attempt + 1}/{max_retries + 1}), "
                    f"retrying in {backoff:.1f}s..."
                )
                await asyncio.sleep(backoff)
                backoff *= backoff_multiplier
        except httpx.HTTPStatusError as e:
            status = e.response.status_code
            if status in _RETRYABLE_STATUS_CODES and attempt < max_retries:
                last_exception = e
                # Respect Retry-After header if present
                retry_after = e.response.headers.get("Retry-After")
                if retry_after:
                    try:
                        backoff = max(float(retry_after), backoff)
                    except ValueError:
                        pass
                logger.warning(
                    f"HTTP {status} (attempt {attempt + 1}/{max_retries + 1}), "
                    f"retrying in {backoff:.1f}s..."
                )
                await asyncio.sleep(backoff)
                backoff *= backoff_multiplier
            else:
                raise  # Non-retryable HTTP error

    raise last_exception  # type: ignore[misc]
