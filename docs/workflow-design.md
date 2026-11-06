# Launchbench Email Automation: Workflow Design

Platform: n8n Cloud (trial). AI: Google Gemini (free tier). Mailbox: `teamlaunchbench@gmail.com`. The Launchbench Data spreadsheet is owned by that account too; n8n's Sheets and Drive credentials sign in as the author's separate demo Google account, which is an editor of the sheet and owns the Drive folders.

## 1. Design principles
These are the points an expert reviewer will probe.

1. **The AI reads and writes; code decides and calculates.** Gemini classifies the email, extracts its fields, and drafts the wording. Plain code nodes do the rest:
   - prices and quotes
   - SLA due times and priority bumps
   - checks against accounts-payable rules
   - lock-in and notice dates

   The figures in every reply can be checked, and the model is never asked to do the arithmetic itself.
2. **Every fact comes from the business's own records.** The knowledge base, the members and invoices, availability, and vendors. Prompts tell the model to say "I'll check with the team" rather than guess.
3. **The level of automation follows the risk.**

   | Kind of reply | What happens |
   |---|---|
   | FAQ answers, acknowledgements | Sent automatically |
   | Anything involving money or contracts | Drafted, then sent after a staff member clicks Approve |
   | Fraud suspicions | Never answered; escalated |

4. **Everything is visible.** Every email ends with:
   - a Gmail label
   - a row in a log tab (leads, tickets or vendor invoices)
   - an internal note sent to the responsible staff alias

   The demo can be followed entirely from the demo inbox and the spreadsheet.

## 2. One inbox, identity and loop safety
**One address.** Testers write to `teamlaunchbench@gmail.com` about anything: a lead, a complaint, an invoice. There is nothing to choose and no protocol to follow. The classifier decides which desk handles each email (sales, support, billing, AP, hello, careers), so routing is an AI showcase rather than a property of the To: address.

**Loop safety.** The Gmail trigger's query is `in:inbox -from:me`. Everything the workflow sends (replies, staff notifications to `+lb-<firstname>`, approval requests, error alerts) is sent *by* the demo account, so Gmail never hands it to the trigger: no loops, and no wasted executions. The test runner doesn't send email at all; it calls WF-0 directly (see WF-T).

**Identity depends on the class, so it is resolved *after* classification.** Testers write from their own Gmail, so no email ever arrives from a member's or vendor's real domain. `settings.demo_mode` decides what happens:

| Class | Demo mode (`TRUE`) | Production (`FALSE`) |
|---|---|---|
| Lead, general query, noise | A member named in the email (e.g. "we're RouteWise, in Cabin 3B"), else the real sender as a **prospect** | Member by sender domain, else prospect |
| Facility issue, customer billing, change request | **Always a member**: one named in the email, else the tester's `member_alias` in the `testers` tab, else a newly assigned member (written to that tab) | Member by sender domain, else "we couldn't find your account" |
| Vendor invoice | Vendor matched by the **GSTIN on the invoice** (PDF or body). The sender-domain check runs only when an `[as …]` tag sets the sender. | Vendor by GSTIN **and** sender domain |

- **"Named in the email"** means the classifier extracted an identity clue (company name, member ID, invoice number, GSTIN, or cabin plus centre, since cabin names repeat across centres) and code found exactly one match.
- **Assignment** picks the member persona assigned to the fewest testers, so a tester is the same company in every email and in follow-ups. Edit `member_alias` to pin a tester to a persona.
- **In demo mode, every member reply opens with one line saying who the tester was matched to**, written by code, not the AI. For example: *"Demo: you're writing as RouteWise Logistics (M007, Whitefield, Cabin 3B)."*
- **Testers' claims won't always match their member's records, and that is the point.** "Why was I charged overage?" from a member with no overage gets "our records show no overage on your last three invoices", not agreement.

**Persona tags (not in the tester guide).** A subject tag `[as <alias>]`, `[as M007]` or `[as V01]` overrides everything above and sets the effective sender to the persona's `as_email`. It is removed before the AI sees the subject. The test runner relies on it so each seed email resolves to the same identity every run; the presenter can use it live, e.g. `[as sparkleserv-fake]` to show the look-alike-domain check.

**Replies always go to the real sender** (or the Reply-To, if set). No email is ever sent to a persona's `as_email`.

The `personas` tab holds 20 ready-made identities:
- 15 members
- 4 vendors
- 1 impostor (`sparkleserv-fake`, with a look-alike domain)

## 3. Workflows
| # | Workflow | Role |
|---|---|---|
| WF-0 | **Intake & triage** | Gmail trigger → context → classify → resolve identity → route to a handler |
| WF-1 | Leads | Qualify, match the space, compute the quote, log the lead, reply, notify the account manager |
| WF-2 | Facility issues | Set priority, compute SLA times, detect repeats and overdue issues, log the ticket, reply, escalate |
| WF-3 | Customer billing | Pull invoices and usage, check the claim against the records, draft, wait for approval |
| WF-4 | Vendor invoices | Read the PDF, run 7 checks, log, file the PDF in Drive, put on hold / flag / alert for fraud |
| WF-5 | Changes & general queries | Answer from the knowledge base (auto-send), or apply notice and lock-in rules (approval) |
| WF-E | Error handler | Any failure → email `+lb-ops`, and label the message `Launchbench/Error` |
| WF-T | Test runner | Manual trigger: reads the chosen seed emails from the Drive Test Kit, adds each one's `[as <alias>]` tag and PDF, and passes them straight to WF-0 (no email sent). WF-0 uses the seed's scripted date as `now` (§8) and replies go to `+lb-testrun` |

Each handler (WF-1 to WF-5) is a sub-workflow that WF-0 calls. That keeps each one readable on screen during the demo, and lets each be tested on its own.

### WF-0 Intake & triage
1. **Two entry points:** the Gmail Trigger (every minute, unread, `in:inbox -from:me`, attachments downloaded) and an Execute Workflow trigger that WF-T calls with seed emails.
2. *(Loop safety is handled by the trigger query, §2.)*
   **Bulk mail is filed without an AI call** (live email only; code: `workflows/code/wf0-spot-bulk-mail.js`). An email with a `List-Unsubscribe` or `List-Id` header, `Precedence: bulk/list/junk`, `Auto-Submitted` (out-of-office replies), a Gmail Promotions/Social/Forums category, or a no-reply sender gets a `noise/bulk` row in `triage_log` with the reason, the `Launchbench/Noise` label, and is marked read. Spam to the public address therefore can't use up the Gemini quota. Emails with a PDF attached are never skipped. A person writing from their own mailbox sends none of these headers, so testers are unaffected.
3. **Code: normalise.**
   - Strip and remember the `[as …]` tag.
   - Set `now`: the seed's date for test-runner items, else the time Gmail received the email (§8).
   - Work out the reply target: Reply-To if present, else From.
   - Turn the body into clean text, with quoted replies removed.
4. **PDFs are passed through, not read here.** Classification works from the body and the attachment's file name; WF-4 extracts the invoice text. This keeps the classifier prompt small.
5. **Google Drive:** download `launchbench-kb.md`. It's about 12k tokens, so the whole thing goes in the prompt and no vector store is needed. It is downloaded fresh for every batch of emails. (An hourly cache in n8n's workflow static data was tried and removed: static data also holds the Gmail trigger's bookmark, and runs that saved the cache could write back an old bookmark, making the trigger re-read old unread mail.)
6. **Gemini, classify and extract:** a Basic LLM Chain with a Structured Output Parser (schema in §4), including the desk and any identity clues.
7. **Code + Sheets: resolve identity** using the rules in §2 (`personas`, `members`, `vendors`, `testers` tabs). If any intent is a member class, the whole email resolves to a member. A new tester assignment is appended to `testers`.
8. **Split Out** on `intents[]`, so an email with two intents (seed email 15) becomes two items.
9. **Switch** on the intent → Execute Workflow WF-1 to WF-5, passing the resolved member or vendor record. Noise is handled inline: label and archive, and send job applications an acknowledgement and a notice to HR.
10. **Gmail:** apply the labels `Launchbench/<Class>`, then mark the email read.

### WF-1 Leads
- **Code, matching:** filter `availability` by team size → the smallest cabin that fits. The preferred centres come from the text, mapped to KOR / IND / HSR / WHF / HEB. If the lead wants a metro, keep only IND and WHF. The space must be free by the move-in date.
- **Code, quote:** compute the prices for each option from `pricing`:
  - the price at each lock-in (none, 6 and 12 months)
  - the partner discount, if one applies
  - the deposit and the meeting-room credits
  - the price both before and after GST
- **Code, score:**
  - **hot:** date ≤ 60 days away **and** (budget given **or** 5 or more seats)
  - **warm:** some intent, but vague
  - **cold:** a day pass or a one-off enquiry
- **Gemini, draft:** writes the reply from the computed options only. Hot leads get a tour offer, plus the 1-day trial for 5 or more seats.
- **Sheets:** append to `leads`.
- **Gmail:**
  - acknowledgement sent automatically
  - the full quote sent after approval by the account manager's alias
  - a new-lead notice to the account manager. More than 40 seats, or no centre preference → Head of Sales.

### WF-2 Facility issues
`tools/facility_rules.js` (tested by `tools/test_facility_rules.js`) applies `kb/05-facility-sla.md`. Gemini only reads the email and writes the reply.
- **Priority (code, not the model's suggestion, which is logged for comparison):** the category sets the base (network and power are P1 when a floor or the centre is affected, otherwise P2; AC, water, access P2; housekeeping, printer, furniture P3; requests P4). Safety, security or injury words are always P1. One level up, once, for a confirmed repeat in `tickets` within 30 days, or when the member says they reported it earlier and the resolution target has passed. A repeat the member claims but `tickets` doesn't show is noted for the centre manager instead.
- **SLA:** first-response and fix-by times in IST (P1/P2 by the clock, P3/P4 in business days), written as "1:20 pm today".
- **Owner and escalation:** the centre manager owns the ticket. Stage 2 (3rd report in 30 days, target missed, or churn risk): Head of Operations, with the centre manager and account manager in copy. Stage 3 (legal threat or injury): COO.
- **Extras:** workarounds by category (meeting room or open-area desks, guest Wi-Fi, spare chairs); "you may be eligible for a credit" wording for repeat or overdue P1/P2 issues, never an amount; for housekeeping, internet, AC and printer issues, the supplier's invoice still awaiting a decision in `ap_invoices` is flagged to staff.
- **Ticket numbers:** `T-` + (2000 + the n8n execution number), so parallel emails never collide.
- **Reply (auto-send):** Gemini writes it from the ticket facts, in the sender's language (code detects the script, e.g. Hindi in Devanagari). Code checks the ticket number and fix-by time are there and no rupee amounts appear; otherwise a template built from the same facts is sent, so a P1 is never held up.
- **Staff email:** one email to the owner (or the escalation contact, with the others in copy), with the rules' reasoning, linked tickets, churn and supplier notes, their email and the reply sent. Logged to `tickets`.

### WF-3 Customer billing
WF-0 calls it for any `customer_billing` intent, except a billing remark inside a concrete membership change (WF-5's approval card already lists the open invoices). `tools/billing_rules.js` (tested by `tools/test_billing_rules.js`) checks the claim against `invoices` and `meeting_room_usage` and applies `kb/04-billing-policy.md`. Gemini only writes the reply.
- **Topics (code, from the email's words, the classifier's subclass and its billing fields):**
  - **Overage:** credits included vs used, hours over × the room's member rate, no rollover; the booking log is offered; no waiver unless a system error. Within the 15-day dispute window the overage plus GST is on hold and the rest is due by the 7th; after it, the full amount is payable. A usage record that doesn't match the invoice line is flagged.
  - **Billed after exit:** invoices for periods after `exit_date` are cancelled by credit note (paid ones refunded within 10 business days). A member who says they left but is Active is flagged, and nothing is cancelled.
  - **Deposit:** due exit + 30 days; overdue is flagged with the deductions to check; refunds only to the registered account.
  - **GSTIN change:** format and Karnataka (29) check, PAN compared with the old GSTIN; first invoice to carry it by the 25th rule; each issued invoice the email names (by number or month) checked against "within 30 days and same FY"; a missing certificate is asked for.
  - **TDS:** only 194-I at 10% on the pre-GST amount (194C/194J refused), worked example on their latest invoice, Form 16A every quarter.
  - **Invoice copy:** only to the billing contact, the company domain, or a demo tester standing in for the member; the PDF is attached (`tools/gen_customer_invoices.py` → Drive `Customer Invoices/`).
  - **Payment status / late fee / waiver / bank details:** open and overdue invoices, late fee, day-30 warning; a waiver request goes to Finance with the 12-month history; bank details never change by email.
  - An invoice number that isn't the member's is never described.
- **Reply:** Gemini writes it as Lakshmi from the customer facts, in the sender's language. Code checks every ₹ amount and the key items; if the draft fails, the reply offered is built from the facts.
- **Approval:** every reply waits for **Lakshmi Narayan (Finance Manager)**: the card shows the record check, flags, "Finance to do" actions, internal notes, their email and the reply. High priority (our error, overdue deposit, churn) puts URGENT in the subject. Approved → sent (threaded reply for live email; with the PDF for copies). Hold or 2 days → marked.
- **FYI** to the account manager when the error is ours, the deposit is overdue, the member says they left, or there is churn risk.
- **Log:** one row per case in `billing_cases` (topics, invoices, amount, actions, priority, status).

### WF-4 Vendor invoices
- **Gemini, extract:** from the PDF text into JSON: vendor, GSTIN, invoice number, date, period, PO, line items, taxable amount, CGST, SGST, total, bank account (last 4 digits).
- **Code, run 7 checks** (from `08-vendors.md`):
  1. known vendor: the GSTIN on the invoice is in the vendor master (plus the sender domain, when §2 says it applies)
  2. our GSTIN is correct
  3. PO present and matching
  4. amount within the expected range
  5. GST arithmetic correct to ±₹1
  6. not a duplicate in `ap_invoices`
  7. billing period valid

  Then decide: PASS, HOLD, FLAG or RETURN. Separately, and overriding all of that, look for fraud signals. Any one makes it **suspected fraud**:
  - the bank account on the invoice differs from `vendors.bank_account_last4` (seed 28: every other check passes, from the vendor's genuine domain)
  - the email asks to change bank details or pay to a new account, or presses for urgent payment (seed 21; also what a tester improvises live)
  - a look-alike sender domain, by edit distance from a known vendor domain (only when a tag sets the sender, e.g. seed 21's `[as sparkleserv-fake]`)
- **Drive:** file the PDF in `Vendor Invoices/`.
- **Sheets:** append to `ap_invoices`, with the approver(s) from the approval limits and the next payment run (the 10th or 25th).
- **Gmail:**

  | Outcome | Action |
  |---|---|
  | HOLD (missing PO) | Draft to the vendor (in practice, the tester), sent after approval |
  | FLAG | Notice to Finance, plus COO if the amount is over ₹2L |
  | **Suspected fraud** | No reply; urgent alert to `+lb-lakshmi` and `+lb-meera` |

### WF-5 Changes and general queries
WF-0 calls it for any email with a `change_request`, or a `general_query` that isn't part of a lead (WF-1's quote answers those).
- **General queries:** Gemini answers from the knowledge base and returns `confidence`, `needs_staff` (+ reason) and an optional `upsell_hint`. **Code** sends it without a person only if confidence ≥ 0.8, `needs_staff` is false and every ₹ amount appears in the KB. Otherwise it goes for approval: the member's account manager, or Kavya (Head of Operations) for non-members. An upsell hint becomes a note to the account manager.
- **Changes:** `tools/change_rules.js` (tested by `tools/test_change_rules.js`) applies `kb/03-membership-terms.md`:
  - notice by plan; exit date = the later of the notice end and the lock-in end; deposit refund by exit + 30 days, less ₹500 per unreturned card
  - early-exit fee for lock-in months left; desks may drop 20% in the lock-in with 2 months' notice, beyond that a partial exit
  - cabins can't be partly released: the best-fitting smaller cabin anywhere, plus the best at their own centre, with the partial-exit difference
  - moves: 1 month's notice, new centre's rates; upgrades: free, new minimum lock-in
  - open and overdue invoices for the account manager
  Facts are split into **customer facts** (the reply) and **internal facts** (the approval card only: fees, new monthly fee, deposit change). Gemini writes the reply from customer facts only; code checks every ₹ amount and the key dates. The account manager approves every change; the Head of Sales gets an FYI on churn risk, any fee, or an exit/downsize of a ₹1L+/month account.
- Gemini's instructions live in their own Code node ("Write the prompt"), separate from the rules.
- Every reply is logged to the `requests` tab (`auto-send` or `approval`, then `Sent automatically`, `Approved and sent`, `Held by …` or `No decision within 2 days`).
- **Member fallback (WF-0):** for member-only classes with no member named, WF-0 uses the sender's domain (seed emails), then the tester's `member_alias`, then assigns the least-used member persona and saves it to `testers`.

### WF-E Errors
Set as the error workflow of WF-0 to WF-5, so n8n runs it whenever one of them fails in a production run (not manual or test-runner runs). No Gemini calls: a Gemini outage is one of the things it reports.
- **Describe the failure (code):** the failed workflow, node and error become a diagnosis (Gemini quota, Google rate limit, expired credential and which one, timeout or 5xx, a Code-node bug, or unknown), what it means for the sender (per workflow, and "failed after approval" for the send nodes), and what to do (fix, then Retry the run).
- **No floods:** the same workflow + node + error is emailed at most once per 30 minutes; repeats are only logged.
- **Stuck emails (every 30 minutes):** unread inbox emails older than 10 minutes, not from the demo account and not yet labelled, were never handled (WF-0 marks every email read). They get the `Launchbench/Error` label and one alert lists them. This covers what an error workflow can't see: classifier failures (logged as `ERROR` rows, so the run doesn't fail) and a Gmail trigger that has stopped.
- **Output:** a row in the `errors` tab; an HTML alert to `+lb-ops` with a link to the run.
- **Before it gets this far:** every Gmail, Google Sheets and Drive step retries up to 3 times, 5 seconds apart, so a brief Google outage (a 500 "internal error") doesn't fail the run. Every Gemini call, including the classifier, gets a second attempt after a 45-second pause (its per-minute limit). Google's own quotas are on the author's Google Cloud project (`launchbench-n8n-demo`), not n8n Cloud's shared one; Sheets allows 60 reads a minute per user by default (an increase to 300 is requested), which is why the test runner sends one seed every 30 seconds.
- **Limit:** on the n8n Cloud trial there is no n8n API, so the alert can't name the email a failed WF-1 to WF-5 run was handling; the linked run shows it.

## 4. Classifier output (structured)
```json
{
  "desk": "hello|sales|support|billing|ap|careers",
  "identity_clues": {"company": null, "member_id": null, "invoice_numbers": [], "gstin": null,
                     "cabin": null, "centre": null},
  "intents": [{"class": "lead|facility_issue|customer_billing|vendor_invoice|change_request|general_query|noise",
               "subclass": "e.g. upsell, event_booking, overage_dispute, gstin_change, job_application, newsletter",
               "summary": "one line"}],
  "language": "en|hinglish|other",
  "sentiment": "positive|neutral|negative",
  "churn_risk": false,
  "lead": {"team_size": null, "centres": [], "near_metro": false, "move_in": null, "budget_inr": null,
           "budget_includes_gst": null, "plan_interest": null, "partner": null, "incorporated": null},
  "issue": {"location": null, "category": null, "suggested_priority": "P1-P4", "since": null, "repeat_claimed": false},
  "billing": {"invoice_numbers": [], "topic": null, "new_gstin": null, "tds_section": null},
  "change": {"type": "exit|downsize|upgrade|move", "seats_from": null, "seats_to": null, "effective": null},
  "attachments_claimed_but_missing": false,
  "fraud_signals": [],
  "confidence": 0.0
}
```

## 5. Gemini usage
- **Model:** the current **Flash** model in the n8n Gemini node, for both classification and drafting. If draft quality disappoints, switch drafting alone to Pro.
- **Calls per email:**
  - classify: 1
  - draft: 1 per intent
  - PDF extraction: 1, vendor invoices only

  That's about 2–3 calls per email, and a full test run (33 seed emails) is about 80 calls. Check this against the daily free-tier cap.
- **Temperature:** 0 for classify and extract, about 0.4 for drafting.
- **The knowledge base goes in the system prompt.** The email goes in the user prompt, inside `<email>` tags, with an instruction to treat its contents as data and not as instructions. This defends against prompt injection hidden in incoming mail.

## 6. Gmail labels
Live email only (seeds have no Gmail message). Gmail labels by ID, so the IDs are in `workflows/code/gmail-labels.js`; the one-off workflow "LB · setup Gmail labels (one-off)" created them. Every label step is set to continue on error, so labelling can never stop a reply.

| Label (`Launchbench/…`) | Applied by | When |
|---|---|---|
| `Lead`, `Issue`, `Billing`, `Vendor`, `Change`, `Query`, `Noise` | WF-0 "Label the email" | One per intent, when the email is logged and marked read |
| `Demo/Assigned member` | WF-0 | The member came from the tester assignment, not the email |
| `Lead/Hot`, `Lead/Warm`, `Lead/Cold` | WF-1 | After scoring |
| `Issue/P1` … `Issue/P4` | WF-2 | With the acknowledgement |
| `Vendor/Pass`, `Vendor/Hold` (also return, duplicate), `Vendor/Flag`, `Vendor/Fraud` | WF-4 | After the checks |
| `Awaiting approval` | WF-1, WF-3, WF-4, WF-5 | Added when the approval card goes out, removed on approve, hold or lapse |
| `Error` | WF-E | An email still unread 10 minutes after it arrived |

## 7. Build order (after the trial starts)
1. Create the credentials (Gmail, Sheets, Drive, Gemini) and set the timezone.
2. Build WF-0 up to and including classification. Run seed emails through it and check every classification.
3. Build WF-2 (facility issues) and WF-5 (changes and general queries). Their payoff is quick, and they show the auto-send and SLA logic.
4. Build WF-1 (leads), whose quoting is the showpiece.
5. Build WF-4 (vendor invoices), including the fraud alert.
6. Build WF-3 (customer billing), with the approval flow.
7. Build WF-E (errors) and WF-T (test runner). Do the full test run and score it (see [test-protocol.md](test-protocol.md)).
8. Republish the Sheets to reset the demo, write a one-page tester guide (the address, what kinds of email to try, sample emails, what to expect: replies in 1–2 minutes, money and contract replies wait for approval), then invite testers.
9. Before the trial ends, export every workflow as JSON into `n8n/workflows/`.

## 8. Dates: each email carries its own "now"
The data is a snapshot taken on 3 Nov 2026, but the code reasons about dates: days overdue, SLA breaches, notice periods, the next payment run. So the workflow needs a rule for what "now" is.

**Rule:** WF-0 sets a `now` field on every email, and every sub-workflow uses that field. **No node may call `$now` or `Date.now()` directly.**

| Email | `now` | Why |
|---|---|---|
| Seed email from the test runner | The seed's scripted date, passed by WF-T as `seed_now` | Results match the `expected_*` fields on every run, whatever the real date |
| Live tester email | The time Gmail received it | Replies quote real times ("fixed by 4 pm today"), and the policy is applied to the actual date |

**Live emails drift, and that is correct behaviour, not a bug.** For example:
- Paysetu's overdue invoice gets older and reaches day 45 around 21 Nov.
- The Koramangala cabins opening on 16 Nov become "available now".
- After 25 Nov, the next vendor payment run is 10 Dec.

**Limit: the trial must end before 1 Dec 2026**, because the ledger has no December invoices. That means starting the trial by about 15 Nov. If it starts later, shift the data by **whole months only**, so invoices stay on the 1st, and re-check the weekday words in the seed emails ("since Monday", "by Friday"). Shifting by days would break both.

Why not shift all the data to the trial's start day? The seed emails are hand-written with dates in their text, and their expected results quote specific dates, so a day-based shift would mean rewriting them. Giving each email its own `now` avoids that.
