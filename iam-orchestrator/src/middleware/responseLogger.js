import { getLineNum } from '../utils/helpers.js';

/**
 * Log responses for debugging (specifically verify-otp responses).
 */
export function responseLogger(req, res, next) {
  const originalJson = res.json;
  res.json = function(data) {
    if (req.path === '/iam/activation/verify-otp') {
      console.log(`[RESPONSE] verify-otp response being sent ${getLineNum()}:`, JSON.stringify(data).substring(0, 200));
    }
    return originalJson.call(this, data);
  };
  next();
}
