import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
const env = {
  APP_MODE: 'live',
  DATABASE_URL: 'postgresql://localhost/db',
  REDIS_URL: 'redis://localhost',
  RABBITMQ_URL: 'amqp://localhost',
  SUPABASE_URL: 'https://example.supabase.co',
  PLAID_CLIENT_ID: 'client',
  PLAID_SECRET: 'secret',
  PLAID_WEBHOOK_URL: 'https://example.com/webhooks/plaid',
  OPENAI_API_KEY: 'test',
  AWS_KMS_KEY_ID: 'test-key',
  AUDIO_BUCKET: 'test-bucket',
  PII_TOKEN_KEY: 'a'.repeat(64),
  CHECKSUM_KEY: 'b'.repeat(64),
  PII_ANALYZER_URL: 'http://localhost:5002',
};
function start(overrides) {
  return spawnSync(
    process.execPath,
    ['--input-type=module', '-e', "await import('./services/api/src/config.js')"],
    { cwd: new URL('../../../', import.meta.url), env: { ...env, ...overrides }, encoding: 'utf8' },
  );
}
test('live configuration accepts a normal private PII analyzer URL', () =>
  assert.equal(start({}).status, 0));
test('demo cannot start in a production environment', () => {
  const r = start({ APP_MODE: 'demo', NODE_ENV: 'production' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Demo mode cannot/);
});
test('live startup fails closed when the privacy service is absent', () => {
  const r = start({ PII_ANALYZER_URL: '' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Missing PII_ANALYZER_URL/);
});
test('production refuses unencrypted cache or queue transport', () => {
  const r = start({ NODE_ENV: 'production', WEB_ORIGIN: 'https://example.com' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /must use TLS/);
});
