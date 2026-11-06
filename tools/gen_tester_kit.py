"""Generate the tester kit: 4 fresh vendor-invoice PDFs, one per outcome.

The seed PDFs in test-emails/attachments/ have already been through the live
system, so a tester forwarding them would only see "duplicate". These use new
invoice numbers and the November 2026 billing period, which no vendor has
billed yet. Each works once; sending one a second time shows the duplicate check.

Usage: python3 -I tools/gen_tester_kit.py test-emails/tester-kit
"""
import sys

import gen_pdfs
from gen_pdfs import make

VENDORS = {
    "printhub": dict(name="PrintHub Office Solutions", gstin="29AAJCP2287D1ZK", email="billing@printhub.in",
                     phone="+91 80 0000 1106", address="9, Lalbagh Road, Shanti Nagar, Bengaluru 560027",
                     bank="Account ending 6604"),
    "beanbox": dict(name="BeanBox Pantry Supplies LLP", gstin="29AARFB9042H1Z5", email="invoices@beanbox.co.in",
                    phone="+91 80 0000 1104", address="7, Hosur Road Warehouse Complex, Bommanahalli, Bengaluru 560068",
                    bank="Account ending 7720"),
    "guardian": dict(name="Guardian Shield Security Services", gstin="29AAHFG3318R1Z9",
                     email="finance@guardianshield.co.in", phone="+91 80 0000 1103",
                     address="21, 1st Main, Jayanagar 3rd Block, Bengaluru 560011", bank="Account ending 3356"),
    # The vendor master has SparkleServ's account ending 4417; this invoice prints 5129.
    "sparkleserv-fraud": dict(name="SparkleServ Facility Services Pvt. Ltd.", gstin="29AAKCS7731P1Z2",
                              email="accounts@sparkleserv.in", phone="+91 80 0000 1101",
                              address="44, 2nd Cross, Peenya Industrial Area, Bengaluru 560058",
                              bank="Account ending 5129 (HDFC Bank, Peenya branch)"),
}


def main(out):
    gen_pdfs.OUT = gen_pdfs.Path(out)
    gen_pdfs.OUT.mkdir(parents=True, exist_ok=True)
    # 1. Clean: every check passes.
    make("1-clean-printhub-PH-26-11-247.pdf", VENDORS["printhub"],
         dict(no="PH-26-11-247", date="05-11-2026", period="November 2026", po="LB-PO-2026-011",
              lines=[(f"Multifunction printer lease and servicing - {c}", "997314", 1, 9000)
                     for c in ("Koramangala", "Indiranagar", "HSR Layout", "Whitefield", "Hebbal")]))
    # 2. Over budget: an ad-hoc line with no PO pushes it above the agreed range.
    make("2-over-budget-beanbox-BBX-1991.pdf", VENDORS["beanbox"],
         dict(no="BBX/1991", date="05-11-2026", period="November 2026", po="LB-PO-2026-021",
              lines=[("Coffee beans - house blend (kg)", "996331", 100, 520),
                     ("Assorted tea (boxes of 100)", "996331", 80, 310),
                     ("Milk, oat milk & sugar supplies (all centres)", "996331", 1, 21480),
                     ("Biscuits & healthy snacks (all centres)", "996331", 1, 18600),
                     ("Paper cups, stirrers & napkins", "996331", 1, 5900),
                     ("Deepavali sweet boxes for members (all centres)", "996331", 1, 26000)]))
    # 3. Missing PO: put on hold, and the vendor is asked to re-issue it.
    make("3-missing-po-guardianshield-GSS-2026-1150.pdf", VENDORS["guardian"],
         dict(no="GSS-2026-1150", date="05-11-2026", period="November 2026", po=None,
              lines=[(f"Manned guarding services, 24x7 - {c}", "998525", 1, amt)
                     for c, amt in (("Koramangala", 48000), ("Indiranagar", 40000), ("HSR Layout", 42000),
                                    ("Whitefield", 52000), ("Hebbal", 42000))]))
    # 4. Fraud: looks perfect, but the bank account isn't the one on file.
    make("4-bank-fraud-sparkleserv-SS-26-27-0688.pdf", VENDORS["sparkleserv-fraud"],
         dict(no="SS/26-27/0688", date="05-11-2026", period="November 2026", po="LB-PO-2026-014",
              lines=[("Housekeeping services - Koramangala (14 staff)", "998533", 1, 78500),
                     ("Housekeeping services - Indiranagar (11 staff)", "998533", 1, 62000),
                     ("Housekeeping services - HSR Layout (12 staff)", "998533", 1, 68000),
                     ("Housekeeping services - Whitefield (16 staff)", "998533", 1, 90000),
                     ("Housekeeping services - Hebbal (11 staff)", "998533", 1, 64000)]))


if __name__ == "__main__":
    main(sys.argv[1])
