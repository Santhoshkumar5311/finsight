import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, SignJWT } from 'jose';
import { verifyBankingToken } from '../src/jwt-auth.js';
const { privateKey, publicKey } = await generateKeyPair('ES256');
const issuer = 'https://test.supabase.co/auth/v1';
const user = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
async function signed(overrides = {}, options = {}) {
  return new SignJWT({
    sub: user,
    role: 'authenticated',
    aal: 'aal2',
    session_id: 'session-1',
    ...overrides,
  })
    .setProtectedHeader({ alg: 'ES256' })
    .setIssuer(options.issuer || issuer)
    .setAudience(options.audience || 'authenticated')
    .setExpirationTime(options.exp || '5m')
    .sign(privateKey);
}
const verify = (token, revoked = async () => false) =>
  verifyBankingToken(token, publicKey, { issuer, revoked });
test('live JWT accepts a signed MFA session and returns its owner', async () =>
  assert.equal((await verify(await signed())).id, user));
test('live JWT rejects wrong issuer, audience, expiry, role and missing session id', async () => {
  for (const token of [
    await signed({}, { issuer: 'https://attacker.example' }),
    await signed({}, { audience: 'anon' }),
    await signed({}, { exp: '-1m' }),
    await signed({ role: 'service_role' }),
    await signed({ session_id: undefined }),
  ])
    await assert.rejects(verify(token), (e) => e.status === 401);
});
test('live JWT requires MFA and checks server-side logout revocation', async () => {
  await assert.rejects(verify(await signed({ aal: 'aal1' })), (e) => e.status === 403);
  await assert.rejects(
    verify(await signed(), async () => true),
    (e) => e.status === 401,
  );
});
test('live JWT fails closed when revocation service is unavailable', async () => {
  await assert.rejects(
    verify(await signed(), async () => {
      throw Object.assign(new Error('Unavailable'), { status: 503 });
    }),
    (e) => e.status === 503,
  );
});
