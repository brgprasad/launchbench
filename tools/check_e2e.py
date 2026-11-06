#!/usr/bin/env python3
"""Check a full end-to-end test-runner run (WF-T with triage_only off).

For every seed it reads what the handlers wrote to the live spreadsheet and
compares it with the expectations in the seed's front matter:
  - triage_log: the class (expected_class)
  - the handler tab the class should reach: leads, tickets, billing_cases,
    requests, ap_invoices (a vendor email only gets a row when it has a PDF)
  - leads.lead_score (expected_lead_score), tickets.priority (expected_priority),
    ap_invoices.validation_status (expected_validation), billing priority
  - whether the AI draft passed its checks or a template / [CHECK] was used
  - rows in the errors tab since the run started

Usage (needs the labs Google sign-in, like score_triage.py):
  GD=/path/to/google_drive   # the author's private Google Sheets helper (gsheets), not part of this repo
  PYTHONPATH=$GD $GD/.venv/bin/python tools/check_e2e.py --since "2026-11-06 19:29" [--seeds 01,02]
"""
import argparse
import pathlib
import re

from gsheets import auth, sheets

SID = "1H7tY4fWsIw1oRcwpeVHbTxD3Bt4XkBYT3rowPsEYwCk"
ROOT = pathlib.Path(__file__).resolve().parent.parent
STATUS = {"PASS": "pending approval", "FLAG": "flagged", "HOLD": "on hold", "SUSPECTED_FRAUD": "suspected fraud"}


def seeds():
    out = {}
    for f in sorted((ROOT / "test-emails").glob("[0-9][0-9]-*.md")):
        fm = f.read_text().split("---")[1]
        get = lambda k: (re.search(rf"^{k}:\s*(.*)$", fm, re.M) or [None, ""])[1].strip()
        sid = get("id").zfill(2)
        out[sid] = {"class": get("expected_class"), "score": get("expected_lead_score"), "priority": get("expected_priority"),
                    "validation": get("expected_validation"), "pdf": "attachments/" in get("attachments"), "file": f.name}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", required=True, help="IST 'YYYY-MM-DD HH:MM' when the run started")
    ap.add_argument("--seeds", default="", help="comma list; default all")
    a = ap.parse_args()
    want = {s.strip().zfill(2) for s in a.seeds.split(",") if s.strip()}
    exp = {k: v for k, v in seeds().items() if not want or k in want}

    with auth.using("labs"):
        tab = {t: sheets.read_records(SID, t) for t in ["triage_log", "leads", "tickets", "billing_cases", "requests", "ap_invoices", "errors"]}
    by_seed = lambda t: {}
    rows = {t: {} for t in tab}
    for t, recs in tab.items():
        for r in recs:
            s = str(r.get("seed_id", "")).zfill(2) if r.get("seed_id") not in ("", None) else ""
            if t == "triage_log" and str(r.get("logged_at", "")) < a.since:
                continue
            if s:
                rows[t].setdefault(s, []).append(r)

    problems = 0
    for sid, e in exp.items():
        notes, bad = [], []
        tl = rows["triage_log"].get(sid, [])
        classes = tl[-1]["classes"] if tl else ""
        if not tl:
            bad.append("no triage_log row")
        elif classes == "ERROR":
            bad.append("classifier ERROR: " + str(tl[-1].get("reasoning", ""))[:80])
        got = {c.split("/")[0] for c in str(classes).split(", ") if c}
        want_cls = {c.strip(" []") for c in e["class"].split(",")}
        if tl and classes != "ERROR" and not want_cls & got:
            bad.append(f"class {classes}, expected {e['class']}")

        L, T, B, R, A = (rows[t].get(sid, []) for t in ["leads", "tickets", "billing_cases", "requests", "ap_invoices"])
        if "lead" in got:
            if not L: bad.append("lead class but no leads row")
            else:
                notes.append(f"lead {L[-1]['lead_score']} {L[-1].get('status','')}")
                if e["score"] and L[-1]["lead_score"] != e["score"]: bad.append(f"lead_score {L[-1]['lead_score']}, expected {e['score']}")
        if "facility_issue" in got:
            if not T: bad.append("facility class but no ticket")
            else:
                t = T[-1]; notes.append(f"ticket {t['priority']} {t['category']} reply_by={t.get('reply_by','')}")
                p = (re.match(r"P\d", e["priority"]) or [""])[0]
                if p and t["priority"] != p: bad.append(f"priority {t['priority']}, expected {p}")
                if t.get("reply_by") == "template": bad.append("AI ack failed its check: template sent")
        if B:
            b = B[-1]; notes.append(f"billing {b['topics']} prio={b['priority']}")
            if e["priority"] == "high" and b["priority"] != "high": bad.append(f"billing priority {b['priority']}, expected high")
            if "[CHECK]" in str(b.get("draft_check", "")) or "failed" in str(b.get("draft_check", "")).lower(): bad.append("billing draft failed its check")
        elif "customer_billing" in got and "change_request" not in got:
            bad.append("billing class but no billing_cases row")
        if R:
            r = R[-1]; notes.append(f"request {r['kind']} {r['decision']}")
            if "CHECK BEFORE APPROVING" in str(r.get("draft_check", "")) or "failed" in str(r.get("draft_check", "")).lower(): bad.append("request draft failed its check: " + str(r.get("draft_check", ""))[:90])
        elif ("change_request" in got or "general_query" in got) and "lead" not in got:
            bad.append("question/change but no requests row")
        if "vendor_invoice" in got and e["pdf"]:
            if not A: bad.append("vendor invoice with PDF but no ap_invoices row")
            else:
                st = str(A[-1]["validation_status"]); notes.append(f"AP {st} checks={A[-1].get('checks','')}")
                v = e["validation"].split()[0] if e["validation"] else ""
                if v and STATUS.get(v, v.lower()) not in st.lower(): bad.append(f"validation {st}, expected {v}")
        problems += bool(bad)
        print(f"{sid} {'FAIL' if bad else 'ok  '} {classes[:45]:45} | {'; '.join(notes)}")
        for b_ in bad:
            print(f"     ! {b_}")
    errs = [r for r in tab["errors"] if str(r.get("logged_at", "")) >= a.since]
    print(f"\n{len(exp) - problems}/{len(exp)} seeds ok; errors tab rows since {a.since}: {len(errs)}")
    for r in errs:
        print(f"   {r['logged_at']} {r['workflow'][:30]} @ {r['node']}: {str(r['error'])[:90]}")


if __name__ == "__main__":
    main()
