import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import { plaid, verifyWebhook } from '../src/plaid.js';
const { privateKey, publicKey } = await generateKeyPair('ES256');
const jwk = await exportJWK(publicKey);
plaid.webhookVerificationKeyGet = async () => ({ data: { key: jwk } });
const raw = Buffer.from('{"webhook_type":"TRANSACTIONS","item_id":"item-1"}');
async function sign(body = raw, iat = Math.floor(Date.now() / 1000)) {
  return new SignJWT({ request_body_sha256: createHash('sha256').update(body).digest('hex') })
    .setProtectedHeader({ alg: 'ES256', kid: 'test-key' })
    .setIssuedAt(iat)
    .sign(privateKey);
}
test('accepts a recent ES256 webhook with matching raw body checksum', async () =>
  assert.equal((await verifyWebhook(raw, await sign())).length, 64));
test('rejects a webhook with altered body bytes', async () =>
  assert.rejects(verifyWebhook(Buffer.from(raw.toString() + ' '), await sign()), /mismatch/));
test('rejects stale and future-dated webhook signatures', async () => {
  await assert.rejects(verifyWebhook(raw, await sign(raw, Math.floor(Date.now() / 1000) - 400)));
  await assert.rejects(verifyWebhook(raw, await sign(raw, Math.floor(Date.now() / 1000) + 60)));
});
test('rejects unsigned webhooks', async () => assert.rejects(verifyWebhook(raw, null), /Missing/));
