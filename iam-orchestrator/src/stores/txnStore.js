import { getRedisClient } from './redis.js';
import { getLineNum } from '../utils/helpers.js';

/**
 * Store transaction data indexed by txnId
 * txn:{txnId} → { identifier, iamUserId, codeVerifier, codeChallenge, redirectUri, clientId, expiresAt }
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
