import { PlaidApi, Configuration, PlaidEnvironments } from 'plaid';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pool, scoped, audit } from './repository.js';
import { encryptSecret, decryptSecret, tokenise, redact } from './security.js';
import { categorize } from '@finsight/core';
import { privateText } from './privacy.js';
export const plaid = new PlaidApi(
  new Configuration({
    basePath: PlaidEnvironments[process.env.PLAID_ENV || 'sandbox'],
    baseOptions: {
      timeout: 12000,
      headers: {
        'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
        'PLAID-SECRET': process.env.PLAID_SECRET,
      },
    },
  }),
);
export async function linkToken(user) {
  const { data } = await plaid.linkTokenCreate({
    user: { client_user_id: user },
    client_name: 'FinSight',
    products: ['transactions'],
    country_codes: ['US'],
    language: 'en',
    webhook: process.env.PLAID_WEBHOOK_URL,
    transactions: { days_requested: 90 },
  });
  return data;
}
export async function exchange(user, publicToken) {
  const { data } = await plaid.itemPublicTokenExchange({ public_token: publicToken });
  const encrypted = await encryptSecret(data.access_token, user);
  await scoped(user, async (c) => {
    await c.query('INSERT INTO profiles(user_id) VALUES($1) ON CONFLICT DO NOTHING', [user]);
    await c.query(
      'INSERT INTO bank_items(id,user_id,encrypted_token) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET encrypted_token=$3 WHERE bank_items.user_id=$2',
      [data.item_id, user, encrypted],
    );
  });
  await audit(user, 'bank.connected', tokenise(data.item_id));
  return data.item_id;
}
export async function verifyWebhook(raw, signature) {
  if (!signature) throw Object.assign(new Error('Missing webhook signature'), { status: 401 });
  const header = decodeProtectedHeader(signature);
  if (header.alg !== 'ES256' || !header.kid)
    throw Object.assign(new Error('Invalid webhook header'), { status: 401 });
  const { data } = await plaid.webhookVerificationKeyGet({ key_id: header.kid });
  if (data.key.expired_at) throw Object.assign(new Error('Expired webhook key'), { status: 401 });
  const key = await importJWK(data.key, 'ES256');
  const { payload } = await jwtVerify(signature, key, {
    algorithms: ['ES256'],
    maxTokenAge: '5 min',
    clockTolerance: 5,
  });
  if (typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 5)
    throw Object.assign(new Error('Invalid webhook age'), { status: 401 });
  const expected = Buffer.from(createHash('sha256').update(raw).digest('hex'));
  const actual = Buffer.from(String(payload.request_body_sha256 || ''));
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
    throw Object.assign(new Error('Webhook body mismatch'), { status: 401 });
  return createHash('sha256').update(signature).digest('hex');
}
export async function syncItem(itemId) {
  // Advisory lock serializes all item syncs, including duplicates across replicas.
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock(hashtext($1))', [itemId]);
    const item = (await lock.query('SELECT * FROM bank_items WHERE id=$1', [itemId])).rows[0];
    if (!item) return null;
    const token = await decryptSecret(item.encrypted_token, item.user_id);
    let finalData,
      added = [],
      modified = [],
      removed = [],
      cursor = item.cursor;
    for (let attempt = 0; attempt < 3; attempt++) {
      added = [];
      modified = [];
      removed = [];
      cursor = item.cursor;
      try {
        do {
          const { data } = await plaid.transactionsSync({
            access_token: token,
            ...(cursor ? { cursor } : {}),
            count: 500,
          });
          added.push(...data.added);
          modified.push(...data.modified);
          removed.push(...data.removed);
          cursor = data.next_cursor;
          finalData = data;
        } while (finalData.has_more);
        break;
      } catch (e) {
        if (
          e.response?.data?.error_code !== 'TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION' ||
          attempt === 2
        )
          throw e;
      }
    }
    const { data: accountData } = await plaid.accountsGet({ access_token: token });
    const names = [
      ...new Set(
        [...added, ...modified]
          .map((t) => t.merchant_name || t.name)
          .concat(accountData.accounts.map((a) => a.name)),
      ),
    ];
    const safeNames = new Map();
    for (let i = 0; i < names.length; i += 8)
      await Promise.all(
        names.slice(i, i + 8).map(async (name) => safeNames.set(name, await privateText(name))),
      );
    await scoped(item.user_id, async (c) => {
      for (const a of accountData.accounts) {
        if (a.balances.iso_currency_code !== 'USD') continue;
        await c.query(
          'INSERT INTO accounts(id,user_id,item_id,name,type,mask,balance,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(id) DO UPDATE SET balance=$7,name=$4 WHERE accounts.user_id=$2',
          [
            tokenise(a.account_id),
            item.user_id,
            itemId,
            safeNames.get(a.name),
            a.type,
            a.mask || '••••',
            Math.round((a.balances.current || 0) * 100),
            'USD',
          ],
        );
      }
      for (const t of [...added, ...modified]) {
        if (t.iso_currency_code !== 'USD') continue;
        const name = safeNames.get(t.merchant_name || t.name),
          primary = t.personal_finance_category?.primary || '';
        if (t.pending_transaction_id)
          await c.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [
            tokenise(t.pending_transaction_id),
            item.user_id,
          ]);
        await c.query(
          'INSERT INTO transactions(id,user_id,account_id,name,amount,date,category,pending,transfer,primary_category,currency) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(id) DO UPDATE SET name=$4,amount=$5,date=$6,category=$7,pending=$8,transfer=$9,primary_category=$10,updated_at=now() WHERE transactions.user_id=$2',
          [
            tokenise(t.transaction_id),
            item.user_id,
            tokenise(t.account_id),
            name,
            Math.round(t.amount * 100),
            t.date,
            categorize(name, primary),
            t.pending,
            /TRANSFER_IN|TRANSFER_OUT|LOAN_PAYMENTS/.test(primary),
            primary,
            'USD',
          ],
        );
      }
      for (const t of removed)
        await c.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [
          tokenise(t.transaction_id),
          item.user_id,
        ]);
      await c.query(
        'UPDATE bank_items SET cursor=$2,import_status=$3,updated_at=now() WHERE id=$1',
        [
          itemId,
          cursor,
          finalData.transactions_update_status === 'HISTORICAL_UPDATE_COMPLETE'
            ? 'complete'
            : 'importing',
        ],
      );
    });
    await audit(item.user_id, 'bank.synced', tokenise(itemId));
    return item.user_id;
  } finally {
    await lock.query('SELECT pg_advisory_unlock(hashtext($1))', [itemId]).catch(() => {});
    lock.release();
  }
}
