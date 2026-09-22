# Local verification — 22 September 2026

- 77 unit/security/database/document tests passed; migrations exercised in PGlite with pgvector.
- 16 HTTP/Socket.io integration tests passed, using disposable data and synthetic credentials.
- Web and Expo TypeScript checks passed; Next.js production build passed.
- `npm audit --omit=dev --audit-level=high`: zero vulnerabilities reported.
- All five supplied ICICI documents reconciled: 146 unique transactions, three accounts. Reimport added zero transactions. Original statements were not copied into the repository. Repayment descriptions are excluded from spending and recurring-bill detection; card refunds reduce card expenses.
- Personal store and encryption key have mode 0600; stored content is an authenticated encrypted envelope. The unauthenticated dashboard returned 401, `/config` required initial owner registration, and `/login` returned 200 with a nonce-based CSP.
- Ollama Qwen3 8B answered synthetic prompts; FinSight's local adapter correctly rendered synthetic rupee/paise values after formatting the model context. Prime Agent's separate tools-disabled configuration answered a synthetic prompt through loopback.

Not validated here: Docker image execution (no local Docker engine), Terraform apply, live Supabase/OAuth/MFA, Plaid, private Redis/RabbitMQ/Presidio/S3/KMS services, physical devices, cloud recovery/rotation, accessibility/visual browser interaction (computer-use browser unavailable), and production load/latency SLOs. CI includes Docker builds; its remote result must be checked after push. See PRODUCTION.md for the remaining external release gates.
