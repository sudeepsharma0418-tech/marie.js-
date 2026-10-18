# Roles and permission matrix

Source of truth: `packages/shared/src/roles.ts`. The API checks permissions on every route and additionally pins hotel users to their own hotel (`assertHotelAccess`, `hotelFilter`). Hiding UI is never the control.

| Permission | Owner | Procurement/admin | Hub | Driver | Hotel manager | Hotel purchasing | Hotel store keeper |
|---|---|---|---|---|---|---|---|
| Manage internal users | ✓ | | | | | | |
| Manage own hotel's purchasing/inventory users | ✓ | | | | ✓ | | |
| Read all hotels / own hotel | ✓ / – | ✓ / – | | | – / ✓ | | |
| Edit hotels, contracts | ✓ | | | | | | |
| Prepare credit-term changes (`credit.request`) | ✓ (applies) | ✓ (needs approval) | | | | | |
| Suppliers, quotations, **supplier costs & margins** (`costs.view`) | ✓ | ✓ | | | | | |
| Catalog read | ✓ | ✓ | ✓ | | ✓ | ✓ | |
| Catalog / pricing manage | ✓ | ✓ | | | | | |
| Create orders, product requests | (on behalf) | (on behalf) | | | ✓ | ✓ | |
| Approve own hotel's staff orders | | | | | ✓ | | |
| Price overrides (large ones need owner) | ✓ | ✓ | | | | | |
| Purchase orders (prepare/submit/send) | ✓ | ✓ | | | | | |
| Receive goods, hub adjustments, dispatch | ✓ | | ✓ | | | | |
| Schedule deliveries | ✓ | ✓ | | | | | |
| See assigned deliveries, confirm delivery | ✓ | ✓ (manage) | | ✓ (own runs only) | | | |
| Hotel inventory view / record usage & restock | ✓ (view) | | | | ✓ | view | ✓ |
| Correct counts, manage shelves, review held events | | | | | ✓ | | |
| Finance: all / own hotel | ✓ / – | ✓ / – | | | – / ✓ | | |
| Issue invoices, credit notes; post bills; record payments | ✓ | ✓ | | | | | |
| Reverse payments | ✓ | | | | | | |
| **Decide approvals** | ✓ only | | | | | | |
| Request approvals | ✓ | ✓ | ✓ | | | | |
| Reports: business / financial / inventory / operations / own hotel | all | business, inventory, operations | inventory | | own hotel | | |
| Audit log, settings, tax | ✓ | | | | | | |

## Approval rules (owner is final authority)
| Action | When approval is needed |
|---|---|
| Supplier PO commitment | PO total ≥ `poApprovalThreshold` (0 = always). DB constraint forbids sent/confirmed/received POs without `approved_at`. |
| Order on credit | Exposure > credit limit, overdue invoices beyond grace days, or account on hold/suspended. Closed accounts cannot order. |
| Credit limit / payment terms | Always (owner applies directly; others create a request). |
| Price override | Deviation from rule price > `priceOverrideThresholdPercent`. |
| Hub stock decrease / write-off | Value ≥ `writeOffApprovalThreshold` (0 = always). |
| AR/AP financial adjustment | Always. |
| Payment reversal | Owner only. |

Nobody approves their own request, except the owner when `allowOwnerSelfApproval` is on (default, single-owner business); such decisions are flagged `selfDecision` in the audit log.

## MFA
TOTP for any user; when `mfaEnforced` is on, owner and procurement roles must enrol before using the system.
