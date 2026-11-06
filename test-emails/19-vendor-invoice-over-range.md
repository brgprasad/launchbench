---
id: 19
date: 2026-11-02 18:30
from: SparkleServ Accounts <accounts@sparkleserv.in>
to: teamlaunchbench@gmail.com
subject: SparkleServ invoice SS/26-27/0611 for October 2026
attachments: [attachments/sparkleserv-SS-26-27-0611.pdf]
expected_class: vendor_invoice
expected_validation: FLAG
expected_action:
  - Extract the invoice: taxable ₹4,45,000, total ₹5,25,100, PO LB-PO-2026-014.
  - Flag the amount. It is above the expected maximum of ₹3,80,000 by ₹65,000 (+17.1%). The cause is line 6, "Festival deep-cleaning (Deepavali)", 5 × ₹16,500 = ₹82,500. This is ad-hoc work and needs its own PO.
  - The regular housekeeping lines total ₹3,62,500, which is within range.
  - The amount is over ₹2,00,000, so both Lakshmi Narayan and Meera Iyer must approve.
  - Add context: Nimbus Byte has made repeated housekeeping complaints (email 10, tickets T-1031 and T-1047). Ops may want this considered before paying the extra charge.
  - Log as "Flagged - pending review".
kb_refs: [08-vendors.md checks 3-4 and approval limits, vendors.csv V01]
---
Dear Launchbench Accounts,

Please find attached our invoice for housekeeping services for October 2026, including the festival deep-cleaning done across all centres before Deepavali, as discussed with your facilities team.

Kindly process at the earliest.

Thanks & regards,
Accounts, SparkleServ Facility Services
