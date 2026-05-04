import pytest
from unittest.mock import MagicMock, patch
from datetime import timezone

from rate_limiter import SlidingWindowLimiter, RateLimitError, RateLimitResult


def make_limiter(limit: int, window: int, results: list):
    """Build a limiter with a mocked Redis script that returns successive results."""
    redis_mock = MagicMock()
    script_mock = MagicMock(side_effect=results)
    redis_mock.register_script.return_value = script_mock
    limiter = SlidingWindowLimiter(redis_mock, limit=limit, window=window)
    return limiter


class TestCheck:
    def test_allows_within_limit(self):
        limiter = make_limiter(5, 60, [[1, 4, 0, 0]])
        result = limiter.check("user:1")
        assert result.allowed is True
        assert result.remaining == 4
        assert result.limit == 5
        assert result.retry_after is None

    def test_blocks_when_limit_exceeded(self):
        import time
        now_ms = int(time.time() * 1000)
        oldest = now_ms - 30_000
        retry_after_ms = oldest + 60_000 - now_ms
        limiter = make_limiter(2, 60, [[0, 0, retry_after_ms, oldest]])
        result = limiter.check("user:2")
        assert result.allowed is False
        assert result.remaining == 0
        assert result.retry_after is not None
        assert result.retry_after > 0

    def test_reset_at_is_timezone_aware(self):
        limiter = make_limiter(5, 60, [[1, 4, 0, 0]])
        result = limiter.check("user:3")
        assert result.reset_at.tzinfo == timezone.utc

    def test_result_is_frozen(self):
        limiter = make_limiter(5, 60, [[1, 4, 0, 0]])
        result = limiter.check("user:4")
        with pytest.raises((AttributeError, TypeError)):
            result.allowed = False  # type: ignore


class TestConsume:
    def test_returns_result_when_allowed(self):
        limiter = make_limiter(5, 60, [[1, 4, 0, 0]])
        result = limiter.consume("user:5")
        assert isinstance(result, RateLimitResult)
        assert result.allowed is True

    def test_raises_when_limit_exceeded(self):
        import time
        now_ms = int(time.time() * 1000)
        oldest = now_ms - 30_000
        retry_after_ms = oldest + 60_000 - now_ms
        limiter = make_limiter(1, 60, [[0, 0, retry_after_ms, oldest]])
        with pytest.raises(RateLimitError):
            limiter.consume("user:6")

    def test_error_carries_metadata(self):
        import time
        now_ms = int(time.time() * 1000)
        oldest = now_ms - 30_000
        retry_after_ms = oldest + 60_000 - now_ms
        limiter = make_limiter(1, 60, [[0, 0, retry_after_ms, oldest]])
        with pytest.raises(RateLimitError) as exc_info:
            limiter.consume("user:7")
        err = exc_info.value
        assert err.retry_after > 0
        assert err.reset_at.tzinfo == timezone.utc
        assert err.limit == 1


class TestKeyPrefix:
    def test_custom_prefix_used_in_key(self):
        redis_mock = MagicMock()
        script_mock = MagicMock(return_value=[1, 4, 0, 0])
        redis_mock.register_script.return_value = script_mock

        limiter = SlidingWindowLimiter(redis_mock, limit=5, window=60, key_prefix="myapp")
        limiter.check("user:8")

        call_kwargs = script_mock.call_args
        assert call_kwargs.kwargs["keys"][0].startswith("myapp:")
