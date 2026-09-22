# India banking support (ICICI Bank)

FinSight cannot and does not automate ICICI NetBanking login. It never asks for or
stores a NetBanking username/password, MPIN, debit-card PIN, CVV or OTP. In India, the
only RBI-sanctioned way for an independent app to receive another institution's account
data with consent is the **Account Aggregator (AA) framework**: a licensed Account
Aggregator (also called a TSP — Technology Service Provider — when acting as an
FIU-agent) brokers consent between you, your bank (the FIP — Financial Information
Provider) and the requesting app (the FIU — Financial Information User), under the
Sahamati/ReBIT technical specification.

FinSight has none of the following: an FIU registration, a commercial relationship with
a licensed AA/TSP (e.g. Setu, Finvu, Anumati, OneMoney, CAMS Finserv), or ICICI's
approval to receive data as an FIP counterparty. **There is no live ICICI connection in
this codebase, and nothing here should be read as one.**

## What actually works right now

| Capability                                                                      | Status                              | Needs                                                                                                                                                                                  |
| ------------------------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Import your own ICICI statement CSV                                             | **Works today**, demo and live mode | Nothing — a statement you download yourself from NetBanking                                                                                                                            |
| Provider abstraction (Plaid / India AA / statement import behind one interface) | **Implemented**                     | Nothing further to use it locally                                                                                                                                                      |
| Account Aggregator consent → fetch flow, architecture-only                      | **Sandbox mock**, fixture data only | `AA_SANDBOX_ENABLED=true` locally; never in production                                                                                                                                 |
| A real ICICI connection via a live Account Aggregator                           | **Not implemented**                 | A licensed AA/TSP commercial relationship, FIU registration or an existing TSP's FIU-agent program, ICICI onboarding as the FIP counterparty, and production credentials from that TSP |
| Automatic per-bank onboarding for other Indian banks                            | **Not implemented**                 | Same AA prerequisites; the adapter is written to make this additive once a real TSP exists (see "Adding another bank" below)                                                           |

Numbered against your original five categories:

1. **Implementable locally right now:** the provider abstraction, the ICICI statement
   CSV importer, and currency-correct normalization/storage/dashboarding of INR data.
2. **Requires an Account Aggregator/FIU/TSP or other approved provider:** any live pull
   of ICICI data without you manually exporting it — i.e. everything beyond statement
   import.
3. **Requires regulatory or commercial onboarding:** becoming an FIU (or partnering with
   a TSP that acts as one on your behalf), and ICICI recognizing that relationship as a
   FIP data-sharing counterparty.
4. **Requires production credentials:** a TSP client ID/secret and signing keys issued
   after that onboarding; none exist for FinSight.
5. **Testable using sandbox/mock data today:** the AA consent/fetch _shape_ via
   `providers/india-aa.js`'s fixture data, gated by `AA_SANDBOX_ENABLED`.

## Test it locally

### Statement import (works now, no setup)

```sh
cd finsight
npm run local        # or npm run dev, with APP_MODE=demo
```

1. Open **http://localhost:3000**, click **Bring another account in**.
2. Choose **India · ICICI Bank**.
3. Click **Choose ICICI statement CSV** and pick a CSV exported from ICICI NetBanking →
   Accounts → Statements. The parser expects a savings-account export with columns for a
   date, `Transaction Remarks`/`Particulars`, and separate `Withdrawal Amount`/`Deposit
Amount` columns (ICICI's standard NetBanking statement download shape — see
   `services/api/src/providers/statement-import.js` for the exact accepted header
   aliases; a different ICICI account type may need its headers renamed to match).
4. Click **Import statement**. Imported transactions appear immediately in Overview,
   Transactions, budgets, bills and Ask FinSight, denominated in INR.
5. Re-uploading the same file is safe — matching rows are upserted, not duplicated.

No `AA_SANDBOX_ENABLED`, Postgres, or credentials are required for this path in demo
mode; it also works in live mode against your real Postgres instance.

### Account Aggregator sandbox (architecture demo, fixture data only)

```sh
# in finsight/.env
APP_MODE=live
AA_SANDBOX_ENABLED=true
# plus the other live-mode variables in .env.example
```

With live mode running, choosing **India · ICICI Bank** in Onboarding also offers **Try
sandbox connection**, which calls `POST /api/india/consent` → `POST
/api/india/import-sandbox` and writes a handful of obviously-fake INR transactions
(`ICICI Bank (sandbox)`, UPI/NEFT narrations) through the same ingest path Plaid uses.
This proves the plumbing — normalization, storage, dashboard, categorization — works for
a second provider without claiming any real bank connection. `config.js` refuses to
start with `AA_SANDBOX_ENABLED=true` when `NODE_ENV=production`.

## Data normalization

Every provider (Plaid, India AA sandbox, ICICI statement import) produces the same
shapes before anything is written — see `services/api/src/providers/types.js` for the
full field list (`NormalizedAccount`, `NormalizedTransaction`): institution, account id,
masked number, account type/subtype, currency, available/current balance, transaction
id, date, description, merchant, amount, currency, category, status, and a UPI/cheque
`reference` when available. Amount sign convention is unchanged from Plaid: **positive
is an outflow (debit), negative is an inflow (credit)**. `packages/core`'s `summarize()`
scopes every aggregate (income, expenses, debt, spending, bills) to one currency at a
time — a USD account and an INR account are never summed together into one number. The
dashboard picks your primary currency by default and can be requested per currency
(`GET /api/dashboard?currency=INR`); the web UI shows a currency switcher only when more
than one currency is present.

**Known limitation:** budgets and bills have no currency column of their own — they are
evaluated against whichever currency the dashboard is currently scoped to. If you use
both a USD and an INR account, generate/review budgets once per currency.

## Security

- No ICICI password, MPIN, debit-card PIN, CVV or OTP is ever requested, transmitted or
  stored by FinSight, in either the statement-import or sandbox path.
- Statement files and AA sandbox fixture data are parsed and normalized entirely
  server-side; they are never sent to GPT-4o, Whisper or embeddings.
- Transaction descriptions/merchant names go through the same redaction path as Plaid
  data (`security.js`'s `redact()` in demo mode; the private Presidio analyzer in live
  mode) before persistence, so a UPI reference or account-number-shaped digit run
  embedded in a bank narration is tokenized, not stored raw.
- Account numbers are masked to the last 2–4 digits you optionally supply; full account
  numbers are never requested, parsed from a statement, or logged.
- `statement_imports` rows (audit trail: row/skip counts and a hash of the uploaded
  bytes, never file contents) carry the same row-level-security owner scoping as every
  other banking table.
- The AA sandbox is inert unless explicitly enabled, and `config.js` fails startup if
  it's enabled with `NODE_ENV=production`, the same way demo mode can't run in
  production.

## Turning this into a real consent-based ICICI connection

1. **Choose a path to becoming an FIU.** Either register directly as a Financial
   Information User with an account-aggregator ecosystem regulator/self-regulatory body,
   or — far more common for an independent app — contract with a licensed TSP (e.g.
   Setu, Finvu, Anumati, OneMoney, CAMS Finserv) that lets you operate as an FIU-agent
   under their registration.
2. **Complete that TSP's commercial/technical onboarding**: legal agreement, sandbox API
   keys, and their integration checklist (consent artifact creation, redirection/consent
   handle flow, key exchange for encrypted FI data, webhook/callback handling).
3. **Confirm ICICI is reachable as a FIP** through that TSP's network (most major banks,
   ICICI included, participate in the AA network as FIPs, but availability is the TSP's
   to confirm and configure).
4. **Replace `providers/india-aa.js`'s fixture functions** (`createConsent`,
   `consentStatus`, `importSandboxData`) with real calls to the TSP's consent-creation,
   consent-status and FI-data-fetch APIs, keeping the same
   `NormalizedAccount`/`NormalizedTransaction` output shape so nothing downstream
   changes. This includes real consent-artifact storage (not the in-memory `Map` the
   sandbox uses), decrypting the TSP's FI-data payload per their key-exchange spec, and
   handling consent revocation/expiry webhooks.
5. **Get production credentials** from the TSP and store them the way `PLAID_SECRET`/
   `AWS_KMS_KEY_ID` are stored today — never hard-coded, never in `.env.example`.
6. **Test against the TSP's own sandbox first**, then a real ICICI account, before ever
   setting `AA_SANDBOX_ENABLED` to anything other than a local development flag (it
   should probably be renamed/removed once a real integration exists, since "sandbox"
   here currently means "fake," not "the TSP's sandbox").
7. **Extend `docs/SECURITY.md` and `docs/ARCHITECTURE.md`** with the same rigor already
   applied to Plaid: threat boundaries, webhook/consent signature verification, and an
   updated outstanding-release-gates list, before accepting real ICICI data.

## Adding another Indian bank later

Nothing here is ICICI-specific at the architecture level: `providers/india-aa.js`
already models a generic AA fetch (any FIP the connected TSP supports would return data
in the same shape), and `providers/statement-import.js` is the one adapter that is
genuinely bank-specific (ICICI's own CSV column layout). Supporting another bank's
statement export means adding a sibling parser (e.g.
`providers/statement-import-hdfc.js`) with its own `HEADER_ALIASES`, not touching
`packages/core`, the database schema, or the rest of the API.
