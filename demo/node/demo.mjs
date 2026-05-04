import Redis from 'ioredis';
import { SlidingWindowLimiter, RateLimitError } from '@aproothi/sliding-rate-limiter-redis';

const redis = new Redis({ host: '127.0.0.1', port: 6379 });
const limiter = new SlidingWindowLimiter(redis, { limit: 5, window: 10 });

const user = 'user:demo';

console.log('Limit: 5 requests per 10 seconds\n');

for (let i = 1; i <= 7; i++) {
  try {
    const result = await limiter.consume(user);
    console.log(`Request ${i}: allowed=true  remaining=${result.remaining}  resetAt=${result.resetAt.toISOString()}`);
  } catch (err) {
    if (err instanceof RateLimitError) {
      console.log(`Request ${i}: allowed=false retryAfter=${err.retryAfter}s`);
    } else {
      throw err;
    }
  }
}

await redis.quit();
