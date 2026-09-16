import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
const port = 14019,
  base = `http://127.0.0.1:${port}`;
let child, socket;
const dir = await mkdtemp(join(tmpdir(), 'finsight-test-'));
const request = async (path, method = 'GET', body) => {
  const r = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: r.status, body: await r.json() };
};
before(async () => {
  child = spawn(process.execPath, ['services/api/src/index.js'], {
    cwd: new URL('../../../', import.meta.url),
    env: {
      ...process.env,
      APP_MODE: 'demo',
      PORT: String(port),
      DEMO_DATA_FILE: join(dir, 'demo.json'),
    },
    stdio: 'pipe',
  });
  let output = '';
  child.stderr.on('data', (b) => (output += b));
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Server startup timeout ' + output)), 10000);
    child.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error('Server exited ' + code + ' ' + output));
    });
    child.stdout.on('data', (b) => {
      if (b.toString().includes('FinSight API')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
});
after(() => {
  socket?.disconnect();
  child?.kill();
});
test('dashboard returns integer totals derived from sample records', async () => {
  const { status, body } = await request('/api/dashboard');
  assert.equal(status, 200);
  assert.ok(body.summary.income > 0);
  assert.equal(
    body.summary.profit,
    body.summary.income - body.summary.expenses - body.summary.debt,
  );
});
test('rejects malformed bills and budget changes', async () => {
  assert.equal(
    (await request('/api/bills', 'POST', { name: 'Rent', amount: -1, due: 'bad' })).status,
    400,
  );
  assert.equal(
    (await request('/api/budgets', 'PUT', { budgets: [{ category: 'Injected', limit: 1 }] }))
      .status,
    400,
  );
});
test('reflection persists and is found in diary search', async () => {
  const saved = await request('/api/diary', 'POST', {
    text: 'Proud of my savings goal integration-check',
  });
  assert.equal(saved.status, 201);
  assert.ok(saved.body.tags.includes('savings goal'));
  const found = await request('/api/diary/search?q=integration-check');
  assert.equal(found.body.entries.length, 1);
});
test('chat affordability uses the current data, not a fabricated forecast', async () => {
  const d = await request('/api/dashboard');
  const r = await request('/api/chat', 'POST', { message: 'Can I afford a $2,000 laptop?' });
  assert.equal(r.body.calculation.left, d.body.summary.profit - 200000);
  assert.match(r.body.text, /not a forecast/);
});
test('next-month affordability provides an explicit calculation-backed projection', async () => {
  const r = await request('/api/chat', 'POST', {
    message: 'Can I afford a $2,000 laptop next month?',
  });
  assert.equal(r.body.source, 'Calculated projection');
  assert.equal(r.body.calculation.left, r.body.calculation.forecast.profit - 200000);
  assert.ok(r.body.calculation.forecast.historyMonths.length > 0);
  assert.match(r.body.text, /not guaranteed/);
});
test('bill and preferences writes persist through the API', async () => {
  const b = await request('/api/bills', 'POST', {
    name: 'Integration bill',
    amount: 1500,
    due: '2026-12-20',
  });
  assert.equal(b.status, 201);
  const p = await request('/api/preferences', 'PUT', { leadHours: [24], notifications: false });
  assert.equal(p.status, 200);
  const d = await request('/api/dashboard');
  assert.ok(d.body.bills.some((x) => x.name === 'Integration bill'));
  assert.deepEqual(d.body.preferences.leadHours, [24]);
});
test('demo transaction broadcasts an update and changes totals in under two seconds locally', async () => {
  socket = io(base, { transports: ['websocket'], forceNew: true });
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  const before = (await request('/api/dashboard')).body.summary.expenses;
  const start = performance.now();
  const event = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('No WebSocket event')), 2000);
    socket.once('dashboard:update', () => {
      clearTimeout(timer);
      resolve();
    });
  });
  assert.equal((await request('/api/demo/transaction', 'POST', {})).status, 201);
  await event;
  assert.ok(performance.now() - start < 2000);
  assert.equal((await request('/api/dashboard')).body.summary.expenses, before + 680);
});
test('demo mode cannot exchange real bank tokens or receive live webhooks', async () => {
  assert.equal((await request('/api/plaid/link-token', 'POST', {})).status, 503);
  assert.equal((await request('/webhooks/plaid', 'POST', {})).status, 404);
});
