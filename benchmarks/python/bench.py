#!/usr/bin/env python3
"""Benchmark SlidingWindowLimiter against a local Redis instance."""
import time
import redis as redis_lib
from rate_limiter import SlidingWindowLimiter

ITERATIONS = 10_000

r = redis_lib.Redis()
limiter = SlidingWindowLimiter(r, limit=ITERATIONS * 2, window=60)

print(f"Benchmarking SlidingWindowLimiter — {ITERATIONS} sequential requests\n")

start = time.perf_counter()
for i in range(ITERATIONS):
    limiter.check(f"bench:{i % 100}")
elapsed = time.perf_counter() - start

per_op_ms = (elapsed / ITERATIONS) * 1000
ops_per_sec = int(ITERATIONS / elapsed)

print(f"Total   : {elapsed * 1000:.1f}ms")
print(f"Per op  : {per_op_ms:.3f}ms")
print(f"Ops/s   : {ops_per_sec}")
