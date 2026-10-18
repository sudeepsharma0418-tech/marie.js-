# Business rules and workflows

## Order lifecycle (`packages/shared/src/workflows.ts`)
```
draft ─► pending_hotel_approval ─► submitted ─► approved ─► procurement ─► consolidating ─► ready_for_dispatch ─► dispatched ─► delivered ─► closed
  │            (purchaser order,       │  └► pending_approval ─► approved / rejected            ▲            │
  │             if hotel requires)     │      (credit check)                                     └─ partially_delivered ◄┘
  └──────────────────────────────── cancelled (before supplier commitments)
```
- `submitted` is transient while the credit check runs.
- Fulfilment states after `procurement` are **derived** from reconciled quantities after every receipt, dispatch or delivery: delivered > dispatched (a delivery is on the road) > partially_delivered > ready_for_dispatch (everything outstanding is reserved at the hub) > consolidating > procurement.
- **Billing status is separate** from fulfilment: invoices show unpaid / partially paid / paid. An order can be delivered and unpaid.
- Prices are re-resolved when a draft is submitted (except manual overrides and quoted request prices).
- Hotels may cancel until procurement starts; staff can cancel later only if no supplier PO is committed (draft/pending POs are cancelled with it).
- Exceptions: direct supplier delivery (PO `fulfillment = direct` skips the hub; the receipt records the hotel recipient and creates a delivered delivery record), partial receipts, damaged goods, failed deliveries (goods return to hub and stay reserved), partial deliveries, unlisted product requests (quote → hotel accepts → draft order at the quoted price).

## Per-line reconciliation
For each order line the system derives, from source documents: ordered, cancelled, needed, purchased (non-cancelled PO lines), received (accepted on receipts), damaged on receipt, reserved at hub, scheduled, dispatched, delivered, invoiced. Nothing is a stored counter.

## Pricing
Selling price precedence (most specific wins): hotel+product → hotel+category (nearest category up the tree) → hotel → product → category → default rule → company default markup. Customer-specific rules always beat general ones. Markups apply to the product's confidential reference cost; fixed prices are per selling unit. Every rule change and cost change is written to `price_history` with user and reason. Prices are tax-exclusive; VAT is computed per line on invoices.

## Credit control
`exposure = AR ledger balance + open orders not yet invoiced + this order`. Approval needed when exposure > limit, overdue invoices exist beyond `creditOverdueGraceDays`, or the account is on hold/suspended. A limit of 0 means every order needs approval (cash customers). The check is snapshotted on the order (`credit_check`), visible to staff only.

## Procurement
Staff record quotations (any active supplier), select a supplier per line, and generate one draft PO per supplier for quantities still to purchase. Submit → approval (or auto-approval below threshold) → mark sent → confirmed → receipts. Over-receipt is refused. Damaged goods are recorded but not stocked. PO cannot be cancelled after receipts (close short instead).

## Hub stock
- On hand = Σ `hub_stock_movements` (receipt +, dispatch −, delivery_return +, adjustments ±).
- Reserved = Σ `hub_reservations` per order line (receipt +, dispatch −, delivery_return +).
- Available = on hand − reserved. Incoming = ordered on committed hub POs and not yet accepted (shown as *unverified*; supplier availability is never stock).
- Decreases cannot eat into reserved stock.

## Delivery
Runs (date, window, driver, vehicle) contain deliveries (one per order per trip). Dispatch moves stock out and releases reservations. Confirmation requires, per line, `delivered + damaged + missing + returned = dispatched` (also a DB CHECK). Returned goods go back to stock and are re-reserved. A failed delivery returns everything. Drivers only see deliveries on their own runs. Evidence: recipient name (required), phone, optional photo.

## Invoicing (accounts receivable)
- Trigger (`invoiceTrigger`): `on_delivery` creates a **draft** invoice for delivered, not-yet-invoiced quantities when a delivery is confirmed; `manual` leaves it to staff.
- Drafts have no number and no financial effect and are hidden from hotels. Issuing assigns the next gapless number for the fiscal year (`INV-208384-00001`), freezes seller/customer snapshots, sets the due date from the hotel's payment terms, and posts a ledger debit. Invoice dates cannot be in the future.
- Issued invoices are immutable (DB trigger). Corrections: credit notes (limited to invoiced quantity) which credit the ledger.
- Invoice outstanding = total − active allocations − issued credit notes.

## Payments
Recorded, never executed, by the platform. Rules: positive amount, not future-dated, reference required for bank/cheque/wallet, the same reference cannot be recorded twice for the same party and method (unique index), idempotency key for retries. Allocations: only to issued invoices / posted bills of the same party, never above outstanding, never above the unallocated payment amount; rows are locked so parallel clerks cannot over-allocate. Unallocated money remains as customer credit. Reversal (owner): payment marked reversed, allocations released, reversing ledger entry added; the original stays.

## Accounts payable
Supplier bills (draft → posted) with the supplier's own bill number (unique per supplier), lines copied from accepted PO quantities by default. Posting credits the AP ledger. Supplier payments debit it.

## Ledger
`ledger_entries` is append-only. AR balance = Σ(debit − credit); AP balance = Σ(credit − debit). Unique `(source_type, source_id, account)` prevents double posting. `/reports/reconciliation` proves ledger balances equal document totals.

## Margin
Expected margin = order line selling price × needed − selected supplier cost × needed. Realised margin = issued invoice revenue (ex-VAT, net of credit notes) − posted supplier bill cost linked through PO lines. Both are shown per order; reports cover product, category and hotel.

## Hotel inventory and offline sync
- Shelves belong to storage areas; each shelf has a random unguessable QR token; a shelf may hold many products with default usage quantity and low-stock level.
- Actions: Used (default quantity pre-filled), Restocked, Correct count (managers, reason required), Transfer.
- Every event carries a **client-generated UUID**. The server stores raw events (`hotel_inventory_events`) and applies them to an append-only ledger (`hotel_stock_movements`). Re-sending an id returns `duplicate`; reusing an id with a different payload is rejected.
- Usage/restock are deltas and are applied even if the device was stale (they physically happened). Negative results are applied but flagged. Identical taps within 10 s are flagged `possible_duplicate`.
- A correction whose `baseQty` differs from the server balance is **held** (`needs_review`) and not applied; a manager accepts (sets the shelf to the count now) or rejects. History is never overwritten.
- Concurrency: advisory lock per shelf+product during processing.
- Offline data on the device: shelves, product names, units and balances for the user's own hotel only, with an expiry (`offlineAccessHours`, default 72 h). No prices or finance. Wiped on logout, on a session revoked by the server, and when another user syncs on the same device. A local save shows "Saved on this device"; only a server answer shows "Saved". Pending count is always visible.
- Not allowed offline: anything other than shelf inventory (no invoices, payments, approvals, credit or purchasing).

## Audit
Every important change writes `audit_logs` in the same transaction: actor, role, action, entity, hotel, reason, before/after (secrets redacted), IP, request id. The table is append-only and hash-chained (`hash = sha256(prev_hash + canonical row)`); `/audit/verify` recomputes the chain and reports the first broken record.
