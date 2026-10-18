# Security, privacy and offline data protection

## Controls implemented
- **Authentication**: argon2id password hashing; 10+ character passwords; generic login errors; account lock for 15 min after 5 failures; per-IP rate limit on login, MFA and reset endpoints; auth events logged.
- **Sessions**: random 256-bit token stored only as SHA-256 hash; HttpOnly SameSite=Lax cookie (Secure in production, enforced at startup); absolute expiry (`sessionHours`); server-side revocation on logout, password change/reset, deactivation, role change and MFA reset; users can sign out other devices.
- **CSRF**: per-session token required in `x-csrf-token` on every cookie-authenticated write; public auth endpoints never read a session.
- **MFA**: TOTP (RFC 6238) with secrets encrypted with AES-256-GCM (`APP_ENCRYPTION_KEY`); enforceable for owner and procurement.
- **Authorization**: permission guard on every route; hotel users pinned to their hotel; cross-hotel ids return 404; supplier costs/margins only for `costs.view`; drivers limited to their runs; owner-only approvals.
- **Input/output**: Zod validation on every input; parameterised SQL only; React escapes output; strict Content-Security-Policy, HSTS, frame and nosniff headers (helmet); CSV exports neutralise formula injection.
- **Uploads**: 10 MB limit, type detected from file content (PDF/JPEG/PNG/WebP only), random storage names, files outside the web root, served only through an authorised endpoint with `nosniff`; hotel users only reach their own non-internal files.
- **Data integrity**: DB constraints and triggers (append-only ledgers, frozen financial documents), transactions, row and advisory locks, idempotency keys.
- **Audit**: append-only, hash-chained log with verification endpoint; secrets are redacted before writing.
- **Secrets**: only via environment variables; `.env` is git-ignored; `.env.example` has no secrets.

## Offline inventory data on devices
- **What is stored** (IndexedDB `hp-offline`): shelf names, QR tokens, product names, units, default usage, low-stock levels and balances for the signed-in user's own hotel, plus that user's unsynced events. No prices, costs, invoices, balances owed or personal data of others.
- **Expiry**: the snapshot carries `expiresAt` (`offlineAccessHours`, default 72 h). After that the device cannot record offline until it reconnects.
- **Shared devices**: data is tagged with the user id; a different user signing in and syncing wipes the previous user's offline data; logout deletes the whole database.
- **Lost device / revoked access**: deactivate the user or revoke their sessions. On next contact the server answers 401 and the app wipes offline data. Unsynced events from a revoked user are never accepted by the server.
- **Limits (honest)**: browser storage is not encrypted beyond the device's own disk encryption. A device that never reconnects keeps data until expiry or until storage is cleared. Mitigations: require screen locks and device encryption on hotel phones, keep `offlineAccessHours` short, use per-person accounts (no shared logins).

## Operational checklist
- Use HTTPS only (TLS at the proxy/CDN), set `COOKIE_SECURE=true`, `TRUST_PROXY=true` behind a proxy.
- Generate `APP_ENCRYPTION_KEY` with `openssl rand -base64 32`; store it in the host's secret store and in the password manager (losing it forces MFA re-enrolment).
- Turn on `mfaEnforced` before go-live; enrol the owner first.
- Database user for the app should not be a superuser (superusers can disable triggers). Keep the superuser for migrations/maintenance only.
- Run `pnpm audit` in CI (configured) and update dependencies monthly.
- Review the audit log and `/audit/verify` weekly; review `auth-events` for repeated failures.
