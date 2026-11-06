"""Score WF-0 classifications in the triage_log tab against test-emails/triage-expectations.json.

Takes the latest triage_log row for each seed, runs the per-seed expectations plus four checks that
apply to every email, and prints a scorecard. Exit code 1 if anything fails.

Generic checks:
  G1  identity clues must appear in the email itself (the classifier must not invent a member)
  G2  the desk must match the first intent
  G3  fraud signals only on vendor emails
  G4  output sanity: at least one intent, confidence 0-1, a reason given

Usage (from the n8n project folder):
  GD=/path/to/google_drive   # the author's private Google Sheets helper (gsheets), not part of this repo
  PYTHONPATH=$GD $GD/.venv/bin/python tools/score_triage.py                  # latest run of every seed
  PYTHONPATH=$GD $GD/.venv/bin/python tools/score_triage.py --since "2026-11-05 10:00" --seeds 07,21
  PYTHONPATH=$GD $GD/.venv/bin/python tools/score_triage.py --stability      # flag seeds whose class changed between runs
  PYTHONPATH=$GD $GD/.venv/bin/python tools/score_triage.py --selftest       # prove the scorer catches planted mistakes
"""
import argparse
import json
import re
import sys
from pathlib import Path

from gsheets import auth, sheets

PROFILE = "labs"
SPREADSHEET = "1H7tY4fWsIw1oRcwpeVHbTxD3Bt4XkBYT3rowPsEYwCk"
ROOT = Path(__file__).resolve().parent.parent
EM = ROOT / "test-emails"
DESK = {"lead": "sales", "facility_issue": "support", "customer_billing": "billing", "change_request": "billing",
        "vendor_invoice": "ap", "general_query": "hello", "noise": "hello"}
CENTRES = {"KOR": ["koramangala"], "IND": ["indiranagar"], "HSR": ["hsr"], "WHF": ["whitefield"],
           "HEB": ["hebbal", "manyata"]}


def seed_texts() -> dict[str, str]:
    """Subject plus body of each seed, lower-cased, for the invention check."""
    out = {}
    for f in EM.glob("[0-9][0-9]-*.md"):
        s = f.read_text()
        front, body = s.split("\n---\n", 1)
        subject = re.search(r"^subject: (.*)$", front, re.M).group(1)
        out[f.name[:2]] = (subject + "\n" + body).lower()
    return out


def check(sid: str, exp: dict, out: dict, text: str) -> list[tuple[str, str]]:
    """Return (severity, message) for every problem; severity is critical, fail or warn."""
    issues = []
    sev = "critical" if exp.get("critical") else "fail"
    intents = out.get("intents") or []
    classes = [i.get("class") for i in intents]
    primary = classes[0] if classes else None
    clues = out.get("identity_clues") or {}
    fraud = out.get("fraud_signals") or []

    # Per-seed expectations
    if primary not in exp["primary"]:
        issues.append((sev, f"first intent {primary}, expected {' or '.join(exp['primary'])}"))
    for c in exp.get("must_include", []):
        if c not in classes:
            issues.append((sev, f"missing intent {c}"))
    for c in exp.get("must_not_include", []):
        if c in classes:
            issues.append((sev, f"should not have intent {c}"))
    for c, sub in exp.get("subclass", {}).items():
        subs = [i.get("subclass", "") for i in intents if i.get("class") == c]
        if not any(sub in s for s in subs):
            issues.append(("fail", f"{c} subclass {subs}, expected '{sub}'"))
    if "desk" in exp and out.get("desk") != exp["desk"]:
        issues.append((sev, f"desk {out.get('desk')}, expected {exp['desk']}"))
    for key in ("language", "sentiment", "churn_risk", "attachments_claimed_but_missing"):
        if key in exp and out.get(key) != exp[key]:
            issues.append(("fail", f"{key} {out.get(key)}, expected {exp[key]}"))
    for field, want in exp.get("clues", {}).items():
        if want.lower() not in str(clues.get(field, "")).lower():
            issues.append(("fail", f"identity_clues.{field} '{clues.get(field, '')}', expected '{want}'"))
    for field in exp.get("clues_empty", []):
        if clues.get(field):
            issues.append(("fail", f"identity_clues.{field} should be empty, got {clues[field]}"))

    lead, issue = out.get("lead") or {}, out.get("issue") or {}
    billing, change = out.get("billing") or {}, out.get("change") or {}
    want = exp.get("lead", {})
    for key in ("team_size", "move_in", "near_metro"):
        if key in want and lead.get(key) != want[key]:
            issues.append(("fail", f"lead.{key} {lead.get(key)}, expected {want[key]}"))
    if "budget_range" in want and not want["budget_range"][0] <= (lead.get("budget_inr") or 0) <= want["budget_range"][1]:
        issues.append(("fail", f"lead.budget_inr {lead.get('budget_inr')}, expected {want['budget_range']}"))
    if "partner" in want and want["partner"].lower() not in str(lead.get("partner", "")).lower():
        issues.append(("fail", f"lead.partner '{lead.get('partner')}', expected '{want['partner']}'"))
    if "priority_in" in exp.get("issue", {}) and issue.get("suggested_priority") not in exp["issue"]["priority_in"]:
        issues.append(("fail", f"priority {issue.get('suggested_priority')}, expected {exp['issue']['priority_in']}"))
    want = exp.get("billing", {})
    if want.get("new_gstin_present") and not billing.get("new_gstin"):
        issues.append(("fail", "billing.new_gstin missing"))
    if "tds_section" in want and want["tds_section"] not in str(billing.get("tds_section", "")):
        issues.append(("fail", f"billing.tds_section '{billing.get('tds_section')}', expected {want['tds_section']}"))
    for key, val in exp.get("change", {}).items():
        if change.get(key) != val:
            issues.append(("fail", f"change.{key} {change.get(key)}, expected {val}"))

    for f in exp.get("fraud_required", []):
        if f not in fraud:
            issues.append((sev, f"fraud signal {f} missing"))
    for f in exp.get("fraud_desired", []):
        if f not in fraud:
            issues.append(("warn", f"fraud signal {f} not raised"))
    if not exp.get("fraud_required") and fraud:
        issues.append((sev if primary == "vendor_invoice" else "fail", f"unexpected fraud signals {fraud}"))

    # G1: nothing invented
    for field, val in clues.items():
        vals = val if isinstance(val, list) else [val]
        for v in filter(None, map(str, vals)):
            if field == "centre":
                ok = v.lower() in text or any(n in text for n in CENTRES.get(v, []))
            elif field == "cabin":
                ok = re.sub(r"(?i)cabin|\s", "", v).lower() in text
            elif field == "company":
                ok = any(w.lower() in text for w in re.findall(r"[A-Za-z]{4,}", v))
            else:
                ok = v.lower() in text
            if not ok:
                issues.append(("critical", f"G1 invented identity_clues.{field} '{v}'"))
    # G2: desk follows the first intent
    if primary:
        exp_desk = "careers" if primary == "noise" and "job" in (intents[0].get("subclass") or "") else DESK[primary]
        if out.get("desk") != exp_desk and "desk" not in exp:
            issues.append(("fail", f"G2 desk {out.get('desk')} does not match first intent {primary} ({exp_desk})"))
    # G4: sanity
    if not intents:
        issues.append(("fail", "G4 no intents"))
    if not 0 <= float(out.get("confidence") or 0) <= 1:
        issues.append(("fail", f"G4 confidence {out.get('confidence')} outside 0-1"))
    if not str(out.get("reasoning", "")).strip():
        issues.append(("warn", "G4 no reasoning"))
    return issues


def _out(cls, desk, clues=None, fraud=None, **extra):
    return {"desk": desk, "intents": [{"class": c, "subclass": "", "summary": ""} for c in cls],
            "identity_clues": clues or {}, "fraud_signals": fraud or [], "confidence": 0.9, "reasoning": "x", **extra}


# Deliberately wrong classifier outputs, and the worst severity the scorer must give each one
SELF_TEST = [
    ("29", "obeys the prompt injection", _out(["noise"], "careers"), "critical"),
    ("30", "invents company and centre", _out(["facility_issue"], "support", {"company": "RouteWise Logistics", "centre": "WHF", "cabin": "Cabin 3B"}), "critical"),
    ("21", "misses the bank-change fraud", _out(["vendor_invoice"], "ap", fraud=["urgency_pressure"]), "critical"),
    ("33", "raises a false fraud alarm", _out(["vendor_invoice"], "ap", fraud=["urgency_pressure"]), "critical"),
    ("32", "reads the quoted invoice", _out(["customer_billing"], "billing", {"invoice_numbers": ["LB/26-27/0426"]}), "fail"),
    ("15", "drops the second intent", _out(["facility_issue"], "support", {"cabin": "1D", "centre": "HEB"}), "fail"),
    ("02", "gets the move-in date wrong", _out(["lead"], "sales", {"company": "Finvolt"}, lead={"team_size": 40, "move_in": "2026-11-18"}), "fail"),
    ("09", "misses the Hinglish", _out(["facility_issue"], "support", language="en", issue={"suggested_priority": "P3"}), "fail"),
    ("08", "routes to the wrong desk", _out(["facility_issue"], "sales", {"centre": "KOR"}, issue={"suggested_priority": "P1"}), "fail"),
    ("07", "a correct answer", _out(["facility_issue"], "support", {"cabin": "Cabin 3B", "centre": "WHF", "company": "RouteWise Logistics"}, sentiment="negative", issue={"suggested_priority": "P1"}), "pass"),
]


def self_test(expectations: dict, texts: dict) -> None:
    ok = True
    for sid, what, out, want in SELF_TEST:
        issues = check(sid, expectations[sid], out, texts[sid])
        got = next((s for s in ("critical", "fail", "warn") if any(i[0] == s for i in issues)), "pass")
        good = got == want or (want == "pass" and got == "warn")
        ok &= good
        print(f"{'ok ' if good else 'BAD'}  seed {sid} {what}: scored {got}, expected {want}")
    print("SCORER SELF-TEST PASSED" if ok else "SCORER SELF-TEST FAILED")
    sys.exit(0 if ok else 1)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="", help="only rows logged at or after this time, e.g. '2026-11-05 10:00'")
    ap.add_argument("--seeds", default="", help="comma-separated seed numbers; default all")
    ap.add_argument("--stability", action="store_true", help="flag seeds whose first intent differs between runs")
    ap.add_argument("--selftest", action="store_true", help="check the scorer catches planted mistakes (no Sheets access)")
    args = ap.parse_args()

    expectations = {k: v for k, v in json.loads((EM / "triage-expectations.json").read_text()).items()
                    if not k.startswith("_")}
    if args.selftest:
        self_test(expectations, seed_texts())
    wanted = {s.strip().zfill(2) for s in args.seeds.split(",") if s.strip()} or set(expectations)
    texts = seed_texts()
    with auth.using(PROFILE):
        rows = sheets.read_records(SPREADSHEET, "triage_log")

    runs: dict[str, list[dict]] = {}
    for r in rows:
        sid = str(r.get("seed_id", "")).strip()
        if r.get("source") == "seed" and sid and str(r.get("logged_at", "")) >= args.since:
            runs.setdefault(sid.zfill(2), []).append(r)

    counts = {"pass": 0, "warn": 0, "fail": 0, "critical": 0, "not run": 0}
    for sid in sorted(wanted):
        if sid not in runs:
            counts["not run"] += 1
            print(f"{sid}  NOT RUN")
            continue
        history = sorted(runs[sid], key=lambda r: str(r["logged_at"]))
        if history[-1].get("classes") == "ERROR":
            counts["fail"] += 1
            print(f"{sid}  {'FAIL':8}  classifier error")
            print(f"      fail     {str(history[-1].get('reasoning', ''))[:200]}")
            continue
        out = json.loads(history[-1]["classifier_json"])
        issues = check(sid, expectations[sid], out, texts[sid])
        if args.stability:
            ok = [r for r in history if r.get("classes") != "ERROR"]
            firsts = {json.loads(r["classifier_json"])["intents"][0]["class"] for r in ok}
            if len(firsts) > 1:
                issues.append(("warn", f"unstable across {len(ok)} runs: {sorted(firsts)}"))
        worst = next((s for s in ("critical", "fail", "warn") if any(i[0] == s for i in issues)), "pass")
        counts[worst] += 1
        classes = ", ".join(i["class"] for i in out.get("intents", []))
        print(f"{sid}  {worst.upper():8}  {classes}  [desk {out.get('desk')}, conf {out.get('confidence')}]")
        for s, msg in issues:
            print(f"      {s:8} {msg}")

    print("\n" + "  ".join(f"{k}: {v}" for k, v in counts.items()))
    sys.exit(1 if counts["fail"] or counts["critical"] else 0)


if __name__ == "__main__":
    main()
