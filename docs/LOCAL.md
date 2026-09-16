# Running FinSight on your computer

Requires Node.js 22+ and npm. No cloud account, Docker, or API keys are required for local demo mode.

```sh
cd /Users/tonycali/fitness-coach/finsight
npm ci
npm run local
```

Open http://localhost:3000. Keep the terminal running; Ctrl+C stops the web server and API. The startup command builds an optimized web dashboard and binds both services to `127.0.0.1`. It refuses occupied ports and remote-backend settings instead of silently connecting your local UI to another service. Use `npm run dev` when editing code.

## What works locally

Sample bank history, calculated income/expenses/debt, budgets, recurring bills, simulated transaction updates, written and audio diary entries, local playback, text search, deterministic tags, and calculation-based affordability answers. Saved recordings can include a written note for search. The bank history is explicitly synthetic. Real bank synchronization, Whisper transcription, general GPT answers, hosted login and remote push require their configured providers; they are not simulated as successful in local mode.

## Storage and security

`.data/demo.json` contains an AES-256-GCM encrypted envelope, including saved audio. `.data/demo.json.key` is a randomly generated encryption key restricted to your OS account (`0600`). New data directories are `0700`; writes use a synced temporary file and atomic replacement. Existing plaintext demo data is automatically encrypted on first startup. Do not delete its key: missing keys or damaged ciphertext stop startup rather than replacing your diary with sample data.

The local key is stored on the same computer. This protects against disclosure of the data file alone, not malware or another process running as your OS user. Use your OS login and disk encryption for laptop protection. Local demo has no separate application login and is intended for one trusted OS user. Cloud MFA, KMS, WAF and device biometrics are separate live/mobile capabilities, not claims about this local deployment.

The API rejects untrusted browser origins, rebinding Host headers, and cross-site browser requests. WebSocket upgrades enforce the same policy. Financial responses are not cached. The dashboard uses a fresh script nonce per request, prohibits embedding, and loads no remote fonts. Inline styles remain allowed for the UI's charts. The app does not make external AI or bank calls in demo mode.

## Encrypted backup and restore

```sh
npm run backup
# Or choose a file:
npm run backup -- /path/to/diary.finsight
```

Enter a passphrase of at least 12 characters at the hidden prompt. The portable backup uses a separate scrypt-derived key and AES-256-GCM; it includes reflections, recordings and all local financial data. Store the passphrase separately. A snapshot is read atomically, so backups can be taken while the local app is running. Reusing an output filename replaces that backup.

Test a restore without overwriting your current diary:

```sh
npm run restore -- /path/to/diary.finsight /path/to/new-restored-directory
```

The destination must not already exist. Restoration creates a new local key, checks the encrypted backup, and preserves the original diary. Stop the running app before switching to the restored file:

```sh
DEMO_DATA_FILE=/path/to/new-restored-directory/demo.json npm run local
```

For scripted tests, `FINSIGHT_BACKUP_PASSWORD` can supply the passphrase without a prompt; avoid putting actual passphrases in shell history. Backups and local keys are ignored by Git. Deleting entries or rotating an OS password does not erase previously created backup files; manage those copies explicitly.

## Verification

```sh
npm run check
npm run test:integration
```

Tests cover encryption/reopen, legacy migration, file permissions, missing keys, modified ciphertext, concurrent writes, password-protected backup restore, origin/Host rejection, WebSocket rejection, local recording retrieval and finance calculations. An optimized local build and matching nonces on all rendered scripts were also verified. External bank/AI flows and physical-device security remain untested without their services/devices.
