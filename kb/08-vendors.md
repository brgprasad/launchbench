# Approved Vendors and Accounts Payable Rules

Vendor invoices are sent to **teamlaunchbench@gmail.com**. They are validated against this list, which is also kept as `data/vendors.csv`, then logged in `data/ap_invoices.csv` and approved by the Finance Manager (**Lakshmi Narayan**).

**Our details, as they must appear on every vendor invoice**
- Bill to: Launchbench Workspaces Pvt. Ltd.
- GSTIN: **29AAFCL4821M1Z7**
- Address: 3rd Floor, Sprint House, 80 Feet Road, 4th Block, Koramangala, Bengaluru 560034

## Approved vendor master
| Vendor | Category | GSTIN | Purchase order (PO) | Billing | Expected taxable amount per invoice | Official billing email |
|---|---|---|---|---|---|---|
| SparkleServ Facility Services Pvt. Ltd. | Housekeeping (all 5 centres) | 29AAKCS7731P1Z2 | LB-PO-2026-014 | Monthly | ₹3,40,000 – ₹3,80,000 | accounts@sparkleserv.in |
| AirLink Fibernet Pvt. Ltd. | Internet leased lines (5 × 1 Gbps) | 29AAGCA5520K1ZQ | LB-PO-2026-009 | Monthly, fixed | ₹1,85,000 exactly | billing@airlinkfibernet.in |
| Guardian Shield Security Services | Security guards | 29AAHFG3318R1Z9 | LB-PO-2026-017 | Monthly | ₹2,10,000 – ₹2,30,000 | finance@guardianshield.co.in |
| BeanBox Pantry Supplies LLP | Tea, coffee, pantry consumables | 29AARFB9042H1Z5 | LB-PO-2026-021 | Monthly | ₹90,000 – ₹1,30,000 | invoices@beanbox.co.in |
| CoolBreeze HVAC Services | AC annual maintenance contract (AMC) | 29ABEPC6614L1Z3 | LB-PO-2026-005 | Quarterly (Apr, Jul, Oct, Jan) | ₹1,20,000 exactly | accounts@coolbreezehvac.in |
| PrintHub Office Solutions | Printer lease and service | 29AAJCP2287D1ZK | LB-PO-2026-011 | Monthly, fixed | ₹45,000 exactly | billing@printhub.in |

**Not processed through ap@**
- **Electricity (BESCOM) and water (BWSSB)** are paid by auto-debit from the utility portals. If an "electricity bill" arrives at ap@ from anyone else, treat it as **suspicious**.
- **Rent to building landlords** is paid by standing instruction under the lease agreements.

## Checks applied to every invoice
1. **Known vendor:**
   - The vendor name and GSTIN must match the vendor master.
   - The email must come from that vendor's billing email domain.
   - Unknown vendor → **Hold**: ask the requester or Operations who engaged them.
2. **Addressed to us:** the bill-to name and **our GSTIN 29AAFCL4821M1Z7** must be correct. If not → **Return to vendor** for correction.
3. **PO quoted:**
   - The invoice must quote the vendor's PO number.
   - Missing PO → **Hold** and email the vendor asking for a re-issued invoice that quotes the PO.
   - Wrong PO → **Return to vendor**.
4. **Amount within range:**
   - The taxable amount must be within the expected range above.
   - Outside the range → **Flag for Finance Manager review**, quoting the variance. Example: "₹4,45,000 vs expected max ₹3,80,000, +17%".
   - Ad-hoc work (such as AC repairs outside the AMC) needs its **own PO**.
5. **GST arithmetic:**
   - Karnataka vendors charge CGST 9% + SGST 9%.
   - The total must equal the taxable amount × 1.18, with up to ₹1 rounding allowed.
   - A mismatch → **Return to vendor**.
6. **No duplicate:** the same vendor and invoice number must not already be in `ap_invoices.csv`. If it is → **Reject as duplicate**.
7. **Billing period:** the period must make sense. No future periods, and no period already billed.

## Approval limits (on the taxable amount)
| Amount | Approver |
|---|---|
| Up to ₹2,00,000 | Finance Manager |
| Above ₹2,00,000 | Finance Manager **and** COO |

## Payment terms
- Approved invoices are paid **Net 30 from the date the invoice is received**, in the **payment runs on the 10th and 25th** of each month.
- Vendors who ask about payment status can be given the scheduled payment-run date once the invoice is approved.

## 🔴 Bank-detail change requests (fraud control)
- **Vendor bank details are never changed on the strength of an email**, even one that looks genuine.
- **What a valid change needs:**
  1. A signed request on the vendor's letterhead.
  2. A cancelled cheque for the new account.
  3. **A call-back by Finance to the phone number already in our vendor master**. Never use a number supplied in the request.
- **The bank account printed on an invoice must match the account on file** (the last 4 digits are in `data/vendors.csv`). An invoice showing a different account is treated as a bank-change request, even if the email and every other check look normal: compromised vendor mailboxes send exactly this.
- **Any email asking to change bank details, especially one that is urgent, comes from a look-alike domain, or asks us to pay a pending invoice to a new account, must be:**
  - flagged as **suspected fraud**
  - **not replied to**
  - escalated immediately to the Finance Manager and the COO
