import Redis from 'ioredis';
import { config } from './config';

const redis = new Redis({
  host: config.redis.host,
  port: config.redis.port,
  keyPrefix: config.redis.keyPrefix,
  lazyConnect: true,
  maxRetriesPerRequest: 0,
  retryStrategy(times) {
    if (times > 3) return null;
    return Math.min(times * 200, 2000);
  },
});

redis.on('error', (err) => {
  console.warn('Redis connection error (IP cache degraded):', (err as Error).message);
});

let connected = false;
redis.connect().then(() => {
  connected = true;
  console.log('Redis connected for IP caching');
}).catch(() => {
  console.warn('Redis unavailable — IP caching will use in-memory fallback');
});

export function isRedisConnected(): boolean {
  return connected;
}

export default redis;