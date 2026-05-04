import redis
from rate_limiter import SlidingWindowLimiter, RateLimitError

r = redis.Redis(host='127.0.0.1', port=6379)
limiter = SlidingWindowLimiter(r, limit=5, window=10)

user = 'user:demo-py'

print('Limit: 5 requests per 10 seconds\n')

for i in range(1, 8):
    try:
        result = limiter.consume(user)
        print(f'Request {i}: allowed=True  remaining={result.remaining}  resetAt={result.reset_at.isoformat()}')
    except RateLimitError as e:
        print(f'Request {i}: allowed=False retryAfter={e.retry_after}s')
