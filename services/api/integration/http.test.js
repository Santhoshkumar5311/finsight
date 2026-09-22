import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io } from 'socket.io-client';
import { request as httpRequest } from 'node:http';
const port = 14019,
  base = `http://127.0.0.1:${port}`;
let child, socket, cookie;
const authFetch = (url, options = {}) =>
  fetch(url, { ...options, headers: { Cookie: cookie, ...options.headers } });
const dir = await mkdtemp(join(tmpdir(), 'finsight-test-'));
const request = async (path, method = 'GET', body) => {
  const r = await authFetch(base + path, {
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
      LOCAL_AI_ENABLED: 'false',
      PORT: String(port),
      DEMO_DATA_FILE: join(dir, 'demo.json'),
      AA_SANDBOX_ENABLED: 'false',
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
  assert.equal((await fetch(base + '/api/dashboard')).status, 401);
  const registration = await fetch(base + '/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@example.com', password: 'test-only-passphrase-1234' }),
  });
  assert.equal(registration.status, 201);
  const header = registration.headers.get('set-cookie');
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  cookie = header.split(';')[0];
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
  socket = io(base, {
    transports: ['websocket'],
    forceNew: true,
    extraHeaders: { Cookie: cookie },
  });
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
test('the India Account Aggregator sandbox is off by default and unreachable in demo mode', async () => {
  assert.equal((await request('/api/india/status')).body.sandboxEnabled, false);
  assert.equal((await request('/api/india/consent', 'POST', {})).status, 404);
  assert.equal((await request('/api/india/import-sandbox', 'POST', {})).status, 404);
});
test('importing an ICICI statement adds real INR transactions that feed the existing dashboard', async () => {
  assert.equal((await request('/api/preferences', 'PUT', { region: 'IN' })).status, 200);
  // Dated within the current month, like the seed data, so the default dashboard window includes them.
  const now = new Date(),
    pad = (n) => String(n).padStart(2, '0'),
    icDate = (day) => `${pad(day)}/${pad(now.getMonth() + 1)}/${now.getFullYear()}`;
  const csv = [
    'Tran Date,Chq No,Particulars,Withdrawal Amount (INR ),Deposit Amount (INR ),Balance (INR )',
    `${icDate(2)},,UPI-SWIGGY-500123456789-swiggy@icici,450.00,,49550.00`,
    `${icDate(3)},,NEFT SALARY CREDIT ACME INDIA PVT LTD,,85000.00,134550.00`,
  ].join('\n');
  const body = new FormData();
  body.append('statement', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
  body.append('last4', '1234');
  const response = await authFetch(base + '/api/accounts/import/icici', { method: 'POST', body });
  assert.equal(response.status, 202);
  const result = await response.json();
  assert.equal(result.imported, 2);
  assert.equal(result.skipped, 0);
  const dashboard = await request('/api/dashboard');
  assert.ok(dashboard.body.currencies.includes('INR'));
  const account = dashboard.body.accounts.find((a) => a.currency === 'INR');
  assert.equal(account.mask, '••1234');
  assert.equal(account.balance, 13455000);
  // The long UPI reference embedded in the narration is redacted before it is ever persisted.
  const swiggyTx = dashboard.body.transactions.find((t) => t.currency === 'INR' && t.amount > 0);
  assert.ok(!swiggyTx.name.includes('500123456789'));
  assert.match(swiggyTx.name, /\[number\]/);
  const inr = await request('/api/dashboard?currency=INR');
  assert.equal(inr.body.summary.currency, 'INR');
  assert.equal(inr.body.summary.expenses, 45000);
  assert.equal(inr.body.summary.income, 8500000);
  // USD demo data is untouched by the INR import.
  const usd = await request('/api/dashboard?currency=USD');
  assert.equal(usd.body.summary.currency, 'USD');
  // Re-importing the same statement does not duplicate the transactions.
  const body2 = new FormData();
  body2.append('statement', new Blob([csv], { type: 'text/csv' }), 'statement.csv');
  const reimport = await authFetch(base + '/api/accounts/import/icici', {
    method: 'POST',
    body: body2,
  });
  assert.equal(reimport.status, 202);
  const afterReimport = await request('/api/dashboard?currency=INR');
  assert.equal(afterReimport.body.transactions.filter((t) => t.currency === 'INR').length, 2);
});
test('an ICICI statement with unrecognized columns is rejected, not silently imported', async () => {
  const body = new FormData();
  body.append('statement', new Blob(['Foo,Bar\n1,2'], { type: 'text/csv' }), 'bad.csv');
  const response = await authFetch(base + '/api/accounts/import/icici', { method: 'POST', body });
  assert.equal(response.status, 400);
});

test('local API blocks cross-origin browser requests and DNS rebinding hosts', async () => {
  for (const headers of [
    { Origin: 'https://untrusted.example' },
    { Host: `untrusted.example:${port}` },
    { 'Sec-Fetch-Site': 'cross-site' },
  ]) {
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(base + '/api/dashboard', { headers }, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 403, JSON.stringify(headers));
  }
  const r = await authFetch(base + '/api/dashboard', {
    headers: { Origin: 'http://localhost:3000' },
  });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
});
test('websocket handshake rejects untrusted browser origins', async () => {
  const client = io(base, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: { Origin: 'https://untrusted.example' },
  });
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Handshake did not finish')), 3000);
      client.once('connect', () => {
        clearTimeout(timeout);
        reject(new Error('Untrusted connection accepted'));
      });
      client.once('connect_error', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  } finally {
    client.disconnect();
  }
});

test('local recording persists encrypted and plays back without exposing audio in JSON', async () => {
  const bytes = Buffer.from('local-test-audio-bytes');
  const body = new FormData();
  body.append('audio', new Blob([bytes], { type: 'audio/webm' }), 'reflection.webm');
  body.append('text', 'Audio savings reflection');
  const response = await authFetch(base + '/api/diary', { method: 'POST', body });
  assert.equal(response.status, 201);
  const entry = await response.json();
  assert.equal(entry.hasAudio, true);
  assert.equal(entry.localAudio, undefined);
  const dashboard = await request('/api/dashboard');
  assert.equal(dashboard.body.diaries.find((d) => d.id === entry.id).localAudio, undefined);
  const search = await request('/api/diary/search?q=Audio%20savings');
  assert.equal(search.body.entries[0].localAudio, undefined);
  const audio = await authFetch(base + `/api/diary/${entry.id}/audio`);
  assert.equal(audio.headers.get('content-type'), 'audio/webm');
  assert.deepEqual(Buffer.from(await audio.arrayBuffer()), bytes);
});

test('local account cannot be claimed twice and bad credentials are rejected', async () => {
  const body = { email: 'test@example.com', password: 'test-only-passphrase-1234' };
  assert.equal((await request('/auth/register', 'POST', body)).status, 409);
  assert.equal(
    (await request('/auth/login', 'POST', { ...body, password: 'incorrect-password' })).status,
    401,
  );
  assert.equal(
    (await fetch(base + '/api/dashboard', { headers: { Cookie: 'finsight_session=forged' } }))
      .status,
    401,
  );
});
test('bank region persists, preserves existing records, and gates provider endpoints', async () => {
  const before = (await request('/api/dashboard')).body;
  let response = await request('/api/preferences', 'PUT', { region: 'US' });
  assert.equal(response.status, 200);
  assert.deepEqual(response.body.leadHours, before.preferences.leadHours);
  const us = (await request('/api/regions')).body;
  assert.equal(us.preferences.region, 'US');
  assert.equal(us.regions.find((r) => r.code === 'US').provider, 'plaid');
  assert.equal(us.regions.find((r) => r.code === 'US').available, false);
  assert.equal((await request('/api/accounts/import/icici', 'POST', {})).status, 409);
  assert.equal((await request('/api/plaid/link-token', 'POST', {})).status, 503);
  await request('/api/preferences', 'PUT', { region: 'IN' });
  assert.equal((await request('/api/plaid/link-token', 'POST', {})).status, 409);
  // Older mobile clients update reminders without erasing the region.
  await request('/api/preferences', 'PUT', { leadHours: [72], notifications: false });
  assert.equal((await request('/api/dashboard')).body.preferences.region, 'IN');
  await request('/api/preferences', 'PUT', { region: 'OTHER' });
  assert.equal((await request('/api/plaid/link-token', 'POST', {})).status, 409);
  assert.equal((await request('/api/accounts/import/icici', 'POST', {})).status, 409);
  assert.equal((await request('/api/preferences', 'PUT', { region: 'ZZ' })).status, 400);
  const after = (await request('/api/dashboard')).body;
  assert.deepEqual(after.accounts, before.accounts);
  assert.deepEqual(after.transactions, before.transactions);
  assert.equal(after.summary.currency, before.summary.currency);
  await request('/api/preferences', 'PUT', { region: 'IN' });
});
test('password change invalidates older sessions and logout invalidates the new cookie', async () => {
  const oldCookie = cookie;
  const changed = await authFetch(base + '/api/session/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'test@example.com',
      currentPassword: 'test-only-passphrase-1234',
      password: 'new-test-passphrase-5678',
    }),
  });
  assert.equal(changed.status, 200);
  cookie = changed.headers.get('set-cookie').split(';')[0];
  assert.equal(
    (await fetch(base + '/api/dashboard', { headers: { Cookie: oldCookie } })).status,
    401,
  );
  assert.equal((await request('/api/session')).status, 200);
  assert.equal((await request('/api/session/logout', 'POST', {})).status, 200);
  assert.equal((await request('/api/dashboard')).status, 401);
});
