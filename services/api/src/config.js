import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';
dotenv.config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)), quiet: true });
export const config = {
  mode: process.env.APP_MODE || 'demo',
  port: Number(process.env.PORT || 4000),
  origin: process.env.WEB_ORIGIN || 'http://localhost:3000',
};
export const live = config.mode === 'live';
if (!['demo', 'live'].includes(config.mode)) throw new Error('APP_MODE must be demo or live');
if (process.env.NODE_ENV === 'production' && !live)
  throw new Error('Demo mode cannot run in production');
// The India Account Aggregator adapter is a local sandbox mock (see providers/india-aa.js);
// no real TSP/FIU integration exists, so it must never be reachable in a real deployment.
if (process.env.NODE_ENV === 'production' && process.env.AA_SANDBOX_ENABLED === 'true')
  throw new Error('AA_SANDBOX_ENABLED must not be true in production');
if (live)
  for (const key of [
    'DATABASE_URL',
    'REDIS_URL',
    'RABBITMQ_URL',
    'SUPABASE_URL',
    'PLAID_CLIENT_ID',
    'PLAID_SECRET',
    'PLAID_WEBHOOK_URL',
    'OPENAI_API_KEY',
    'AWS_KMS_KEY_ID',
    'AUDIO_BUCKET',
    'PII_TOKEN_KEY',
    'CHECKSUM_KEY',
    'PII_ANALYZER_URL',
  ])
    if (!process.env[key]) throw new Error(`Missing ${key}`);
if (live && ['PII_TOKEN_KEY', 'CHECKSUM_KEY'].some((k) => !/^[a-f0-9]{64}$/i.test(process.env[k])))
  throw new Error('HMAC keys must be at least 32 random bytes in hex');

if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535)
  throw new Error('Invalid PORT');
if (live && process.env.NODE_ENV === 'production') {
  for (const key of ['WEB_ORIGIN', 'SUPABASE_URL', 'PLAID_WEBHOOK_URL'])
    if (!process.env[key]?.startsWith('https://'))
      throw new Error(`${key} must use HTTPS in production`);
  if (
    !process.env.REDIS_URL.startsWith('rediss://') ||
    !process.env.RABBITMQ_URL.startsWith('amqps://')
  )
    throw new Error('Production cache and queue connections must use TLS');
}

if (!['api', 'worker'].includes(process.env.SERVICE_ROLE || 'api'))
  throw new Error('SERVICE_ROLE must be api or worker');
if (live && process.env.NODE_ENV === 'production') {
  for (const key of ['DATABASE_SSL_CA', 'AUDIT_BUCKET'])
    if (!process.env[key]) throw new Error(`Missing ${key}`);
  if (new URL(process.env.DATABASE_URL).searchParams.get('sslmode') === 'disable')
    throw new Error('Database TLS cannot be disabled');
  if (process.env.PII_TOKEN_KEY === process.env.CHECKSUM_KEY)
    throw new Error('PII and checksum keys must be independent');
}
