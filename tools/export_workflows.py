#!/usr/bin/env python3
"""Turn raw n8n workflow JSON into clean, importable files in workflows/.

The n8n Cloud trial has no public API, so the raw JSON comes from the n8n MCP
tool get_workflow_details (one file per workflow, either the whole tool result
or just its "workflow" object). This script keeps what n8n needs to import a
workflow and drops instance-only fields (permissions, version ids, publish state).

    python3 -I tools/export_workflows.py <dir-of-raw-json> [workflows]

Credentials stay as references (id + name); n8n exports never contain secrets.
After importing into another n8n, reconnect each credential by name.
"""
import json
import pathlib
import re
import sys

KEEP = ["name", "nodes", "connections", "settings", "nodeGroups", "meta", "tags"]
# Fixed file names, so a re-export overwrites the same files.
FILES = {
    "GRkH0glRmqfPZQIG": "wf0-intake-and-triage.json",
    "CC7wCrdgUjafOLyQ": "wf1-leads.json",
    "sRtx0ugmlHwi6pct": "wf2-facility-issues.json",
    "IPoxQ8cGSoD6cPx1": "wf3-customer-billing.json",
    "WGPjCuJll4JGp5gF": "wf4-vendor-invoices.json",
    "znfViO3j0L05i5CO": "wf5-questions-and-changes.json",
    "3HY83a73WFAZbAl1": "wfe-errors.json",
    "cHps1e3n8QnXh4hL": "wft-test-runner.json",
    "d7wbvnA6jmXYeaKQ": "setup-gmail-labels.json",
}
SECRET = re.compile(r"(AIza[0-9A-Za-z_-]{30,}|ya29\.|refresh_token|client_secret|-----BEGIN)")


def main(src, dst="workflows"):
    out = pathlib.Path(dst)
    out.mkdir(exist_ok=True)
    for f in sorted(pathlib.Path(src).glob("*.json")):
        raw = json.loads(f.read_text())
        w = raw.get("workflow", raw)
        name = FILES.get(w.get("id"))
        if not name:
            print(f"skip {f.name}: unknown workflow {w.get('id')}")
            continue
        clean = {k: w[k] for k in KEEP if k in w}
        clean["id"] = w["id"]  # keeps errorWorkflow / Execute Workflow references meaningful
        clean["active"] = False  # imported copies start unpublished
        clean.setdefault("pinData", {})
        clean["settings"] = {k: v for k, v in clean.get("settings", {}).items() if k != "availableInMCP"}
        text = json.dumps(clean, indent=2, ensure_ascii=False) + "\n"
        if SECRET.search(text):
            sys.exit(f"{name}: looks like it contains a secret; not written")
        (out / name).write_text(text)
        print(f"{name}: {len(clean['nodes'])} nodes")


if __name__ == "__main__":
    main(*sys.argv[1:])
