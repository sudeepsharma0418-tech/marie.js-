# HotelProc Butwal: hotel procurement, supply and finance platform

A B2B platform for a hotel supply business in Butwal, Nepal: hotels order from one catalog; staff source from suppliers, consolidate at a hub and deliver; the business invoices, collects and pays suppliers; hotels track shelf stock with QR codes (offline capable). English and Nepali.

> Status: **working prototype (Phase 1 foundation + Phase 2 slice, with much of Phase 3)**. All automated tests pass. **Not yet validated for Nepal tax compliance** — read [docs/COMPLIANCE.md](docs/COMPLIANCE.md) before issuing real invoices.

## Quick start (development)
Requirements: Node 22+, pnpm 10, PostgreSQL 16 (or `docker compose up -d db`).
```bash
pnpm install
cp .env.example .env            # set DATABASE_URL, TEST_DATABASE_URL, APP_ENCRYPTION_KEY (openssl rand -base64 32)
pnpm db:reset && pnpm db:seed   # schema + clearly labelled demo data (prints the demo password)
pnpm dev:api                    # http://localhost:4000
pnpm dev:web                    # http://localhost:5173
```
Demo accounts (password printed by the seed): `owner@demo.local`, `procurement@demo.local`, `hub@demo.local`, `driver@demo.local`, `manager@tinau.demo.local`, `purchase@tinau.demo.local`, `store@tinau.demo.local`, `manager@lumbini.demo.local`, `manager@hills.demo.local`.

## Try the full flow
1. **Owner** → Hotels → create a hotel, credit terms, invite a manager (copy the link). Pricing → add rules.
2. **Hotel manager** (any language) → Order supplies → cart → Submit.
3. **Procurement** → Orders → the order → record quotes, Select supplier per line → Create purchase orders → Submit for approval.
4. **Owner** → Approvals → Approve. **Procurement** → PO → Mark sent.
5. **Hub** → Purchase orders → Receive goods (record damage if any).
6. **Procurement** → order → Schedule delivery on a run with a driver. **Hub** → Deliveries → Dispatch.
7. **Driver** (phone) → My deliveries → Confirm delivery (partial/returned quantities allowed).
8. **Procurement** → Invoices → the draft → Issue tax invoice. **Hotel manager** sees it and the balance.
9. **Procurement** → Payments → Record payment (partial is fine). Supplier bills → from PO → Post → record supplier payment.
10. **Owner** → Reports → Reconciliation / margin / aging. Audit log → Verify integrity.
11. **Store keeper** (phone) → Scan shelf → product → Used / Restocked. Turn off the network, record more, turn it back on: it syncs without duplicates.

## Commands
| | |
|---|---|
| `pnpm test` | shared + API (real PostgreSQL) + web tests |
| `pnpm e2e` | Playwright browser tests (mobile + desktop) |
| `pnpm lint` / `pnpm typecheck` / `pnpm build` | static checks and production builds |
| `pnpm db:generate` / `db:migrate` / `db:seed` / `db:reset` | schema workflow |
| `scripts/backup.sh`, `restore.sh`, `verify-backup.sh` | backups and restore testing |

## Documentation
- [Architecture & stack decision](docs/ARCHITECTURE.md)
- [Database & migrations](docs/DATABASE.md)
- [API reference](docs/API.md)
- [Roles & permission matrix](docs/PERMISSIONS.md)
- [Business rules & workflows](docs/BUSINESS_RULES.md)
- [Security, privacy & offline data](docs/SECURITY.md)
- [Testing](docs/TESTING.md)
- [Deployment, hosting costs, backups](docs/DEPLOYMENT.md)
- [Nepal compliance items to verify](docs/COMPLIANCE.md)
- [Known limitations & next milestones](docs/KNOWN_LIMITATIONS.md)

## Layout
```
apps/api          Fastify + Drizzle + PostgreSQL (modular monolith, /api/v1)
apps/web          React + Vite PWA (English/Nepali, offline shelf inventory)
packages/shared   permissions, workflows, exact money maths
e2e/              Playwright tests        scripts/  backup & restore
docs/             documentation
```
