from __future__ import annotations

import time
import secrets
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from redis import Redis
from redis.client import Script

_SCRIPT = """
local key         = KEYS[1]
local now         = tonumber(ARGV[1])
local window_ms   = tonumber(ARGV[2])
local limit       = tonumber(ARGV[3])
local req_id      = ARGV[4]

local window_start = now - window_ms

redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start - 1)

local count = redis.call('ZCARD', key)

if count < limit then
  redis.call('ZADD', key, now, req_id)
  redis.call('PEXPIRE', key, window_ms)
  return {1, limit - count - 1, 0, 0}
else
  local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
  local oldest_score = tonumber(oldest[2])
  local retry_after_ms = oldest_score + window_ms - now
  return {0, 0, retry_after_ms, oldest_score}
end
"""


@dataclass(frozen=True)
class RateLimitResult:
    allowed: bool
    remaining: int
    retry_after: Optional[int]  # seconds, None if allowed
    reset_at: datetime
    limit: int


class RateLimitError(Exception):
    def __init__(self, retry_after: int, reset_at: datetime, limit: int) -> None:
        super().__init__(f"Rate limit exceeded. Retry after {retry_after}s.")
        self.retry_after = retry_after
        self.reset_at = reset_at
        self.limit = limit


class SlidingWindowLimiter:
    def __init__(
        self,
        redis: Redis,
        *,
        limit: int,
        window: int,
        key_prefix: str = "rl",
    ) -> None:
        self._redis = redis
        self._limit = limit
        self._window_ms = window * 1000
        self._key_prefix = key_prefix
        self._script: Script = redis.register_script(_SCRIPT)

    def _key(self, identifier: str) -> str:
        return f"{self._key_prefix}:{identifier}"

    def check(self, identifier: str) -> RateLimitResult:
        now_ms = int(time.time() * 1000)
        req_id = secrets.token_hex(8)

        result = self._script(
            keys=[self._key(identifier)],
            args=[str(now_ms), str(self._window_ms), str(self._limit), req_id],
        )

        allowed, remaining, retry_after_ms, oldest_score = (int(v) for v in result)

        if allowed:
            reset_at = datetime.fromtimestamp((now_ms + self._window_ms) / 1000, tz=timezone.utc)
        else:
            reset_at = datetime.fromtimestamp((oldest_score + self._window_ms) / 1000, tz=timezone.utc)

        return RateLimitResult(
            allowed=bool(allowed),
            remaining=remaining,
            retry_after=None if allowed else max(1, -(-retry_after_ms // 1000)),  # ceiling div
            reset_at=reset_at,
            limit=self._limit,
        )

    def consume(self, identifier: str) -> RateLimitResult:
        result = self.check(identifier)
        if not result.allowed:
            raise RateLimitError(result.retry_after, result.reset_at, self._limit)
        return result
