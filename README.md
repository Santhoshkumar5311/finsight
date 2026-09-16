# FinSight

A personal finance diary with a Next.js dashboard, Expo mobile client, Express API, PostgreSQL/pgvector, Plaid, GPT-4o, Whisper, Redis, RabbitMQ and KMS-encrypted S3 audio.

The local demo runs without credentials. Live adapters are implemented but require your own services, credentials and deployment configuration. Production latency, physical-device behavior, and live provider integration are not certified by the local tests.

## Run the web app and API

Requires Node.js 22 or later and npm.

```sh
cd finsight
npm ci
npm run dev
```

Open **http://localhost:3000**. The API listens on **http://localhost:4000**. Demo data persists in `.data/demo.json`; it contains synthetic accounts and transactions. No external API is called in demo mode. Written diary entries, budgets, bills and preferences persist. Web recording and local playback work; real transcription explicitly requires live services.

Try these flows:

- Overview → weekly/monthly spending and previous/next months.
- Transactions → search, category filter and CSV export.
- Accounts → **Simulate a new transaction** → watch totals update without refresh.
- Budgets → adjust a limit or regenerate from prior months.
- Bills & reminders → add a bill; posted transactions automatically reconcile its status.
- Money diary → record locally or save a written reflection; search your entries.
- Ask FinSight → “Can I afford a $2,000 laptop next month?” returns a projection calculated from observed prior months, upcoming bills and current debt, with explicit assumptions.
- Settings → dark appearance and reminder lead times.

## Project structure

```text
apps/
  web/                 Next.js dashboard and browser capture
  mobile/              Expo native client, independent lockfile
services/api/
  src/                 Auth, Plaid, jobs, agent, diary, notifications
  test/                Finance, crypto, PII, webhook and PostgreSQL/RLS tests
  integration/         Isolated HTTP and WebSocket tests
packages/core/          Deterministic financial intelligence
database/             PostgreSQL and pgvector migration
infra/                 Dockerfiles, TLS, IAM, private storage and WAF configuration
docs/                  Architecture, security and API reference
```

## Implementation sequence

1. **Scaffold:** npm workspaces for web/API/core; separate Expo dependency tree. `npm run dev` runs the demo end to end.
2. **Database:** `database/001_schema.sql` creates all tables, indexes, pgvector, RLS and agent grants. `npm test` executes this migration twice in embedded PostgreSQL, then tests ownership and permissions.
3. **Plaid:** Link token creation requests 90 days; exchange encrypts the access token with KMS. Verified webhooks feed a durable inbox and RabbitMQ. Sync handles pagination, additions, modifications, removals and pending replacements atomically.
4. **Agent:** deterministic categorization, income, debt, bill and anomaly calculations precede Socket.io updates. GPT-4o gets scoped function tools, not arbitrary SQL or banking writes. Budget generation and chat are functional in demo mode using local calculations; general LLM responses require live mode.
5. **Diary:** Web Audio waveform and noise suppression; Whisper transcription; private PII analysis; AI topic tags, same-day transaction cross-reference, pgvector search and S3 SSE-KMS audio. Native recording uses metering and Android voice-communication processing.
6. **Security:** Supabase OAuth/TOTP, native biometrics and SecureStore, certificate pins, validation, audit events, RLS, webhook crypto, tokenization, private PII analysis, KMS, TLS/WAF infrastructure and dependency audits. Read `docs/SECURITY.md` before enabling real user data.

## Configure live mode

Copy `.env.example` to `.env` at the FinSight root. Set `APP_MODE=live` and fill every required value. The API fails startup if required secrets or the private PII analyzer URL are absent. Demo mode disables all OpenAI calls even if a key is present. It refuses to start with `NODE_ENV=production` and binds only to loopback.

### Database, queue, cache and privacy service

```sh
docker compose up -d
npm run db:migrate
```

The compose file is for local development: PostgreSQL with pgvector, Redis, RabbitMQ and Presidio. All published ports bind to loopback. Pin Presidio’s image by digest for deployments. Docker is not required for the demo or SQL tests.

For production, use a dedicated Supabase project with restricted network access, self-host its data plane, or use the supplied private RDS foundation with Supabase Auth. Public database endpoints do not meet the requested private-network requirement. Set `DATABASE_URL` with TLS certificate verification, `REDIS_URL` to `rediss://…`, and `RABBITMQ_URL` to `amqps://…`. Run migrations using a trusted migration identity; deploy runtime credentials with only the necessary table privileges. The current API and worker run together; separate their identities when splitting them into independent services.

Generate `PII_TOKEN_KEY` and `CHECKSUM_KEY` independently with `openssl rand -hex 32`. Keep them in a secrets manager. Changing the token key requires a token migration; it is not interchangeable with KMS rotation.

### Supabase Auth

Enable Google OAuth, configure `http://localhost:3000` (development) and your production web URL in the redirect allowlist. Enable TOTP MFA and asymmetric JWT signing. The live API requires `aal2`; an OAuth-only session cannot fetch financial data.

Create `apps/web/.env.local`:

```dotenv
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_PUBLIC_ANON_KEY
```

`NEXT_PUBLIC_*` values are public and are embedded at build time. Never put a service-role key, Plaid secret, OpenAI key, database password or AWS credential there.

### Plaid

Set the client ID, secret and environment. Use Sandbox first. Configure a public HTTPS webhook endpoint ending in `/webhooks/plaid`; a local development tunnel may expose that route to Plaid. The app requests US institutions and USD transactions. A history import can remain in progress while Plaid retrieves bank history; completion is based on Plaid’s historical sync status, not a fabricated percentage. First connect starts an initial sync; later webhooks continue it.

### OpenAI, S3 and KMS

Set `OPENAI_API_KEY`, `AWS_REGION`, `AWS_KMS_KEY_ID` (the key ARN), and `AUDIO_BUCKET`. Use an AWS workload identity with permissions derived from `infra/iam-policy.json`. The KMS key must permit data-key generation and decrypt; S3 must be private and use the same KMS key. The application uses the specifically requested `gpt-4o` and `whisper-1`, and `text-embedding-3-small` for 1536-dimensional embeddings.

`PII_ANALYZER_URL` points to your private Presidio analyzer. Text is tokenized before persistence/embedding/chat. Original voice audio is still sent to Whisper to perform the requested transcription, and retained privately in S3. A PII detector reduces exposure but cannot prove every possible identifier is detected; validate its language coverage and your retention rules before production.

### Notifications

Generate a VAPID keypair using `web-push.generateVAPIDKeys()` and set the VAPID environment variables. Web Settings registers the service worker and browser subscription after permission is granted. A scheduler uses the latest reconciled bill state, 72/24/1-hour lead times, generic lock-screen messages and persistent delivery IDs. Reminders are based on 12:00 UTC due dates.

Native remote notifications use Expo Push Service. Configure an EAS project, APNs/FCM credentials and optionally `EXPO_ACCESS_TOKEN`. The native Settings flow registers a push token and saves the selected leads. The backend checks Expo receipts and removes invalid tokens. Demo native reminders use local scheduling.

## Run mobile

```sh
cd apps/mobile
npm ci
cp .env.example .env
npm run ios
# Or: npm run android
```

A native development build is required for Plaid and certificate pinning; Expo Go is not supported for those native modules. Xcode/Android Studio and platform SDKs are required. `npm run start` starts Metro for an already-built client.

For live mode, set `EXPO_PUBLIC_MODE=live`, the HTTPS API URL, Supabase public values, EAS project ID, and two API SPKI hashes (current and backup). Configure `finsight://auth/callback` in Supabase’s redirect allowlist. The app refuses live startup without pinning support/configuration and requires enrolled biometrics. Tokens are stored in device Keychain/Keystore through SecureStore; backgrounding locks the diary and clears its visible financial state.

Both iOS and Android JavaScript/Hermes bundles exported successfully; these are not signed native binaries or physical-device validations. Android/iOS hardware checks remain necessary.

## Validation

```sh
npm run check                 # Web types + unit/security/embedded PostgreSQL tests
npm run test:integration      # Isolated API and Socket.io tests on localhost:14019
npm run build                # Production Next.js build
npm run typecheck --prefix apps/mobile
cd apps/mobile
npx expo export --platform ios --output-dir /tmp/finsight-mobile-export
```

The integration tests use a unique temporary data directory and do not change your demo diary. They cover persistence, rejected malformed input, calculation-backed chat and a local WebSocket update within two seconds. Provider calls are not part of those tests. Test coverage is described in `docs/SECURITY.md`.

`npm audit` reports no known vulnerabilities for either lockfile at build time. The mobile tree overrides transitive `uuid` to its patched CommonJS-compatible 11.x release; both Plaid and Xcode tooling use its compatible `v4` API.

## Deployment and limits

Build the web app with `npm run build`; run it with `npm run start -w @finsight/web`. The API image builds from the repository’s FinSight root using `docker build -f services/api/Dockerfile .`. `infra/security.tf` provisions a KMS key, encrypted private S3/RDS and WAF for an existing VPC/application load balancer. Application compute, managed queue/cache, Supabase configuration and secret injection are deployment-specific and are not provisioned automatically.

The two-second webhook update and one-second LLM response requirements are **SLO targets, not guarantees**. Financial calculation responses are local and fast; general GPT-4o answers and Plaid history retrieval depend on remote services. Plaid is not a continuous bank transaction stream. See `docs/ARCHITECTURE.md` for calculation semantics, delivery behavior, and the distinction between bank freshness and webhook processing latency.

Sources used for the adapters: [Plaid transactions](https://plaid.com/docs/transactions/), [Plaid webhook verification](https://plaid.com/docs/api/webhooks/webhook-verification/), [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling), [OpenAI transcription](https://developers.openai.com/api/docs/guides/speech-to-text), [Expo audio](https://docs.expo.dev/versions/latest/sdk/audio/), [Expo notifications](https://docs.expo.dev/push-notifications/sending-notifications/), [PGlite extensions](https://pglite.dev/extensions/), [Presidio installation](https://microsoft.github.io/presidio/installation/).
