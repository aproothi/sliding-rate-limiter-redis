import { jest } from '@jest/globals';
import RedisMock from 'ioredis-mock';
import { SlidingWindowLimiter, RateLimitError } from '../src/index.js';

function makeLimiter(limit: number, window: number) {
  const redis = new RedisMock();
  return new SlidingWindowLimiter(redis as any, { limit, window });
}

describe('SlidingWindowLimiter', () => {
  describe('check()', () => {
    it('allows requests within the limit', async () => {
      const limiter = makeLimiter(5, 60);
      const result = await limiter.check('user:1');
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(4);
      expect(result.limit).toBe(5);
      expect(result.retryAfter).toBeNull();
    });

    it('tracks remaining count correctly', async () => {
      const limiter = makeLimiter(3, 60);
      const r1 = await limiter.check('user:2');
      const r2 = await limiter.check('user:2');
      const r3 = await limiter.check('user:2');
      expect(r1.remaining).toBe(2);
      expect(r2.remaining).toBe(1);
      expect(r3.remaining).toBe(0);
    });

    it('blocks after limit is reached', async () => {
      const limiter = makeLimiter(2, 60);
      await limiter.check('user:3');
      await limiter.check('user:3');
      const result = await limiter.check('user:3');
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
      expect(result.retryAfter).toBeGreaterThan(0);
    });

    it('isolates different identifiers', async () => {
      const limiter = makeLimiter(1, 60);
      const r1 = await limiter.check('user:A');
      const r2 = await limiter.check('user:B');
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
    });

    it('returns a future resetAt date', async () => {
      const limiter = makeLimiter(5, 60);
      const before = Date.now();
      const result = await limiter.check('user:4');
      expect(result.resetAt.getTime()).toBeGreaterThan(before);
    });
  });

  describe('consume()', () => {
    it('returns result when allowed', async () => {
      const limiter = makeLimiter(5, 60);
      const result = await limiter.consume('user:5');
      expect(result.allowed).toBe(true);
    });

    it('throws RateLimitError when limit exceeded', async () => {
      const limiter = makeLimiter(1, 60);
      await limiter.consume('user:6');
      await expect(limiter.consume('user:6')).rejects.toThrow(RateLimitError);
    });

    it('RateLimitError carries retryAfter and resetAt', async () => {
      const limiter = makeLimiter(1, 60);
      await limiter.consume('user:7');
      try {
        await limiter.consume('user:7');
        fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RateLimitError);
        const rle = err as RateLimitError;
        expect(rle.retryAfter).toBeGreaterThan(0);
        expect(rle.resetAt).toBeInstanceOf(Date);
        expect(rle.limit).toBe(1);
      }
    });
  });

  describe('keyPrefix', () => {
    it('respects custom keyPrefix', async () => {
      const redis = new RedisMock();
      const limiter = new SlidingWindowLimiter(redis as any, {
        limit: 2,
        window: 60,
        keyPrefix: 'myapp',
      });
      await limiter.check('user:8');
      const keys = await redis.keys('*');
      expect(keys.some((k: string) => k.startsWith('myapp:'))).toBe(true);
    });
  });
});
