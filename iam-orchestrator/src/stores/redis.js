import { createClient } from 'redis';
import { REDIS_URL } from '../config/index.js';
import { getLineNum } from '../utils/helpers.js';

let redisClient;

/**
 * Initialize and connect the Redis client.
 */
export async function initRedis() {
  redisClient = createClient({ url: REDIS_URL });

  redisClient.on('error', (err) => console.error(`[REDIS] Client error ${getLineNum()}:`, err));
  redisClient.on('connect', () => console.log(`[REDIS] Connected to Redis ${getLineNum()}`));
  redisClient.on('ready', () => console.log(`[REDIS] Redis client ready ${getLineNum()}`));

  try {
    await redisClient.connect();
  } catch (err) {
    console.error(`[REDIS] Failed to connect ${getLineNum()}:`, err.message);
    throw err;
  }
}

/**
 * Return the connected Redis client instance.
 */
export function getRedisClient() {
  return redisClient;
}
