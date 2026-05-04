import type { Redis } from 'ioredis';
import { randomBytes } from 'crypto';
import type { RateLimiterOptions, RateLimitResult } from './types.js';
import { RateLimitError } from './types.js';

// Atomically: remove expired entries, count, conditionally add new entry.
// Returns [allowed (0|1), remaining, retry_after_ms, oldest_score]
const SLIDING_WINDOW_SCRIPT = `
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
`;

export class SlidingWindowLimiter {
  private readonly redis: Redis;
  private readonly limit: number;
  private readonly windowMs: number;
  private readonly keyPrefix: string;

  constructor(redis: Redis, options: RateLimiterOptions) {
    this.redis = redis;
    this.limit = options.limit;
    this.windowMs = options.window * 1000;
    this.keyPrefix = options.keyPrefix ?? 'rl';
  }

  private key(identifier: string): string {
    return `${this.keyPrefix}:${identifier}`;
  }

  async check(identifier: string): Promise<RateLimitResult> {
    const now = Date.now();
    const reqId = randomBytes(8).toString('hex');

    const result = (await this.redis.eval(
      SLIDING_WINDOW_SCRIPT,
      1,
      this.key(identifier),
      String(now),
      String(this.windowMs),
      String(this.limit),
      reqId,
    )) as [number, number, number, number];

    const [allowed, remaining, retryAfterMs, oldestScore] = result;

    const resetAt = allowed
      ? new Date(now + this.windowMs)
      : new Date(oldestScore + this.windowMs);

    return {
      allowed: allowed === 1,
      remaining,
      retryAfter: retryAfterMs > 0 ? Math.ceil(retryAfterMs / 1000) : null,
      resetAt,
      limit: this.limit,
    };
  }

  async consume(identifier: string): Promise<RateLimitResult> {
    const result = await this.check(identifier);
    if (!result.allowed) {
      throw new RateLimitError(result.retryAfter!, result.resetAt, this.limit);
    }
    return result;
  }
}
