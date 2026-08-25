"""Tests for the Redis cache module — locks and caching."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.services.cache import redis_lock


@pytest.mark.asyncio
class TestRedisLock:
    """Test redis_lock token-based acquire/release."""

    def _mock_redis(self, set_return="token-abc"):
        """Build a mock Redis whose SET returns the given value."""
        r = AsyncMock()
        r.set = AsyncMock(return_value=set_return)
        r.eval = AsyncMock(return_value=1)
        return r

    async def test_acquires_with_token(self):
        """Lock stores a random token, not a static '1'."""
        r = self._mock_redis(set_return="token-abc")
        with patch("app.services.cache._get_redis", return_value=r):
            async with redis_lock("test"):
                pass
        r.set.assert_called_once()
        call_args = r.set.call_args
        token = call_args[0][1] if len(call_args[0]) > 1 else call_args[1].get("value")
        assert isinstance(token, str)
        assert len(token) == 32  # secrets.token_hex(16) = 32 hex chars
        assert token != "1"

    async def test_raises_when_already_held(self):
        """RuntimeError when SET NX returns None (lock held)."""
        r = self._mock_redis(set_return=None)
        with patch("app.services.cache._get_redis", return_value=r), \
             pytest.raises(RuntimeError, match="already held"):
            async with redis_lock("test"):
                pass

    async def test_release_calls_eval(self):
        """Release uses r.eval with the Lua compare-and-delete script."""
        r = self._mock_redis(set_return="mytoken")
        with patch("app.services.cache._get_redis", return_value=r):
            async with redis_lock("test"):
                pass
        r.eval.assert_called_once()
        # eval(script, numkeys, key, token)
        call_args = r.eval.call_args
        assert call_args[0][1] == 1  # numkeys
        assert call_args[0][2] == "lock:test"  # key
        # Token passed to eval must match what was stored via set
        stored_token = r.set.call_args[0][1]
        assert call_args[0][3] == stored_token

    async def test_expired_lock_logs_warning(self):
        """When lock expired (token mismatch), logs warning instead of error."""
        r = self._mock_redis(set_return="mytoken")
        r.eval = AsyncMock(return_value=0)  # 0 = token mismatch
        with patch("app.services.cache._get_redis", return_value=r), \
             patch("app.services.cache.logger") as mock_logger:
            async with redis_lock("test"):
                pass
        mock_logger.warning.assert_called_once()
        assert "expired" in mock_logger.warning.call_args[0][0].lower()

    async def test_lock_not_released_on_acquire_failure(self):
        """No release attempted when lock was never acquired."""
        r = self._mock_redis(set_return=None)
        with patch("app.services.cache._get_redis", return_value=r), \
             pytest.raises(RuntimeError):
            async with redis_lock("test"):
                pass
        r.eval.assert_not_called()

    async def test_ttl_forwarded(self):
        """Custom TTL is passed to Redis SET."""
        r = self._mock_redis(set_return="tok")
        with patch("app.services.cache._get_redis", return_value=r):
            async with redis_lock("test", ttl=900):
                pass
        call_kwargs = r.set.call_args
        assert call_kwargs[1].get("ex") == 900 or (len(call_kwargs[0]) > 3 and call_kwargs[0][3] == 900)
