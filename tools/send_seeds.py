#!/usr/bin/env python3
"""Send seed emails as real Gmail messages, through the live trigger.

The test runner (WF-T) hands seeds straight to WF-0. This script tests the whole
path instead: Gmail delivery, the polling trigger, the bulk-mail filter, the
handlers, and the replies a tester would actually receive.

Every seed is sent from the demo's test account (whichever Google account the
labs-mail profile is signed in to; never the demo inbox itself) to the demo inbox, one every
--gap seconds (Google Sheets allows 60 writes a minute). A member or vendor seed
gets an [as <alias>] subject tag, so WF-0 treats it as that persona, exactly as
a presenter would. A prospect or noise seed arrives as the test account itself.
The real sending time is used, not the seed's date, so date-dependent results
(notice periods, SLA clocks) are computed from today.

Usage (needs the labs-mail sign-in of the author's private gsheets helper):
  GD=/path/to/google_drive
  PYTHONPATH=$GD $GD/.venv/bin/python tools/send_seeds.py --seeds 22,34 [--gap 30] [--dry-run]
Then check the results (the run log is written to runs/):
  PYTHONPATH=$GD $GD/.venv/bin/python tools/check_e2e.py --run-log runs/<file>.json
"""
import argparse
import base64
import csv
import datetime as dt
import json
import pathlib
import re
import time
from email.message import EmailMessage

ROOT = pathlib.Path(__file__).resolve().parent.parent
INBOX = "teamlaunchbench@gmail.com"     # the only address it sends to
IST = dt.timezone(dt.timedelta(hours=5, minutes=30))


def load_seeds():
    out = {}
    for f in sorted((ROOT / "test-emails").glob("[0-9][0-9]-*.md")):
        _, fm, body = f.read_text().split("---", 2)
        get = lambda k: (re.search(rf"^{k}:\s*(.*)$", fm, re.M) or [None, ""])[1].strip()
        m = re.match(r"(.*?)\s*<([^>]+)>", get("from"))
        name, addr = (m.group(1).strip('" '), m.group(2).lower()) if m else ("", get("from").lower())
        pdfs = re.findall(r"attachments/[\w.-]+\.pdf", get("attachments"))
        out[get("id").zfill(2)] = {"name": name, "address": addr, "subject": get("subject"),
                                   "body": body.strip() + "\n", "pdfs": pdfs, "file": f.name}
    return out


def aliases():
    with open(ROOT / "data" / "personas.csv", newline="") as fh:
        return {r["as_email"].lower(): r["alias"] for r in csv.DictReader(fh)}


def build(seed, alias, sender):
    msg = EmailMessage()
    msg["From"] = f"{seed['name']} <{sender}>" if seed["name"] else sender
    msg["To"] = INBOX
    msg["Subject"] = f"[as {alias}] {seed['subject']}" if alias else seed["subject"]
    msg.set_content(seed["body"])
    for rel in seed["pdfs"]:
        p = ROOT / "test-emails" / rel
        msg.add_attachment(p.read_bytes(), maintype="application", subtype="pdf", filename=p.name)
    return msg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default="", help="comma list, e.g. 22,34; default all")
    ap.add_argument("--gap", type=int, default=30, help="seconds between emails (default 30)")
    ap.add_argument("--dry-run", action="store_true", help="print what would be sent, send nothing")
    a = ap.parse_args()

    seeds, alias_of = load_seeds(), aliases()
    want = [s.strip().zfill(2) for s in a.seeds.split(",") if s.strip()] or list(seeds)
    unknown = [s for s in want if s not in seeds]
    if unknown:
        raise SystemExit(f"no such seed: {', '.join(unknown)}")

    svc, me = None, "test.account@example.com"
    if not a.dry_run:
        from gsheets import auth
        svc = auth.gmail_service("labs-mail")
        me = svc.users().getProfile(userId="me").execute()["emailAddress"].lower()
        if me == INBOX:
            raise SystemExit(f"labs-mail is signed in as the demo inbox {INBOX}: its own mail never reaches the workflow")

    started = dt.datetime.now(IST)
    log = {"started": started.strftime("%Y-%m-%d %H:%M"), "seeds": []}
    for i, sid in enumerate(want):
        s = seeds[sid]
        alias = alias_of.get(s["address"], "")
        msg = build(s, alias, me)
        line = f"{sid} {msg['Subject'][:60]:60} {len(s['pdfs'])} PDF"
        if a.dry_run:
            print("would send", line)
            continue
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode()
        sent = svc.users().messages().send(userId="me", body={"raw": raw}).execute()
        log["seeds"].append({"seed": sid, "subject": s["subject"], "alias": alias, "sent_at": dt.datetime.now(IST).isoformat(timespec="seconds"),
                             "message_id": sent["id"], "thread_id": sent["threadId"]})
        print("sent", line, flush=True)
        if i < len(want) - 1:
            time.sleep(a.gap)
    if a.dry_run:
        return
    runs = ROOT / "runs"
    runs.mkdir(exist_ok=True)
    path = runs / f"send-{started.strftime('%Y%m%d-%H%M')}.json"
    path.write_text(json.dumps(log, indent=2, ensure_ascii=False) + "\n")
    print(f"\nrun log: {path.relative_to(ROOT)}\ncheck in a few minutes: tools/check_e2e.py --run-log {path.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
