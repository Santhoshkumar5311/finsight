# Validation record

Validated locally on 2026-09-16.

| Check                      | Result                                                                                    |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run check`            | Passed: web TypeScript and 40 unit/database/security tests                                |
| `npm run test:integration` | Passed: 11 isolated HTTP/WebSocket integration tests                                      |
| `npm run build`            | Passed: optimized Next.js production build                                                |
| Mobile TypeScript          | Passed                                                                                    |
| Expo iOS export            | Passed: JavaScript/Hermes bundle, not a signed binary                                     |
| Expo Android export        | Passed: JavaScript/Hermes bundle, not a signed binary                                     |
| Root dependency audit      | 0 known vulnerabilities                                                                   |
| Mobile dependency audit    | 0 known vulnerabilities                                                                   |
| Chrome interaction checks  | Dashboard, filtered transaction search, assistant opening/calculated response, diary save |

The SQL suite runs the real migration twice in PGlite with pgvector and pgcrypto. It checks owner isolation with two users, denied client banking mutations, denied credential access, scoped agent reads/writes, and anonymous diary access denial. It does not replace hosted PostgreSQL integration testing or a security review.

The local Socket.io test observed the new transaction, received an update, and verified changed financial totals within its 2-second deadline. This is not an external-provider or production latency measurement. The agent explicitly labels forecast assumptions and does not claim future cash flow is guaranteed.

External Plaid, Supabase OAuth/TOTP, Whisper, GPT-4o, Presidio, AWS, RabbitMQ, Redis and notification-provider calls were not exercised with live credentials. Physical-device biometrics, native pinning, OAuth redirects and push delivery remain deployment validation tasks. Terraform resources were supplied but not applied.

Local hardening checks: encrypted legacy diary migration, file permissions, ciphertext tamper rejection, missing-key failure, concurrent persistence, portable passphrase backup roundtrip, cross-origin and Host rejection, WebSocket origin rejection, and saved audio roundtrip without embedding audio in API JSON. The optimized local server was started using `npm run local`; HTTP health, unique per-request CSP nonces matching every rendered script, no-store responses, and encrypted storage were verified. Chrome rendered the dashboard with the new CSP enabled.
