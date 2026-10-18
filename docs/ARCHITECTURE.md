# Architecture

## Business in one paragraph
A single company in Butwal buys hotel supplies from many suppliers and resells them to hotels, guesthouses and resorts at a markup. Hotels order from one catalog; staff pick suppliers manually, buy (owner approves commitments), receive at a small consolidation hub (or the supplier delivers direct), deliver on scheduled runs, invoice what was actually delivered, and record payments that happen outside the system (bank, cash, cheque, wallet). Hotels also track their own shelf stock with QR codes, including offline.

## Stack decision
| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language, shared types and rules between API and web |
| API | Node 22 + Fastify 5 | Fast, mature, small; good plugin ecosystem (cookies, rate limit, multipart, helmet) |
| Database | PostgreSQL 16 | Real transactions, row locks, CHECK constraints, triggers, `numeric` money |
| DB access | Drizzle ORM + SQL migrations | Typed queries, readable generated SQL, pure JS (no native engine), hand-written SQL where needed (triggers) |
| Validation | Zod | Same schemas style for every endpoint |
| Web | React 19 + Vite + React Router + TanStack Query + Tailwind 4 | Standard, fast, easy to hire for |
| i18n | i18next, `en.json` / `ne.json` generated from one table | Both languages always have the same keys (tested) |
| Offline | Service worker (app shell) + IndexedDB outbox | Only the inventory workflow is offline, as specified |
| Tests | Vitest (API integration on a real PostgreSQL, web units), Playwright (browser) | Tests exercise real constraints and triggers, not mocks |

Rejected: Prisma (native engine download, weaker control of triggers/CHECKs), microservices (no need at this scale), a SaaS multi-tenant design (single company for now; hotel isolation is still enforced).

## Shape
```
apps/api        Fastify modular monolith (one process, one database)
  src/modules   auth, users, settings, hotels, suppliers, catalog + pricing engine, orders,
                requests, procurement (POs, receiving), hub, delivery, hotel-inventory,
                finance (invoices, credit notes, bills, payments, ledger), approvals,
                reports, attachments, admin (audit, notifications, dashboard)
  src/db        schema (Drizzle), migrations, seed
  drizzle/      SQL migration history (0001 adds integrity triggers)
apps/web        React SPA, served by the API in production
packages/shared roles + permission matrix, workflow state machines, exact money maths
e2e/            Playwright browser tests
```
The API is JSON over HTTPS under `/api/v1`, usable by future Android/iOS apps with `Authorization: Bearer` tokens (login with header `x-client: mobile` returns a token). Business rules live only in the API.

## Key design rules
- **Separate records with links**: customer order → supplier quotations → purchase orders → goods receipts → deliveries → invoices → payments; supplier bills and supplier payments separately. None is inferred from another.
- **Ledgers, not editable balances**: hub stock, hub reservations, hotel shelf stock, AR and AP are append-only ledgers (DB triggers block UPDATE/DELETE). Balances are sums.
- **Finalized documents are frozen** by DB triggers (issued invoices, credit notes, posted bills, recorded payments). Corrections use credit notes, reversals and approved adjustments.
- **Money** is `numeric(14,2)` in PostgreSQL and integer paisa (BigInt) in code; quantities `numeric(14,3)`. No floating point in calculations (browser only formats).
- **Time**: stored as `timestamptz` (UTC); business dates (invoice, due, payment) are `date` in Nepal time (Asia/Kathmandu).
- **Transactions** wrap every multi-step change; row locks (`SELECT … FOR UPDATE`) and advisory locks protect allocations, numbering, stock and the audit chain.
- **Security** is server side: every route has a permission guard; hotel users are pinned to their own hotel; other hotels' ids return 404.
