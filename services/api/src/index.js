import './config.js';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import multer from 'multer';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from 'socket.io';
import { z } from 'zod';
import { config, live } from './config.js';
import { authenticate, tokenise, redact } from './security.js';
import * as repo from './repository.js';
import { summarize, categories, categorize, day, makeBudgets } from '@finsight/core';
import { linkToken, exchange, verifyWebhook } from './plaid.js';
import { initEvents, enqueue, updateDashboard } from './events.js';
import { chat, queryIndex } from './agent.js';
import { diaryEntry, audioStream } from './audio.js';
import { startReminders, pushReady } from './notifications.js';
import { privateText } from './privacy.js';
import { origins, allowedRequest, requestSecurity } from './request-security.js';
await repo.initStore();
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
app.get('/config', (_, res) =>
  res.json({ mode: config.mode, pushReady, vapidPublicKey: process.env.VAPID_PUBLIC_KEY || null }),
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
app.use('/api', async (req, res, next) => {
  try {
    req.user = await authenticate(req.get('authorization')?.replace(/^Bearer /, ''));
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
    socket.data.user = await authenticate(socket.handshake.auth.token);
    next();
  } catch {
    next(new Error('Authentication required'));
  }
});
io.on('connection', (socket) => {
  socket.join(socket.data.user.id);
  if (live) {
    const timeout = setTimeout(
      () => socket.disconnect(true),
      Math.max(0, socket.data.user.expiresAt - Date.now()),
    );
    socket.on('disconnect', () => clearTimeout(timeout));
  }
});
await initEvents(io);
startReminders();
app.get('/api/dashboard', async (req, res) => {
  const options = z
    .object({
      month: z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
        .optional(),
      period: z.enum(['month', 'week']).optional(),
    })
    .parse(req.query);
  const s = await repo.state(req.user.id);
  res.json({ ...s, summary: summarize(s, options), mode: config.mode });
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
  const result = await repo.pool.query(
    'SELECT import_status AS status FROM bank_items WHERE user_id=$1',
    [req.user.id],
  );
  res.json({
    items: result.rows,
    complete: result.rows.length > 0 && result.rows.every((x) => x.status === 'complete'),
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
