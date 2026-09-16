import pg from 'pg';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { live } from './config.js';
import { seed } from './seed.js';
import { verifyChecksum } from './security.js';
export const pool = live
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 15 })
  : null;
const path = process.env.DEMO_DATA_FILE
  ? pathToFileURL(process.env.DEMO_DATA_FILE)
  : new URL('../../../.data/demo.json', import.meta.url);
let demo,
  writeChain = Promise.resolve();
export async function initStore() {
  if (!live) {
    try {
      demo = JSON.parse(await readFile(path, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      demo = seed();
      await persist();
    }
  }
}
async function persist() {
  const snapshot = JSON.stringify(demo, null, 2);
  writeChain = writeChain.then(async () => {
    await mkdir(new URL('.', path), { recursive: true });
    await writeFile(new URL('./demo.tmp', path), snapshot, { mode: 0o600 });
    await rename(new URL('./demo.tmp', path), path);
  });
  await writeChain;
}
export async function scoped(user, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query("SELECT set_config('app.user_id',$1,true)", [user]);
    const result = await fn(c);
    await c.query('COMMIT');
    return result;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
export async function state(user) {
  if (!live) return structuredClone(demo);
  return scoped(user, async (c) => {
    await c.query('INSERT INTO profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING', [user]);
    const result = {};
    for (const [name, sql] of Object.entries({
      accounts: 'SELECT id,name,type,mask,balance,currency FROM accounts WHERE user_id=$1',
      transactions:
        'SELECT id,name,amount,date::text,category,account_id AS "accountId",pending,transfer,currency FROM transactions WHERE user_id=$1 ORDER BY date DESC',
      bills: 'SELECT id,name,amount,due::text,category,status FROM bills WHERE user_id=$1',
      budgets:
        'SELECT category AS id,category,limit_cents AS "limit" FROM budgets WHERE user_id=$1',
      diaries:
        'SELECT id,transcript,tags,created_at AS "createdAt",transaction_ids AS "transactionIds",audio_key IS NOT NULL AS "hasAudio" FROM diary_entries WHERE user_id=$1 ORDER BY created_at DESC',
      preferences: 'SELECT preferences FROM profiles WHERE user_id=$1',
    }))
      result[name] = (await c.query(sql, [user])).rows;
    for (const t of result.transactions) t.amount = Number(t.amount);
    for (const a of result.accounts) a.balance = Number(a.balance);
    for (const b of result.bills) b.amount = Number(b.amount);
    for (const b of result.budgets) b.limit = Number(b.limit);
    result.preferences = result.preferences[0].preferences;
    return result;
  });
}
export async function audit(user, action, resource = '') {
  if (live)
    await pool.query(
      'INSERT INTO audit_log(user_id,action,resource,request_id) VALUES($1,$2,$3,$4)',
      [user, action, resource, randomUUID()],
    );
  else console.log(JSON.stringify({ audit: action, resource, at: new Date().toISOString() }));
}
export async function saveBudgets(user, budgets) {
  if (!live) {
    demo.budgets = budgets;
    return persist();
  }
  return scoped(user, async (c) => {
    for (const b of budgets)
      await c.query(
        'INSERT INTO budgets(user_id,category,limit_cents) VALUES($1,$2,$3) ON CONFLICT(user_id,category) DO UPDATE SET limit_cents=$3',
        [user, b.category, b.limit],
      );
  });
}
export async function saveBill(user, bill) {
  if (!live) {
    demo.bills.push(bill);
    return persist();
  }
  return scoped(user, (c) =>
    c.query('INSERT INTO bills(id,user_id,name,amount,due,category) VALUES($1,$2,$3,$4,$5,$6)', [
      bill.id,
      user,
      bill.name,
      bill.amount,
      bill.due,
      bill.category,
    ]),
  );
}
export async function saveDiary(user, entry, embedding = null) {
  if (!live) {
    demo.diaries.unshift(entry);
    return persist();
  }
  return scoped(user, (c) =>
    c.query(
      'INSERT INTO diary_entries(id,user_id,transcript,tags,audio_key,embedding,transaction_ids,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
      [
        entry.id,
        user,
        entry.transcript,
        entry.tags,
        entry.audioKey || null,
        embedding ? '[' + embedding.join(',') + ']' : null,
        entry.transactionIds,
        entry.createdAt,
      ],
    ),
  );
}
export async function searchDiary(user, query, embedding) {
  if (!live)
    return demo.diaries
      .filter(
        (e) =>
          e.transcript.toLowerCase().includes(query.toLowerCase()) ||
          e.tags.some((t) => t.includes(query.toLowerCase())),
      )
      .slice(0, 5);
  return scoped(
    user,
    async (c) =>
      (
        await c.query(
          'SELECT id,transcript,tags,created_at AS "createdAt" FROM diary_entries WHERE user_id=$1 ORDER BY embedding <=> $2::vector LIMIT 5',
          [user, '[' + embedding.join(',') + ']'],
        )
      ).rows,
  );
}
export async function savePreferences(user, preferences) {
  if (!live) {
    demo.preferences = preferences;
    return persist();
  }
  return scoped(user, (c) =>
    c.query('UPDATE profiles SET preferences=$2 WHERE user_id=$1', [user, preferences]),
  );
}
export async function saveMetrics(user, data, signature) {
  if (!verifyChecksum(data, signature)) throw new Error('Metric checksum mismatch');
  if (!live) {
    demo.metrics = data;
    return persist();
  }
  return scoped(user, (c) =>
    c.query(
      'INSERT INTO dashboard_metrics(user_id,data,checksum) VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET data=$2,checksum=$3,updated_at=now()',
      [user, data, signature],
    ),
  );
}
export async function demoTransaction(transaction) {
  if (live) throw new Error('Unavailable');
  demo.transactions.unshift(transaction);
  await persist();
}
export async function saveSubscription(user, id, subscription) {
  if (!live) {
    demo.subscriptions = demo.subscriptions.filter((s) => s.id !== id).concat({ id, subscription });
    return persist();
  }
  return scoped(user, (c) =>
    c.query(
      'INSERT INTO push_subscriptions(id,user_id,subscription) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET subscription=$3 WHERE push_subscriptions.user_id=$2',
      [id, user, subscription],
    ),
  );
}
export async function notificationUsers() {
  return live
    ? (await pool.query('SELECT user_id AS id FROM profiles')).rows
    : [{ id: '00000000-0000-4000-8000-000000000001' }];
}
export async function subscriptions(user) {
  return live
    ? scoped(
        user,
        async (c) =>
          (await c.query('SELECT * FROM push_subscriptions WHERE user_id=$1', [user])).rows,
      )
    : demo.subscriptions;
}
export async function delivered(user, id, mark = false) {
  if (!live) {
    const exists = demo.deliveries.includes(id);
    if (mark && !exists) {
      demo.deliveries.push(id);
      await persist();
    }
    return exists;
  }
  return scoped(user, async (c) => {
    if (mark)
      await c.query(
        'INSERT INTO notification_deliveries(id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING',
        [id, user],
      );
    return (
      (
        await c.query('SELECT 1 FROM notification_deliveries WHERE id=$1 AND user_id=$2', [
          id,
          user,
        ])
      ).rowCount > 0
    );
  });
}
export async function deleteSubscription(user, id) {
  if (!live) {
    demo.subscriptions = demo.subscriptions.filter((s) => s.id !== id);
    return persist();
  }
  return scoped(user, (c) =>
    c.query('DELETE FROM push_subscriptions WHERE id=$1 AND user_id=$2', [id, user]),
  );
}
