import { scoped } from '../repository.js';
import { privateText } from '../privacy.js';
import { categorize } from '@finsight/core';

/**
 * Single live-mode write path for normalized accounts/transactions (see `types.js`),
 * shared by every banking provider so there is one place that redacts names, upserts
 * rows and enforces owner scoping. Each provider is responsible for choosing its own
 * stable `accountId`/`transactionId` values (already suitable as primary keys) so
 * Plaid's existing `tokenise(a.account_id)` scheme is untouched by this refactor.
 *
 * Takes an already-open transaction client so a caller (like Plaid's cursor-based
 * sync) can commit accounts/transactions and its own bookkeeping atomically. Callers
 * with nothing else to commit alongside can use `upsertNormalized` instead.
 * @param {import('pg').PoolClient} c
 * @param {string} userId
 * @param {import('./types.js').NormalizedAccount[]} accounts
 * @param {import('./types.js').NormalizedTransaction[]} transactions
 * @param {string[]} removedTransactionIds
 */
export async function writeNormalized(
  c,
  userId,
  accounts,
  transactions,
  removedTransactionIds = [],
) {
  const names = [
    ...new Set([
      ...accounts.map((a) => a.accountName),
      ...transactions.map((t) => t.merchant || t.description),
    ]),
  ];
  const safeNames = new Map();
  for (let i = 0; i < names.length; i += 8)
    await Promise.all(
      names.slice(i, i + 8).map(async (name) => safeNames.set(name, await privateText(name))),
    );
  for (const a of accounts) {
    await c.query(
      'INSERT INTO accounts(id,user_id,item_id,name,type,mask,balance,currency,provider,subtype,available_balance,balance_as_of) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(id) DO UPDATE SET balance=CASE WHEN accounts.balance_as_of IS NULL OR $12::date IS NULL OR accounts.balance_as_of <= $12::date THEN $7 ELSE accounts.balance END,balance_as_of=CASE WHEN $12::date IS NULL THEN accounts.balance_as_of ELSE GREATEST(accounts.balance_as_of,$12::date) END,name=$4,available_balance=$11 WHERE accounts.user_id=$2',
      [
        a.accountId,
        userId,
        a.itemId || null,
        safeNames.get(a.accountName),
        a.accountType,
        a.maskedNumber || '••••',
        a.currentBalance,
        a.currency,
        a.provider,
        a.accountSubtype || null,
        a.availableBalance ?? null,
        a.balanceDate || null,
      ],
    );
  }
  for (const t of transactions) {
    if (t.replacesTransactionId)
      await c.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [
        t.replacesTransactionId,
        userId,
      ]);
    const name = safeNames.get(t.merchant || t.description),
      primary = t.category || '',
      category = categorize(name, primary);
    await c.query(
      'INSERT INTO transactions(id,user_id,account_id,name,amount,date,category,pending,transfer,primary_category,currency,provider,merchant,status,reference) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT(id) DO UPDATE SET name=$4,amount=$5,date=$6,category=$7,pending=$8,transfer=$9,primary_category=$10,status=$14,updated_at=now() WHERE transactions.user_id=$2',
      [
        t.transactionId,
        userId,
        t.accountId,
        name,
        t.amount,
        t.date,
        category,
        t.pending,
        t.transfer || false,
        primary,
        t.currency,
        t.provider,
        name,
        t.status || (t.pending ? 'pending' : 'posted'),
        t.reference || null,
      ],
    );
  }
  for (const id of removedTransactionIds)
    await c.query('DELETE FROM transactions WHERE id=$1 AND user_id=$2', [id, userId]);
}

/** Convenience wrapper for providers with no other work to commit in the same transaction. */
export async function upsertNormalized(userId, accounts, transactions, removedTransactionIds = []) {
  return scoped(userId, (c) =>
    writeNormalized(c, userId, accounts, transactions, removedTransactionIds),
  );
}
