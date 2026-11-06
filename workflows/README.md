# The n8n workflows

These are exports of the live workflows, ready to import into a recent n8n instance, self-hosted or n8n Cloud.

| File | Workflow | What it does |
|---|---|---|
| `wf0-intake-and-triage.json` | LB · WF-0 Intake & triage | Gmail trigger; Gemini classifies each email against the knowledge base; code identifies the sender; routes to the handlers; logs to `triage_log` |
| `wf1-leads.json` | LB · WF-1 Leads | Matches free space, computes the quote, acknowledges, drafts, asks the account manager to approve, sends |
| `wf2-facility-issues.json` | LB · WF-2 Facility issues | Ticket, priority and SLA times, repeats and escalation, automatic acknowledgement |
| `wf3-customer-billing.json` | LB · WF-3 Customer billing | Checks claims against invoices and usage, drafts, Finance approves, attaches invoice PDFs from Drive |
| `wf4-vendor-invoices.json` | LB · WF-4 Vendor invoices | Reads the PDF, 7 AP checks plus fraud checks, files to Drive, logs, alerts or asks for approval |
| `wf5-questions-and-changes.json` | LB · WF-5 Questions & changes | Answers from the knowledge base, or applies notice/lock-in rules and asks for approval |
| `wfe-errors.json` | LB · WF-E Errors | Error workflow for WF-0 to WF-5, plus a 30-minute check for unanswered emails |
| `wft-test-runner.json` | LB · WF-T Test runner | Feeds the seed emails from Drive into WF-0 without sending mail |
| `setup-gmail-labels.json` | LB · setup Gmail labels (one-off) | Creates the `Launchbench/…` Gmail labels |
| `code/` | | The exact contents of the larger Code nodes, for reading and diffing. The rule engines inside them are developed and tested as `tools/*.js`. |

## Importing
1. In n8n: **Workflows → Import from file**, one file at a time. Import the handlers (WF-1 to WF-5) and WF-E first, then WF-0, then WF-T.
2. **Reconnect the credentials.** The files name them but contain no secrets: *Gmail account* (Gmail OAuth2), *Google Sheets account*, *Google Drive account*, and *Google Gemini(PaLM) Api account* (an API key from aistudio.google.com).
3. **Point them at your own copies**, because the IDs in the files belong to the original instance:
   - the Google Sheet ID `1H7tY4fWsIw1oRcwpeVHbTxD3Bt4XkBYT3rowPsEYwCk`: a spreadsheet with one tab per CSV in `data/`;
   - the Google Drive folder IDs (knowledge base, Test Kit, Vendor Invoices, Customer Invoices): upload `kb/`, `test-emails/` and the PDFs;
   - the sub-workflow IDs in WF-0's "Run WF-…" nodes, WF-T's "Send to WF-0", and each workflow's *Error workflow* setting;
   - the Gmail label IDs (`Label_1` … `Label_23`): run the setup workflow, then update the map in `code/gmail-labels.js` and the "Label …" nodes;
   - the demo mailbox and its `+lb-<name>` staff aliases, which appear in the Code nodes and Gmail nodes.
4. Publish the handlers before WF-0 (n8n won't publish a workflow whose sub-workflows are unpublished).

The original runs on Gemini `gemini-3.5-flash-lite` on the free tier; see [docs/workflow-design.md §5](../docs/workflow-design.md) for the limits that shaped the design.
