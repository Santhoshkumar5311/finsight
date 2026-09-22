import '../services/api/src/config.js';
import { rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createConnection } from 'node:net';
if (process.env.APP_MODE === 'live') throw new Error('Use Supabase account recovery in live mode');
if (!process.argv.includes('--confirm'))
  throw new Error(
    'Stop FinSight, then run npm run local:reset-login -- --confirm. This resets local login only; anyone with filesystem access can do this.',
  );
await new Promise((ok, fail) => {
  const socket = createConnection({ host: '127.0.0.1', port: Number(process.env.PORT || 4000) });
  socket.once('connect', () => {
    socket.destroy();
    fail(new Error('Stop FinSight before resetting login'));
  });
  socket.once('error', (e) => (e.code === 'ECONNREFUSED' ? ok() : fail(e)));
});
const path = resolve(
  process.env.LOCAL_AUTH_FILE ||
    (process.env.DEMO_DATA_FILE ? `${process.env.DEMO_DATA_FILE}.auth` : '.data/local-auth.json'),
);
await rename(path, `${path}.recovery-${Date.now()}`);
console.log(
  'Login reset. Restart FinSight and create your replacement local login. Your encrypted diary and key were preserved.',
);
