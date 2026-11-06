"""Publish the Launchbench demo data to the labs Google Drive.

Creates (or updates in place) under My Drive/Demos/Launchbench:
  Launchbench Data       one spreadsheet, one tab per data/*.csv
  Knowledge Base/        kb/*.md
  Test Kit/              test-emails/*.md, Test Kit/attachments/*.pdf
  Vendor Invoices/       empty; the n8n workflow files vendor PDFs here
  Customer Invoices/     one PDF per invoices.csv row (tools/gen_customer_invoices.py), attached by WF-3

Safe to re-run: tabs are cleared and rewritten, and files are replaced by name.

Usage (from the n8n project folder):
  GD=/path/to/google_drive   # the author's private Google Sheets helper (gsheets), not part of this repo
  PYTHONPATH=$GD $GD/.venv/bin/python tools/publish_drive.py [--files-only]

--files-only updates the knowledge base, test kit and invoice PDFs but leaves the
spreadsheet alone, so the rows the workflows have logged are kept.
"""
import csv
import io
import re
import sys
from pathlib import Path

from googleapiclient.http import MediaIoBaseUpload

from gsheets import auth, drive, sheets

PROFILE = "labs"
ROOT = Path(__file__).resolve().parent.parent
SPREADSHEET = "Launchbench Data"
SPREADSHEET_ID = "1H7tY4fWsIw1oRcwpeVHbTxD3Bt4XkBYT3rowPsEYwCk"
TABS = ["members", "invoices", "meeting_room_usage", "availability", "pricing",
        "vendors", "ap_invoices", "leads", "tickets", "requests", "billing_cases", "errors", "personas", "testers", "settings",
        "triage_log"]
KB_BUNDLE = "launchbench-kb.md"  # all kb/*.md in one file, so the workflow needs one download


def typed(value: str):
    """Numbers become numbers; everything else (GSTINs, phones, dates, IDs) stays text."""
    if re.fullmatch(r"-?(0|[1-9]\d*)", value):
        return int(value)
    if re.fullmatch(r"-?(0|[1-9]\d*)\.\d+", value):
        return float(value)
    return value


def find_in_folder(name: str, folder_id: str) -> dict | None:
    q = (f"name = '{drive._escape(name)}' and '{folder_id}' in parents and trashed = false")
    hits = drive._paged_list(q, limit=1)
    return hits[0] if hits else None


def put_file(path: Path, folder_id: str, mime: str) -> None:
    media = MediaIoBaseUpload(io.BytesIO(path.read_bytes()), mimetype=mime, resumable=False)
    files = auth.drive_service().files()
    existing = find_in_folder(path.name, folder_id)
    if existing:
        files.update(fileId=existing["id"], media_body=media, supportsAllDrives=True).execute()
    else:
        files.create(body={"name": path.name, "parents": [folder_id]}, media_body=media,
                     fields="id", supportsAllDrives=True).execute()


def publish_spreadsheet(folder_id: str) -> str:
    # The workflows read this exact spreadsheet ID, so never create a second one.
    # (Ownership moved to the demo mailbox account; the labs account is an editor.)
    # Transferring ownership leaves a shortcut in the folder; follow it to the pinned ID.
    existing = find_in_folder(SPREADSHEET, folder_id)
    if existing and drive.get_file(existing["id"]).get("mimeType") == "application/vnd.google-apps.shortcut":
        existing = None
    sid = existing["id"] if existing else SPREADSHEET_ID
    if sid != SPREADSHEET_ID:
        raise SystemExit(f"Found '{SPREADSHEET}' with ID {sid}, but the workflows use {SPREADSHEET_ID}. Stopping.")
    svc = auth.sheets_service().spreadsheets()

    meta = sheets.metadata(sid)["sheets"]
    have = {s["properties"]["title"]: s["properties"]["sheetId"] for s in meta}
    if TABS[0] not in have and len(meta) == 1 and meta[0]["properties"]["title"] in ("Sheet1", "Sheet 1"):
        first = meta[0]["properties"]["sheetId"]
        svc.batchUpdate(spreadsheetId=sid, body={"requests": [{"updateSheetProperties": {
            "properties": {"sheetId": first, "title": TABS[0]}, "fields": "title"}}]}).execute()
        have = {TABS[0]: first}
    for tab in TABS:
        if tab not in have:
            have[tab] = sheets.add_tab(sid, tab)["sheetId"]

    requests = []
    for tab in TABS:
        rows = list(csv.reader(open(ROOT / "data" / f"{tab}.csv", newline="")))
        values = [rows[0]] + [[typed(v) for v in r] for r in rows[1:]]
        sheets.clear(sid, tab)
        sheets.write(sid, f"{tab}!A1", values, raw=True)
        requests += [
            {"updateSheetProperties": {"properties": {"sheetId": have[tab], "gridProperties": {"frozenRowCount": 1}},
                                       "fields": "gridProperties.frozenRowCount"}},
            {"repeatCell": {"range": {"sheetId": have[tab], "startRowIndex": 0, "endRowIndex": 1},
                            "cell": {"userEnteredFormat": {"textFormat": {"bold": True}}},
                            "fields": "userEnteredFormat.textFormat.bold"}},
            {"autoResizeDimensions": {"dimensions": {"sheetId": have[tab], "dimension": "COLUMNS"}}},
        ]
        print(f"  {tab}: {len(values) - 1} rows")
    svc.batchUpdate(spreadsheetId=sid, body={"requests": requests}).execute()
    return sid


def publish_customer_invoices(folder_id: str) -> None:
    """(Re)generate one PDF per invoice and upload them, replacing by name."""
    import subprocess
    import sys
    out = ROOT / "build" / "customer-invoices"
    subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "gen_customer_invoices.py"), str(out)], check=True)
    pdfs = sorted(out.glob("*.pdf"))
    for f in pdfs:
        put_file(f, folder_id, "application/pdf")
    print(f"Customer Invoices: {len(pdfs)} PDFs")


def main() -> None:
    with auth.using(PROFILE):
        me = auth.whoami()["emailAddress"]
        if not me.endswith(".labs@gmail.com"):  # the labs account owns the Sheet and Drive folders
            raise SystemExit(f"Profile '{PROFILE}' is signed in as {me}, not the labs account. Stopping.")
        print("Signed in as", me)
        lb = drive.ensure_folder("Launchbench", drive.ensure_folder("Demos"))
        kb = drive.ensure_folder("Knowledge Base", lb)
        kit = drive.ensure_folder("Test Kit", lb)
        kit_att = drive.ensure_folder("attachments", kit)
        drive.ensure_folder("Vendor Invoices", lb)
        customer_inv = drive.ensure_folder("Customer Invoices", lb)

        files_only = "--files-only" in sys.argv[1:]
        if files_only:
            print(SPREADSHEET, "left unchanged (--files-only)")
        else:
            print(SPREADSHEET)
            sid = publish_spreadsheet(lb)
        kb_files = sorted((ROOT / "kb").glob("*.md"))
        for f in kb_files:
            put_file(f, kb, "text/markdown")
        bundle = ROOT / "build" / KB_BUNDLE
        bundle.parent.mkdir(exist_ok=True)
        bundle.write_text("\n\n---\n\n".join(f"<!-- {f.name} -->\n{f.read_text()}" for f in kb_files))
        put_file(bundle, kb, "text/markdown")
        for f in sorted((ROOT / "test-emails").glob("*.md")):
            put_file(f, kit, "text/markdown")
        for f in sorted((ROOT / "test-emails" / "attachments").glob("*.pdf")):
            put_file(f, kit_att, "application/pdf")
        publish_customer_invoices(customer_inv)

        print("Folder:", drive.folder_path(lb))
        if not files_only:
            print("Spreadsheet:", drive.get_file(sid)["webViewLink"])
            print("Spreadsheet ID:", sid)
        print("Knowledge Base folder ID:", kb)
        print("KB bundle file ID:", find_in_folder(KB_BUNDLE, kb)["id"])


if __name__ == "__main__":
    main()
