import webpush from 'web-push';
import {
  notificationUsers,
  state,
  subscriptions,
  delivered,
  saveSubscription,
  deleteSubscription,
  pool,
} from './repository.js';
import { summarize } from '@finsight/core';
import { tokenise } from './security.js';
import { live } from './config.js';
export const pushReady = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY);
if (pushReady)
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  );
async function expoRequest(path, payload) {
  const r = await fetch('https://exp.host/--/api/v2/push/' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(process.env.EXPO_ACCESS_TOKEN
        ? { Authorization: 'Bearer ' + process.env.EXPO_ACCESS_TOKEN }
        : {}),
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error('Expo push unavailable');
  const body = await r.json();
  if (body.errors?.length) throw new Error('Expo rejected push request');
  return body.data;
}
async function send(user, sub, payload) {
  if (sub.subscription.type === 'expo') {
    const ticket = await expoRequest('send', {
      to: sub.subscription.token,
      title: payload.title,
      body: payload.body,
      data: { screen: 'Bills' },
      sound: 'default',
    });
    if (ticket.status === 'error') {
      if (ticket.details?.error === 'DeviceNotRegistered') await deleteSubscription(user, sub.id);
      throw new Error('Expo delivery rejected');
    }
    await saveSubscription(user, sub.id, {
      ...sub.subscription,
      tickets: [...(sub.subscription.tickets || []), { id: ticket.id, at: Date.now() }],
    });
  } else if (pushReady) {
    try {
      await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
    } catch (e) {
      if (e.statusCode === 410 || e.statusCode === 404) await deleteSubscription(user, sub.id);
      throw e;
    }
  } else throw new Error('VAPID is not configured');
}
export function startReminders() {
  if (!live && !pushReady) return;
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    let lock;
    try {
      if (live) {
        lock = await pool.connect();
        const result = await lock.query(
          "SELECT pg_try_advisory_lock(hashtext('finsight-reminder-worker')) AS acquired",
        );
        if (!result.rows[0].acquired) return;
      }
      for (const { id: user } of await notificationUsers()) {
        const s = await state(user);
        if (!s.preferences.notifications) continue;
        const subs = await subscriptions(user);
        for (const sub of subs) {
          const tickets = (sub.subscription.tickets || []).filter(
            (t) => Date.now() - t.at > 15 * 60000,
          );
          if (tickets.length) {
            try {
              const receipts = await expoRequest('getReceipts', { ids: tickets.map((t) => t.id) });
              if (Object.values(receipts).some((r) => r.details?.error === 'DeviceNotRegistered')) {
                await deleteSubscription(user, sub.id);
                continue;
              }
              await saveSubscription(user, sub.id, {
                ...sub.subscription,
                tickets: sub.subscription.tickets.filter(
                  (t) => !receipts[t.id] && Date.now() - t.at < 24 * 36e5,
                ),
              });
            } catch {
              console.error('Expo receipt check will retry');
            }
          }
        }
        for (const bill of summarize(s).bills.filter((b) => b.status !== 'paid'))
          for (const hours of s.preferences.leadHours) {
            const until = new Date(bill.due + 'T12:00:00Z').getTime() - Date.now();
            if (until > hours * 36e5 || until < (hours - 1) * 36e5) continue;
            for (const sub of subs) {
              const key = tokenise(`${user}:${bill.name}:${bill.due}:${hours}:${sub.id}`);
              if (await delivered(user, key)) continue;
              try {
                await send(user, sub, {
                  title: 'FinSight · Bill reminder',
                  body: `A bill is due ${bill.due}. Open FinSight to review.`,
                  url: '/',
                });
                await delivered(user, key, true);
              } catch {
                console.error('Reminder delivery will retry');
              }
            }
          }
      }
    } catch (e) {
      console.error('Reminder scheduler unavailable', e.name);
    } finally {
      if (lock) {
        await lock
          .query("SELECT pg_advisory_unlock(hashtext('finsight-reminder-worker'))")
          .catch(() => {});
        lock.release();
      }
      running = false;
    }
  }, 30000);
  timer.unref();
}
