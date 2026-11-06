"""Generate 4 fictional vendor invoice PDFs for the AP seed emails.

Usage: python3 -I tools/gen_pdfs.py test-emails/attachments
"""
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

OUT = Path(".")  # set by main(); tools/gen_tester_kit.py imports make() and sets its own
ss = getSampleStyleSheet()

BILL_TO = ("Launchbench Workspaces Pvt. Ltd.<br/>3rd Floor, Sprint House, 80 Feet Road, 4th Block,<br/>"
           "Koramangala, Bengaluru 560034<br/>GSTIN: 29AAFCL4821M1Z7")


def inr(x):
    """Indian digit grouping, 2 decimals: 1234567.5 -> 12,34,567.50"""
    neg = x < 0
    whole, frac = f"{abs(x):.2f}".split(".")
    if len(whole) > 3:
        head, tail = whole[:-3], whole[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        whole = ",".join(parts) + "," + tail
    return ("-" if neg else "") + whole + "." + frac


def make(fname, vendor, invoice):
    doc = SimpleDocTemplate(str(OUT / fname), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=16 * mm, bottomMargin=16 * mm)
    el = [Paragraph(f"<b>{vendor['name']}</b>", ss["Title"]),
          Paragraph(f"{vendor['address']}<br/>GSTIN: {vendor['gstin']} &nbsp;|&nbsp; {vendor['email']} "
                    f"&nbsp;|&nbsp; {vendor['phone']}", ss["Normal"]),
          Spacer(1, 6 * mm),
          Paragraph("<b>TAX INVOICE</b>", ss["Heading2"])]
    meta = [["Invoice No.", invoice["no"], "Invoice Date", invoice["date"]],
            ["Billing Period", invoice["period"], "PO Number", invoice.get("po") or "—"],
            ["Place of Supply", "Karnataka (29)", "Payment Terms", "Net 30"]]
    t = Table(meta, colWidths=[30 * mm, 55 * mm, 30 * mm, 55 * mm])
    t.setStyle(TableStyle([("FONTNAME", (0, 0), (0, -1), "Helvetica-Bold"),
                           ("FONTNAME", (2, 0), (2, -1), "Helvetica-Bold"),
                           ("GRID", (0, 0), (-1, -1), 0.4, colors.grey), ("FONTSIZE", (0, 0), (-1, -1), 9)]))
    el += [t, Spacer(1, 5 * mm), Paragraph("<b>Bill To</b>", ss["Normal"]), Paragraph(BILL_TO, ss["Normal"]),
           Spacer(1, 5 * mm)]

    rows = [["#", "Description", "SAC", "Qty", "Rate (INR)", "Amount (INR)"]]
    taxable = 0
    for i, (desc, sac, qty, rate) in enumerate(invoice["lines"], 1):
        amt = qty * rate
        taxable += amt
        rows.append([str(i), Paragraph(desc, ss["Normal"]), sac, str(qty), inr(rate), inr(amt)])
    cgst = round(taxable * 0.09, 2)
    sgst = cgst
    total = taxable + cgst + sgst
    rows += [["", "Taxable value", "", "", "", inr(taxable)],
             ["", "CGST @ 9%", "", "", "", inr(cgst)],
             ["", "SGST @ 9%", "", "", "", inr(sgst)],
             ["", "Total (INR)", "", "", "", inr(round(total))]]
    lt = Table(rows, colWidths=[8 * mm, 82 * mm, 16 * mm, 12 * mm, 26 * mm, 30 * mm])
    n = len(invoice["lines"])
    lt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e8e8e8")),
                            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                            ("FONTNAME", (1, -1), (-1, -1), "Helvetica-Bold"),
                            ("GRID", (0, 0), (-1, n), 0.4, colors.grey),
                            ("LINEABOVE", (0, n + 1), (-1, n + 1), 0.8, colors.black),
                            ("ALIGN", (3, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("FONTSIZE", (0, 0), (-1, -1), 9)]))
    el += [lt, Spacer(1, 6 * mm),
           Paragraph(f"<b>Bank:</b> {vendor['bank']}", ss["Normal"]),
           Paragraph("Please quote the invoice number in your payment remarks.", ss["Normal"]),
           Spacer(1, 10 * mm),
           Paragraph(f"For {vendor['name']}<br/><br/>Authorised Signatory", ss["Normal"]),
           Spacer(1, 6 * mm),
           Paragraph("<i>Fictional document generated for a software demo. Not a real tax invoice.</i>",
                     ss["Italic"])]
    doc.build(el)
    print(f"{fname}: taxable {inr(taxable)} total {inr(round(total))}")


def main(out):
    global OUT
    OUT = Path(out)
    OUT.mkdir(parents=True, exist_ok=True)
    make("airlink-ALF-2026-11-0912.pdf",
         dict(name="AirLink Fibernet Pvt. Ltd.", gstin="29AAGCA5520K1ZQ", email="billing@airlinkfibernet.in",
              phone="+91 80 0000 1102", address="12, Data Park, Bannerghatta Road, Bengaluru 560076",
              bank="Account ending 9082"),
         dict(no="ALF/2026/11/0912", date="01-11-2026", period="November 2026", po="LB-PO-2026-009",
              lines=[(f"1 Gbps dedicated leased line with failover - {c}", "998422", 1, 37000)
                     for c in ("Koramangala", "Indiranagar", "HSR Layout", "Whitefield", "Hebbal")]))

    make("sparkleserv-SS-26-27-0611.pdf",
         dict(name="SparkleServ Facility Services Pvt. Ltd.", gstin="29AAKCS7731P1Z2", email="accounts@sparkleserv.in",
              phone="+91 80 0000 1101", address="44, 2nd Cross, Peenya Industrial Area, Bengaluru 560058",
              bank="Account ending 4417"),
         dict(no="SS/26-27/0611", date="02-11-2026", period="October 2026", po="LB-PO-2026-014",
              lines=[("Housekeeping services - Koramangala (14 staff)", "998533", 1, 78500),
                     ("Housekeeping services - Indiranagar (11 staff)", "998533", 1, 62000),
                     ("Housekeeping services - HSR Layout (12 staff)", "998533", 1, 68000),
                     ("Housekeeping services - Whitefield (16 staff)", "998533", 1, 90000),
                     ("Housekeeping services - Hebbal (11 staff)", "998533", 1, 64000),
                     ("Festival deep-cleaning (Deepavali) - all 5 centres, incl. facade & carpet shampoo",
                      "998533", 5, 16500)]))

    make("beanbox-BBX-1964.pdf",
         dict(name="BeanBox Pantry Supplies LLP", gstin="29AARFB9042H1Z5", email="invoices@beanbox.co.in",
              phone="+91 80 0000 1104", address="7, Hosur Road Warehouse Complex, Bommanahalli, Bengaluru 560068",
              bank="Account ending 7720"),
         dict(no="BBX/1964", date="02-11-2026", period="October 2026", po=None,
              lines=[("Coffee beans - house blend (kg)", "996331", 100, 520),
                     ("Assorted tea (boxes of 100)", "996331", 80, 310),
                     ("Milk, oat milk & sugar supplies (all centres)", "996331", 1, 21480),
                     ("Biscuits & healthy snacks (all centres)", "996331", 1, 18600),
                     ("Paper cups, stirrers & napkins", "996331", 1, 5900)]))

    # Every check passes, but the bank account differs from the vendor master (3356): fraud from a genuine domain
    make("guardianshield-GSS-2026-1121.pdf",
         dict(name="Guardian Shield Security Services", gstin="29AAHFG3318R1Z9", email="finance@guardianshield.co.in",
              phone="+91 80 0000 1103", address="21, 1st Main, Jayanagar 3rd Block, Bengaluru 560011",
              bank="Account ending 8851"),
         dict(no="GSS-2026-1121", date="03-11-2026", period="October 2026", po="LB-PO-2026-017",
              lines=[(f"Manned guarding services, 24x7 - {c}", "998525", 1, amt)
                     for c, amt in (("Koramangala", 48000), ("Indiranagar", 40000), ("HSR Layout", 42000),
                                    ("Whitefield", 52000), ("Hebbal", 42000))]))


if __name__ == "__main__":
    main(sys.argv[1])
