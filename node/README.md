# sliding-rate-limiter-redis

A Redis-backed **sliding window** rate limiter for Node.js.

[![npm](https://img.shields.io/npm/v/@aproothi/sliding-rate-limiter-redis)](https://www.npmjs.com/package/@aproothi/sliding-rate-limiter-redis)
[![Node.js CI](https://github.com/aproothi/sliding-rate-limiter-redis/actions/workflows/node-ci.yml/badge.svg)](https://github.com/aproothi/sliding-rate-limiter-redis/actions/workflows/node-ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://github.com/aproothi/sliding-rate-limiter-redis/blob/main/LICENSE)

## Why sliding window?

Most rate limiters use a fixed window (e.g. "100 requests per minute, resetting on the clock"). This creates a burst problem: a client can make 100 requests at 00:59 and another 100 at 01:00 — 200 requests in two seconds.

The **sliding window log** algorithm solves this by tracking the exact timestamp of every request in a Redis sorted set. Only requests within the last `window` seconds are counted, so the limit is enforced continuously rather than in discrete buckets.

All Redis operations execute atomically via a **Lua script**, so check-and-increment is race-condition free under high concurrency.

## Installation

```bash
npm install @aproothi/sliding-rate-limiter-redis ioredis
```

Requires `ioredis >= 5.0.0` and a running Redis instance.

## Quick start

```typescript
import Redis from 'ioredis';
import { SlidingWindowLimiter, RateLimitError } from '@aproothi/sliding-rate-limiter-redis';

const redis = new Redis();
const limiter = new SlidingWindowLimiter(redis, { limit: 100, window: 60 });

// Non-throwing: inspect the result yourself
const result = await limiter.check('user:42');
console.log(result);
// { allowed: true, remaining: 99, retryAfter: null, resetAt: Date, limit: 100 }

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

### Express middleware example

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

## API

### `new SlidingWindowLimiter(redis, options)`

| Parameter | Type | Description |
|-----------|------|-------------|
| `redis` | `Redis` (ioredis) | Connected ioredis client |
| `options.limit` | `number` | Maximum requests per window |
| `options.window` | `number` | Window duration in **seconds** |
| `options.keyPrefix` | `string` | Redis key prefix. Default: `"rl"` |

### `check(identifier) → Promise<RateLimitResult>`

Records the request and returns a result. Does **not** throw on limit exceeded.

### `consume(identifier) → Promise<RateLimitResult>`

Same as `check()` but throws `RateLimitError` if the limit is exceeded.

### `RateLimitResult`

| Field | Type | Description |
|-------|------|-------------|
| `allowed` | `boolean` | Whether the request was allowed |
| `remaining` | `number` | Requests remaining in the current window |
| `retryAfter` | `number \| null` | Seconds until next request allowed; `null` if allowed |
| `resetAt` | `Date` | When the current window resets |
| `limit` | `number` | The configured limit |

### `RateLimitError`

Thrown by `consume()` when the limit is exceeded. Carries `retryAfter`, `resetAt`, and `limit`.

## Full documentation

See the [GitHub repository](https://github.com/aproothi/sliding-rate-limiter-redis) for architecture details, Python package, benchmarks, and more.

## License

MIT
