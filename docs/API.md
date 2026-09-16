# API reference

Base URL: `http://localhost:4000` in development. Live `/api/*` routes require `Authorization: Bearer <Supabase AAL2 JWT>`. All amounts are integer USD cents. Errors are JSON `{ "error": "…" }`. Banking data is never written through user-facing routes.

| Method | Route                   | Body / query                                       | Result                                                                     |
| ------ | ----------------------- | -------------------------------------------------- | -------------------------------------------------------------------------- |
| GET    | `/health`               | —                                                  | Status and mode                                                            |
| GET    | `/config`               | —                                                  | Mode and public push configuration                                         |
| GET    | `/api/dashboard`        | `month=YYYY-MM&period=month\|week`                 | Accounts, transactions, diary, budgets, preferences and calculated summary |
| POST   | `/api/plaid/link-token` | `{}`                                               | Plaid Link token                                                           |
| POST   | `/api/plaid/exchange`   | `{publicToken}`                                    | 202, import queued                                                         |
| GET    | `/api/plaid/status`     | —                                                  | Per-item import states                                                     |
| POST   | `/webhooks/plaid`       | Raw JSON with `Plaid-Verification` header          | 202 after durable acceptance                                               |
| POST   | `/api/chat`             | `{message, allowReminder?:false}`                  | Answer, source, latency; calculation for affordability                     |
| PUT    | `/api/budgets`          | `{budgets:[{category,limit}]}`                     | Saved                                                                      |
| POST   | `/api/budgets/generate` | `{}`                                               | Generated budgets                                                          |
| POST   | `/api/bills`            | `{name,amount,due:"YYYY-MM-DD",category?:"Other"}` | New bill                                                                   |
| PUT    | `/api/preferences`      | `{leadHours:[72,24,1],notifications:false}`        | Saved preferences                                                          |
| POST   | `/api/diary`            | Multipart `audio` OR JSON/multipart `text`         | Redacted reflection, tags and transaction references                       |
| GET    | `/api/diary/search`     | `q=…`                                              | Owner-scoped search results                                                |
| GET    | `/api/diary/:id/audio`  | —                                                  | Authenticated private audio stream                                         |
| POST   | `/api/push`             | `{endpoint,keys:{p256dh,auth}}`                    | Browser subscription                                                       |
| POST   | `/api/push/mobile`      | `{token:"ExpoPushToken[…]"}`                       | Native subscription                                                        |
| POST   | `/api/demo/transaction` | `{}`                                               | Demo-only sample purchase and broadcast                                    |

Socket.io connects to the API origin with `auth: { token }`. The server assigns the room from the verified subject. Listen for `dashboard:update`, then refetch the current month/week. A notification is a cache-invalidation event, not an entire financial payload.

Live audio uploads allow WebM, M4A/MP4, WAV, MP3 and Ogg MIME types, with a 20 MB limit. An unsupported or absent upload does not create an empty diary entry. UI capture limits recordings to three minutes. Whisper/S3/PII failure returns an error; there is no fake transcript fallback.
