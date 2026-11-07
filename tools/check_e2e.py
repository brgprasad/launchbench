#!/usr/bin/env python3
"""Check a full end-to-end test-runner run (WF-T with triage_only off).

For every seed it reads what the handlers wrote to the live spreadsheet and
compares it with the expectations in the seed's front matter:
  - triage_log: the class (expected_class)
  - the handler tab the class should reach: leads, tickets, billing_cases,
    requests, ap_invoices (a vendor email only gets a row when it has a PDF)
  - leads.lead_score (expected_lead_score), tickets.priority (expected_priority),
    ap_invoices.validation_status (expected_validation), billing priority,
    requests.decision (expected_decision: auto-send, staff answer or approval)
  - whether the AI draft passed its checks or a template / [CHECK] was used
  - rows in the errors tab since the run started

Usage (needs the labs Google sign-in, like score_triage.py):
  GD=/path/to/google_drive   # the author's private Google Sheets helper (gsheets), not part of this repo
  PYTHONPATH=$GD $GD/.venv/bin/python tools/check_e2e.py --since "2026-11-06 19:29" [--seeds 01,02]

After tools/send_seeds.py (real emails), pass its run log instead. Rows carry no
seed_id then, so each email is found in triage_log by its subject, and handler
rows by their received_at. It also reads the test account's inbox (labs-mail
sign-in) for the replies a tester would get: every email must get at least one
reply at once (an answer or an acknowledgement), except seeds marked
expected_reply: none (suspected fraud, pitches, newsletters), which must get
none. Each reply's first words are listed.
  PYTHONPATH=$GD $GD/.venv/bin/python tools/check_e2e.py --run-log runs/send-20261107-1015.json
"""
import json
import argparse
import csv
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
                    "validation": get("expected_validation"), "decision": get("expected_decision"),
                    "reply": get("expected_reply").split("#")[0].strip(), "pdf": "attachments/" in get("attachments"), "file": f.name}
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", help="IST 'YYYY-MM-DD HH:MM' when the run started (test-runner runs)")
    ap.add_argument("--run-log", help="runs/send-*.json from tools/send_seeds.py (real-email runs)")
    ap.add_argument("--seeds", default="", help="comma list; default all")
    a = ap.parse_args()
    log = json.loads(pathlib.Path(a.run_log).read_text()) if a.run_log else None
    if log:
        a.since = a.since or log["started"]
        a.seeds = a.seeds or ",".join(x["seed"] for x in log["seeds"])
    if not a.since:
        ap.error("give --since or --run-log")
    want = {s.strip().zfill(2) for s in a.seeds.split(",") if s.strip()}
    exp = {k: v for k, v in seeds().items() if not want or k in want}

    with auth.using("labs"):
        tab = {t: sheets.read_records(SID, t) for t in ["triage_log", "leads", "tickets", "billing_cases", "requests", "ap_invoices", "errors"]}
    by_seed = lambda t: {}
    rows = {t: {} for t in tab}
    # Real emails: subject -> seed in triage_log, then the email's time -> seed in every tab.
    by_time, seed_cls, seed_member = {}, {}, {}
    if log:
        subj = {x["subject"].strip().lower(): x["seed"] for x in log["seeds"]}
        for r in tab["triage_log"]:
            if str(r.get("logged_at", "")) >= a.since and r.get("source") == "live" and str(r.get("subject", "")).strip().lower() in subj:
                by_time[str(r["now"])] = subj[str(r["subject"]).strip().lower()]
                seed_cls[subj[str(r["subject"]).strip().lower()]] = str(r.get("classes", ""))
                m = re.search(r"\bM\d{3}\b", str(r.get("identity", "")))
                if m: seed_member[subj[str(r["subject"]).strip().lower()]] = m.group(0)
    ref = {}  # seed -> the member or vendor id its [as] tag stands for
    if log:
        with open(ROOT / "data" / "personas.csv", newline="") as fh:
            alias_ref = {p["alias"]: p["ref_id"] for p in csv.DictReader(fh)}
        ref = {x["seed"]: alias_ref.get(x["alias"], "") for x in log["seeds"]}
    by_minute = {}
    for when, sid in by_time.items():
        by_minute.setdefault(when[:16].replace("T", " "), []).append(sid)

    def seed_for(t, r):
        """Real emails: tickets log the minute and ap_invoices the date only, so
        fall back to the minute plus member, or the vendor."""
        got = by_time.get(str(r.get("now" if t == "triage_log" else "received_at", "")), "")
        if got or t == "triage_log":
            return got
        if t == "ap_invoices":
            hits = [s for s, v in ref.items() if v and v == r.get("vendor_id") and s in exp and exp[s]["pdf"] and str(r.get("received_at", "")) >= a.since[:10]]
            return hits[0] if len(hits) == 1 else ""
        need = {"tickets": "facility_issue", "billing_cases": "customer_billing", "leads": "lead"}.get(t, "")
        cands = [s for s in by_minute.get(str(r.get("received_at", ""))[:16].replace("T", " "), []) if need in seed_cls.get(s, "")]
        if len(cands) > 1:
            cands = [s for s in cands if seed_member.get(s, ref.get(s)) == r.get("member_id")] or cands
        return cands[0] if len(cands) == 1 else ""

    for t, recs in tab.items():
        for r in recs:
            if log:
                s = seed_for(t, r)
            else:
                s = str(r.get("seed_id", "")).zfill(2) if r.get("seed_id") not in ("", None) else ""
            if t == "triage_log" and str(r.get("logged_at", "")) < a.since:
                continue
            if s:
                rows[t].setdefault(s, []).append(r)
    replies = inbox_replies(log) if log else {}

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
            if e["decision"] and r["decision"] != e["decision"]:
                bad.append(f"decision {r['decision']}, expected {e['decision']}: " + str(r.get("draft_check", ""))[-120:])
            if "CHECK BEFORE APPROVING" in str(r.get("draft_check", "")) or "failed" in str(r.get("draft_check", "")).lower(): bad.append("request draft failed its check: " + str(r.get("draft_check", ""))[:90])
        elif ("change_request" in got or "general_query" in got) and "lead" not in got:
            bad.append("question/change but no requests row")
        if "vendor_invoice" in got and e["pdf"]:
            if not A: bad.append("vendor invoice with PDF but no ap_invoices row")
            else:
                st = str(A[-1]["validation_status"]); notes.append(f"AP {st} checks={A[-1].get('checks','')}")
                v = e["validation"].split()[0] if e["validation"] else ""
                if v and STATUS.get(v, v.lower()) not in st.lower(): bad.append(f"validation {st}, expected {v}")
        if log:
            got_reply = replies.get(sid, [])
            notes.append(f"{len(got_reply)} repl{'y' if len(got_reply) == 1 else 'ies'} in inbox")
            if e["reply"] == "none" and got_reply: bad.append("a reply was sent, but this email should get none")
            if e["reply"] != "none" and not got_reply: bad.append("no reply reached the sender")
            for g in got_reply: notes.append("  ↳ " + g[:70])
        problems += bool(bad)
        print(f"{sid} {'FAIL' if bad else 'ok  '} {classes[:45]:45} | {'; '.join(notes)}")
        for b_ in bad:
            print(f"     ! {b_}")
    errs = [r for r in tab["errors"] if str(r.get("logged_at", "")) >= a.since]
    print(f"\n{len(exp) - problems}/{len(exp)} seeds ok; errors tab rows since {a.since}: {len(errs)}")
    for r in errs:
        print(f"   {r['logged_at']} {r['workflow'][:30]} @ {r['node']}: {str(r['error'])[:90]}")


def inbox_replies(log):
    """Snippets of the messages that came back into each sent email's thread."""
    from gsheets import auth
    svc = auth.gmail_service("labs-mail")
    out = {}
    for x in log["seeds"]:
        th = svc.users().threads().get(userId="me", id=x["thread_id"], format="metadata", metadataHeaders=["From"]).execute()
        out[x["seed"]] = [m.get("snippet", "") for m in th.get("messages", []) if m["id"] != x["message_id"]]
    return out


if __name__ == "__main__":
    main()
