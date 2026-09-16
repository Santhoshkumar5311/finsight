import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  createHmac,
  timingSafeEqual,
} from 'node:crypto';
import { KMSClient, GenerateDataKeyCommand, DecryptCommand } from '@aws-sdk/client-kms';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { live } from './config.js';
export const DEMO_USER = '00000000-0000-4000-8000-000000000001';
const kms = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const jwks = live
  ? createRemoteJWKSet(new URL(process.env.SUPABASE_URL + '/auth/v1/.well-known/jwks.json'))
  : null;
export async function authenticate(token) {
  if (!live) return { id: DEMO_USER, aal: 'demo' };
  if (!token) throw Object.assign(new Error('Sign in to continue'), { status: 401 });
  try {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: process.env.SUPABASE_URL + '/auth/v1',
      audience: process.env.SUPABASE_JWT_AUDIENCE || 'authenticated',
      algorithms: ['ES256', 'RS256'],
    });
    if (!payload.sub || typeof payload.exp !== 'number' || payload.role !== 'authenticated')
      throw new Error('Invalid user');
    if (payload.aal !== 'aal2')
      throw Object.assign(new Error('Complete TOTP verification'), { status: 403 });
    return { id: payload.sub, aal: payload.aal, expiresAt: payload.exp * 1000 };
  } catch (e) {
    if (e.status) throw e;
    throw Object.assign(new Error('Session expired or invalid'), { status: 401 });
  }
}
export function tokenise(value) {
  return createHmac('sha256', process.env.PII_TOKEN_KEY || 'demo-only-not-a-production-key')
    .update(value)
    .digest('hex');
}
export function redact(text = '') {
  return text
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\b(?:\d[ -]?){7,19}\b/g, '[number]')
    .replace(
      /\b(?:access|public|link)-(?:production|sandbox|development)-[\w-]+/gi,
      '[credential]',
    );
}
export function checksum(value) {
  return createHmac('sha256', process.env.CHECKSUM_KEY || 'demo-only-checksum')
    .update(JSON.stringify(value))
    .digest('hex');
}
export function verifyChecksum(value, signature) {
  const expected = Buffer.from(checksum(value));
  const actual = Buffer.from(signature || '');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
export function sealWithKey(text, key, context) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(context));
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    body: body.toString('base64'),
  };
}
export function openWithKey(value, key, context) {
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAAD(Buffer.from(context));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.body, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}
export async function encryptSecret(secret, userId) {
  const context = { userId, purpose: 'plaid-token' };
  const result = await kms.send(
    new GenerateDataKeyCommand({
      KeyId: process.env.AWS_KMS_KEY_ID,
      KeySpec: 'AES_256',
      EncryptionContext: context,
    }),
  );
  const key = Buffer.from(result.Plaintext);
  try {
    return {
      ...sealWithKey(secret, key, userId),
      key: Buffer.from(result.CiphertextBlob).toString('base64'),
    };
  } finally {
    key.fill(0);
    result.Plaintext.fill(0);
  }
}
export async function decryptSecret(value, userId) {
  const result = await kms.send(
    new DecryptCommand({
      CiphertextBlob: Buffer.from(value.key, 'base64'),
      EncryptionContext: { userId, purpose: 'plaid-token' },
    }),
  );
  const key = Buffer.from(result.Plaintext);
  try {
    return openWithKey(value, key, userId);
  } finally {
    key.fill(0);
    result.Plaintext.fill(0);
  }
}
