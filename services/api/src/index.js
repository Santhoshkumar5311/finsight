import './config.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import { config, live } from './config.js';
import { authenticate, tokenise, redact } from './security.js';
import * as repo from './repository.js';
import {
  summarize,
  categories,
  categorize,
  day,
  makeBudgets,
  currenciesPresent,
} from '@finsight/core';
import { linkToken, exchange, verifyWebhook } from './plaid.js';
import { initEvents, enqueue, updateDashboard, eventsReady, closeEvents } from './events.js';
import { chat, queryIndex } from './agent.js';
import { diaryEntry, audioStream } from './audio.js';
import { startReminders, pushReady } from './notifications.js';
import { privateText } from './privacy.js';
import { origins, allowedRequest, requestSecurity } from './request-security.js';
import {
  aaSandboxEnabled,
  createConsent,
  consentStatus,
  importSandboxData,
} from './providers/india-aa.js';
import { parseIciciDocument } from './providers/document-import.js';
import { parseIciciStatement, StatementImportError } from './providers/statement-import.js';
import {
  localAccountExists,
  createLocalAccount,
  loginLocal,
  cookieToken,
  revokeLocal,
  sessionCookie,
  changeLocalPassword,
} from './local-auth.js';
import {
  initSessionCache,
  revokeSession,
  userRateLimit,
  securityReady,
  closeSessionCache,
} from './session-cache.js';
await repo.initStore();
await initSessionCache();
const app = express(),
  http = createServer(app);
app.disable('x-powered-by');
app.set('trust proxy', live ? 1 : false);
app.use(helmet({ strictTransportSecurity: live ? undefined : false }));
app.use(requestSecurity);
app.use(cors({ origin: origins, credentials: true }));
app.use(
  rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }),
);
app.get('/health', (_, res) => res.json({ status: 'ok', mode: config.mode }));
app.get('/config', async (_, res) =>
  res.json({
    mode: config.mode,
    authProvider: live ? 'supabase' : 'local',
    setupRequired: !live && !(await localAccountExists()),
    pushReady,
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null,
  }),
);
app.post(
  '/webhooks/plaid',
  express.raw({ type: 'application/json', limit: '1mb' }),
  async (req, res) => {
    if (!live) return res.status(404).json({ error: 'Not available in demo' });
    const id = await verifyWebhook(req.body, req.get('Plaid-Verification'));
    const event = z
      .object({ webhook_type: z.string(), webhook_code: z.string(), item_id: z.string() })
      .passthrough()
      .parse(JSON.parse(req.body.toString('utf8')));
    if (event.webhook_type === 'TRANSACTIONS' && event.webhook_code === 'SYNC_UPDATES_AVAILABLE')
      await enqueue(event.item_id, id);
    res.status(202).json({ received: true });
  },
);
app.use(express.json({ limit: '64kb' }));
const authLimit = rateLimit({
  windowMs: 15 * 60000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again in 15 minutes.' },
});
app.post('/auth/:action', authLimit, async (req, res) => {
  if (live || !['register', 'login'].includes(req.params.action)) return res.sendStatus(404);
  // JSON + explicit browser Origin checks avoid cross-site form login/registration.
  if (!req.is('application/json')) return res.status(415).json({ error: 'JSON required' });
  const session = await (req.params.action === 'register'
    ? createLocalAccount(req.body)
    : loginLocal(req.body));
  sessionCookie(res, session);
  await repo.audit('00000000-0000-4000-8000-000000000001', 'auth.' + req.params.action);
  res.status(req.params.action === 'register' ? 201 : 200).json({ authenticated: true });
});
app.use('/api', async (req, res, next) => {
  try {
    req.user = await authenticate(
      req.get('authorization')?.replace(/^Bearer /, ''),
      cookieToken(req.headers.cookie),
      req.path !== '/session',
    );
    if (
      !(await userRateLimit(
        req.user.id,
        req.path === '/chat' ? 'chat' : 'api',
        req.path === '/chat' ? 20 : 180,
        60,
      ))
    )
      return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    await repo.audit(req.user.id, 'api.' + req.method, req.path);
    next();
  } catch (e) {
    next(e);
  }
});
const io = new Server(http, {
  cors: { origin: origins, credentials: true },
  maxHttpBufferSize: 16384,
  allowRequest: (req, callback) => callback(null, allowedRequest(req)),
});
io.use(async (socket, next) => {
  try {
    socket.data.user = await authenticate(
      socket.handshake.auth.token,
      cookieToken(socket.request.headers.cookie),
      false,
    );
    next();
  } catch {
    next(new Error('Authentication required'));
  }
});
io.on('connection', (socket) => {
  socket.join(socket.data.user.id);
  socket.join('session:' + socket.data.user.sessionId);
  const timeout = setTimeout(
    () => socket.disconnect(true),
    Math.max(0, socket.data.user.expiresAt - Date.now()),
  );
  const check = setInterval(async () => {
    try {
      await authenticate(
        socket.handshake.auth.token,
        cookieToken(socket.request.headers.cookie),
        false,
      );
    } catch {
      socket.disconnect(true);
    }
  }, 30000);
  socket.on('disconnect', () => {
    clearTimeout(timeout);
    clearInterval(check);
  });
});
await initEvents(io);
const stopReminders = !live ? startReminders() : undefined;
app.get('/api/session', (req, res) =>
  res.json({ user: { id: req.user.id, aal: req.user.aal }, expiresAt: req.user.expiresAt }),
);
app.post('/api/session/logout', async (req, res) => {
  if (live) await revokeSession(req.user.sessionId);
  else {
    revokeLocal(cookieToken(req.headers.cookie));
    sessionCookie(res);
  }
  io.in('session:' + req.user.sessionId).disconnectSockets(true);
  res.json({ signedOut: true });
});
app.post('/api/session/password', authLimit, async (req, res) => {
  if (live) return res.sendStatus(404);
  const session = await changeLocalPassword(req.body);
  sessionCookie(res, session);
  io.in(req.user.id).disconnectSockets(true);
  await repo.audit(req.user.id, 'auth.password.changed');
  res.json({ changed: true });
});
app.get('/ready', async (_, res) => {
  try {
    if (live) await repo.pool.query('SELECT 1');
    if (!(await securityReady()) || !eventsReady()) throw new Error('Not ready');
    res.json({ status: 'ready' });
  } catch {
    res.status(503).json({ status: 'unavailable' });
  }
});
app.get('/api/dashboard', async (req, res) => {
  const options = z
    .object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional(),
      period: z.enum(['month', 'week']).optional(),
      currency: z
        .string()
        .regex(/^[A-Z]{3}$/)
        .optional(),
    })
    .parse(req.query);
  const s = await repo.state(req.user.id);
  const currencies = currenciesPresent(s);
  if (options.currency && !currencies.includes(options.currency))
    return res.status(400).json({ error: `No accounts or transactions use ${options.currency}` });
  res.json({ ...s, summary: summarize(s, options), currencies, mode: config.mode });
});
app.post('/api/plaid/link-token', async (req, res) => {
  if (!live)
    return res.status(503).json({
      error:
        'Live bank connections require Plaid credentials. Demo accounts are already connected.',
    });
  res.json(await linkToken(req.user.id));
});
app.post('/api/plaid/exchange', async (req, res) => {
  if (!live) return res.sendStatus(404);
  const { publicToken } = z
    .object({ publicToken: z.string().min(10).max(500) })
    .strict()
    .parse(req.body);
  const id = await exchange(req.user.id, publicToken);
  await enqueue(id, randomUUID());
  res.status(202).json({ status: 'importing' });
});
app.get('/api/plaid/status', async (req, res) => {
  if (!live) return res.json({ items: [], complete: true });
  const result = await repo.scoped(req.user.id, (c) =>
    c.query('SELECT import_status AS status FROM bank_items WHERE user_id=$1', [req.user.id]),
  );
  res.json({
    items: result.rows,
    complete: result.rows.length > 0 && result.rows.every((x) => x.status === 'complete'),
  });
});
// India: no live Account Aggregator/TSP integration exists yet (see docs/INDIA_BANKING.md).
// The sandbox routes below simulate the AA consent/fetch shape with obviously fake data,
// gated by AA_SANDBOX_ENABLED, and are never reachable in a production config (config.js
// refuses to start with AA_SANDBOX_ENABLED=true when NODE_ENV=production).
app.get('/api/india/status', (req, res) =>
  res.json({ sandboxEnabled: live && aaSandboxEnabled() }),
);
app.post('/api/india/consent', (req, res) => {
  if (!live) return res.status(404).json({ error: 'Not available in demo' });
  res.status(201).json(createConsent(req.user.id));
});
app.get('/api/india/consent/:id/status', (req, res) => {
  if (!live) return res.status(404).json({ error: 'Not available in demo' });
  res.json(consentStatus(req.user.id, z.uuid().parse(req.params.id)));
});
app.post('/api/india/import-sandbox', async (req, res) => {
  if (!live) return res.status(404).json({ error: 'Not available in demo' });
  const { consentId } = z.object({ consentId: z.uuid() }).strict().parse(req.body);
  const result = await importSandboxData(req.user.id, consentId);
  await updateDashboard(req.user.id);
  res.status(202).json(result);
});
const csvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 },
  fileFilter: (_req, file, cb) =>
    cb(
      null,
      [
        'text/csv',
        'application/vnd.ms-excel',
        'application/pdf',
        'application/octet-stream',
        'text/plain',
      ].includes(file.mimetype),
    ),
});
// Works in demo and live mode alike: no external credentials or approvals are needed to
// import a statement you already downloaded yourself from ICICI's NetBanking portal.
app.post('/api/accounts/import/icici', csvUpload.single('statement'), async (req, res) => {
  if (!req.file)
    return res
      .status(400)
      .json({ error: 'Attach an ICICI CSV, XLS transaction history, or credit-card PDF' });
  const body = z
    .object({
      accountName: z.string().min(1).max(60).optional(),
      last4: z
        .string()
        .regex(/^\d{4}$/)
        .optional(),
    })
    .parse(req.body || {});
  let accountId = tokenise('icici-statement:' + req.user.id);
  let parsed;
  try {
    const binary =
      req.file.buffer.subarray(0, 5).toString() === '%PDF-' ||
      req.file.buffer.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1';
    parsed = binary
      ? await parseIciciDocument(req.file.buffer, req.user.id)
      : parseIciciStatement(req.file.buffer.toString('utf8'), accountId);
    accountId = parsed.accountId || accountId;
  } catch (e) {
    if (e instanceof StatementImportError) return res.status(400).json({ error: e.message });
    throw e;
  }
  const existing = await repo.getAccount(req.user.id, accountId);
  const accountMeta = {
    provider: 'icici-statement',
    accountId,
    institution: 'ICICI Bank',
    accountName:
      body.accountName ||
      existing?.name ||
      (parsed.accountType === 'credit' ? 'ICICI credit card' : 'ICICI savings account'),
    accountType: parsed.accountType || 'depository',
    accountSubtype: parsed.accountType === 'credit' ? 'credit-card' : 'savings',
    balanceDate:
      parsed.balanceDate ||
      parsed.transactions
        .map((t) => t.date)
        .sort()
        .at(-1),
    maskedNumber: parsed.last4
      ? '••' + parsed.last4
      : body.last4
        ? '••' + body.last4
        : existing?.mask || '••••',
    currency: 'INR',
    currentBalance:
      parsed.closingBalance ?? (existing?.balance != null ? Number(existing.balance) : 0),
  };
  await repo.importTransactions(req.user.id, accountMeta, parsed.transactions, {
    sourceHash: createHash('sha256').update(req.file.buffer).digest('hex'),
    skipped: parsed.skipped,
  });
  await updateDashboard(req.user.id);
  res.status(202).json({
    imported: parsed.rowCount,
    reconciled: !!parsed.reconciled,
    balanceAsOf: parsed.balanceDate,
    skipped: parsed.skipped,
    warnings: parsed.warnings.slice(0, 20),
    accountId,
  });
});
app.post('/api/chat', rateLimit({ windowMs: 60000, limit: 20 }), async (req, res) => {
  const body = z
    .object({ message: z.string().min(1).max(2000), allowReminder: z.boolean().default(false) })
    .strict()
    .parse(req.body);
  const start = performance.now();
  const reply = await chat(req.user.id, body.message, body);
  res.json({ ...reply, latencyMs: Math.round(performance.now() - start) });
});
app.put('/api/budgets', async (req, res) => {
  const { budgets } = z
    .object({
      budgets: z
        .array(
          z
            .object({ category: z.enum(categories), limit: z.number().int().min(0).max(100000000) })
            .strict(),
        )
        .max(9),
    })
    .strict()
    .parse(req.body);
  await repo.saveBudgets(req.user.id, budgets);
  await updateDashboard(req.user.id);
  res.json({ saved: true });
});
app.post('/api/budgets/generate', async (req, res) => {
  const s = await repo.state(req.user.id);
  const budgets = makeBudgets(s.transactions);
  await repo.saveBudgets(req.user.id, budgets);
  await updateDashboard(req.user.id);
  res.json({ budgets });
});
app.post('/api/bills', async (req, res) => {
  const body = z
    .object({
      name: z.string().min(1).max(100),
      amount: z.number().int().positive().max(100000000),
      due: z.iso.date(),
      category: z.enum(categories).default('Other'),
    })
    .strict()
    .parse(req.body);
  const bill = {
    ...body,
    name: await privateText(body.name),
    id: randomUUID(),
    status: 'upcoming',
  };
  await repo.saveBill(req.user.id, bill);
  await updateDashboard(req.user.id);
  res.status(201).json(bill);
});
app.put('/api/preferences', async (req, res) => {
  const body = z
    .object({
      leadHours: z.array(z.union([z.literal(72), z.literal(24), z.literal(1)])).max(3),
      notifications: z.boolean(),
    })
    .strict()
    .parse(req.body);
  await repo.savePreferences(req.user.id, body);
  res.json(body);
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 1 },
  fileFilter: (_req, file, cb) =>
    cb(
      null,
      [
        'audio/webm',
        'audio/mp4',
        'audio/mpeg',
        'audio/wav',
        'audio/ogg',
        'audio/x-m4a',
        'video/mp4',
      ].includes(file.mimetype),
    ),
});
app.post('/api/diary', upload.single('audio'), async (req, res) => {
  const text = z.string().max(12000).optional().parse(req.body?.text);
  if (!req.file && !text?.trim())
    return res.status(400).json({ error: 'Add a reflection or a supported audio file' });
  res.status(201).json(await diaryEntry(req.user.id, { text, file: req.file }));
});
app.get('/api/diary/search', async (req, res) => {
  const { q } = z.object({ q: z.string().min(1).max(1000) }).parse(req.query);
  res.json({ entries: await queryIndex(req.user.id, q) });
});
app.get('/api/diary/:id/audio', async (req, res) => {
  const id = z.uuid().parse(req.params.id);
  const result = await audioStream(req.user.id, id);
  res.set('Content-Type', result.ContentType || 'audio/webm');
  res.set('Cache-Control', 'private, no-store');
  result.Body.pipe(res);
});
app.post('/api/push', async (req, res) => {
  const subscription = z
    .object({
      endpoint: z.url().refine((v) => new URL(v).protocol === 'https:'),
      keys: z.object({ p256dh: z.string().max(300), auth: z.string().max(300) }),
    })
    .strict()
    .parse(req.body);
  const host = new URL(subscription.endpoint).hostname;
  if (
    !['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com'].some(
      (h) => host === h || host.endsWith('.' + h),
    )
  )
    return res.status(400).json({ error: 'Unsupported push service' });
  await repo.saveSubscription(req.user.id, tokenise(subscription.endpoint), subscription);
  res.status(201).json({ subscribed: true });
});
app.post('/api/push/mobile', async (req, res) => {
  const { token } = z
    .object({ token: z.string().regex(/^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]+\]$/) })
    .strict()
    .parse(req.body);
  await repo.saveSubscription(req.user.id, tokenise(token), { type: 'expo', token, tickets: [] });
  res.status(201).json({ subscribed: true });
});
app.post('/api/demo/transaction', async (req, res) => {
  if (live) return res.sendStatus(404);
  const t = {
    id: randomUUID(),
    name: 'Blue Bottle Coffee',
    amount: 680,
    date: day(),
    category: categorize('Coffee'),
    accountId: 'checking',
    pending: false,
    currency: 'USD',
  };
  await repo.demoTransaction(t);
  await updateDashboard(req.user.id);
  res.status(201).json(t);
});
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status =
    err instanceof z.ZodError ? 400 : err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  console.error(JSON.stringify({ error: err.name, code: err.code, status }));
  res.status(status).json({
    error:
      status === 500
        ? 'Something went wrong. Please try again.'
        : err instanceof z.ZodError
          ? 'Invalid request. Check the fields and try again.'
          : err.message,
  });
});
http.listen(config.port, live ? '0.0.0.0' : '127.0.0.1', () =>
  console.log(`FinSight API · ${config.mode} · http://localhost:${config.port}`),
);

let shuttingDown = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    const force = setTimeout(() => process.exit(1), 10000);
    force.unref();
    stopReminders?.();
    http.close();
    io.disconnectSockets(true);
    try {
      await closeEvents();
      await closeSessionCache();
      await repo.pool?.end();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
