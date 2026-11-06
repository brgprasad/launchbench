"""Consistency checks for the Launchbench KB, data and seed emails.

Usage: python3 -I tools/verify.py .
"""
import csv
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(sys.argv[1])
KB, DATA, EM = ROOT / "kb", ROOT / "data", ROOT / "test-emails"
fails = []


def check(cond, msg):
    if not cond:
        fails.append(msg)


def rows(name):
    return list(csv.DictReader(open(DATA / name)))


def num(s):
    return int(s.replace("₹", "").replace(",", "").strip())


price = {r["sku"]: float(r["value"]) for r in rows("pricing.csv")}
CENTRES = ["KOR", "IND", "HSR", "WHF", "HEB"]

# 1. Seat-plan table in 02-pricing.md matches pricing.csv
pricing_md = (KB / "02-pricing.md").read_text()
for label, prefix in [("Hot desk", "HOT"), ("Dedicated desk", "DED"), ("Private cabin (per seat)", "CAB"),
                      ("Founders Plan (per seat)", "FND")]:
    line = next(l for l in pricing_md.splitlines() if l.startswith(f"| {label} |"))
    cells = [c.strip() for c in line.strip("|").split("|")[1:]]
    for c, cell in zip(CENTRES, cells):
        sku = f"{prefix}-{c}"
        if cell.startswith("₹"):
            check(sku in price and num(cell) == price[sku], f"02-pricing {label} {c}: {cell} vs csv {price.get(sku)}")
        else:
            check(sku not in price, f"02-pricing {label} {c} says not offered but csv has {sku}")

# Other fixed prices quoted in markdown
for sku, text in [("MR-4", "₹600 / hour"), ("MR-8", "₹1,000 / hour"), ("MR-12", "₹1,500 / hour"),
                  ("EVT-KOR-HALF", "₹22,000"), ("EVT-KOR-FULL", "₹40,000"), ("EVT-WHF-HALF", "₹26,000"),
                  ("EVT-WHF-FULL", "₹48,000"), ("DAY-ALL", "₹600 per person"), ("GUEST-ALL", "₹400"),
                  ("VO-BASIC", "₹2,000 / month"), ("VO-GST", "₹3,500 / month"), ("LOCKER-ALL", "₹750"),
                  ("ACCESS247-HOT", "₹1,500 / seat"), ("PARK-BIKE-ALL", "₹800")]:
    check(text in pricing_md, f"02-pricing missing '{text}' for {sku}")
    check(str(int(price[sku])) == re.sub(r"[^\d]", "", text.split("/")[0].split(" per")[0]),
          f"{sku} csv {price[sku]} vs md '{text}'")

# 2. FAQ Q3: 16-seat cabin, 12-month lock-in
faq = (KB / "07-faq.md").read_text()
names = {"KOR": "Koramangala", "IND": "Indiranagar", "HSR": "HSR Layout", "WHF": "Whitefield", "HEB": "Hebbal"}
q3 = faq.split("**3.")[1].split("**4.")[0]
for c in CENTRES:
    exp = round(16 * price[f"CAB-{c}"] * 0.9)
    m = re.search(rf"\| {names[c]} \| ₹([\d,]+) \|", q3)
    check(m and num(m.group(1)) == exp, f"FAQ Q3 {c}: expected {exp}, got {m.group(1) if m else None}")

# 3. Cabin inventory: centre file vs members / availability
centres_md = (KB / "01-centres.md").read_text()
inv = {}
for c in CENTRES:
    sect = centres_md.split(f"({c})")[1].split("\n## ")[0]
    cab_line = next(l for l in sect.splitlines() if l.startswith("- **Cabins:**"))
    inv[c] = {int(s): int(n) for n, s in re.findall(r"(\d+) × (\d+)-seat", cab_line)}
    cap = int(re.search(r"\*\*Capacity:\*\* (\d+) seats \((\d+) hot desks, (\d+) dedicated desks, (\d+) seats in cabins",
                        sect).group(1))
    hot, ded, cab = map(int, re.search(r"\((\d+) hot desks, (\d+) dedicated desks, (\d+) seats", sect).groups())
    check(sum(s * n for s, n in inv[c].items()) == cab, f"{c}: cabin seats {inv[c]} != {cab}")
    check(hot + ded + cab == cap, f"{c}: {hot}+{ded}+{cab} != {cap}")

members = {m["member_id"]: m for m in rows("members.csv")}
for m in members.values():
    if m["plan"] == "Private cabin":
        check(int(m["seats"]) in inv[m["centre"]], f"{m['member_id']} cabin {m['seats']} not in {m['centre']}")
for a in rows("availability.csv"):
    if a["space_type"] == "Private cabin":
        check(int(a["cabin_size"]) in inv[a["centre"]], f"availability {a['centre']} {a['cabin_size']} not in inventory")

# 4. Invoice arithmetic
invoices = {i["invoice_no"]: i for i in rows("invoices.csv")}
for i in invoices.values():
    t = int(i["seat_fee_inr"]) + int(i["usage_inr"]) + int(i["late_fee_inr"])
    check(t == int(i["taxable_inr"]), f"{i['invoice_no']} taxable")
    check(round(t * 0.18) == int(i["gst_18_inr"]), f"{i['invoice_no']} gst")
    check(t + int(i["gst_18_inr"]) == int(i["total_inr"]), f"{i['invoice_no']} total")
    check(i["member_id"] in members, f"{i['invoice_no']} unknown member")

# 5. AP log arithmetic
for a in rows("ap_invoices.csv"):
    check(abs(int(a["taxable_amount"]) * 0.18 - int(a["gst_amount"])) <= 1, f"AP {a['invoice_no']} gst")
    check(int(a["taxable_amount"]) + int(a["gst_amount"]) == int(a["total_amount"]), f"AP {a['invoice_no']} total")

# 6. Seed emails: referenced IDs exist, front matter present, attachments exist
classes = {}
domains = {m["email_domain"]: mid for mid, m in members.items()}
for f in sorted(EM.glob("*.md")):
    s = f.read_text()
    check(s.startswith("---\n") and s.count("\n---\n") >= 1, f"{f.name}: front matter")
    for key in ("from:", "to:", "subject:", "expected_class:", "expected_action:"):
        check(key in s.split("\n---\n")[0], f"{f.name}: missing {key}")
    for mid in set(re.findall(r"\bM0\d\d\b", s)):
        check(mid in members, f"{f.name}: unknown member {mid}")
    for inv_no in set(re.findall(r"LB/26-27/\d{4}", s)):
        check(inv_no in invoices, f"{f.name}: unknown invoice {inv_no}")
    for att in re.findall(r"attachments/[\w.-]+\.pdf", s):
        check((EM / att).exists(), f"{f.name}: missing {att}")
    # member referenced in expectations must match sender domain
    sender = re.search(r"^from: .*<[^@]+@([^>]+)>", s, re.M).group(1)
    named = re.findall(r"member (M0\d\d)|^\s*- Identify .*?(M0\d\d)", s, re.M)
    for a, b in named:
        mid = a or b
        check(domains.get(sender) == mid, f"{f.name}: sender {sender} is not {mid}")
    cls = re.search(r"^expected_class: (.+)$", s, re.M).group(1)
    for c in re.findall(r"[a-z_]+", cls):
        classes[c] = classes.get(c, 0) + 1
for c, n in classes.items():
    check(n >= 2, f"class {c} has only {n} seed email(s)")

# 7. PDFs: totals add up
for pdf, taxable, total in [("airlink-ALF-2026-11-0912.pdf", "1,85,000.00", "2,18,300"),
                            ("sparkleserv-SS-26-27-0611.pdf", "4,45,000.00", "5,25,100"),
                            ("beanbox-BBX-1964.pdf", "1,22,780.00", "1,44,880"),
                            ("guardianshield-GSS-2026-1121.pdf", "2,24,000.00", "2,64,320")]:
    txt = subprocess.run(["pdftotext", "-layout", str(EM / "attachments" / pdf), "-"],
                         capture_output=True, text=True).stdout
    check(taxable in txt and total in txt and "29AAFCL4821M1Z7" in txt, f"{pdf}: totals/GSTIN not found")

# 9. Website (site/dist, built by tools/build_site.py): prices, leaks, links, honesty guards
DIST = ROOT / "site" / "dist"
if DIST.exists():
    kb_text = " ".join(p.read_text() for p in KB.glob("*.md"))
    allowed = {num(a) for a in re.findall(r"₹[\d,]+", kb_text)} | {int(v) for v in price.values()}
    sizes = {1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 30}
    for sku, v in price.items():
        if sku.split("-")[0] in ("HOT", "DED", "CAB", "FND"):
            for k in sizes:
                for d in (1, 0.95, 0.9, 0.85):
                    allowed.add(round(v * k * d))
        if sku.split("-")[0] in ("MR", "EVT"):
            allowed.add(round(v * (100 - price["DISC-MEMBER-ROOMS"]) / 100))
        if sku.startswith("VO-"):
            allowed.add(int(v * 12))
    pages = sorted(DIST.rglob("*.html"))
    check(len(pages) >= 15, f"site: only {len(pages)} pages built")
    disclaimer = "is a fictional company"
    for page in pages:
        rel = page.relative_to(DIST)
        html = page.read_text()
        text = re.sub(r"<[^>]+>", " ", html)
        for amt in re.findall(r"₹[\d,]+", text):
            check(num(amt) in allowed, f"site {rel}: {amt} not in pricing.csv/KB or derivable from them")
        check("+lb-" not in html, f"site {rel}: staff alias (+lb-) leaked")
        check(not re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", text + " ".join(re.findall(r'href="mailto:([^"]+)"', html))),
              f"site {rel}: an email address is in the page source (use the mail() macro)")
        for leak in re.findall(r"\b[\w-]+\.(?:csv|md)\b", text):
            check(False, f"site {rel}: internal file name '{leak}' leaked")
        check('name="robots" content="noindex' in html, f"site {rel}: missing noindex")
        check(disclaimer in html, f"site {rel}: missing fictional-company disclaimer")
        refs = re.findall(r'(?:href|src)="(/[^"]*)"', html)
        refs += [u.split()[0] for s in re.findall(r'srcset="([^"]+)"', html) for u in s.split(",")]
        for ref in refs:
            path = ref.split("#")[0].split("?")[0]
            if not path.startswith("/") or path.startswith("//"):
                continue
            target = DIST / path.lstrip("/")
            if path.endswith("/"):
                target = target / "index.html"
            check(target.exists(), f"site {rel}: broken link {ref}")
    for f, must in (("_headers", "X-Robots-Tag: noindex"), ("robots.txt", "User-agent: GPTBot")):
        check((DIST / f).exists() and must in (DIST / f).read_text(), f"site: {f} missing or incomplete")
    print(f"site: {len(pages)} pages checked")

# 8. KB size
words = sum(len(p.read_text().split()) for p in KB.glob("*.md"))
print(f"classes: {classes}")
print(f"KB words: {words} (~{int(words * 1.4)} tokens)")
print("\n".join(fails) if fails else "ALL CHECKS PASSED")
sys.exit(1 if fails else 0)
