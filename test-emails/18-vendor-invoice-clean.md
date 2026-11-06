---
id: 18
date: 2026-11-02 09:12
from: AirLink Fibernet Billing <billing@airlinkfibernet.in>
to: teamlaunchbench@gmail.com
subject: Invoice ALF/2026/11/0912 - November 2026
attachments: [attachments/airlink-ALF-2026-11-0912.pdf]
expected_class: vendor_invoice
expected_validation: PASS
expected_action:
  - Extract from the PDF: vendor, GSTIN 29AAGCA5520K1ZQ, invoice number ALF/2026/11/0912, date 01-11-2026, PO LB-PO-2026-009, taxable ₹1,85,000, CGST + SGST ₹33,300, total ₹2,18,300.
  - All 7 checks pass:
    - known vendor and email domain
    - our GSTIN is correct
    - the PO matches
    - the amount equals the fixed ₹1,85,000
    - the GST arithmetic is correct
    - not a duplicate (October was 0871)
    - the period is valid
  - Append to ap_invoices.csv as "Pending approval". The approver is Lakshmi Narayan alone, because the amount is at or below ₹2,00,000.
  - Schedule payment in the last payment run before Net 30 from receipt (by 2 Dec), which is 25 Nov.
  - Optionally acknowledge receipt to the vendor.
kb_refs: [08-vendors.md, vendors.csv, ap_invoices.csv]
---
Dear Sir/Madam,

Please find attached our invoice ALF/2026/11/0912 for leased-line services for November 2026.

Regards,
Accounts Team
AirLink Fibernet Pvt. Ltd.
