---
id: 28
date: 2026-11-03 11:05
from: Guardian Shield Finance <finance@guardianshield.co.in>
to: teamlaunchbench@gmail.com
subject: Invoice GSS-2026-1121 - October 2026
attachments: [attachments/guardianshield-GSS-2026-1121.pdf]
expected_class: vendor_invoice
expected_reply: none  # suspected fraud: a reply would tell a fraudster the address works
expected_validation: SUSPECTED_FRAUD
expected_action:
  - Extract from the PDF: GSTIN 29AAHFG3318R1Z9, invoice number GSS-2026-1121, PO LB-PO-2026-017, taxable ₹2,24,000, CGST + SGST ₹40,320, total ₹2,64,320, bank account ending 8851.
  - All 7 checks pass:
    - known vendor (V03) and its genuine email domain
    - our GSTIN is correct
    - the PO matches
    - the amount is within ₹2,10,000 – ₹2,30,000
    - the GST arithmetic is correct
    - not a duplicate (September was GSS-2026-1093)
    - the period is valid
  - But the bank account on the invoice (ending 8851) does not match the account on file (ending 3356). Treat as suspected fraud. A compromised vendor mailbox looks exactly like this.
  - Do NOT reply, and do NOT update vendors.csv.
  - Alert Lakshmi Narayan and Meera Iyer. Recommend a call-back to Guardian Shield on the number in the vendor master, +91 80 0000 1103.
  - Log as "Suspected fraud - payment held".
kb_refs: [08-vendors.md bank-detail change section, vendors.csv V03, ap_invoices.csv]
---
Dear Accounts Team,

Please find attached our invoice GSS-2026-1121 for security services at all five centres for October 2026.

Kindly arrange payment as per the usual terms.

Regards,
Accounts
Guardian Shield Security Services
