import { getRedisClient } from './redis.js';
import { getLineNum } from '../utils/helpers.js';

/**
 * Store transaction data indexed by txnId
 * txn:{txnId} → {
 *   identifier, iamUserId, username,
 *   flow: 'ACTIVE_USER' | 'FIRST_TIME_USER',
 *   status: 'OTP_SENT' | 'OTP_VERIFIED' | 'LOGIN_ALLOWED' | 'IAM_AUTHORIZE_READY' | 'IAM_SESSION_CREATED' | 'COMPLETED',
 *   clientId, redirectUri, channel: 'WEB' | 'MOBILE',
 *   codeVerifier, codeChallenge, nonce,
 *   activationToken (for first-time users),
 *   expiresAt
 * }
 * TTL: 10 minutes
 */
const txnStore = {
  async get(txnId) {
    try {
      const data = await getRedisClient().get(`txn:${txnId}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`[REDIS] Error getting txn ${getLineNum()}:`, err.message);
      return null;
    }
  },

  async set(txnId, value) {
    try {
      // 10-minute TTL for transactions
      await getRedisClient().setEx(`txn:${txnId}`, 600, JSON.stringify(value));
    } catch (err) {
      console.error(`[REDIS] Error setting txn ${getLineNum()}:`, err.message);
    }
  },

  async delete(txnId) {
    try {
      await getRedisClient().del(`txn:${txnId}`);
    } catch (err) {
      console.error(`[REDIS] Error deleting txn ${getLineNum()}:`, err.message);
    }
  }
};

export default txnStore;
