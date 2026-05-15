import { getRedisClient } from './redis.js';
import { getLineNum } from '../utils/helpers.js';

/**
 * Store state data indexed by state (generated at authorize time, not loginInit time)
 * state:{state} → { txnId, expiresAt }
 * Simplified from old schema that stored full PKCE data.
 * PKCE verifier/nonce/activationToken now stored in txnStore, retrieved via txnId.
 * TTL: 10 minutes
 */
const stateStore = {
  async get(state) {
    try {
      const data = await getRedisClient().get(`state:${state}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`[REDIS] Error getting state ${getLineNum()}:`, err.message);
      return null;
    }
  },

  async set(state, value) {
    try {
      // 10-minute TTL for state
      await getRedisClient().setEx(`state:${state}`, 600, JSON.stringify(value));
    } catch (err) {
      console.error(`[REDIS] Error setting state ${getLineNum()}:`, err.message);
    }
  },

  async delete(state) {
    try {
      await getRedisClient().del(`state:${state}`);
    } catch (err) {
      console.error(`[REDIS] Error deleting state ${getLineNum()}:`, err.message);
    }
  }
};

export default stateStore;
