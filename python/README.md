# sliding-rate-limiter-redis

A Redis-backed **sliding window** rate limiter for Python.

[![PyPI](https://img.shields.io/pypi/v/sliding-rate-limiter-redis)](https://pypi.org/project/sliding-rate-limiter-redis)
[![Python CI](https://github.com/aproothi/rate-limiter/actions/workflows/python-ci.yml/badge.svg)](https://github.com/aproothi/rate-limiter/actions/workflows/python-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/aproothi/rate-limiter/blob/main/LICENSE)

## Why sliding window?

Most rate limiters use a fixed window (e.g. "100 requests per minute, resetting on the clock"). This creates a burst problem: a client can make 100 requests at 00:59 and another 100 at 01:00 — 200 requests in two seconds.

The **sliding window log** algorithm solves this by tracking the exact timestamp of every request in a Redis sorted set. Only requests within the last `window` seconds are counted, so the limit is enforced continuously rather than in discrete buckets.

All Redis operations execute atomically via a **Lua script**, so check-and-increment is race-condition free under high concurrency.

## Installation

```bash
pip install sliding-rate-limiter-redis
```

Requires `redis-py >= 4.0.0` and a running Redis instance.

## Quick start

```python
import redis
from rate_limiter import SlidingWindowLimiter, RateLimitError

r = redis.Redis()
limiter = SlidingWindowLimiter(r, limit=100, window=60, key_prefix="rl")

# Non-throwing: inspect the result yourself
result = limiter.check("user:42")
print(result)
# RateLimitResult(allowed=True, remaining=99, retry_after=None, reset_at=..., limit=100)

# Throwing: raises RateLimitError if the limit is exceeded
try:
    limiter.consume("user:42")
except RateLimitError as e:
    print(f"Rate limited. Retry after {e.retry_after}s")
```

### FastAPI middleware example

```python
from fastapi import Request
from fastapi.responses import JSONResponse

@app.middleware("http")
async def rate_limit(request: Request, call_next):
    try:
        result = limiter.consume(request.client.host)
        response = await call_next(request)
        response.headers["X-RateLimit-Remaining"] = str(result.remaining)
        return response
    except RateLimitError as e:
        return JSONResponse(
            status_code=429,
            content={"error": "Too Many Requests"},
            headers={"Retry-After": str(e.retry_after)},
        )
```

## API

### `SlidingWindowLimiter(redis, *, limit, window, key_prefix="rl")`

| Parameter | Type | Description |
|-----------|------|-------------|
| `redis` | `redis.Redis` | Connected redis-py client |
| `limit` | `int` | Maximum requests per window |
| `window` | `int` | Window duration in **seconds** |
| `key_prefix` | `str` | Redis key prefix. Default: `"rl"` |

### `check(identifier) → RateLimitResult`

Records the request and returns a result. Does **not** raise on limit exceeded.

### `consume(identifier) → RateLimitResult`

Same as `check()` but raises `RateLimitError` if the limit is exceeded.

### `RateLimitResult`

| Field | Type | Description |
|-------|------|-------------|
| `allowed` | `bool` | Whether the request was allowed |
| `remaining` | `int` | Requests remaining in the current window |
| `retry_after` | `int \| None` | Seconds until next request allowed; `None` if allowed |
| `reset_at` | `datetime` | UTC datetime when the window resets |
| `limit` | `int` | The configured limit |

### `RateLimitError`

Raised by `consume()` when the limit is exceeded. Carries `retry_after`, `reset_at`, and `limit`.

## Full documentation

See the [GitHub repository](https://github.com/aproothi/rate-limiter) for architecture details, Node.js package, benchmarks, and more.

## License

MIT
