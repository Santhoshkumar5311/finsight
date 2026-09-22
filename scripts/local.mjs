import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { readFile, cp, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
const root = fileURLToPath(new URL('../', import.meta.url));
process.chdir(root);
dotenv.config({ quiet: true });
if (process.env.APP_MODE && process.env.APP_MODE !== 'demo')
  throw new Error(
    'npm run local is for the offline demo. Use npm run dev for configured live services.',
  );
if (Number(process.versions.node.split('.')[0]) < 22)
  throw new Error('Node.js 22 or later is required');
// Client values are embedded by Next: refuse an accidental remote backend in local mode.
for (const file of [
  'apps/web/.env',
  'apps/web/.env.local',
  'apps/web/.env.production',
  'apps/web/.env.production.local',
]) {
  try {
    const env = dotenv.parse(await readFile(file));
    if (
      env.NEXT_PUBLIC_API_URL &&
      !['http://localhost:4000', 'http://127.0.0.1:4000'].includes(env.NEXT_PUBLIC_API_URL)
    )
      throw new Error(`${file} points to a remote API; remove that setting for local mode`);
    if (env.NEXT_PUBLIC_SUPABASE_URL)
      throw new Error(`${file} enables hosted authentication; remove it for local demo mode`);
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
  }
}
for (const port of [3000, 4000]) {
  await new Promise((ok, fail) => {
    const probe = createServer();
    probe.once('error', () =>
      fail(
        new Error(
          `Port ${port} is already in use. Stop the previous FinSight process before starting another.`,
        ),
      ),
    );
    probe.listen(port, '127.0.0.1', () => probe.close(ok));
  });
}
const env = {
  ...process.env,
  APP_MODE: 'demo',
  WEB_ORIGIN: 'http://localhost:3000',
  PORT: '4000',
  NEXT_PUBLIC_API_URL: 'http://localhost:4000',
  NEXT_PUBLIC_SUPABASE_URL: '',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: '',
};
const next = resolve('node_modules/next/dist/bin/next');
console.log('Building the local dashboard…');
await new Promise((ok, fail) => {
  const build = spawn(process.execPath, [next, 'build', 'apps/web'], {
    env: { ...env, NODE_ENV: 'production' },
    stdio: 'inherit',
  });
  build.once('error', fail);
  build.once('exit', (code) => (code === 0 ? ok() : fail(new Error('Dashboard build failed'))));
});
const standalone = resolve('apps/web/.next/standalone/apps/web');
await mkdir(resolve(standalone, '.next'), { recursive: true });
await cp(resolve('apps/web/.next/static'), resolve(standalone, '.next/static'), {
  recursive: true,
});
await cp(resolve('apps/web/public'), resolve(standalone, 'public'), { recursive: true });
const children = [
  spawn(process.execPath, ['services/api/src/index.js'], {
    env: { ...env, NODE_ENV: 'development' },
    stdio: 'inherit',
  }),
  spawn(process.execPath, [resolve(standalone, 'server.js')], {
    env: { ...env, NODE_ENV: 'production', HOSTNAME: '127.0.0.1', PORT: '3000' },
    stdio: 'inherit',
  }),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  children.forEach((child) => child.kill('SIGTERM'));
  setTimeout(
    () =>
      children.forEach((child) => {
        if (child.exitCode === null) child.kill('SIGKILL');
      }),
    5000,
  ).unref();
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
for (const child of children) {
  child.once('error', () => stop(1));
  child.once('exit', (code) => stop(code || 0));
}
console.log('FinSight local • http://localhost:3000 • Ctrl+C stops both services');
