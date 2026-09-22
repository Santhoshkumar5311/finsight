/**
 * Provider-independent shapes that every banking adapter (Plaid, India AA, statement
 * import) must produce before data reaches `providers/ingest.js`. This file has no
 * runtime exports; it documents the contract so new adapters don't need to touch
 * `packages/core` or the database layer.
 *
 * Amount sign convention matches the existing Plaid pipeline and `packages/core`:
 * a positive amount is an outflow (debit/spend), a negative amount is an inflow
 * (credit/deposit). All amounts are integer minor units (cents, paise, ...).
 *
 * @typedef {Object} NormalizedAccount
 * @property {'plaid'|'india-aa'|'icici-statement'} provider
 * @property {string} institution - e.g. "Chase", "ICICI Bank"
 * @property {string} accountId - stable id from the source provider (tokenised before storage)
 * @property {string} maskedNumber - last 2-4 digits only, e.g. "4829" or "••1234"
 * @property {string} accountType - e.g. "depository", "credit"
 * @property {string} [accountSubtype] - e.g. "savings", "current"
 * @property {string} accountName
 * @property {string} currency - ISO 4217, e.g. "USD", "INR"
 * @property {number} [availableBalance] - integer minor units, if known
 * @property {number} currentBalance - integer minor units
 * @property {string} [itemId] - references bank_items.id, when the provider tracks one
 *
 * @typedef {Object} NormalizedTransaction
 * @property {'plaid'|'india-aa'|'icici-statement'} provider
 * @property {string} transactionId - stable id from the source provider (tokenised before storage)
 * @property {string} accountId - matches a NormalizedAccount.accountId
 * @property {string} [replacesTransactionId] - id of a pending row this posted transaction supersedes
 * @property {string} date - YYYY-MM-DD
 * @property {string} description - raw merchant/narration text
 * @property {string} [merchant] - cleaned merchant/payee name, if distinct from description
 * @property {number} amount - integer minor units; positive = debit/outflow, negative = credit/inflow
 * @property {string} currency - ISO 4217
 * @property {boolean} pending
 * @property {boolean} [transfer]
 * @property {string} [category] - Plaid's raw category, if any; final category comes from `categorize()`
 * @property {'posted'|'pending'|'reversed'} [status]
 * @property {string} [reference] - UPI ref no, cheque no, or other bank reference, when available
 */
export {};
