# Nepal tax and legal items to verify before go-live

**The platform does not claim tax or legal compliance.** Tax settings are data (`tax_rates`, `company_settings`), not code, and every seeded rate is marked "needs accountant verification". A qualified Nepal tax professional must confirm each item below.

## 1. Electronic invoicing permission and IRD-certified billing software (highest priority)
- Under the IRD's Electronic Billing Procedure 2074, a resident business must get permission from its tax office before issuing tax invoices electronically ([Voxel guide](https://www.voxelgroup.net/compliance/guides/nepal/), [VATupdate booklet](https://www.vatupdate.com/2026/09/20/nepal-e-invoicing-e-reporting-country-booklet/)).
- Businesses above a turnover threshold must use **IRD-certified billing software connected to CBMS** (Central Billing Monitoring System) in real time. The threshold has changed several times and sources disagree in 2026: an IRD decision of 2082/12/27 reportedly sets NPR 200 million, the FY 2083/84 budget signals NPR 100 million, older guides cite NPR 10 crore and a lower NPR 5 crore for hotels/restaurants ([ICT Frame](https://ictframe.com/ird-mandates-electronic-billing/), [Tigg guide](https://tiggapp.com/blog-posts/your-ultimate-guide-to-e-billing-in-nepal), [BUSY comparison](https://busysoftwarenepal.com/blog/best-ird-billing-software-nepal-2026/)).
- **This platform is not IRD-certified and is not connected to CBMS.** Until an accountant confirms what applies:
  - Option A: issue legal tax invoices from an IRD-approved billing system or IRD-approved printed invoice books, and use this platform's invoice as the internal billing record/statement (record the legal invoice number in the invoice notes).
  - Option B: apply to the tax office for permission to issue electronically from this system; CBMS integration and certification would then be a development project (Phase 5).
- The invoice footer setting is pre-filled with a "DEMO – not a valid tax invoice" warning.

## 2. VAT rate and item treatment
- Standard VAT is commonly published as 13% under the VAT Act 2052, with Schedule 1 exemptions (e.g. some basic food items) ([Kintsugi guide](https://trykintsugi.com/sales-tax-guides/apac/nepal), [Lookuptax](https://lookuptax.com/docs/country/nepal-vat-guidelines-indirect-tax)). Seeded `VAT13` and `EXEMPT` codes must be confirmed, and **each product's tax code** (e.g. sugar seeded as EXEMPT) reviewed.
- Registration thresholds are reported as NPR 50 lakh (goods) and NPR 30 lakh (services) ([beancount summary](https://beancount.io/blog/2026/10/07/nepal-vat-threshold-reform-small-business-registration-guide), [Law Alpine](https://lawalpine.com/blog/vat-in-nepal-rates-and-thresholds-2082-83)); the company's own VAT registration status is a setting.

## 3. Tax invoice content (Rule 17 of the VAT Rules) — not confirmed
The invoice currently shows: seller name, address, PAN/VAT no.; buyer name, address, PAN/VAT no.; invoice number, date, fiscal year; line description, quantity, unit, rate, taxable amount, VAT and total; exempt and taxable subtotals. An accountant must confirm the full required list, including:
- Bikram Sambat (BS) date on the invoice (the platform stores AD dates; BS display is not implemented).
- Amount in words, "Tax Invoice" / "Abbreviated tax invoice" wording, copy markings (original / duplicate) and reprint counters.
- Mode of payment and any required signature/stamp.
- Numbering: one gapless series per fiscal year (implemented, `INV-208384-00001`); confirm the required format and whether a new series is needed per branch.

## 4. Other items
- **Fiscal year** label (e.g. 2083/84) is set manually; confirm the Shrawan 1 changeover procedure.
- **VAT books**: purchase and sales registers in IRD format and monthly VAT returns. Data exists (`invoices`, `supplier_bills`, period input/output VAT in the reconciliation report) but IRD-format registers are not produced.
- **TDS** on supplier payments (where applicable) is not calculated.
- **Credit/debit note** format and VAT reversal rules.
- **Record retention** period for invoices and accounting records (configure backups/archival accordingly).
- **Data protection**: Individual Privacy Act 2075 obligations for staff/customer personal data, and whether hosting outside Nepal is acceptable.
- **Contracts**: hotel supply contracts, credit terms and late payment terms should be reviewed by a lawyer.
