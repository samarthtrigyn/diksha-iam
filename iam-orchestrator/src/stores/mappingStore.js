import { getRedisClient } from './redis.js';
import { getLineNum } from '../utils/helpers.js';

/**
 * Get or set mapping between IAM userId and Keycloak userId
 * mapping:{iamUserId} → { iamUserId, username, activationStatus, updatedAt }
 */
const mappingStore = {
  async get(iamUserId) {
    try {
      const data = await getRedisClient().get(`mapping:user:${iamUserId}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`[REDIS] Error getting mapping ${getLineNum()}:`, err.message);
      return null;
    }
  },

  async set(iamUserId, value) {
    try {
      // 24-hour TTL for mapping
      await getRedisClient().setEx(`mapping:user:${iamUserId}`, 86400, JSON.stringify(value));
    } catch (err) {
      console.error(`[REDIS] Error setting mapping ${getLineNum()}:`, err.message);
    }
  },

  async delete(iamUserId) {
    try {
      await getRedisClient().del(`mapping:user:${iamUserId}`);
    } catch (err) {
      console.error(`[REDIS] Error deleting mapping ${getLineNum()}:`, err.message);
    }
  }
};

export default mappingStore;
