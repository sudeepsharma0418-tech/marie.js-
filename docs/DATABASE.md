# Database

PostgreSQL 16. Schema in `apps/api/src/db/schema/*.ts`; SQL migrations in `apps/api/drizzle/` (applied in order, recorded in the `drizzle.__drizzle_migrations` table).

| Migration | Content |
|---|---|
| 0000_init | All tables, foreign keys, unique indexes, CHECK constraints |
| 0001_integrity_triggers | Append-only triggers (audit, ledger, hub/hotel stock, reservations, price history); freeze issued invoices / credit notes / posted bills and their lines; payment and allocation immutability |

## Entities (51 tables)
- **Organisation & security**: `company_settings` (single row), `users`, `sessions` (hashed tokens), `user_invitations`, `password_reset_tokens`, `auth_events`
- **Hotels**: `hotels` (credit limit, terms, status), `hotel_contracts` (versioned)
- **Suppliers & catalog**: `suppliers`, `supplier_contacts`, `categories` (tree), `units`, `products` (EN/NE names, units, reference cost, tax code), `supplier_products`, `supplier_quotations`, `pricing_rules`, `price_history`, `tax_rates`
- **Orders**: `orders`, `order_lines` (price snapshot, supplier selection), `order_events` (timeline), `product_requests`
- **Procurement**: `purchase_orders`, `po_lines`, `goods_receipts`, `goods_receipt_lines`
- **Hub**: `hub_stock_movements`, `hub_reservations`
- **Delivery**: `delivery_runs`, `deliveries`, `delivery_lines`
- **Hotel inventory**: `hotel_locations` (areas/shelves + QR token), `shelf_products`, `hotel_inventory_events` (raw device events, id = client UUID), `hotel_stock_movements`
- **Finance**: `invoices`, `invoice_lines`, `credit_notes`, `credit_note_lines`, `supplier_bills`, `supplier_bill_lines`, `payments`, `payment_allocations`, `financial_adjustments`, `ledger_entries`, `document_series`
- **System**: `approval_requests`, `notifications`, `attachments`, `audit_logs`, `system_config`

## Important constraints
- Hotel roles must have `hotel_id`; internal roles must not (`users_hotel_scope_chk`).
- Committed POs require approval fields (`purchase_orders_commit_needs_approval_chk`); direct POs need a hotel.
- Pricing rule targets must match scope; fixed prices only for product scopes.
- Delivery lines must balance; receipt quantities non-negative; hub movement sign matches type.
- Ledger: exactly one of debit/credit positive; party type matches account; unique per source.
- Payments: party matches direction; unique live reference per party+method.
- One pending approval per (type, target).

## Conventions
UUID primary keys (ledgers use bigserial for ordering); `numeric(14,2)` money, `numeric(14,3)` quantities, `numeric(7,3)` percentages; `timestamptz` in UTC; `date` for business dates in Nepal time. Demo rows carry `is_demo = true`.

## Changing the schema
1. Edit `apps/api/src/db/schema/*.ts`.
2. `pnpm db:generate` → review the new SQL in `apps/api/drizzle/`.
3. For triggers/functions: `pnpm --filter @hp/api exec drizzle-kit generate --custom --name <name>` and write SQL.
4. `pnpm db:migrate` locally, run tests, commit the migration. Production applies migrations on container start.
Never edit an applied migration; add a new one. Prefer additive changes (new nullable column → backfill → constraint) for zero-downtime deploys.
