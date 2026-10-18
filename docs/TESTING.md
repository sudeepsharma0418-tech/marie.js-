# Testing

| Command | What | Needs |
|---|---|---|
| `pnpm test` | All unit + integration tests (shared, API, web) | PostgreSQL with `hotelproc_test` |
| `pnpm --filter @hp/api test` | API integration tests over HTTP against a real database | `TEST_DATABASE_URL` (default `postgresql://hp:hp_dev_password@localhost:5432/hotelproc_test`) |
| `pnpm --filter @hp/web test` | Translations parity, offline logic, sync engine (jsdom + fake IndexedDB) | — |
| `pnpm e2e` | Playwright browser tests (mobile + desktop) starting the API and web app | PostgreSQL with `hotelproc_e2e`, Chromium (`PLAYWRIGHT_BROWSERS_PATH` if preinstalled) |
| `pnpm lint`, `pnpm typecheck`, `pnpm build` | Static checks and production builds | — |
| `scripts/verify-backup.sh` | Backup + restore round trip with row-count and audit-chain comparison | two databases |

The API suite rebuilds the test database schema once per run and truncates/re-seeds per file. Tests use the HTTP layer (`app.inject`) so authentication, CSRF, permissions and validation are exercised, not bypassed.

## Coverage of required behaviours
| Requirement | Test file |
|---|---|
| Full acceptance scenario (spec §14, steps 1–15, 19) with exact money | `apps/api/test/acceptance-flow.test.ts` |
| Login, lockout, CSRF, logout/deactivation revocation, password policy, TOTP MFA and enforcement | `security.test.ts` |
| Cross-hotel access (orders, finance, QR codes, users), confidential costs, role limits, owner-only approvals, permission matrix | `security.test.ts` |
| Pricing precedence, price history, overrides with approval, MOQ, lifecycle transitions, hotel-side approval, credit limit / overdue / on-hold / closed, unlisted requests | `orders-credit.test.ts` |
| Partial and duplicate receipts, over-receipt, damaged goods, hub stock/reservations, dispatch, partial delivery, returns | `acceptance-flow.test.ts`, `integrity.test.ts` |
| PO commitment blocked without approval at DB level, threshold auto-approval, write-off approvals, failed delivery, driver isolation, direct supplier delivery | `integrity.test.ts` |
| Usage/restock, duplicate offline event ids, id reuse, 20 parallel taps plus 10 simultaneous retries, double-tap flag, negative stock, corrections and stale-correction review, transfers, offline snapshot contents, append-only ledger | `hotel-inventory.test.ts` |
| Invoice VAT, snapshots, immutability, partial payments, allocation limits, unallocated credit, credit notes, reversal, AR/AP ledgers, adjustments, report totals vs. records | `finance.test.ts` |
| Parallel over-allocation and gapless parallel invoice numbering | `integrity.test.ts` |
| Upload type validation and file access control | `integrity.test.ts` |
| Audit chain tamper detection, no secrets in audit | `integrity.test.ts` |
| Money maths and state machines | `packages/shared/test/money.test.ts` |
| English/Nepali key parity, all used keys exist, placeholders preserved | `apps/web/test/i18n.test.ts` |
| Offline storage isolation per user, expiry, logout wipe, pending until server confirms, retry with same id | `apps/web/test/offline.test.ts` |
| Nepali ordering in the browser; offline QR usage on a phone viewport then sync with no duplicates (verified server-side); role-restricted pages | `e2e/hotel-flows.spec.ts` |

## Demo data
`pnpm db:seed` loads clearly labelled demo records (`(Demo)` names, `is_demo = true`): 3 hotels, 4 suppliers, 32 bilingual products, pricing rules, Tinau View shelves with opening stock, and accounts for every role (password printed by the seed).
