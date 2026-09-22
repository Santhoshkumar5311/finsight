import pg from 'pg';
import { databaseOptions } from './database-config.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { categorize } from '@finsight/core';
import { localStore } from './local-store.js';
import { live } from './config.js';
import { seed } from './seed.js';
import { verifyChecksum } from './security.js';
import { privateText } from './privacy.js';
import { writeNormalized } from './providers/ingest.js';
export const pool = live ? new pg.Pool(databaseOptions()) : null;
const path =
  process.env.DEMO_DATA_FILE || fileURLToPath(new URL('../../../.data/demo.json', import.meta.url));
let demo, store;
export async function initStore() {
  if (live && process.env.NODE_ENV === 'production') {
    const role = process.env.SERVICE_ROLE === 'worker' ? 'finsight_worker' : 'finsight_api';
    const { rows } = await pool.query(
      "SELECT rolsuper,rolbypassrls,pg_has_role(current_user,$1,'MEMBER') AS member FROM pg_roles WHERE rolname=current_user",
      [role],
    );
    if (!rows[0]?.member || rows[0].rolsuper || rows[0].rolbypassrls)
      throw new Error('Use a restricted runtime database identity with the matching FinSight role');
    const owned = await pool.query(
      "SELECT 1 FROM pg_tables WHERE schemaname='public' AND tableowner=current_user LIMIT 1",
    );
    if (owned.rowCount)
      throw new Error('Runtime database identity must not own application tables');
  }
  if (!live) {
    store = await localStore(path);
    try {
      demo = await store.read();
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      demo = seed();
      await persist();
    }
  }
}
async function persist() {
  await store.write(demo);
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
  if (!live)
    return structuredClone({
      ...demo,
      diaries: demo.diaries.map(({ localAudio, ...entry }) => entry),
    });
  return scoped(user, async (c) => {
    await c.query('INSERT INTO profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING', [user]);
    const result = {};
    for (const [name, sql] of Object.entries({
      accounts:
        'SELECT id,name,type,mask,balance,balance_as_of::text AS "balanceAsOf",currency FROM accounts WHERE user_id=$1',
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
      .slice(0, 5)
      .map(({ localAudio, ...entry }) => entry);
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

export function localDiaryAudio(id) {
  if (live) return null;
  return demo.diaries.find((entry) => entry.id === id)?.localAudio;
}

export async function getAccount(user, accountId) {
  if (!live) return demo.accounts.find((a) => a.id === accountId) || null;
  return (
    (
      await scoped(user, (c) =>
        c.query(
          'SELECT id,name,mask,balance,currency,balance_as_of::text AS "balanceAsOf" FROM accounts WHERE id=$1 AND user_id=$2',
          [accountId, user],
        ),
      )
    ).rows[0] || null
  );
}

/**
 * Shared demo/live write path for a normalized account + its transactions (used by
 * ICICI statement import). Mirrors the `if (!live) {...} return scoped(...)` pattern
 * used elsewhere in this file so callers don't branch on mode themselves. Live-mode
 * writes go through `providers/ingest.js`'s `writeNormalized`, the same code Plaid
 * uses, so both providers share one upsert/redaction path.
 * @param {import('./providers/types.js').NormalizedAccount} accountMeta
 * @param {import('./providers/types.js').NormalizedTransaction[]} transactions
 */
export async function importTransactions(
  user,
  accountMeta,
  transactions,
  { sourceHash, skipped = 0 } = {},
) {
  if (!live) {
    const demoAccount = {
      id: accountMeta.accountId,
      name: accountMeta.accountName,
      institution: accountMeta.institution,
      type: accountMeta.accountType,
      mask: accountMeta.maskedNumber,
      balance: accountMeta.currentBalance,
      balanceAsOf: accountMeta.balanceDate,
      currency: accountMeta.currency,
      provider: accountMeta.provider,
    };
    const accountIndex = demo.accounts.findIndex((a) => a.id === demoAccount.id);
    if (accountIndex === -1) demo.accounts.push(demoAccount);
    else {
      const previous = demo.accounts[accountIndex];
      if (
        previous.balanceAsOf &&
        demoAccount.balanceAsOf &&
        previous.balanceAsOf > demoAccount.balanceAsOf
      ) {
        demoAccount.balance = previous.balance;
        demoAccount.balanceAsOf = previous.balanceAsOf;
      }
      demo.accounts[accountIndex] = { ...previous, ...demoAccount };
    }
    const indexById = new Map(demo.transactions.map((t, i) => [t.id, i]));
    for (const t of transactions) {
      const name = await privateText(t.merchant || t.description);
      const row = {
        id: t.transactionId,
        name,
        amount: t.amount,
        date: t.date,
        category: categorize(name, t.category || ''),
        accountId: t.accountId,
        pending: t.pending,
        transfer: t.transfer || false,
        currency: t.currency,
        provider: t.provider,
      };
      if (indexById.has(row.id)) demo.transactions[indexById.get(row.id)] = row;
      else demo.transactions.push(row);
    }
    return persist();
  }
  await scoped(user, async (c) => {
    await writeNormalized(c, user, [accountMeta], transactions);
    if (sourceHash)
      await c.query(
        'INSERT INTO statement_imports(user_id,account_id,provider,source_hash,row_count,skipped_count) VALUES($1,$2,$3,$4,$5,$6)',
        [
          user,
          accountMeta.accountId,
          accountMeta.provider,
          sourceHash,
          transactions.length,
          skipped,
        ],
      );
  });
}
