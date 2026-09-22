import { plaidRegionalOptions } from '@finsight/core';
import { PlaidApi, Configuration, PlaidEnvironments } from 'plaid';
import { decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pool, scoped, audit } from './repository.js';
import { encryptSecret, decryptSecret, tokenise } from './security.js';
import { writeNormalized } from './providers/ingest.js';
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
export async function linkToken(user, preferences = { region: 'US' }) {
  const { data } = await plaid.linkTokenCreate({
    user: { client_user_id: user },
    client_name: 'FinSight',
    products: ['transactions'],
    ...plaidRegionalOptions(preferences),
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
    // A currency other than USD is no longer dropped: summarize()/money() are currency-scoped
    // per packages/core, so accounts/transactions in any currency Plaid reports are safe to keep.
    const normalizedAccounts = accountData.accounts.map((a) => ({
      provider: 'plaid',
      itemId,
      accountId: tokenise(a.account_id),
      institution: 'Plaid',
      accountName: a.name,
      accountType: a.type,
      accountSubtype: a.subtype || null,
      maskedNumber: a.mask || '••••',
      currency: a.balances.iso_currency_code || a.balances.unofficial_currency_code || 'USD',
      currentBalance: Math.round((a.balances.current || 0) * 100),
      availableBalance:
        a.balances.available != null ? Math.round(a.balances.available * 100) : null,
    }));
    const normalizedTransactions = [...added, ...modified].map((t) => ({
      provider: 'plaid',
      transactionId: tokenise(t.transaction_id),
      replacesTransactionId: t.pending_transaction_id
        ? tokenise(t.pending_transaction_id)
        : undefined,
      accountId: tokenise(t.account_id),
      date: t.date,
      description: t.name,
      merchant: t.merchant_name || t.name,
      amount: Math.round(t.amount * 100),
      currency: t.iso_currency_code || t.unofficial_currency_code || 'USD',
      pending: t.pending,
      transfer: /TRANSFER_IN|TRANSFER_OUT|LOAN_PAYMENTS/.test(
        t.personal_finance_category?.primary || '',
      ),
      category: t.personal_finance_category?.primary || '',
      status: t.pending ? 'pending' : 'posted',
    }));
    const removedTransactionIds = removed.map((t) => tokenise(t.transaction_id));
    await scoped(item.user_id, async (c) => {
      await writeNormalized(
        c,
        item.user_id,
        normalizedAccounts,
        normalizedTransactions,
        removedTransactionIds,
      );
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
