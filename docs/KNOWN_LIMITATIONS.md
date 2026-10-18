# Known limitations and next milestones

## Not done yet (honest list)
- **Tax compliance not validated**; not IRD-certified, no CBMS link, no BS dates, no amount-in-words, no IRD-format VAT registers or TDS (see COMPLIANCE.md).
- **No email or SMS delivery**: invitations and reset links are shown to the inviting admin / logged in development. Notifications are in-app only.
- **PDF output** is the browser's Print → Save as PDF on a print-styled invoice page (correct Devanagari shaping). No server-generated PDF archive yet.
- **Object storage**: uploads go to local disk (`STORAGE_DIR`); back it up (scripts do) or add an S3-compatible driver before running more than one app server.
- **Docker image** is written but could not be built in the development sandbox (its network proxy blocks package downloads inside `docker build`). The bundled server it runs was verified directly. Build it once in CI or on a normal machine before the first deploy.
- **Error tracking** (Sentry) not integrated; logs only.
- Server-generated text in order timelines (e.g. "Within credit terms") is English only; UI labels are bilingual. Dates show Gregorian (AD) in both languages.
- Delivery evidence supports recipient name/phone and a photo; drawn signature capture is not built.
- Hub bins/locations within the hub are not modelled (single hub stock per product).
- Releasing hub reservations for cancelled orders after goods were received, customer returns after delivery, and supplier credit notes are handled with adjustments/credit notes manually; no dedicated workflow yet.
- Session idle timeout is not separate from absolute expiry.
- Reports are tabular with CSV export; no charts and no Excel (.xlsx) export (CSV opens in Excel).
- Nepali translations were written by the developer and need review by a native speaker in the business.
- The web bundle is one ~630 kB chunk (184 kB gzipped); code-splitting would speed first load on slow mobile networks.

## Suggested next milestones
1. **Go-live hardening (Phase 4)**: accountant review and the IRD decision (COMPLIANCE.md §1); email (invites/resets) and SMS for delivery notices; Sentry; production deploy on Option A; first restore drill; UAT with 2–3 Butwal hotels and staff on real phones.
2. **Phase 3 completions**: cancellation-after-receipt and returns workflows, supplier credit notes, BS date display and amount in words, server PDFs, Excel export, hub bins, signature capture.
3. **Phase 5 (only when approved)**: native apps on the same API (Bearer tokens already supported), supplier portal, payment provider integrations (eSewa/Khalti/ConnectIPS), route planning, purchase forecasting from hotel usage data.
