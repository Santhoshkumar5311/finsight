import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, unlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localStore } from '../src/local-store.js';
import { encryptBackup, decryptBackup } from '../../../scripts/backup.mjs';
const data = {
  accounts: [],
  transactions: [],
  bills: [],
  budgets: [],
  diaries: [{ transcript: 'private reflection' }],
  preferences: {},
};
async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'finsight-crypto-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return join(dir, 'demo.json');
}
test('local diary is encrypted, owner-only, and survives reopening', async (t) => {
  const path = await fixture(t),
    store = await localStore(path);
  await store.write(data);
  assert.ok(!(await readFile(path, 'utf8')).includes('private reflection'));
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.equal((await stat(path + '.key')).mode & 0o777, 0o600);
  assert.deepEqual(await (await localStore(path)).read(), data);
});
test('existing plaintext diary upgrades without data loss', async (t) => {
  const path = await fixture(t);
  await writeFile(path, JSON.stringify(data));
  assert.deepEqual(await (await localStore(path)).read(), data);
  assert.ok(!(await readFile(path, 'utf8')).includes('private reflection'));
});
test('tampered storage and missing keys fail closed without reseeding', async (t) => {
  const path = await fixture(t),
    store = await localStore(path);
  await store.write(data);
  const envelope = JSON.parse(await readFile(path, 'utf8'));
  const body = Buffer.from(envelope.body, 'base64');
  body[0] ^= 1;
  envelope.body = body.toString('base64');
  await writeFile(path, JSON.stringify(envelope));
  await assert.rejects(store.read());
  await unlink(path + '.key');
  await assert.rejects(localStore(path), /key is missing/);
});
test('serialized writes do not corrupt the local diary', async (t) => {
  const path = await fixture(t),
    store = await localStore(path);
  await Promise.all(
    Array.from({ length: 12 }, (_, i) => store.write({ ...data, preferences: { counter: i } })),
  );
  assert.equal((await store.read()).preferences.counter, 11);
});
test('portable backup restores with its passphrase and rejects tampering/wrong password', async (t) => {
  const password = 'a long test passphrase',
    backup = encryptBackup(data, password);
  assert.ok(!backup.includes('private reflection'));
  assert.throws(() => decryptBackup(backup, 'wrong password'));
  const tampered = JSON.parse(backup);
  tampered.tag = Buffer.alloc(16).toString('base64');
  assert.throws(() => decryptBackup(JSON.stringify(tampered), password));
  const path = await fixture(t),
    store = await localStore(path);
  await store.write(decryptBackup(backup, password));
  assert.deepEqual(await store.read(), data);
});
