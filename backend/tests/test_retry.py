"""Tests for the retry utility — exponential backoff on HTTP errors."""

from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest

from app.integrations.retry import retry_request


@pytest.mark.asyncio
class TestRetryRequest:
    """Test retry_request with mock HTTP functions."""

    async def test_success_no_retry(self):
        """Successful call returns immediately."""
        mock_fn = AsyncMock(return_value="ok")
        result = await retry_request(mock_fn)
        assert result == "ok"
        assert mock_fn.call_count == 1

    async def test_retry_on_timeout(self):
        """Retries on httpx.TimeoutException."""
        mock_fn = AsyncMock(side_effect=[
            httpx.TimeoutException("timeout"),
            httpx.TimeoutException("timeout"),
            "ok",
        ])
        result = await retry_request(mock_fn, initial_backoff=0.01)
        assert result == "ok"
        assert mock_fn.call_count == 3

    async def test_retry_on_connect_error(self):
        """Retries on httpx.ConnectError."""
        mock_fn = AsyncMock(side_effect=[
            httpx.ConnectError("connection refused"),
            "ok",
        ])
        result = await retry_request(mock_fn, initial_backoff=0.01)
        assert result == "ok"
        assert mock_fn.call_count == 2

    async def test_retry_on_500(self):
        """Retries on HTTP 500."""
        response_500 = MagicMock()
        response_500.status_code = 500
        response_500.headers = {}
        error_500 = httpx.HTTPStatusError("server error", request=MagicMock(), response=response_500)

        mock_fn = AsyncMock(side_effect=[error_500, "ok"])
        result = await retry_request(mock_fn, initial_backoff=0.01)
        assert result == "ok"
        assert mock_fn.call_count == 2

    async def test_no_retry_on_400(self):
        """Does NOT retry on HTTP 400 (client error)."""
        response_400 = MagicMock()
        response_400.status_code = 400
        error_400 = httpx.HTTPStatusError("bad request", request=MagicMock(), response=response_400)

        mock_fn = AsyncMock(side_effect=error_400)
        with pytest.raises(httpx.HTTPStatusError):
            await retry_request(mock_fn, initial_backoff=0.01)
        assert mock_fn.call_count == 1

    async def test_exhausted_retries(self):
        """Raises last exception after all retries exhausted."""
        mock_fn = AsyncMock(side_effect=httpx.TimeoutException("timeout"))
        with pytest.raises(httpx.TimeoutException):
            await retry_request(mock_fn, max_retries=2, initial_backoff=0.01)
        assert mock_fn.call_count == 3  # initial + 2 retries

    async def test_retry_on_429(self):
        """Retries on HTTP 429 (rate limit)."""
        response_429 = MagicMock()
        response_429.status_code = 429
        response_429.headers = {}
        error_429 = httpx.HTTPStatusError("rate limited", request=MagicMock(), response=response_429)

        mock_fn = AsyncMock(side_effect=[error_429, "ok"])
        result = await retry_request(mock_fn, initial_backoff=0.01)
        assert result == "ok"

    async def test_passes_args_and_kwargs(self):
        """Arguments are forwarded to the function."""
        mock_fn = AsyncMock(return_value="result")
        result = await retry_request(mock_fn, "arg1", key="value")
        assert result == "result"
        mock_fn.assert_called_once_with("arg1", key="value")
