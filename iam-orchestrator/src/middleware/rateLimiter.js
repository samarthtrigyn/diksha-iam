/**
 * Rate Limiting Middleware
 * Protects API from abuse with per-IP and per-user rate limits
 */

import rateLimit from 'express-rate-limit';

/**
 * Global rate limiter: 100 requests per 15 minutes per IP
 */
export const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'too_many_requests',
    errorDescription: 'Too many requests from this IP, please try again later',
    statusCode: 429
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/health';
  }
});

/**
 * Strict rate limiter: 5 requests per minute per IP
 * Used for sensitive endpoints (login, password reset, etc.)
 */
export const strictLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // limit each IP to 5 requests per minute
  message: {
    error: 'too_many_requests',
    errorDescription: 'Too many login attempts, please try again later',
    statusCode: 429
  },
  skipSuccessfulRequests: false, // Count all requests
  skipFailedRequests: false // Count failed attempts too (important for login)
});

/**
 * Very strict limiter: 3 requests per hour per IP
 * Used for OTP verification and password reset
 */
export const veryStrictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 3, // limit each IP to 3 requests per hour
  message: {
    error: 'too_many_requests',
    errorDescription: 'Too many attempts, please try again in 1 hour',
    statusCode: 429
  },
  skipSuccessfulRequests: false
});

/**
 * Redis-based rate limiter (for distributed systems)
 * Uses the same Redis instance as session store
 * Note: For distributed deployments, consider implementing RedisStore
 */
export function createRedisLimiter(windowMs = 15 * 60 * 1000, max = 100) {
  // Currently using memory store for simplicity
  // For production distributed systems, integrate rate-limit-redis
  return rateLimit({
    windowMs: windowMs,
    max: max,
    message: {
      error: 'too_many_requests',
      errorDescription: 'Too many requests, please try again later',
      statusCode: 429
    },
    standardHeaders: true,
    legacyHeaders: false
  });
}

export default {
  globalLimiter,
  strictLimiter,
  veryStrictLimiter,
  createRedisLimiter
};
