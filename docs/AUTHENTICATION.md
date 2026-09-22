# Authentication

Local use: run `npm run local`, open http://localhost:3000/login and create the single owner account with your email and a password of at least 12 characters. No hosted login or email delivery is involved. The account protects the entire local workspace. Existing data is unavailable over HTTP or Socket.io until you sign in. There is no default password.

Passwords are salted and hashed with scrypt. The local email is stored as a hash; authentication records have owner-only filesystem permissions. Session cookies are HttpOnly and SameSite=Strict, expire after eight hours or 30 minutes without activity, and are invalidated when the API restarts. Logout disconnects sockets. Changing your password revokes existing sessions. This loopback-only mode uses HTTP; do not expose it through a tunnel or public reverse proxy.

For a forgotten local password, stop FinSight, then run:

```sh
npm run local:reset-login -- --confirm
npm run local
```

Create the replacement login. The command archives only the authentication file and preserves the encrypted diary/key. OS account access is trusted: someone who can read the diary and adjacent encryption key can decrypt it or reset this login. Enable FileVault and protect your OS account. Keep passphrase-encrypted backups separately (`npm run backup`).

Production uses Supabase Auth instead of this local account. Configure the public URL/anon key at web build time and the issuer on the API. Enable Google OAuth, email confirmation and recovery delivery, and allow the exact `/login` callback URL and mobile callback scheme. The login page supports email signup, password login, Google, recovery and TOTP enrollment/verification. Every live API and socket requires a signed, unexpired, authenticated-role JWT with `aal2`. No dashboard data is loaded before the gate succeeds.

API logout records the session ID in Redis and closes its sockets; the frontend also revokes the current Supabase refresh session. Redis outages fail closed. External admin revocation is bounded by JWT expiry unless it also reaches the API revocation store; configure short JWT lifetimes. Exercise signup, OAuth callback, email recovery, MFA recovery and multi-replica logout on the actual hosted project before launch. Local password authentication is not TOTP MFA.
