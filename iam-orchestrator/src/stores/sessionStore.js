import { getRedisClient } from './redis.js';
import { getLineNum } from '../utils/helpers.js';

/**
 * Application session store
 * Pattern: session:{sessionId} → { iamUserId, username, accessToken, refreshToken, createdAt, expiresAt }
 * TTL: Configurable (default 24 hours)
 */
const sessionStore = {
  async get(sessionId) {
    try {
      const data = await getRedisClient().get(`session:${sessionId}`);
      return data ? JSON.parse(data) : null;
    } catch (err) {
      console.error(`[REDIS] Error getting session ${getLineNum()}:`, err.message);
      return null;
    }
  },

  async set(sessionId, value, ttlSeconds = 86400) {
    try {
      await getRedisClient().setEx(`session:${sessionId}`, ttlSeconds, JSON.stringify(value));
    } catch (err) {
      console.error(`[REDIS] Error setting session ${getLineNum()}:`, err.message);
    }
  },

  async delete(sessionId) {
    try {
      await getRedisClient().del(`session:${sessionId}`);
    } catch (err) {
      console.error(`[REDIS] Error deleting session ${getLineNum()}:`, err.message);
    }
  },

  async rotate(sessionId, newValue, ttlSeconds = 86400) {
    try {
      await this.delete(sessionId);
      await this.set(sessionId, newValue, ttlSeconds);
    } catch (err) {
      console.error(`[REDIS] Error rotating session ${getLineNum()}:`, err.message);
    }
  }
};

export default sessionStore;
