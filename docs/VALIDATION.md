# Validation record

Validated locally on 2026-09-16.

| Check | Result |
| --- | --- |
| `npm run check` | Passed: web TypeScript and 35 unit/database/security tests |
| `npm run test:integration` | Passed: 8 isolated HTTP/WebSocket integration tests |
| `npm run build` | Passed: optimized Next.js production build |
| Mobile TypeScript | Passed |
| Expo iOS export | Passed: JavaScript/Hermes bundle, not a signed binary |
| Expo Android export | Passed: JavaScript/Hermes bundle, not a signed binary |
| Root dependency audit | 0 known vulnerabilities |
| Mobile dependency audit | 0 known vulnerabilities |
| Chrome interaction checks | Dashboard, filtered transaction search, assistant opening/calculated response, diary save |

The SQL suite runs the real migration twice in PGlite with pgvector and pgcrypto. It checks owner isolation with two users, denied client banking mutations, denied credential access, scoped agent reads/writes, and anonymous diary access denial. It does not replace hosted PostgreSQL integration testing or a security review.

The local Socket.io test observed the new transaction, received an update, and verified changed financial totals within its 2-second deadline. This is not an external-provider or production latency measurement. The agent explicitly labels forecast assumptions and does not claim future cash flow is guaranteed.

External Plaid, Supabase OAuth/TOTP, Whisper, GPT-4o, Presidio, AWS, RabbitMQ, Redis and notification-provider calls were not exercised with live credentials. Physical-device biometrics, native pinning, OAuth redirects and push delivery remain deployment validation tasks. Terraform resources were supplied but not applied.
