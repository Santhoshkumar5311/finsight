import { createClient } from 'redis';
import { live } from './config.js';
let cache;
export async function initSessionCache() {
  if (!live) return;
  cache = createClient({ url: process.env.REDIS_URL });
  cache.on('error', () => console.error('Security cache unavailable'));
  await cache.connect();
}
export async function isRevoked(id) {
  if (!live) return false;
  if (!cache?.isReady)
    throw Object.assign(new Error('Authentication service unavailable'), { status: 503 });
  return !!(await cache.get(`revoked:${id}`));
}
export async function revokeSession(id) {
  await cache.set(`revoked:${id}`, '1', { EX: 86400 });
}
export async function userRateLimit(user, scope, limit, seconds) {
  if (!live) return true;
  const count = await cache.eval(
    "local n = redis.call('INCR', KEYS[1]); if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end; return n",
    { keys: [`rate:${scope}:${user}`], arguments: [String(seconds)] },
  );
  return Number(count) <= limit;
}
export async function securityReady() {
  return !live || (cache?.isReady && (await cache.ping()) === 'PONG');
}
export async function closeSessionCache() {
  if (cache?.isOpen) await cache.quit();
}
