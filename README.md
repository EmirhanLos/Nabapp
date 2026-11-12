# Nabapp

Nabapp is a Node.js/Express and WebSocket messaging app with a vanilla browser client and SQLite storage. Run it on **Node.js 20 or newer**.

## Run locally

```powershell
Copy-Item .env.example .env
```

Set `NABAPP_SECRET` to a random value of at least 32 characters. For encrypted backups, generate a separate 32-byte key:

```powershell
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Put the values in `.env`, then run:

```powershell
npm ci
npm start
npm test
```

The app is served at `http://localhost:3000`; `GET /api/health` is the unauthenticated health check. Development SMS and email codes are printed to the server console. Production SMS currently requires a configured SMS provider; no general-purpose, guaranteed-free SMS service exists. Production email uses SMTP. For Gmail, create an app password and put it in `SMTP_PASS` in your local `.env`; use `SMTP_USER` for the Gmail account and `SMTP_FROM` for the sender. Never put credentials in source control or chat. SMS and email templates can be customized with `SMS_VERIFICATION_TEMPLATE`, `EMAIL_VERIFICATION_SUBJECT`, and `EMAIL_VERIFICATION_TEMPLATE`; use `{code}` where the one-time code should appear. Templates default to the Turkish examples in `dogrulamaornek.txt`.

By default, sessions do not expire from inactivity (`SESSION_IDLE_MINUTES=0`), but still expire after `SESSION_DAYS` (30 days in the example). Set a positive idle timeout if your deployment requires automatic session expiry.

### Test with two accounts

For local testing, keep `NABAPP_SMS_PROVIDER=dev` in `.env`. Register two accounts with the reserved fictional North American numbers `+12025550101` and `+12025550102`; no real SMS can be delivered to these numbers. When either account requests a verification code, read it from the terminal running `npm start` and enter it in that account's browser. Each account keeps its own session token and encryption key backup even inside the same browser profile (see "Account isolation and key backup recovery"), but separate browser profiles (for example, a normal window and a private window) still make testing easier. Keep both windows open, add the other number using **New chat**, then send a message. The development verification code is for local testing only; configure a real SMS provider for production.

`ALLOWED_ORIGINS` is a comma-separated exact origin allowlist for cross-origin deployments. Without it, only same-origin browser requests are allowed. Set `TRUST_PROXY=true` only when the app is behind a trusted reverse proxy that overwrites forwarded headers. HTTPS termination belongs at that proxy/load balancer; Helmet applies HSTS in production.

The API uses explicit Bearer authorization headers, not cookies, so classic cookie-based CSRF tokens are not used. Keep the Content Security Policy restrictive and do not add untrusted inline scripts: a browser XSS flaw could access the locally stored session token.

## Account isolation and key backup recovery

Session tokens, encrypted identity key backups, and pinned contact keys are stored **per account**, not in one shared browser slot:

- `nabapp-session-v2:<phone>` — the session token of that account.
- `nabapp-identity-v2:<userId>` — the encrypted identity key backup of that account.
- `nabapp-trusted-v2:<userId>` — the contact fingerprints that account has pinned.

The active account is bound per tab (`sessionStorage`) and per profile (`localStorage`). Registering or logging into a second account in the same browser profile therefore no longer destroys the first account's keys, and two accounts in two tabs no longer share a token. The pre-upgrade single slots (`nabapp-token`, `nabapp-identity`, `nabapp-trusted-keys-v1`) are migrated into the owning account's slot on first use; a backup that belongs to another account is skipped and never deleted.

**One account at a time per browser.** The app follows the rule that a single browser keeps one account open: **Settings → HESAPLAR** lists the accounts with a session in this profile, marks the open one, and switches to another with a single click (its keys stay in their own slot and are restored on the next unlock). The login screen lists the same accounts so the phone number can be filled with one click, and registering a second account warns that another account is still open.

If a device has no keys for the logged-in account, the app no longer dead-ends: **Settings → ŞİFRELEME ANAHTARLARI** offers "Anahtar yedeğini dışa aktar" on the device that holds the keys and "Yedek dosyasından geri yükle" on the new device. The exported file contains only the password-encrypted key blob (AES-256-GCM, PBKDF2-SHA256), so private keys never leave the device in clear text and the server never sees them. The chat view also shows an "Anahtarları geri yükle" notice while the account has no keys on the device.

## Message encryption status

The browser now signs signed prekeys with ECDSA P-256, verifies the signature before session setup, and pins contact identity fingerprints on first use. Compare the displayed fingerprint with the contact through a separate trusted channel; the server can still substitute keys before that first verification. A changed pinned key blocks new session setup. The X3DH/Double Ratchet implementation remains project code, has not been independently audited, and must not be represented as equivalent to an audited Signal implementation. Existing clients/accounts without the new signing key must generate and publish updated encryption keys before starting new sessions.

Group chats encrypt each message separately to every member using that member's pairwise session; group membership and routing metadata are visible to the server. Files up to 4 MB are carried inside the encrypted message envelope. WebRTC audio/video calling uses direct peer connectivity with public STUN as a best-effort default; some NATs/firewalls require a TURN relay and calls require HTTPS plus microphone/camera permission. Background push delivery is not enabled. The current app is a web/PWA, not native Android/iOS; it cannot send SMS through a device SIM. There is no cross-platform, guaranteed-free way to deliver real SMS without an SMS provider or operator service.

## Docker

Copy `.env.example` to `.env`, set production secrets/provider settings, then:

```powershell
docker compose up --build -d
```

SQLite data is persisted in the `nabapp-data` volume. The included GitHub Actions workflow runs tests and checks production dependencies. Production integrations such as Netgsm, SMTP, Sentry, New Relic, CDN, DNS/firewall, and deployment rollback require service-specific credentials and infrastructure; configure them outside the source tree.

## Encrypted backups and recovery

Set a unique `BACKUP_ENCRYPTION_KEY` before running:

```powershell
npm run backup
```

The script uses SQLite's online backup API, writes AES-256-GCM encrypted backups, and rotates backups older than seven days. Schedule it with Task Scheduler or cron and copy encrypted backups to separate protected storage. Keep the backup key separately; losing it makes backups unrecoverable.

To restore, stop the application first, set the same backup key and `NABAPP_RESTORE_CONFIRM=YES`, then run:

```powershell
npm run restore -- E:\path\to\nabapp-YYYY-MM-DDTHH-MM-SS-sssZ.db.enc
```

The restore tool authenticates/decrypts the backup, runs SQLite integrity validation, and retains an encrypted copy of the previous database. Keep that copy until the application and restored data have been verified.

## Operations

- Check `/api/health`, process logs, disk space, database/backup age, CPU and memory routinely; alert on repeated restarts, failed requests, low disk space, and missed backups.
- Apply dependency/security updates regularly, test restores, and review access to secrets and backup storage.
- For an outage, inspect logs and health first; restart only after preserving relevant logs. For database recovery, stop writes and use the validated restore procedure above.
- For suspected abuse or data exposure, preserve relevant logs, restrict affected credentials/access, assess notification and legal obligations, and follow your incident-response process.
