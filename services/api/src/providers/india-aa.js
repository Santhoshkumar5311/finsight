import { randomUUID } from 'node:crypto';
import { tokenise } from '../security.js';
import { upsertNormalized } from './ingest.js';

/**
 * India Account Aggregator (AA) adapter — SANDBOX ONLY.
 *
 * FinSight has no Financial Information User (FIU) registration, no relationship
 * with a licensed Technology Service Provider (TSP, e.g. Setu/Finvu/Anumati/OneMoney)
 * and no approval from ICICI Bank to receive data as a Financial Information
 * Provider (FIP). This module therefore never calls any real AA/TSP/bank endpoint —
 * it simulates the shape of the consent → fetch flow described in the AA technical
 * specification (Sahamati/ReBIT) with obviously fake fixture data, purely so the
 * provider abstraction and the rest of the app (dashboard, budgets, categorization,
 * Ask FinSight) can be exercised end to end before a real TSP integration exists.
 *
 * See docs/INDIA_BANKING.md for exactly what a real integration would require.
 */
export function aaSandboxEnabled() {
  return process.env.AA_SANDBOX_ENABLED === 'true';
}

function unavailable() {
  return Object.assign(
    new Error('India Account Aggregator sandbox is not enabled (set AA_SANDBOX_ENABLED=true)'),
    { status: 503 },
  );
}

// In-memory only: a real TSP integration would track consent artifacts server-side
// with the TSP, not fabricate them locally. Cleared on process restart by design.
const consents = new Map();

export function createConsent(userId) {
  if (!aaSandboxEnabled()) throw unavailable();
  const consentId = randomUUID();
  consents.set(consentId, { userId, status: 'ACTIVE', createdAt: new Date().toISOString() });
  return {
    consentId,
    status: 'ACTIVE',
    sandbox: true,
    fip: 'ICICI Bank (sandbox fixture — not a real AA/FIP connection)',
    note: 'No real consent was requested from ICICI or any Account Aggregator.',
  };
}

export function consentStatus(userId, consentId) {
  if (!aaSandboxEnabled()) throw unavailable();
  const consent = consents.get(consentId);
  if (!consent || consent.userId !== userId)
    throw Object.assign(new Error('Unknown consent'), { status: 404 });
  return { consentId, status: consent.status, sandbox: true };
}

// Clearly-fake fixture data in the shape a real AA FI-Data fetch would return, translated
// into NormalizedAccount/NormalizedTransaction (see providers/types.js).
function fixtureData(userId, consentId) {
  const accountId = tokenise('india-aa-sandbox:' + userId + ':savings');
  const accounts = [
    {
      provider: 'india-aa',
      accountId,
      institution: 'ICICI Bank (sandbox)',
      accountName: 'ICICI Sandbox Savings',
      accountType: 'depository',
      accountSubtype: 'savings',
      maskedNumber: '••1234',
      currency: 'INR',
      currentBalance: 5_00000,
      availableBalance: 5_00000,
    },
  ];
  const rows = [
    ['2026-09-01', 'UPI-SWIGGY-500123456789-swiggy@icici', 45000, 'debit'],
    ['2026-09-03', 'NEFT SALARY CREDIT ACME INDIA PVT LTD', 8500000, 'credit'],
    ['2026-09-05', 'UPI-BIGBASKET-500987654321-bigbasket@icici', 320000, 'debit'],
    ['2026-09-10', 'ELECTRICITY BILL BSES PAYMENT', 180000, 'debit'],
  ];
  const transactions = rows.map(([date, description, amount, direction]) => ({
    provider: 'india-aa',
    transactionId: tokenise(`india-aa-sandbox:${consentId}:${date}:${description}:${amount}`),
    accountId,
    date,
    description,
    amount: direction === 'debit' ? amount : -amount,
    currency: 'INR',
    pending: false,
    status: 'posted',
    reference: description.startsWith('UPI') ? description.split('-')[2] : undefined,
  }));
  return { accounts, transactions };
}

/** Fetches (fixture) FI data for an active sandbox consent and writes it through the shared ingest path. */
export async function importSandboxData(userId, consentId) {
  if (!aaSandboxEnabled()) throw unavailable();
  const consent = consents.get(consentId);
  if (!consent || consent.userId !== userId || consent.status !== 'ACTIVE')
    throw Object.assign(new Error('Consent is not active'), { status: 409 });
  const { accounts, transactions } = fixtureData(userId, consentId);
  await upsertNormalized(userId, accounts, transactions);
  return { imported: transactions.length, sandbox: true };
}
