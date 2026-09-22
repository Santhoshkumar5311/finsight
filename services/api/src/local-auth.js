import { scrypt, randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { live } from './config.js';
const derive = promisify(scrypt);
const file =
  process.env.LOCAL_AUTH_FILE ||
  (process.env.DEMO_DATA_FILE
    ? `${process.env.DEMO_DATA_FILE}.auth`
    : fileURLToPath(new URL('../../../.data/local-auth.json', import.meta.url)));
const sessions = new Map();
const lifetime = 8 * 3600000,
  idleLimit = 30 * 60000;
const identity = (email) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
const digest = (token) => createHash('sha256').update(token).digest('hex');
const invalid = () => Object.assign(new Error('Email or password is incorrect'), { status: 401 });
export const credentialsSchema = z
  .object({ email: z.email().max(254), password: z.string().min(12).max(128) })
  .strict();
export async function localAccountExists() {
  if (live) return false;
  try {
    await readFile(file);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') return false;
    throw e;
  }
}
async function hash(password, salt) {
  return Buffer.from(
    await derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }),
  );
}
export async function createLocalAccount(input) {
  if (live) throw new Error('Local accounts are disabled in live mode');
  const { email, password } = credentialsSchema.parse(input);
  const salt = randomBytes(32).toString('hex');
  const passwordHash = (await hash(password, salt)).toString('hex');
  await mkdir(dirname(file), { recursive: true, mode: 0o700 });
  try {
    await writeFile(
      file,
      JSON.stringify({ version: 1, emailHash: identity(email), salt, passwordHash }),
      { flag: 'wx', mode: 0o600 },
    );
  } catch (e) {
    if (e.code === 'EEXIST')
      throw Object.assign(new Error('An account already exists. Sign in instead.'), {
        status: 409,
      });
    throw e;
  }
  return issueSession();
}
export async function loginLocal(input) {
  if (live) throw new Error('Local accounts are disabled in live mode');
  const { email, password } = credentialsSchema.parse(input);
  let account;
  try {
    account = JSON.parse(await readFile(file, 'utf8'));
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
  const actual = await hash(password, account?.salt || 'unconfigured-local-account');
  const expected = account ? Buffer.from(account.passwordHash, 'hex') : Buffer.alloc(64);
  if (
    !account ||
    expected.length !== actual.length ||
    !timingSafeEqual(actual, expected) ||
    identity(email) !== account.emailHash
  )
    throw invalid();
  return issueSession();
}
function issueSession() {
  for (const [key, session] of sessions)
    if (session.expiresAt <= Date.now() || session.lastSeen + idleLimit <= Date.now())
      sessions.delete(key);
  if (sessions.size >= 10) sessions.delete(sessions.keys().next().value);
  const token = randomBytes(32).toString('base64url'),
    now = Date.now();
  sessions.set(digest(token), { expiresAt: now + lifetime, lastSeen: now });
  return token;
}
export function cookieToken(header = '') {
  return header
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith('finsight_session='))
    ?.slice('finsight_session='.length);
}
export function authenticateLocal(token, touch = true) {
  const key = digest(token || ''),
    session = sessions.get(key),
    now = Date.now();
  if (!session || session.expiresAt <= now || session.lastSeen + idleLimit <= now) {
    sessions.delete(key);
    throw Object.assign(new Error('Sign in to continue'), { status: 401 });
  }
  if (touch) session.lastSeen = now;
  return {
    id: '00000000-0000-4000-8000-000000000001',
    aal: 'local',
    expiresAt: session.expiresAt,
    sessionId: key,
  };
}
export function revokeLocal(token) {
  sessions.delete(digest(token || ''));
}
export function sessionCookie(res, token = '') {
  res.cookie('finsight_session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: false,
    path: '/',
    maxAge: token ? lifetime : 0,
  });
}

export async function changeLocalPassword(input) {
  const { email, currentPassword, password } = z
    .object({
      email: z.email().max(254),
      currentPassword: z.string().min(1).max(128),
      password: z.string().min(12).max(128),
    })
    .strict()
    .parse(input);
  const check = await loginLocal({ email, password: currentPassword });
  revokeLocal(check);
  const salt = randomBytes(32).toString('hex');
  const passwordHash = (await hash(password, salt)).toString('hex');
  const { atomicPrivateWrite } = await import('./local-store.js');
  await atomicPrivateWrite(
    file,
    JSON.stringify({ version: 1, emailHash: identity(email), salt, passwordHash }),
  );
  sessions.clear();
  return issueSession();
}
