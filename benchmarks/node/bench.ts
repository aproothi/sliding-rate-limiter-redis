import Redis from 'ioredis';
import { SlidingWindowLimiter } from '../../node/src/index.js';

const ITERATIONS = 10_000;
const CONCURRENCY = 100;
const redis = new Redis();
const limiter = new SlidingWindowLimiter(redis, { limit: ITERATIONS * 2, window: 60 });

async function run() {
  console.log(`Benchmarking SlidingWindowLimiter — ${ITERATIONS} requests, concurrency ${CONCURRENCY}\n`);

  // Sequential
  const seqStart = performance.now();
  for (let i = 0; i < ITERATIONS; i++) {
    await limiter.check(`bench:seq:${i % 100}`);
  }
  const seqMs = performance.now() - seqStart;

  // Concurrent batches
  const conStart = performance.now();
  const batches = Math.ceil(ITERATIONS / CONCURRENCY);
  for (let b = 0; b < batches; b++) {
    const batch = Array.from({ length: CONCURRENCY }, (_, i) =>
      limiter.check(`bench:con:${(b * CONCURRENCY + i) % 100}`),
    );
    await Promise.all(batch);
  }
  const conMs = performance.now() - conStart;

  console.log(`Sequential  : ${seqMs.toFixed(1)}ms total | ${(seqMs / ITERATIONS).toFixed(3)}ms/op | ${Math.round(ITERATIONS / (seqMs / 1000))} ops/s`);
  console.log(`Concurrent  : ${conMs.toFixed(1)}ms total | ${(conMs / ITERATIONS).toFixed(3)}ms/op | ${Math.round(ITERATIONS / (conMs / 1000))} ops/s`);

  await redis.quit();
}

run().catch(console.error);
