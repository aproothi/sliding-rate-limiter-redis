export interface RateLimiterOptions {
  limit: number;
  window: number; // seconds
  keyPrefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfter: number | null; // seconds
  resetAt: Date;
  limit: number;
}

export class RateLimitError extends Error {
  readonly retryAfter: number;
  readonly resetAt: Date;
  readonly limit: number;

  constructor(retryAfter: number, resetAt: Date, limit: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s.`);
    this.name = 'RateLimitError';
    this.retryAfter = retryAfter;
    this.resetAt = resetAt;
    this.limit = limit;
  }
}
