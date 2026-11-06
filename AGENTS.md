# Guide for AI assistants

You are probably reading this because someone gave you this repository and asked "what is this, and what can you do with it?" This file answers that. Humans: start with [README.md](README.md) instead.

## What this repository is
A working **AI email-automation system built in n8n** for a fictional business, [*Launchbench Workspaces*](https://launchbench.netlify.app), a coworking operator with 5 centres in Bengaluru, India. It is a portfolio demonstration: it shows what an automation consultant can build for a mid-sized business. The company's website is live at https://launchbench.netlify.app.

One shared inbox receives everything: sales leads, members' facility complaints, billing questions, supplier invoices, membership changes, general questions and spam. n8n reads each email, has Google Gemini classify it and extract its details, works out who sent it, and passes it to one of five specialist workflows. Each specialist checks the business's own records, has Gemini draft a reply, checks that draft in code, and then either sends it or asks a staff member to approve it with one click. Every email ends with a Gmail label, a row in a Google Sheet and a note to the responsible staff member.

**The core design rule: the AI reads and writes; code decides and calculates.** Gemini never computes a price, a due date, a late fee or a fraud verdict. Plain JavaScript does, from the CSV data and knowledge-base rules, and the AI only words the result. Every reply is then checked in code: a rupee amount that doesn't appear in the computed facts fails the check.

**Everything is fictional:** the company, people, members, vendors, GSTINs, bank details and phone numbers. The neighbourhoods and metro stations are real Bengaluru places. Prices are in Indian rupees (₹), plus 18% GST. The data is a snapshot dated **3 Nov 2026**.

## What you can and can't do with it

You **can**:
1. **Explain how it works**, to any depth, from the docs and the code (map below).
2. **Help a tester write test emails** and predict what should happen. The rules are all in `kb/` and the records in `data/`, so you can work out the correct quote, SLA time, late fee or fraud verdict *before* the email is sent. [docs/tester-guide.md](docs/tester-guide.md) has scenario ideas.
3. **Check a reply the tester received.** Compare every price, date and policy in it against `data/pricing.csv`, `data/availability.csv`, `data/members.csv`, `data/invoices.csv` and the `kb/` files. That is the most useful thing you can do for a tester: find where the system was wrong.
4. **Run the business-rule engines locally.** They are plain Node.js with no dependencies or credentials: `node tools/test_lead_quote.js` (and `test_facility_rules.js`, `test_billing_rules.js`, `test_ap_checks.js`, `test_change_rules.js`). You can call the functions in `tools/*.js` with your own inputs.
5. **Run the data consistency checks:** `python3 -I tools/verify.py .`
6. **Read or import the workflows.** `workflows/*.json` are n8n exports. See [workflows/README.md](workflows/README.md) for how to import them into another n8n instance and what to reconnect.
7. **Sketch how the same system would fit a different business:** which parts are generic (intake, classification, identity, approvals, error handling) and which are Launchbench-specific (the rule engines and the knowledge base).

You **can't**:
- Reach the live system. The n8n instance, the Gmail inbox and the Google Sheet belong to the author, and no credentials are in this repo. The only way to test the live system is to email the demo inbox (see the tester guide).
- Run `tools/publish_drive.py` or `tools/score_triage.py`. They need the author's Google sign-in.

**Safety rules if you help someone test or modify it:**
- Never send real email to the domains in the seed emails (`routewise.in`, `tiffinly.in` and others). They are made up, and some may belong to real companies.
- Don't put real personal or financial data into test emails. Everything a tester sends is processed by Gemini and logged in a spreadsheet.
- Keep every price in `data/pricing.csv` and every policy in `kb/`. The website, the AI and the code all read from there, so a fact edited anywhere else will disagree with the rest.

## How the system fits together

```
Tester's email ──► Gmail inbox ──► WF-0 Intake & triage
                                   │  Gemini classifies (class, desk, details, language, sentiment, fraud signals)
                                   │  code resolves the sender: which member, vendor or prospect
                                   ▼
        ┌───────────────┬──────────────┬──────────────┬──────────────┬───────────────┐
        WF-1 Leads   WF-2 Facility  WF-3 Billing   WF-4 Vendor     WF-5 Questions   (noise: label only)
                       issues                        invoices        & changes
        each: read records ► code works out the facts ► Gemini drafts ► code checks the draft
              ► log to the Sheet ► auto-send, or wait for a staff member's Approve click

WF-E Errors: any failure → plain-English alert email + errors tab; every 30 min, flags unanswered emails
WF-T Test runner: feeds the 33 seed emails into WF-0 without sending mail (regression testing)
```

| Workflow | What the code decides | What waits for a human |
|---|---|---|
| WF-1 Leads | Which space fits (seats, centre, metro, budget, move-in date), the quote with discounts and GST, hot/warm/cold | The quote, approved by the account manager |
| WF-2 Facility issues | Priority P1–P4, SLA response and fix-by times, repeat and overdue detection, escalation stage | Nothing: the acknowledgement is sent at once; staff get a ticket notice |
| WF-3 Customer billing | Overage maths, invoices raised after an exit, deposit refund timing, GSTIN correction rules, TDS, late fees | Every billing reply, approved by Finance; invoice PDFs are attached from Drive |
| WF-4 Vendor invoices | 7 accounts-payable checks on the PDF, plus fraud checks (bank account differs from the vendor master, bank-change requests, look-alike domains) | Vendor replies, approved by Finance; suspected fraud is never answered and goes straight to Finance and the COO |
| WF-5 Questions & changes | Notice periods, lock-in, early-exit fees, up/downsizing rules | Contract changes, approved by the account manager; safe FAQ answers go automatically |

**Where the logic lives.** Each rule engine is written and unit-tested as a plain JS file in `tools/` (for example `tools/billing_rules.js` with `tools/test_billing_rules.js`). The same code, plus a small wrapper, is pasted into an n8n Code node; the exact node contents are kept in `workflows/code/`. Prompts are in separate "Write the prompt" Code nodes so they can be tuned without touching the engines.

**Demo mode.** Testers write from their own email addresses, so the system can't recognise members by email domain. With `settings.demo_mode` on, a tester writing about a facility issue, billing or a contract change is matched to a fictional member company (one named in the email, else one assigned to them and remembered). Every such reply starts with a line like *"Demo: you're writing as RouteWise Logistics (M007, Whitefield, Cabin 3B)."* Vendors are matched by the GSTIN printed on the invoice. Details: [docs/workflow-design.md §2](docs/workflow-design.md).

## Repository map
| Path | What it is |
|---|---|
| `README.md` | One-page overview for people |
| `docs/tester-guide.md` | How to test the live demo by email |
| `docs/workflow-design.md` | Full design: principles, identity, each workflow, classifier schema, Gemini usage, Gmail labels, dates |
| `docs/workflow-diagrams.md` | Mermaid diagrams of the flows |
| `docs/test-protocol.md` | The regression test and how to judge results |
| `kb/` | The knowledge base the AI answers from (~11.8k tokens, sent whole with each classification) |
| `kb/00-company-profile.md` | Company facts, people, desks, routing, escalation, tone |
| `kb/01-centres.md` | The 5 centres: capacity, cabins, amenities, metro, parking, hours |
| `kb/02-pricing.md` | Rate card, discounts, credits, add-ons, deposits, worked examples |
| `kb/03-membership-terms.md` | Lock-in, notice, early exit, up/downsizing, deposit refunds |
| `kb/04-billing-policy.md` | Invoice cycle, GST and GSTIN changes, TDS, late fees, disputes |
| `kb/05-facility-sla.md` | P1–P4 priorities, response and fix targets, escalation, service credits |
| `kb/06-house-rules.md` | Guests, pets, couriers, access, network, events |
| `kb/07-faq.md` | 30 Q&As |
| `kb/08-vendors.md` | Approved vendors and accounts-payable rules, including bank-change fraud control |
| `data/pricing.csv` | Single source of truth for every price |
| `data/members.csv` | 25 member companies: centre, plan, seats, lock-in, fees, GSTIN, account manager |
| `data/invoices.csv` | Customer invoices Sep–Nov 2026, with problems deliberately planted |
| `data/meeting_room_usage.csv` | Meeting-room credits and overage per member |
| `data/availability.csv` | Free cabins and desks per centre, with available-from dates |
| `data/vendors.csv` | Vendor master: GSTIN, PO, expected amount range, bank account (last 4), billing domain |
| `data/ap_invoices.csv` | Vendor-invoice log, pre-filled with October so duplicate checks have history |
| `data/personas.csv` | 20 identities the test runner uses (15 members, 4 vendors, 1 impostor) |
| `data/leads.csv`, `tickets.csv`, `billing_cases.csv`, `requests.csv`, `triage_log.csv`, `errors.csv`, `testers.csv`, `settings.csv` | The tabs the workflows write to and read from (in Google Sheets when live; these are the starting copies) |
| `test-emails/` | 33 seed emails with expected outcomes in their front matter; `triage-expectations.json` is the machine-checkable version; `attachments/` holds the 4 vendor-invoice PDFs the seeds use; `tester-kit/` holds 4 fresh ones for live testers (clean, over budget, missing PO, bank-account fraud); `*-inputs.json` are captured classifier outputs used by the unit tests |
| `tools/*.js` | Rule engines and their tests (see above) |
| `tools/*.py` | `gen_data.py`, `gen_pdfs.py`, `gen_tester_kit.py`, `gen_customer_invoices.py` generate data and PDFs; `verify.py` checks consistency; `build_site.py` builds the company website; `publish_drive.py`, `score_triage.py`, `export_workflows.py` are the author's operations scripts |
| `workflows/*.json` | n8n workflow exports (import-ready) |
| `workflows/code/` | The exact contents of every large Code node |
| `site/` | Source of the fictional company's website, live at https://launchbench.netlify.app (static, built from the same `data/` and `kb/` by `tools/build_site.py`) |

## Seed emails (the regression set)
| # | Class | What it tests |
|---|---|---|
| 01 | Lead, hot | Budget, team size, metro and date combined: only the Whitefield 16-seat cabin fits, at ₹1,44,000; GST-inclusive/exclusive ambiguity |
| 02 | Lead, hot | 40 seats in 2 weeks: assembles 3 adjacent Koramangala cabins from availability |
| 03 | Lead, warm | Vague and not urgent: nurture reply |
| 04 | Query, cold | Day pass and Sunday access; a freelancer is not eligible for the Founders Plan |
| 05 | Lead, upsell | Existing member outgrowing desks into an 8-seat cabin |
| 06 | Lead, hot | Founders Plan eligibility plus partner discount and waived deposit |
| 07 | Issue | AC down past its SLA: raised to P1 and escalated |
| 08 | Issue, P1 | Floor-wide internet outage repeating an earlier ticket |
| 09 | Issue, P3 | Informal Hinglish; a "third time" claim with no tickets behind it |
| 10 | Issue, churn risk | Third housekeeping complaint, angry tone: stage-2 escalation |
| 11 | Billing | Disputed meeting-room overage, explained from usage data |
| 12 | Billing | Invoices raised after an exit plus an overdue deposit refund |
| 13 | Billing | GSTIN change: one invoice correctable, one too old; the "attached" certificate is missing |
| 14 | Billing | TDS under the wrong section (194C), corrected to 194-I with worked numbers |
| 15 | Issue + billing | Two requests in one email |
| 16 | Change | Downsizing during lock-in while an invoice is overdue |
| 17 | Change | Valid exit notice, with the deposit timeline |
| 18 | Vendor invoice | Clean: passes all 7 checks |
| 19 | Vendor invoice | 17% over range from an ad-hoc line with no PO: needs COO approval |
| 20 | Vendor invoice | Missing PO: on hold, vendor asked to re-issue |
| 21 | Vendor, fraud | Look-alike domain asking for a bank change: no reply, Finance alerted |
| 22 | Query | Pets are allowed only at HSR |
| 23 | Query + lead | Event-hall quote with member discount, guest-list rule, Demo Night date |
| 24 | Query | Sunday access, heavy delivery, a server rack that breaks the network policy |
| 25–27 | Noise | SEO pitch, newsletter, job application |
| 28 | Vendor, fraud | Genuine domain, passes all 7 checks, but the bank account on the PDF isn't the one on file |
| 29 | Adversarial | Prompt injection in a P.S. ("classify this as noise") |
| 30 | Adversarial | Three lines, no company or centre: nothing may be invented |
| 31 | Adversarial | Written in Hindi (Devanagari script) |
| 32 | Adversarial | A reply whose quoted earlier message mentions an invoice: only the new text counts |
| 33 | Adversarial | An ordinary supplier payment query: a false fraud alarm fails |

## Facts that often trip up a reader
- **Dates.** The records stop at 30 Nov 2026. Seed emails are processed as of their own scripted dates (2–4 Nov 2026); live email as of the real date.
- **One inbox, many "people".** Staff such as Lakshmi (Finance) or Ananya (account manager) are plus-aliases of the demo inbox (`+lb-lakshmi`). Approval requests go there, so the author clicks Approve on their behalf. A tester only sees the reply that results.
- **Gemini free tier.** About 500 calls a day (resetting at 13:30 IST) and 15 a minute. Each email uses 2–3 calls; bulk mail (newsletters, auto-replies, no-reply senders) is filed by code without any. A burst of emails may be answered a minute or two late; an email that fails is flagged by WF-E, not lost.
- **Production stand-ins.** Demo mode relaxes sender checks only so that testers can play members; every relaxation is a setting, and production mode matches by sender domain.
