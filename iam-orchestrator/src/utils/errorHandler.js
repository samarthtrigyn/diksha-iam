/**
 * Centralized Error Response Handler
 * Standardizes all error responses across the application
 * 
 * Usage:
 *   - res.status(400).json(formatError('invalid_request', 'Missing identifier', 400))
 *   - throw new ApiError('unauthorized', 'Invalid token', 401)
 */

export class ApiError extends Error {
  constructor(code, message, statusCode = 500) {
    super(message);
    this.code = code;
    this.statusCode = statusCode;
  }
}

/**
 * Format error response
 * @param {string} code - Error code (e.g., 'invalid_request', 'unauthorized')
 * @param {string} description - Human-readable error message
 * @param {number} statusCode - HTTP status code
 * @returns {object} Standardized error response
 */
export function formatError(code, description, statusCode = 500) {
  return {
    error: code,
    errorDescription: description,
    statusCode: statusCode,
    timestamp: new Date().toISOString()
  };
}

/**
 * Global error handler middleware
 * Should be registered LAST in app.js
 */
export function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Handle custom ApiError
  if (err instanceof ApiError) {
    return res.status(err.statusCode).json(
      formatError(err.code, err.message, err.statusCode)
    );
  }

  // Handle validation errors
  if (err.name === 'ValidationError') {
    return res.status(400).json(
      formatError('invalid_request', err.message, 400)
    );
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json(
      formatError('invalid_token', 'Invalid or expired token', 401)
    );
  }

  // Handle MongoDB/DB errors
  if (err.name === 'CastError' || err.message.includes('database')) {
    return res.status(500).json(
      formatError('internal_error', 'Database error occurred', 500)
    );
  }

  // Handle Keycloak errors
  if (err.message.includes('Keycloak') || err.message.includes('OIDC')) {
    return res.status(502).json(
      formatError('provider_error', 'Authentication provider error', 502)
    );
  }

  // Default error response
  const statusCode = err.statusCode || 500;
  const errorCode = err.code || 'internal_error';
  const message = err.message || 'An unexpected error occurred';

  res.status(statusCode).json(
    formatError(errorCode, message, statusCode)
  );
}

/**
 * Async route wrapper to catch errors
 * Usage: router.post('/endpoint', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
