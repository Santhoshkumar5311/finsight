import amqp from 'amqplib';
import { createClient } from 'redis';
import { createAdapter } from '@socket.io/redis-adapter';
import { live } from './config.js';
import { pool, state, saveMetrics, saveBudgets, audit } from './repository.js';
import { syncItem } from './plaid.js';
import { summarize, makeBudgets } from '@finsight/core';
import { checksum } from './security.js';
let io,
  channel,
  redis,
  sub,
  broker,
  dispatcher,
  closing = false;
const queue = 'finsight.bank.sync';
export async function updateDashboard(user) {
  const s = await state(user);
  if (!s.budgets.length) {
    await saveBudgets(user, makeBudgets(s.transactions));
    s.budgets = makeBudgets(s.transactions);
  }
  const summary = summarize(s);
  await saveMetrics(user, summary, checksum(summary));
  if (redis) await redis.set('dashboard:' + user, JSON.stringify(summary), { EX: 60 });
  io?.to(user).emit('dashboard:update', { at: summary.updatedAt });
  return summary;
}
export async function enqueue(itemId, id) {
  await pool.query('INSERT INTO webhook_inbox(id,item_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [
    id,
    itemId,
  ]);
  if (channel) {
    channel.sendToQueue(queue, Buffer.from(JSON.stringify({ id, itemId })), { persistent: true });
    await channel.waitForConfirms();
  }
}
export async function initEvents(server, { consume = false } = {}) {
  io = server;
  if (!live) return;
  redis = createClient({ url: process.env.REDIS_URL });
  sub = redis.duplicate();
  for (const r of [redis, sub]) r.on('error', () => console.error('Redis connection error'));
  await Promise.all([redis.connect(), sub.connect()]);
  io.adapter(createAdapter(redis, sub));
  broker = await amqp.connect(process.env.RABBITMQ_URL);
  channel = await broker.createConfirmChannel();
  broker.on('error', () => console.error('RabbitMQ connection error'));
  broker.on('close', () => {
    if (!closing) {
      console.error('RabbitMQ disconnected; supervisor restart required');
      process.exit(1);
    }
  });
  await channel.assertQueue(queue, {
    durable: true,
    arguments: { 'x-dead-letter-exchange': '', 'x-dead-letter-routing-key': queue + '.dead' },
  });
  await channel.assertQueue(queue + '.dead', { durable: true });
  if (!consume) return;
  await channel.prefetch(8);
  await channel.consume(queue, async (msg) => {
    if (!msg) return;
    const started = performance.now();
    try {
      const { id, itemId } = JSON.parse(msg.content);
      const row = (await pool.query('SELECT processed_at FROM webhook_inbox WHERE id=$1', [id]))
        .rows[0];
      if (row && !row.processed_at) {
        const user = await syncItem(itemId);
        if (user) await updateDashboard(user);
        await pool.query('UPDATE webhook_inbox SET processed_at=now() WHERE id=$1', [id]);
        console.log(
          JSON.stringify({
            metric: 'webhook_processing_ms',
            value: Math.round(performance.now() - started),
          }),
        );
      }
      channel.ack(msg);
    } catch (e) {
      console.error('Sync failed; durable inbox will retry', e.code || e.name);
      channel.nack(msg, false, false);
    }
  });
  // Outbox replay covers crashes between database commit and broker confirmation.
  dispatcher = setInterval(async () => {
    try {
      const rows = (
        await pool.query(
          "SELECT id,item_id FROM webhook_inbox WHERE processed_at IS NULL AND received_at < now()-interval '15 seconds' ORDER BY received_at LIMIT 50",
        )
      ).rows;
      for (const r of rows)
        channel.sendToQueue(queue, Buffer.from(JSON.stringify({ id: r.id, itemId: r.item_id })), {
          persistent: true,
        });
      await channel.waitForConfirms();
    } catch {
      console.error('Inbox replay unavailable');
    }
  }, 15000);
  dispatcher.unref();
}

export function eventsReady() {
  return !live || (!!redis?.isReady && !!sub?.isReady && !!channel && !closing);
}
export async function closeEvents() {
  closing = true;
  clearInterval(dispatcher);
  await channel?.close();
  await broker?.close();
  if (sub?.isOpen) await sub.quit();
  if (redis?.isOpen) await redis.quit();
}
