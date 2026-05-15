/**
 * Session Code Store
 * Temporary single-use codes for mobile/third-party clients to exchange for tokens.
 * Pattern: sessionCode:{code} → { sessionId, iamUserId, username, clientId, used, expiresAt }
 * TTL: 5 minutes
 */

import crypto from 'crypto';
import { getRedisClient } from './redis.js';

const SESSION_CODE_TTL = 5 * 60; // 5 minutes in seconds
const SESSION_CODE_PREFIX = 'sessionCode:';

/**
 * Generate a random session code.
 * @returns {string} - Random alphanumeric code
 */
function generateSessionCode() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Store a session code.
 * @param {string} code - The session code
 * @param {Object} data - { sessionId, iamUserId, username, clientId }
 * @returns {Promise<void>}
 */
async function set(code, data) {
  const client = getRedisClient();
  const key = `${SESSION_CODE_PREFIX}${code}`;
  const value = JSON.stringify({
    ...data,
    used: false,
    expiresAt: Date.now() + SESSION_CODE_TTL * 1000,
  });

  await client.setex(key, SESSION_CODE_TTL, value);
}

/**
 * Retrieve a session code.
 * @param {string} code - The session code
 * @returns {Promise<Object|null>} - Session code data or null
 */
async function get(code) {
  const client = getRedisClient();
  const key = `${SESSION_CODE_PREFIX}${code}`;
  const value = await client.get(key);

  if (!value) return null;

  const data = JSON.parse(value);

  // Check if expired
  if (Date.now() > data.expiresAt) {
    await delete_session_code(code); // Clean up
    return null;
  }

  return data;
}

/**
 * Mark a session code as used (consumed in a token exchange).
 * @param {string} code - The session code
 * @returns {Promise<boolean>} - true if marked, false if already used
 */
async function markUsed(code) {
  const client = getRedisClient();
  const key = `${SESSION_CODE_PREFIX}${code}`;
  const data = await get(code);

  if (!data) return false;
  if (data.used) return false;

  data.used = true;
  const value = JSON.stringify(data);
  await client.setex(key, SESSION_CODE_TTL, value);

  return true;
}

/**
 * Delete a session code.
 * @param {string} code - The session code
 * @returns {Promise<void>}
 */
async function delete_session_code(code) {
  const client = getRedisClient();
  const key = `${SESSION_CODE_PREFIX}${code}`;
  await client.del(key);
}

export { generateSessionCode, set, get, markUsed };
export { delete_session_code as delete };

export default {
  generateSessionCode,
  set,
  get,
  markUsed,
  delete: delete_session_code,
};
