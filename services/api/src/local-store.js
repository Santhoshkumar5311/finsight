import { mkdir, readFile, writeFile, rename, chmod, open, unlink } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { dirname } from 'node:path';
import { sealWithKey, openWithKey } from './security.js';

const context = 'finsight-local-store-v1';
export async function atomicPrivateWrite(path, content) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${randomUUID()}.tmp`;
  try {
    const file = await open(temporary, 'wx', 0o600);
    try {
      await file.writeFile(content);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, path);
  } finally {
    await unlink(temporary).catch((e) => {
      if (e.code !== 'ENOENT') throw e;
    });
  }
}
export function validateLocalData(data) {
  if (
    !data ||
    !['accounts', 'transactions', 'bills', 'budgets', 'diaries'].every((k) =>
      Array.isArray(data[k]),
    ) ||
    !data.preferences
  )
    throw new Error('Invalid FinSight local data; refusing to overwrite it');
  return data;
}
export async function localStore(path) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const keyPath = `${path}.key`;
  let key;
  try {
    key = await readFile(keyPath);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    // Never replace a missing key for an existing encrypted diary.
    let existing;
    try {
      existing = JSON.parse(await readFile(path, 'utf8'));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (existing?.format === context)
      throw new Error(
        'Local encryption key is missing. Restore the matching key from your backup.',
      );
    key = randomBytes(32);
    await writeFile(keyPath, key, { flag: 'wx', mode: 0o600 });
  }
  if (key.length !== 32) throw new Error('Invalid local encryption key');
  await chmod(keyPath, 0o600);
  let chain = Promise.resolve();
  const store = {
    async read() {
      const envelope = JSON.parse(await readFile(path, 'utf8'));
      if (envelope.format === context)
        return validateLocalData(JSON.parse(openWithKey(envelope, key, context)));
      // One-time upgrade of the original plaintext demo file.
      const data = validateLocalData(envelope);
      await store.write(data);
      return data;
    },
    async write(data) {
      const encrypted = JSON.stringify({
        format: context,
        ...sealWithKey(JSON.stringify(validateLocalData(data)), key, context),
      });
      const pending = chain.then(() => atomicPrivateWrite(path, encrypted));
      chain = pending.catch(() => {});
      await pending;
    },
  };
  return store;
}
