import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { localStore, atomicPrivateWrite } from '../services/api/src/local-store.js';

export function encryptBackup(data, password) {
  if (password.length < 12) throw new Error('Use a backup passphrase with at least 12 characters');
  const salt = randomBytes(16),
    iv = randomBytes(12),
    key = scryptSync(password, salt, 32);
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from('finsight-backup-v1'));
    return JSON.stringify({
      format: 'finsight-backup-v1',
      salt: salt.toString('base64'),
      iv: iv.toString('base64'),
      body: Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]).toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
    });
  } finally {
    key.fill(0);
  }
}
export function decryptBackup(text, password) {
  const data = JSON.parse(text);
  if (data.format !== 'finsight-backup-v1') throw new Error('Unsupported backup format');
  const key = scryptSync(password, Buffer.from(data.salt, 'base64'), 32);
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'base64'));
    decipher.setAAD(Buffer.from('finsight-backup-v1'));
    decipher.setAuthTag(Buffer.from(data.tag, 'base64'));
    return JSON.parse(
      Buffer.concat([decipher.update(Buffer.from(data.body, 'base64')), decipher.final()]).toString(
        'utf8',
      ),
    );
  } finally {
    key.fill(0);
  }
}
async function password() {
  if (process.env.FINSIGHT_BACKUP_PASSWORD) return process.env.FINSIGHT_BACKUP_PASSWORD;
  if (!process.stdin.isTTY) throw new Error('Run from a terminal to enter the backup passphrase');
  process.stdout.write('Backup passphrase (hidden): ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((ok, fail) => {
    let value = '';
    function done(error) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onData);
      process.stdout.write('\n');
      if (error) fail(error);
      else ok(value);
    }
    function onData(bytes) {
      for (const c of bytes.toString('utf8')) {
        if (c === '\u0003') return done(new Error('Cancelled'));
        if (c === '\r' || c === '\n') return done();
        if (c === '\u007f') value = value.slice(0, -1);
        else value += c;
      }
    }
    process.stdin.on('data', onData);
  });
}
async function main() {
  if (process.env.APP_MODE === 'live')
    throw new Error('These commands only back up the local diary, not hosted services');
  const [command, argument, destination] = process.argv.slice(2);
  const root = fileURLToPath(new URL('../', import.meta.url));
  const source = process.env.DEMO_DATA_FILE || join(root, '.data/demo.json');
  if (command === 'create') {
    const store = await localStore(source);
    const data = await store.read();
    const target = resolve(
      argument ||
        join(root, '.data/backups', `${new Date().toISOString().replace(/:/g, '-')}.finsight`),
    );
    await atomicPrivateWrite(target, encryptBackup(data, await password()));
    console.log(`Encrypted backup saved: ${target}`);
  } else if (command === 'restore' && argument && destination) {
    const data = decryptBackup(await readFile(resolve(argument), 'utf8'), await password());
    // Always restore into a NEW directory, preserving the existing diary.
    const targetDir = resolve(destination);
    await mkdir(targetDir, { mode: 0o700 });
    const target = join(targetDir, 'demo.json');
    const store = await localStore(target);
    await store.write(data);
    console.log(
      `Restored and encrypted: ${target}\nStart with DEMO_DATA_FILE pointing to this file.`,
    );
  } else
    throw new Error(
      'Usage: npm run backup -- [output.finsight] OR npm run restore -- backup.finsight NEW_DIRECTORY',
    );
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
