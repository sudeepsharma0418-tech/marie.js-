# Deployment, backups and operations

## Recommended hosting (early stage)
All prices are typical list prices remembered at the time of writing, in USD per month. **Verify current pricing before buying.** Latency from Butwal to Indian regions is roughly 40–80 ms.

| Option | Setup | Est. monthly | Pros | Cons |
|---|---|---|---|---|
| **A. Recommended**: DigitalOcean Bangalore (BLR1) | 1 Droplet 2 GB running the Docker image + Managed PostgreSQL (1 GB, daily backups + point-in-time restore) + Spaces for file backups | ~$12 + ~$15 + ~$5 = **~$32** | Managed DB backups/PITR, simple, close to Nepal, predictable bill | Single app server (fine at this scale) |
| B. Render / Railway (Singapore) | Web service + managed Postgres | ~$25–35 | Least server work, auto deploys | Higher latency, less control, cold-start limits on cheap plans |
| C. Budget VPS (Hetzner Singapore / Contabo) | One VM with app + self-managed PostgreSQL + off-site backups (Backblaze B2) | ~$8–12 | Cheapest | You own DB patching, backups and restores; higher operational risk for financial data |
| D. AWS Lightsail Mumbai | Instance + managed DB | ~$25–35 | AWS ecosystem | More moving parts |

Recommendation: **Option A**. Financial records justify a managed database with automatic backups and point-in-time recovery. Add Cloudflare (free plan) in front for DNS, HTTPS and basic DDoS protection.

One-time/annual costs: domain (`.com` ~$12/yr; `.com.np` is free for registered Nepali businesses via Mercantile — verify), optional SMS provider (e.g. Sparrow SMS, prepaid per message), transactional email (e.g. Amazon SES, ~$0.10 per 1,000 emails). Error tracking (Sentry free tier) and uptime monitoring (UptimeRobot free) cost nothing at this size.

## Environments
| | Database | Notes |
|---|---|---|
| development | `hotelproc_dev` | `pnpm db:reset && pnpm db:seed` loads demo data |
| test | `hotelproc_test` | wiped by every `pnpm test` run (name must contain "test") |
| e2e | `hotelproc_e2e` | wiped by `pnpm e2e` |
| production | managed PostgreSQL | demo seed refused unless `ALLOW_DEMO_SEED=true`; `db:reset` refused |

Environment variables: see `.env.example` (each documented there).

## First production deploy (Option A)
1. Create the managed PostgreSQL cluster (Bangalore), a database `hotelproc` and an **app user without superuser rights**; allow only the Droplet in trusted sources.
2. Create the Droplet (Ubuntu LTS), install Docker, enable the firewall (allow 22 from your IP, 80/443).
3. Build the image (CI or locally): `docker build -t hotelproc:<version> .` and push to a registry (DigitalOcean Container Registry or GHCR).
4. On the Droplet create `/srv/hotelproc/.env` (mode 600):
   ```
   NODE_ENV=production
   DATABASE_URL=postgresql://app:...@db-host:25060/hotelproc?sslmode=require
   APP_ENCRYPTION_KEY=<openssl rand -base64 32>
   WEB_ORIGIN=https://app.yourdomain.com.np
   COOKIE_SECURE=true
   TRUST_PROXY=true
   ```
5. Run: `docker run -d --name hotelproc --restart unless-stopped --env-file /srv/hotelproc/.env -v /srv/hotelproc/storage:/data/storage -p 127.0.0.1:4000:4000 hotelproc:<version>` (migrations run automatically on start).
6. Put Caddy or Nginx in front for TLS (Caddy gets Let's Encrypt certificates automatically), or Cloudflare proxy with "Full (strict)".
7. Create the owner account: temporarily run the seed on a *separate* demo database, or create the first user with a one-off SQL insert using an argon2 hash, then invite everyone else from the app. Change company settings, tax rates and fiscal year in **Settings** first.
8. Health check: `GET /api/v1/health`.

## Upgrades and rollback
- Deploy a new image tag; migrations run before the server starts. Keep the previous image.
- Migrations are written to be additive. To roll back the code, redeploy the previous tag (old code tolerates new nullable columns). If a migration must be undone, restore from the point-in-time backup taken right before the deploy — never hand-edit financial tables.
- Take an on-demand backup (`scripts/backup.sh`) before each release.

## Backups and recovery
| What | How | Frequency | Retention |
|---|---|---|---|
| Database | Managed DB automatic backups + PITR | daily / continuous | 7 days (provider) |
| Database (independent copy) | `scripts/backup.sh` (pg_dump custom format) to Spaces/B2 | nightly cron | 30 days + monthly copies for the legal retention period |
| Uploaded files | `scripts/backup.sh` tars `STORAGE_DIR` | nightly | same as DB |

Restore procedure: create an empty database → `TARGET_DATABASE_URL=... scripts/restore.sh db-<stamp>.dump` → restore files tarball into `STORAGE_DIR` → point the app at it → `GET /api/v1/audit/verify` must return `ok: true`.

**Test restores monthly**: `DATABASE_URL=<prod read replica or copy> SCRATCH_DATABASE_URL=<scratch db> scripts/verify-backup.sh` dumps, restores into a scratch database, compares every table's row count and the audit-chain head. (Verified in development: 51 tables, identical counts, chain head matched.)

## Monitoring and logs
- Structured JSON logs (pino) to stdout; `docker logs` or ship to the provider's log service. Authorization headers, cookies and CSRF tokens are redacted.
- Uptime check on `/api/v1/health` every 5 minutes.
- Add Sentry (or similar) for error tracking: not integrated yet (see KNOWN_LIMITATIONS).
- Watch: failed logins (`/api/v1/auth-events`), pending approvals, offline sync issues (Reports → Operations), audit chain verification.
