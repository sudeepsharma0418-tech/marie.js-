# API reference

Base path `/api/v1`. JSON in and out. Generated from the route definitions in `apps/api/src/modules`; keep in sync when adding routes.

## Conventions
- **Auth**: session cookie `hp_sid` (HttpOnly, SameSite=Lax, Secure in production) set by `POST /auth/login`. Writes with a cookie must send header `x-csrf-token` (value from login or `GET /auth/me`). Mobile clients send `x-client: mobile` on login to receive a token and then use `Authorization: Bearer <token>` (no CSRF needed).
- **Errors**: `{ "error": { "code", "message", "details?" } }`. 400 validation, 401 not signed in / `mfa_required`, 403 forbidden / `csrf` / `mfa_enrolment_required`, 404 not found **or another hotel's record**, 409 conflict/duplicate/immutable, 422 business rule, 429 rate limited/locked.
- **Money** is a decimal string with 2 places (`"1250.50"`), quantities 3 places. Never send floats you computed.
- **Idempotency**: `idempotencyKey` on order creation, goods receipts and payments; inventory events use their own UUID `id`.
- **Pagination**: `?page=&pageSize=` where supported, response `{ items, total, page, pageSize, pages }`.
- **CSV**: report and aging endpoints accept `?format=csv`.
- Hotel users are always limited to their own hotel; `hotelId` filters are ignored for them.

| Module | Method | Path | Permission (any of) |
|---|---|---|---|
| admin | GET | `/api/v1/audit` | audit.view |
| admin | GET | `/api/v1/audit/verify` | audit.view |
| admin | GET | `/api/v1/auth-events` | audit.view |
| admin | GET | `/api/v1/notifications` | any signed-in user |
| admin | POST | `/api/v1/notifications/:id/read` | any signed-in user |
| admin | POST | `/api/v1/notifications/read-all` | any signed-in user |
| admin | GET | `/api/v1/dashboard` | any signed-in user |
| approvals | GET | `/api/v1/approvals` | approvals.decide / approvals.request |
| approvals | GET | `/api/v1/approvals/:id` | approvals.decide / approvals.request |
| approvals | POST | `/api/v1/approvals/:id/decide` | approvals.decide |
| approvals | POST | `/api/v1/approvals/:id/cancel` | approvals.request |
| attachments | POST | `/api/v1/attachments` | any signed-in user |
| attachments | GET | `/api/v1/attachments/:id/download` | any signed-in user |
| auth | POST | `/api/v1/auth/login` | public |
| auth | POST | `/api/v1/auth/logout` | public |
| auth | GET | `/api/v1/auth/me` | any signed-in user (own account) |
| auth | PATCH | `/api/v1/auth/me` | any signed-in user (own account) |
| auth | POST | `/api/v1/auth/mfa/setup` | any signed-in user (own account) |
| auth | POST | `/api/v1/auth/mfa/enable` | any signed-in user (own account) |
| auth | POST | `/api/v1/auth/mfa/verify` | any signed-in user (own account) |
| auth | POST | `/api/v1/auth/password/change` | any signed-in user (own account) |
| auth | POST | `/api/v1/auth/password/forgot` | public |
| auth | POST | `/api/v1/auth/password/reset` | public |
| auth | POST | `/api/v1/auth/invitations/accept` | public |
| auth | GET | `/api/v1/auth/sessions` | any signed-in user (own account) |
| auth | POST | `/api/v1/auth/sessions/:id/revoke` | any signed-in user (own account) |
| catalog | GET | `/api/v1/categories` | catalog.read |
| catalog | POST | `/api/v1/categories` | catalog.manage |
| catalog | PATCH | `/api/v1/categories/:id` | catalog.manage |
| catalog | GET | `/api/v1/products` | catalog.read |
| catalog | GET | `/api/v1/products/:id` | catalog.read |
| catalog | POST | `/api/v1/products` | catalog.manage |
| catalog | PATCH | `/api/v1/products/:id` | catalog.manage |
| catalog | GET | `/api/v1/pricing-rules` | pricing.manage |
| catalog | POST | `/api/v1/pricing-rules` | pricing.manage |
| catalog | POST | `/api/v1/pricing-rules/:id/deactivate` | pricing.manage |
| catalog | GET | `/api/v1/pricing/preview` | pricing.manage |
| delivery | POST | `/api/v1/delivery-runs` | delivery.manage |
| delivery | PATCH | `/api/v1/delivery-runs/:id` | delivery.manage |
| delivery | GET | `/api/v1/deliveries` | any signed-in user (own account) |
| delivery | GET | `/api/v1/deliveries/:id` | any signed-in user (own account) |
| delivery | POST | `/api/v1/deliveries` | delivery.manage |
| delivery | PATCH | `/api/v1/deliveries/:id` | delivery.manage |
| delivery | POST | `/api/v1/deliveries/:id/cancel` | delivery.manage |
| finance | GET | `/api/v1/invoices` | any signed-in user (own account) |
| finance | GET | `/api/v1/invoices/:id` | any signed-in user (own account) |
| finance | POST | `/api/v1/orders/:id/invoices` | invoices.manage |
| finance | POST | `/api/v1/invoices/:id/issue` | invoices.manage |
| finance | POST | `/api/v1/invoices/:id/discard` | invoices.manage |
| finance | POST | `/api/v1/credit-notes` | invoices.manage |
| finance | POST | `/api/v1/credit-notes/:id/issue` | invoices.manage |
| finance | GET | `/api/v1/credit-notes` | any signed-in user (own account) |
| finance | GET | `/api/v1/credit-notes/:id` | any signed-in user (own account) |
| finance | GET | `/api/v1/supplier-bills` | bills.manage / finance.view_all |
| finance | GET | `/api/v1/supplier-bills/:id` | bills.manage / finance.view_all |
| finance | POST | `/api/v1/supplier-bills` | bills.manage |
| finance | POST | `/api/v1/supplier-bills/:id/post` | bills.manage |
| finance | POST | `/api/v1/supplier-bills/:id/discard` | bills.manage |
| finance | GET | `/api/v1/payments` | any signed-in user (own account) |
| finance | POST | `/api/v1/payments` | payments.record |
| finance | POST | `/api/v1/payments/:id/allocations` | payments.record |
| finance | POST | `/api/v1/payments/:id/reverse` | payments.reverse |
| finance | GET | `/api/v1/finance/hotels/:id/summary` | any signed-in user (own account) |
| finance | GET | `/api/v1/finance/hotels/:id/statement` | any signed-in user (own account) |
| finance | GET | `/api/v1/finance/suppliers/:id/statement` | finance.view_all |
| finance | GET | `/api/v1/finance/ar-aging` | any signed-in user (own account) |
| finance | GET | `/api/v1/finance/ap-aging` | finance.view_all |
| finance | GET | `/api/v1/finance/orders/:id/margin` | costs.view |
| hotel-inventory | GET | `/api/v1/hotel-inventory/locations` | any signed-in user (own account) |
| hotel-inventory | GET | `/api/v1/hotel-inventory/scan/:token` | hotel_inventory.view |
| hotel-inventory | POST | `/api/v1/hotel-inventory/events` | hotel_inventory.record |
| hotel-inventory | GET | `/api/v1/hotel-inventory/events` | any signed-in user (own account) |
| hotel-inventory | GET | `/api/v1/hotel-inventory/movements` | any signed-in user (own account) |
| hotel-inventory | GET | `/api/v1/hotel-inventory/low-stock` | any signed-in user (own account) |
| hotels | GET | `/api/v1/hotels` | hotels.read_all / hotels.read_own |
| hotels | GET | `/api/v1/hotels/:id` | hotels.read_all / hotels.read_own |
| hotels | POST | `/api/v1/hotels` | hotels.manage |
| hotels | PATCH | `/api/v1/hotels/:id` | hotels.manage |
| hotels | POST | `/api/v1/hotels/:id/credit-terms` | credit.request |
| hotels | POST | `/api/v1/hotels/:id/contracts` | contracts.manage |
| hub | GET | `/api/v1/hub/stock` | hub.stock.view |
| hub | GET | `/api/v1/hub/movements` | hub.stock.view |
| hub | POST | `/api/v1/hub/adjustments` | hub.stock.adjust |
| hub | GET | `/api/v1/hub/consolidation` | hub.stock.view |
| orders | GET | `/api/v1/orders` | any signed-in user (own account) |
| orders | GET | `/api/v1/orders/:id` | any signed-in user (own account) |
| orders | POST | `/api/v1/orders` | orders.create / orders.manage |
| orders | PUT | `/api/v1/orders/:id/lines` | orders.create / orders.manage |
| orders | POST | `/api/v1/orders/:id/submit` | orders.create / orders.manage |
| orders | POST | `/api/v1/orders/:id/hotel-approve` | orders.approve_hotel |
| orders | POST | `/api/v1/orders/:id/hotel-return` | orders.approve_hotel |
| orders | POST | `/api/v1/orders/:id/cancel` | orders.create / orders.manage |
| orders | POST | `/api/v1/orders/:id/reorder` | orders.create |
| orders | POST | `/api/v1/orders/:id/lines/:lineId/price` | orders.price_override |
| orders | PUT | `/api/v1/orders/:id/lines/:lineId/sourcing` | procurement.manage |
| orders | POST | `/api/v1/orders/:id/purchase-orders` | procurement.manage |
| procurement | GET | `/api/v1/purchase-orders` | procurement.manage / hub.receive |
| procurement | GET | `/api/v1/purchase-orders/:id` | procurement.manage / hub.receive |
| procurement | POST | `/api/v1/purchase-orders` | procurement.manage |
| procurement | POST | `/api/v1/purchase-orders/:id/submit` | procurement.manage |
| procurement | POST | `/api/v1/purchase-orders/:id/send` | procurement.manage |
| procurement | POST | `/api/v1/purchase-orders/:id/confirm` | procurement.manage |
| procurement | POST | `/api/v1/purchase-orders/:id/cancel` | procurement.manage |
| procurement | POST | `/api/v1/purchase-orders/:id/close` | procurement.manage |
| procurement | POST | `/api/v1/purchase-orders/:id/receipts` | hub.receive |
| reports | GET | `/api/v1/reports/purchases` | reports.business |
| reports | GET | `/api/v1/reports/margin` | reports.business |
| reports | GET | `/api/v1/reports/ap-aging` | reports.financial |
| reports | GET | `/api/v1/reports/credit-utilization` | reports.financial |
| reports | GET | `/api/v1/reports/reconciliation` | reports.financial |
| reports | GET | `/api/v1/reports/stock-discrepancies` | reports.inventory |
| reports | GET | `/api/v1/reports/operations` | reports.operations |
| reports | GET | `/api/v1/reports/price-history` | reports.business |
| requests | GET | `/api/v1/product-requests` | any signed-in user (own account) |
| requests | GET | `/api/v1/product-requests/:id` | any signed-in user (own account) |
| requests | POST | `/api/v1/product-requests` | requests.create |
| requests | PATCH | `/api/v1/product-requests/:id` | requests.manage |
| requests | POST | `/api/v1/product-requests/:id/withdraw` | requests.create |
| settings | GET | `/api/v1/settings` | settings.manage |
| settings | PATCH | `/api/v1/settings` | settings.manage |
| settings | GET | `/api/v1/tax-rates` | any signed-in user |
| settings | PUT | `/api/v1/tax-rates/:code` | tax.manage |
| settings | GET | `/api/v1/units` | any signed-in user |
| settings | GET | `/api/v1/document-series` | settings.manage |
| settings | PATCH | `/api/v1/document-series/:id` | settings.manage |
| suppliers | GET | `/api/v1/suppliers` | suppliers.read |
| suppliers | GET | `/api/v1/suppliers/:id` | suppliers.read |
| suppliers | POST | `/api/v1/suppliers` | suppliers.manage |
| suppliers | PATCH | `/api/v1/suppliers/:id` | suppliers.manage |
| suppliers | POST | `/api/v1/suppliers/:id/contacts` | suppliers.manage |
| suppliers | PUT | `/api/v1/suppliers/:id/products/:productId` | suppliers.manage |
| suppliers | GET | `/api/v1/quotations` | quotations.manage |
| suppliers | POST | `/api/v1/quotations` | quotations.manage |
| users | GET | `/api/v1/users` | any signed-in user (own account) |
| users | POST | `/api/v1/users/invitations` | any signed-in user (own account) |
| users | GET | `/api/v1/users/invitations` | any signed-in user (own account) |
| users | PATCH | `/api/v1/users/:id` | any signed-in user (own account) |
| users | POST | `/api/v1/users/:id/revoke-sessions` | users.manage_internal |
| users | POST | `/api/v1/users/:id/reset-mfa` | users.manage_internal |
