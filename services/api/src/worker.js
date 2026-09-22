import './config.js';
import { Server } from 'socket.io';
import { createServer } from 'node:http';
import { live } from './config.js';
import { initStore, pool } from './repository.js';
import { initEvents, closeEvents, eventsReady } from './events.js';
import { startReminders } from './notifications.js';
import { startAuditExport } from './audit-export.js';
if (!live || process.env.SERVICE_ROLE !== 'worker')
  throw new Error('Worker requires APP_MODE=live and SERVICE_ROLE=worker');
await initStore();
const io = new Server();
await initEvents(io, { consume: true });
const stopReminders = startReminders(),
  stopAudit = startAuditExport();
const health = createServer((req, res) => {
  if (req.url !== '/health') {
    res.writeHead(404);
    res.end();
    return;
  }
  res.writeHead(eventsReady() ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: eventsReady() ? 'ready' : 'unavailable' }));
});
health.listen(Number(process.env.WORKER_HEALTH_PORT || 4001), '0.0.0.0');
console.log('FinSight worker ready');
let closing = false;
for (const signal of ['SIGTERM', 'SIGINT'])
  process.on(signal, async () => {
    if (closing) return;
    closing = true;
    setTimeout(() => process.exit(1), 15000).unref();
    stopReminders?.();
    stopAudit();
    health.close();
    try {
      await closeEvents();
      await pool.end();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  });
