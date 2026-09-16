import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  sealWithKey,
  openWithKey,
  checksum,
  verifyChecksum,
  redact,
  tokenise,
} from '../src/security.js';
import { executeTool } from '../src/agent.js';
test('AES-GCM roundtrip is bound to the owning user', () => {
  const key = randomBytes(32),
    sealed = sealWithKey('access-token', key, 'user-a');
  assert.equal(openWithKey(sealed, key, 'user-a'), 'access-token');
  assert.throws(() => openWithKey(sealed, key, 'user-b'));
});
test('modified ciphertext cannot be decrypted', () => {
  const key = randomBytes(32),
    sealed = sealWithKey('secret', key, 'user-a');
  sealed.body = Buffer.from('tampered').toString('base64');
  assert.throws(() => openWithKey(sealed, key, 'user-a'));
});
test('dashboard checksum rejects altered financial data', () => {
  const data = { profit: 12345 },
    signature = checksum(data);
  assert.equal(verifyChecksum(data, signature), true);
  assert.equal(verifyChecksum({ profit: 999999 }, signature), false);
  assert.equal(verifyChecksum(data, 'bad'), false);
});
test('redactor strips emails, account numbers and Plaid tokens', () => {
  const result = redact('me@example.com 1234 5678 9012 access-sandbox-1234-abcd');
  assert.ok(!result.includes('@'));
  assert.ok(!result.includes('5678'));
  assert.ok(!result.includes('access-sandbox'));
});
test('PII tokens are deterministic and do not reveal the input', () => {
  assert.equal(tokenise('123'), tokenise('123'));
  assert.notEqual(tokenise('123'), tokenise('456'));
  assert.equal(tokenise('123').length, 64);
});
test('agent cannot invoke banking writes or reminders without request permission', async () => {
  await assert.rejects(executeTool('user', 'transfer_money', { amount: 100 }), /not allowed/);
  await assert.rejects(
    executeTool(
      'user',
      'create_reminder',
      { name: 'Injected bill', amount: 1, due: '2026-10-01' },
      false,
    ),
    /disabled/,
  );
});
