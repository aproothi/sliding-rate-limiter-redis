# rate-limiter

A Redis-backed **sliding window** rate limiter available as both an NPM package and a PyPI package.

[![Node.js CI](https://github.com/aproothi/rate-limiter/actions/workflows/node-ci.yml/badge.svg)](https://github.com/aproothi/rate-limiter/actions/workflows/node-ci.yml)
[![Python CI](https://github.com/aproothi/rate-limiter/actions/workflows/python-ci.yml/badge.svg)](https://github.com/aproothi/rate-limiter/actions/workflows/python-ci.yml)
[![npm](https://img.shields.io/npm/v/@aproothi/sliding-rate-limiter-redis)](https://www.npmjs.com/package/@aproothi/sliding-rate-limiter-redis)
[![PyPI](https://img.shields.io/pypi/v/sliding-rate-limiter-redis)](https://pypi.org/project/sliding-rate-limiter-redis)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Why sliding window?

Most rate limiters use a **fixed window** (e.g. "100 requests per minute, resetting on the clock"). This creates a burst problem: a client can make 100 requests at 00:59 and another 100 at 01:00 — 200 requests in two seconds.

The **sliding window log** algorithm solves this by tracking the exact timestamp of every request in a Redis sorted set. Only requests within the last `window` seconds are counted, so the limit is enforced continuously rather than in discrete buckets.

All Redis operations are executed atomically via a **Lua script**, so the check-and-increment is race-condition free even under high concurrency.

## Architecture

```
check(identifier)
  │
  └─► Redis EVAL (Lua)
        ├── ZREMRANGEBYSCORE  remove expired entries
        ├── ZCARD             count active entries
        ├── ZADD (if allowed) record this request
        └── PEXPIRE           auto-cleanup key
```

## Quick start

### Node.js

```bash
npm install @aproothi/sliding-rate-limiter-redis ioredis
```

```typescript
import Redis from 'ioredis';
import { SlidingWindowLimiter, RateLimitError } from '@aproothi/sliding-rate-limiter-redis';

const redis = new Redis();
const limiter = new SlidingWindowLimiter(redis, {
  limit: 100,      // max requests
  window: 60,      // per 60 seconds
  keyPrefix: 'rl', // optional Redis key prefix
});

// Non-throwing: inspect the result yourself
const result = await limiter.check('user:42');
console.log(result);
// {
//   allowed: true,
//   remaining: 99,
//   retryAfter: null,
//   resetAt: Date,
//   limit: 100,
// }

// Throwing: raises RateLimitError if the limit is exceeded
try {
  await limiter.consume('user:42');
} catch (err) {
  if (err instanceof RateLimitError) {
    res.set('Retry-After', String(err.retryAfter));
    res.status(429).json({ error: 'Too Many Requests' });
  }
}
```

#### Express middleware example

```typescript
function rateLimitMiddleware(limiter: SlidingWindowLimiter) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await limiter.consume(req.ip ?? 'unknown');
      res.set('X-RateLimit-Limit', String(result.limit));
      res.set('X-RateLimit-Remaining', String(result.remaining));
      res.set('X-RateLimit-Reset', String(Math.floor(result.resetAt.getTime() / 1000)));
      next();
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.set('Retry-After', String(err.retryAfter));
        res.status(429).json({ error: 'Too Many Requests' });
      } else {
        next(err);
      }
    }
  };
}
```

### Python

```bash
pip install sliding-rate-limiter-redis
```

```python
import redis
from rate_limiter import SlidingWindowLimiter, RateLimitError

r = redis.Redis()
limiter = SlidingWindowLimiter(r, limit=100, window=60, key_prefix="rl")

# Non-throwing
result = limiter.check("user:42")
print(result)
# RateLimitResult(allowed=True, remaining=99, retry_after=None, reset_at=..., limit=100)

# Throwing
try:
    limiter.consume("user:42")
except RateLimitError as e:
    print(f"Rate limited. Retry after {e.retry_after}s")
```

#### FastAPI middleware example

```python
from fastapi import Request, Response
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

## API reference

### `SlidingWindowLimiter`

| Parameter | Type | Description |
|-----------|------|-------------|
| `redis` | `Redis` (ioredis) / `Redis` (redis-py) | Connected Redis client |
| `limit` | `number` / `int` | Maximum requests per window |
| `window` | `number` / `int` | Window duration in **seconds** |
| `keyPrefix` / `key_prefix` | `string` (optional) | Redis key prefix. Default: `"rl"` |

### `check(identifier)` → `RateLimitResult`

Checks whether the identifier is within the rate limit. **Always records the request** (use this when you want to count the request regardless of response, e.g. for analytics).

### `consume(identifier)` → `RateLimitResult` or throws `RateLimitError`

Same as `check()` but throws / raises if the limit is exceeded. Use this in request handlers.

### `RateLimitResult`

| Field | Type | Description |
|-------|------|-------------|
| `allowed` | `boolean` | Whether the request was allowed |
| `remaining` | `number` | Requests remaining in the current window |
| `retryAfter` / `retry_after` | `number \| null` | Seconds until the next request will be allowed |
| `resetAt` / `reset_at` | `Date` / `datetime` | When the current window resets |
| `limit` | `number` | The configured limit |

### `RateLimitError`

Thrown by `consume()` when the limit is exceeded. Carries `retryAfter`, `resetAt`, and `limit`.

## Benchmarks

Run against a local Redis instance:

```bash
# Node.js
cd node && npm run bench

# Python
cd python && python ../benchmarks/python/bench.py
```

Sample results (MacBook Pro M2, Redis 7, local socket):

```
Node.js  sequential : ~0.15ms/op  ~6,500 ops/s
Node.js  concurrent : ~0.04ms/op ~25,000 ops/s
Python   sequential : ~0.20ms/op  ~5,000 ops/s
```

## Development

```bash
# Node.js
cd node
npm install
npm test
npm run build

# Python
cd python
pip install -e ".[dev]"
pytest -v
```

## License

MIT
