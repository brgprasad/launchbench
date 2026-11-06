"""Generate members.csv, meeting_room_usage.csv and invoices.csv from pricing.csv.

Usage: python3 -I tools/gen_data.py data
"""
import csv
import sys
from datetime import date, timedelta
from pathlib import Path

DATA = Path(sys.argv[1])
price = {r["sku"]: float(r["value"]) for r in csv.DictReader(open(DATA / "pricing.csv"))}

PLAN_SKU = {"Hot desk": "HOT", "Dedicated desk": "DED", "Private cabin": "CAB", "Founders Plan": "FND"}
CREDITS_PER_SEAT = {"Hot desk": 2, "Dedicated desk": 4, "Private cabin": 4}
DEPOSIT_MONTHS = {"Hot desk": 1, "Founders Plan": 1, "Dedicated desk": 2, "Private cabin": 2}
LOCKIN_DISC = {0: 0, 3: 0, 6: price["DISC-LOCKIN-6"], 12: price["DISC-LOCKIN-12"]}

# id, company, domain, contact, title, centre, plan, seats, lockin_m, start, status, exit_date, AM, space, escalated
M = [
    ("M001", "Tiffinly Technologies Pvt. Ltd.", "tiffinly.in", "Rahul Verma", "Operations Lead", "KOR", "Private cabin", 12, 12, "2026-02-01", "Active", "", "Ananya Bose", "Cabin 2A", False),
    ("M002", "Paysetu Fintech Pvt. Ltd.", "paysetu.in", "Shruti Agarwal", "Head of Admin", "IND", "Private cabin", 20, 12, "2026-04-01", "Active", "", "Ananya Bose", "Cabin 4A", False),
    ("M003", "KrishiGrid Agritech Pvt. Ltd.", "krishigrid.in", "Manoj Patil", "Co-founder", "HSR", "Dedicated desk", 6, 6, "2026-06-01", "Active", "", "Vikram Shetty", "Desks D21-D26", False),
    ("M004", "Nimbus Byte Analytics Pvt. Ltd.", "nimbusbyte.in", "Karthik Subramanian", "Workplace Manager", "WHF", "Private cabin", 30, 12, "2025-09-01", "Active", "", "Deepa Menon", "Cabin 5A", True),
    ("M005", "Swasth AI Health Pvt. Ltd.", "swasthai.in", "Neha Kapoor", "COO", "HEB", "Private cabin", 16, 12, "2026-03-01", "Active", "", "Deepa Menon", "Cabin 1D", False),
    ("M006", "Kalakaar Studio LLP", "kalakaar.studio", "Aisha Siddiqui", "Founder", "IND", "Dedicated desk", 4, 6, "2026-05-01", "Active", "", "Ananya Bose", "Desks D07-D10", False),
    ("M007", "RouteWise Logistics Pvt. Ltd.", "routewise.in", "Pradeep Gowda", "Admin Manager", "WHF", "Private cabin", 12, 12, "2026-01-01", "Active", "", "Deepa Menon", "Cabin 3B", False),
    ("M008", "Gurukul Online Learning Pvt. Ltd.", "gurukulonline.in", "Sanjay Bhat", "Head of Operations", "HSR", "Private cabin", 8, 6, "2026-08-01", "Active", "", "Vikram Shetty", "Cabin 2C", False),
    ("M009", "Fernweh Travel Tech Pvt. Ltd.", "fernweh.travel", "Tanvi Joshi", "Founder", "KOR", "Hot desk", 3, 0, "2026-07-01", "Active", "", "Ananya Bose", "Open area", False),
    ("M010", "Ledgerly Fintech Pvt. Ltd.", "ledgerly.in", "Harsh Vardhan", "Co-founder", "HSR", "Founders Plan", 2, 3, "2026-09-01", "Active", "", "Vikram Shetty", "Desks F03-F04", False),
    ("M011", "Mitti Ceramics D2C Pvt. Ltd.", "mitticeramics.in", "Pooja Rao", "Founder", "HEB", "Dedicated desk", 3, 6, "2026-05-01", "Active", "", "Deepa Menon", "Desks D14-D16", False),
    ("M012", "Quanta Robotics Pvt. Ltd.", "quantarobotics.in", "Arvind Krishnan", "CTO", "WHF", "Private cabin", 8, 12, "2026-03-01", "Active", "", "Deepa Menon", "Cabin 2F", False),
    ("M013", "Apna Kirana Cloud Pvt. Ltd.", "apnakirana.cloud", "Mohit Jain", "Co-founder", "KOR", "Private cabin", 8, 6, "2026-06-01", "Active", "", "Ananya Bose", "Cabin 3E", False),
    ("M014", "Vayu Drones Pvt. Ltd.", "vayudrones.in", "Siddharth Rao", "Admin Lead", "HEB", "Private cabin", 12, 12, "2025-12-01", "Active", "", "Deepa Menon", "Cabin 1A", False),
    ("M015", "ByteBazaar Commerce Pvt. Ltd.", "bytebazaar.in", "Zoya Ahmed", "Founder", "IND", "Hot desk", 5, 0, "2026-09-01", "Active", "", "Ananya Bose", "Open area", False),
    ("M016", "Dhoop Solar Energy Pvt. Ltd.", "dhoopsolar.in", "Venkatesh Iyer", "Office Manager", "WHF", "Dedicated desk", 8, 6, "2026-04-01", "Active", "", "Deepa Menon", "Desks D31-D38", False),
    ("M017", "LingoLab AI Pvt. Ltd.", "lingolab.ai", "Ishita Sen", "Co-founder", "KOR", "Founders Plan", 3, 3, "2026-10-01", "Active", "", "Ananya Bose", "Desks F10-F12", False),
    ("M018", "Kiraaya Rentals Pvt. Ltd.", "kiraaya.in", "Abhishek Nair", "Finance Executive", "HSR", "Private cabin", 6, 6, "2026-07-01", "Active", "", "Vikram Shetty", "Cabin 1B", False),
    ("M019", "Nirmaan BuildTech Pvt. Ltd.", "nirmaanbuild.in", "Gaurav Malhotra", "Head of People", "HEB", "Private cabin", 20, 12, "2026-01-01", "Active", "", "Deepa Menon", "Cabin 2A", False),
    ("M020", "Pixelpatch Games Pvt. Ltd.", "pixelpatch.games", "Daniel Fernandes", "Studio Manager", "KOR", "Private cabin", 16, 12, "2026-05-01", "Active", "", "Ananya Bose", "Cabin 3C", False),
    ("M021", "Arogya Diagnostics Ltd. (Bengaluru Sales)", "arogyadiagnostics.com", "Ramesh Kumar", "Regional Sales Manager", "WHF", "Private cabin", 8, 12, "2026-02-01", "Active", "", "Deepa Menon", "Cabin 4D", False),
    ("M022", "Saral Legal Services LLP", "sarallegal.in", "Kavitha Rao", "Partner", "IND", "Virtual office - Basic", 0, 12, "2026-04-01", "Active", "", "Ananya Bose", "Virtual", False),
    ("M023", "Greenloop Recycling Pvt. Ltd.", "greenloop.in", "Faisal Khan", "Founder", "HSR", "Virtual office - GST Registration", 0, 12, "2026-01-01", "Active", "", "Vikram Shetty", "Virtual", False),
    ("M024", "Cartwheel Commerce Pvt. Ltd.", "cartwheel.shop", "Megha Sharma", "Finance Lead", "WHF", "Hot desk", 4, 0, "2026-03-01", "Exited", "2026-09-30", "Deepa Menon", "Open area", False),
    ("M025", "Zenith Payroll Solutions Pvt. Ltd.", "zenithpayroll.in", "Anil Thomas", "Director", "KOR", "Dedicated desk", 5, 6, "2026-08-01", "Active", "", "Ananya Bose", "Desks D40-D44", False),
]

# Fictional GSTINs (Karnataka, state code 29). Kiraaya's is the OLD one; they will email a new one.
GSTIN = {
    "M001": "29AAFCT1184B1Z3", "M002": "29AAJCP5521F1ZX", "M003": "29AAGCK3390N1Z8", "M004": "29AADCN7712Q1Z1",
    "M005": "29AAQCS2268M1Z6", "M006": "29AAPFK4417E1ZB", "M007": "29AAHCR6603J1Z2", "M008": "29AAKCG1975H1Z4",
    "M009": "", "M010": "29AAMCL8840A1Z9", "M011": "29AASCM2056K1Z7", "M012": "29AARCQ4431D1Z5",
    "M013": "29AAUCA7789G1Z0", "M014": "29AAVCV3125P1Z3", "M015": "", "M016": "29AAECD5562R1Z8",
    "M017": "29AAXCL2207S1Z1", "M018": "29AALCK9914T1Z6", "M019": "29AAFCN6638U1Z2", "M020": "29AAZCP1149V1Z9",
    "M021": "29AABCA8873W1Z4", "M022": "29AAOFS3360X1ZA", "M023": "29AAYCG5512Y1Z7", "M024": "29AAWCC2284Z1Z5",
    "M025": "29AATCZ6697C1Z3",
}


def add_months(d, n):
    y, m = divmod(d.month - 1 + n, 12)
    return date(d.year + y, m + 1, 1)


def monthly_fee(row):
    mid, *_ , centre, plan, seats, lockin, start = row[:10]
    if plan.startswith("Virtual"):
        return price["VO-BASIC" if "Basic" in plan else "VO-GST"]
    base = seats * price[f"{PLAN_SKU[plan]}-{centre}"]
    fee = base * (1 - LOCKIN_DISC[lockin] / 100)
    # 6% escalation on first anniversary (Nimbus renewed 2026-09-01)
    if date.fromisoformat(start) <= date(2025, 9, 1):
        fee *= 1.06
    return round(fee)


members = []
for row in M:
    mid, company, domain, contact, title, centre, plan, seats, lockin, start, status, exit_date, am, space, esc = row
    fee = monthly_fee(row)
    s = date.fromisoformat(start)
    if mid == "M004":  # renewed for a further 12 months on 2025-09-01 anniversary -> current term from 2026-09-01
        term_start = date(2026, 9, 1)
    else:
        term_start = s
    lockin_end = (add_months(term_start, lockin) - timedelta(days=1)).isoformat() if lockin else ""
    deposit = 0 if plan.startswith("Virtual") else fee * DEPOSIT_MONTHS[plan]
    credits = 10 if plan == "Founders Plan" else (0 if plan.startswith("Virtual") else seats * CREDITS_PER_SEAT[plan])
    members.append({
        "member_id": mid, "company": company, "email_domain": domain, "primary_contact": contact,
        "contact_title": title, "contact_email": f"{contact.split()[0].lower()}@{domain}",
        "centre": centre, "plan": plan, "seats": seats, "space": space,
        "lock_in_months": lockin, "contract_start": start, "current_term_start": term_start.isoformat(),
        "lock_in_end": lockin_end, "monthly_seat_fee_inr": fee, "security_deposit_inr": deposit,
        "meeting_credits_per_month": credits, "gstin": GSTIN[mid], "account_manager": am,
        "status": status, "exit_date": exit_date,
        "notes": {
            "M004": "Renewed 12-month term from 2026-09-01 with 6% escalation. 2 housekeeping complaints in Oct 2026 (tickets T-1031, T-1047).",
            "M024": "Notice received 2026-08-29; exited 2026-09-30. Deposit refund pending (due by 2026-10-30).",
            "M018": "GSTIN on file is the old registration.",
            "M010": "Partner-referred (Kaveri Seed Partners); deposit waived.",
        }.get(mid, ""),
    })

fields = list(members[0].keys())
with open(DATA / "members.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=fields)
    w.writeheader()
    w.writerows(members)

# Meeting-room usage (credits) for Sep and Oct 2026. Planted overages.
USED = {  # member_id: (sep_used, oct_used)
    "M001": (44, 62), "M002": (71, 66), "M003": (20, 18), "M004": (102, 96), "M005": (50, 41),
    "M006": (12, 15), "M007": (30, 44), "M008": (26, 33), "M009": (4, 6), "M010": (7, 9),
    "M011": (8, 10), "M012": (21, 24), "M013": (25, 29), "M014": (40, 38), "M015": (9, 8),
    "M016": (28, 31), "M017": (0, 10), "M018": (18, 22), "M019": (64, 70), "M020": (70, 58),
    "M021": (19, 27), "M024": (6, 0), "M025": (16, 22),
}
# overage rate by room mostly used (member rate)
OVER_RATE = {"M001": 800, "M020": 800, "M025": 480, "M013": 480}
usage = []
for m in members:
    mid = m["member_id"]
    if mid not in USED:
        continue
    for month, used in zip(("2026-09", "2026-10"), USED[mid]):
        if mid == "M017" and month == "2026-09":
            continue
        if mid == "M024" and month == "2026-10":
            continue
        inc = int(m["meeting_credits_per_month"])
        over = max(0, used - inc)
        rate = OVER_RATE.get(mid, 800) if over else 0
        usage.append({
            "member_id": mid, "company": m["company"], "month": month, "credits_included": inc,
            "credits_used": used, "overage_hours": over, "overage_rate_inr": rate,
            "overage_amount_inr": over * rate,
            "note": {"M001": "Mostly Series A (8-seater) bookings by tiffinly.in users",
                     "M020": "Series B (8-seater) playtest sessions"}.get(mid, "") if over else "",
        })
with open(DATA / "meeting_room_usage.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(usage[0].keys()))
    w.writeheader()
    w.writerows(usage)
over_by = {(u["member_id"], u["month"]): u for u in usage}

# Invoices: Sep, Oct, Nov 2026 (issued on the 1st)
invoices = []
seq = 381
months = [("2026-09", date(2026, 9, 1)), ("2026-10", date(2026, 10, 1)), ("2026-11", date(2026, 11, 1))]
for period, inv_date in months:
    prev = {"2026-10": "2026-09", "2026-11": "2026-10"}.get(period)
    for m in members:
        mid = m["member_id"]
        if m["plan"].startswith("Virtual"):
            continue
        if date.fromisoformat(m["contract_start"]) > inv_date:
            continue
        # Planted error: Cartwheel exited 2026-09-30 but kept being billed for Oct & Nov.
        seat = int(m["monthly_seat_fee_inr"])
        usage_amt, usage_note = 0, ""
        if prev and (mid, prev) in over_by and over_by[(mid, prev)]["overage_amount_inr"]:
            u = over_by[(mid, prev)]
            usage_amt = u["overage_amount_inr"]
            usage_note = f"Meeting-room overage {prev}: {u['overage_hours']} hrs @ INR {u['overage_rate_inr']}"
        late_fee, late_note = 0, ""
        if mid == "M002" and period == "2026-11":
            oct_total = next(i["total_inr"] for i in invoices if i["member_id"] == "M002" and i["billing_period"] == "2026-10")
            late_fee = round(oct_total * 0.015)
            late_note = "Late fee 1.5% on overdue invoice LB/26-27/" + next(
                i["invoice_no"].split("/")[-1] for i in invoices if i["member_id"] == "M002" and i["billing_period"] == "2026-10")
        taxable = seat + usage_amt + late_fee
        gst = round(taxable * 0.18)
        status, paid_on = "Paid", (inv_date + timedelta(days=5)).isoformat()
        if period == "2026-11":
            status, paid_on = "Unpaid (not yet due)", ""
        if mid == "M002" and period == "2026-10":
            status, paid_on = "Overdue", ""
        if mid == "M024" and period in ("2026-10", "2026-11"):
            status, paid_on = "Unpaid", ""
        invoices.append({
            "invoice_no": f"LB/26-27/{seq:04d}", "invoice_date": inv_date.isoformat(), "member_id": mid,
            "company": m["company"], "gstin_on_invoice": m["gstin"], "billing_period": period,
            "seat_fee_inr": seat, "usage_inr": usage_amt, "usage_note": usage_note,
            "late_fee_inr": late_fee, "late_fee_note": late_note, "taxable_inr": taxable,
            "gst_18_inr": gst, "total_inr": taxable + gst,
            "due_date": (inv_date + timedelta(days=6)).isoformat(), "status": status, "paid_on": paid_on,
        })
        seq += 1
with open(DATA / "invoices.csv", "w", newline="") as f:
    w = csv.DictWriter(f, fieldnames=list(invoices[0].keys()))
    w.writeheader()
    w.writerows(invoices)

print(f"{len(members)} members, {len(usage)} usage rows, {len(invoices)} invoices")
