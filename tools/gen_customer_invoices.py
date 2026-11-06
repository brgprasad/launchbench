"""Generate a PDF for every customer invoice in data/invoices.csv.

WF-3 attaches these when a member asks for an invoice copy. The figures come
straight from invoices.csv and members.csv, so the PDF always matches what the
workflow quotes. tools/publish_drive.py uploads them to Drive (Customer Invoices/).

Usage: python3 -I tools/gen_customer_invoices.py            (writes build/customer-invoices/)
File names: LB/26-27/0407 -> LB-26-27-0407.pdf
"""
import csv
import re
import sys
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

ROOT = Path(__file__).resolve().parent.parent
OUT = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "build" / "customer-invoices"
OUT.mkdir(parents=True, exist_ok=True)

INK = colors.HexColor("#14213D")
ACCENT = colors.HexColor("#F26B1D")
LIGHT = colors.HexColor("#F6F1E9")
ss = getSampleStyleSheet()
small = ParagraphStyle("small", parent=ss["Normal"], fontSize=8.5, leading=11, textColor=INK)
body = ParagraphStyle("body", parent=ss["Normal"], fontSize=9.5, leading=12.5, textColor=INK)
brand = ParagraphStyle("brand", parent=ss["Title"], fontSize=20, leading=24, alignment=0, textColor=INK, spaceAfter=0)
heading = ParagraphStyle("heading", parent=ss["Heading2"], fontSize=13, textColor=ACCENT, spaceBefore=0, spaceAfter=0)

SELLER = ("3rd &amp; 4th Floor, Sprint House, 80 Feet Road, 4th Block, Koramangala, Bengaluru 560034<br/>"
          "GSTIN 29AAFCL4821M1Z7 &nbsp;|&nbsp; teamlaunchbench@gmail.com")
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
          "October", "November", "December"]


def inr(x: float) -> str:
    """Indian digit grouping, 2 decimals: 1234567.5 -> 12,34,567.50"""
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
    return ("-" if x < 0 else "") + whole + "." + frac


def nice(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.day} {MONTHS[d.month - 1][:3]} {d.year}"


def period_name(p: str) -> str:
    y, m = p.split("-")
    return f"{MONTHS[int(m) - 1]} {y}"


def centres() -> dict:
    text = (ROOT / "kb" / "01-centres.md").read_text()
    out = {}
    for m in re.finditer(r"^## ([^(\n]+)\((\w{3})\)[^\n]*\n(?:.*\n)*?- \*\*Address:\*\* (.+)$", text, re.M):
        out[m.group(2)] = (m.group(1).strip(), m.group(3).strip())
    return out


def make(inv: dict, member: dict, where: dict) -> Path:
    name = inv["invoice_no"].replace("/", "-") + ".pdf"
    path = OUT / name
    doc = SimpleDocTemplate(str(path), pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm,
                            topMargin=14 * mm, bottomMargin=14 * mm,
                            title=f"Launchbench invoice {inv['invoice_no']}", author="Launchbench Workspaces Pvt. Ltd.")
    centre_name, centre_addr = where.get(member["centre"], (member["centre"], ""))
    top = Table([[Paragraph("<b>launch</b>bench", brand), Paragraph("TAX INVOICE", heading)],
                 [Paragraph("Launchbench Workspaces Pvt. Ltd.<br/>" + SELLER, small), ""]],
                colWidths=[120 * mm, 54 * mm])
    top.setStyle(TableStyle([("ALIGN", (1, 0), (1, 0), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                             ("LINEBELOW", (0, 1), (-1, 1), 1.2, ACCENT), ("BOTTOMPADDING", (0, 1), (-1, 1), 8),
                             ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    status = "Paid on " + nice(inv["paid_on"]) if inv["status"].lower().startswith("paid") and inv["paid_on"] else "Due by " + nice(inv["due_date"])
    meta = Table([
        [Paragraph("<b>Invoice No.</b>", small), Paragraph(inv["invoice_no"], small),
         Paragraph("<b>Bill to</b>", small)],
        [Paragraph("<b>Invoice date</b>", small), Paragraph(nice(inv["invoice_date"]), small),
         Paragraph(f"<b>{member['company']}</b><br/>Member {member['member_id']}, {member['space']}, Launchbench {centre_name}<br/>"
                   f"{centre_addr}<br/>GSTIN {inv['gstin_on_invoice'] or 'not registered (B2C)'}", small)],
        [Paragraph("<b>Billing period</b>", small), Paragraph(period_name(inv["billing_period"]), small), ""],
        [Paragraph("<b>Place of supply</b>", small), Paragraph("Karnataka (29)", small), ""],
        [Paragraph("<b>Payment</b>", small), Paragraph(status, small), ""],
    ], colWidths=[28 * mm, 42 * mm, 104 * mm])
    meta.setStyle(TableStyle([("SPAN", (2, 1), (2, 4)), ("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("BACKGROUND", (2, 1), (2, 4), LIGHT), ("LEFTPADDING", (0, 0), (1, -1), 0)]))

    seats = member["seats"]
    plan = member["plan"]
    lines = [(f"{plan}: {seats} seat{'s' if seats != '1' else ''}, {member['space']}, {centre_name}, "
              f"{period_name(inv['billing_period'])} (billed in advance)", "997212", float(inv["seat_fee_inr"]))]
    if float(inv["usage_inr"] or 0):
        lines.append((inv["usage_note"].replace("INR ", "₹") + " (billed in arrears)", "997212", float(inv["usage_inr"])))
    if float(inv["late_fee_inr"] or 0):
        lines.append((inv["late_fee_note"] or "Late fee", "997212", float(inv["late_fee_inr"])))
    rows = [["#", "Description", "SAC", "Amount (INR)"]]
    for i, (desc, sac, amt) in enumerate(lines, 1):
        rows.append([str(i), Paragraph(desc.replace("₹", "Rs "), body), sac, inr(amt)])
    gst = float(inv["gst_18_inr"])
    cgst = round(gst / 2, 2)
    rows += [["", "Taxable value", "", inr(float(inv["taxable_inr"]))],
             ["", "CGST @ 9%", "", inr(cgst)],
             ["", "SGST @ 9%", "", inr(gst - cgst)],
             ["", "Total (INR)", "", inr(float(inv["total_inr"]))]]
    n = len(lines)
    lt = Table(rows, colWidths=[8 * mm, 118 * mm, 18 * mm, 30 * mm])
    lt.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), INK), ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                            ("FONTNAME", (1, -1), (-1, -1), "Helvetica-Bold"),
                            ("LINEBELOW", (0, 1), (-1, n), 0.3, colors.lightgrey),
                            ("LINEABOVE", (0, -1), (-1, -1), 1, INK), ("BACKGROUND", (0, -1), (-1, -1), LIGHT),
                            ("ALIGN", (3, 0), (3, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                            ("FONTSIZE", (0, 0), (-1, -1), 9), ("TEXTCOLOR", (0, 1), (-1, -1), INK)]))

    el = [top, Spacer(1, 5 * mm), meta, Spacer(1, 6 * mm), lt, Spacer(1, 6 * mm),
          Paragraph("<b>How to pay:</b> NEFT, RTGS, IMPS or UPI to Launchbench Workspaces Pvt. Ltd., account ending 4821, "
                    "quoting the invoice number. Payment is due by the 7th; cheques are not accepted. "
                    "Our bank details never change by email.", small),
          Spacer(1, 2 * mm),
          Paragraph("TDS, if applicable, under Section 194-I at 10% on the taxable value; please share Form 16A every quarter. "
                    "Raise any dispute within 15 days of the invoice date.", small),
          Spacer(1, 10 * mm),
          Paragraph("For Launchbench Workspaces Pvt. Ltd.<br/><br/>Authorised Signatory", body),
          Spacer(1, 8 * mm),
          Paragraph("<i>Launchbench Workspaces is a fictional company. This document was generated for a software demo "
                    "and is not a real tax invoice.</i>", small)]
    doc.build(el)
    return path


def main() -> None:
    members = {m["member_id"]: m for m in csv.DictReader(open(ROOT / "data" / "members.csv", newline=""))}
    where = centres()
    assert len(where) == 5, where
    count = 0
    for inv in csv.DictReader(open(ROOT / "data" / "invoices.csv", newline="")):
        make(inv, members[inv["member_id"]], where)
        count += 1
    print(f"{count} invoices -> {OUT}")


if __name__ == "__main__":
    main()
