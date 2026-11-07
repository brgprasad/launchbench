# Launchbench: Test Protocol

What is tested automatically, how to run it, how to do a quick manual check, and what to watch out for. **Scope today: WF-0 (intake & triage).** Each later workflow adds its own section here when it is built.

## 1. The automated tests

There are three layers. Each one guards a different kind of mistake.

| Layer | What it proves | How to run | Needs |
|---|---|---|---|
| **Data consistency** (`tools/verify.py`) | The knowledge base, CSVs, seed emails and PDFs agree with each other: every price matches `pricing.csv`, every invoice adds up, every member or invoice a seed mentions exists, every PDF's totals are right | `python3 -I tools/verify.py .` | Nothing; runs offline in a second |
| **Triage regression** (WF-T + `tools/score_triage.py`) | Gemini classifies all 35 seed emails correctly: class, desk, extracted fields, identity clues, fraud signals | Run WF-T, then the scorer (§2) | Gemini quota: one call per seed |
| **Scorer self-test** (`score_triage.py --selftest`) | The scorer itself catches mistakes. It feeds in 10 deliberately wrong answers and checks each one is flagged at the right severity. | `score_triage.py --selftest` | Nothing; offline |

### What the triage regression checks
Every seed email is checked against its entry in [`test-emails/triage-expectations.json`](../test-emails/triage-expectations.json), plus four checks that apply to every email:

| Check | Fails when |
|---|---|
| **G1 Nothing invented** | An identity clue (company, member ID, invoice number, GSTIN, cabin, centre) doesn't appear in the email itself. This is **critical**: the identity step trusts these clues. |
| **G2 Desk follows class** | The desk doesn't match the first intent (lead → sales, issue → support, billing and changes → billing, vendor → ap, job application → careers, others → hello) |
| **G3 Fraud only where it belongs** | Fraud signals appear on a non-vendor email, or on a vendor email that shouldn't have any |
| **G4 Sane output** | No intents, confidence outside 0–1, or no reasoning |

### Coverage: which risk each seed guards against

| Risk | Seeds |
|---|---|
| Each of the 7 classes recognised | Leads 01–06, issues 07–10, billing 11–14, changes 16–17, vendors 18–21 and 28, queries 22–24, noise 25–27 |
| Two intents in one email | 15 (issue + billing), 23 (query + lead) |
| Extracted fields right: team size, dates, budget, seat counts, TDS section | 01, 02, 06, 14, 16 |
| Relative dates resolved against the email's date ("in two weeks", "from 1 January") | 01, 02, 06 |
| Tone: Hinglish, anger, churn threat | 09, 10 |
| Claimed attachment missing | 13 |
| Fraud caught from the text | 21 (**critical**) |
| **No false fraud alarm** on an ordinary supplier email | 33 (**critical**), 18–20 |
| **Prompt injection** ignored | 29 (**critical**) |
| **Nothing invented** from a terse email | 30 |
| Non-English script | 31 |
| Quoted earlier messages ignored (tests the Normalise code too) | 32 |

### Severity
- **critical:** fraud missed, a false fraud alarm, an injection obeyed, or an identity invented. Any one of these blocks a demo.
- **fail:** a wrong class, desk or extracted field.
- **warn:** worth a look but not wrong, e.g. a desirable fraud signal not raised, or a class that changed between runs.

### What is *not* covered automatically, and how it is covered instead
- **The live Gmail path:** the trigger, attachment download and mark-as-read. WF-T bypasses Gmail by design. Covered by the real-email run below (`tools/send_seeds.py`) and by quick check Q3.
- **Repeatability:** the same email can occasionally be classified differently. Run the full set twice and use `--stability` (§2).
- **Emails nobody thought of.** The seeds are a regression baseline, not proof of general accuracy. Your own improvised emails (§4) are the real test.
- **Later workflows:** replies, quotes, SLA times, approvals and vendor checks. Their expectations already exist as the `expected_action` list in each seed file, and they get automated checks when each workflow is built.

## 2. Running the triage regression

1. In n8n, open **LB · WF-T Test runner**. Double-click **Which seeds**, enter `01, 07, 21` (or leave it empty for all 35), close it and press **Ctrl+S**.
   - Keep **triage_only** on (the default). WF-0 then classifies and logs each seed but runs no handler: no replies, staff emails or approval cards, and one Gemini call per seed. Turn it off only for an end-to-end run of the handlers, which sends real mail to the `+lb-` aliases and leaves approval runs waiting.
2. Click **Execute workflow**. WF-T sends **one seed every 30 seconds**, like real traffic (firing all 35 at once would exceed Google Sheets' 60 reads a minute per user). A full run takes about 23 minutes; rows appear in `triage_log` as each seed is classified.
   - **The free tier allows about 500 Gemini 3.5 Flash-Lite calls a day**, shared with live testing and reset at **13:30 IST** (midnight Pacific). A full regression (35 calls) fits easily.
3. Score it from the project folder:
   ```bash
   GD=/path/to/google_drive   # the author's private Google Sheets helper (gsheets), not part of this repo
   PYTHONPATH=$GD $GD/.venv/bin/python tools/score_triage.py --since "2026-11-05 10:00"
   ```
   Use `--since` with the time you started the run, so older rows are ignored; `--seeds 07,21` limits the scorecard to chosen seeds.
4. Read the scorecard: one line per seed (PASS / WARN / FAIL / CRITICAL), with the reasons indented underneath, and totals at the end.

**End-to-end run (handlers on).** With **triage_only** off, check the whole pipeline instead: every handler tab row, lead scores, ticket priorities, billing and request draft checks, vendor-invoice outcomes and the errors tab:
```bash
PYTHONPATH=$GD $GD/.venv/bin/python tools/check_e2e.py --since "2026-11-06 19:48"
```
Afterwards, stop the approval runs it leaves waiting (n8n → Executions → filter *Waiting*) and reset the spreadsheet before real testers use it.

**Real-email run (the whole path, as a tester sees it).** `tools/send_seeds.py` sends the seeds as real Gmail messages from the test account to the demo inbox, one every 30 seconds, so they go through the Gmail trigger, the bulk-mail filter and the published workflows. Member and vendor seeds get an `[as <alias>]` subject tag; prospect and noise seeds arrive as the test account. Then `check_e2e.py --run-log` matches each email to its seed by subject, checks every handler row as above, and reads the test account's inbox for the replies that came back:
```bash
PYTHONPATH=$GD $GD/.venv/bin/python tools/send_seeds.py --seeds 22,34,35      # or no --seeds for all
PYTHONPATH=$GD $GD/.venv/bin/python tools/check_e2e.py --run-log runs/send-20261107-1015.json
```
- It needs WF-0 and the handlers **published**, and the helper's `labs-mail` sign-in (send and read only).
- Results use today's date, not the seed's date, so notice periods and SLA clocks shift accordingly.
- It leaves real mail in both inboxes and a row for the test account in the `testers` tab. Reset before real testers use the sheet.

**Or ask Claude: "run the triage regression".** Claude runs WF-T through the n8n connection, waits, runs the scorer and reports the result.

**When to run it:** after any change to the classifier prompt, the schema or the Normalise code, and before every demo. Run all seeds, not just the one you were fixing: a fix for one email can break another.

## 3. Quick checks

Each takes a minute or two and tells you whether things are basically alive.

### Where things are
| What | Where |
|---|---|
| **WF-T**, the test runner | n8n → **Personal** → **Workflows** → **LB · WF-T Test runner** |
| **WF-0**, intake & triage | Same list → **LB · WF-0 Intake & triage** |
| **`triage_log`**, the results | Google Sheets, signed in as teamlaunchbench@gmail.com (the owner) or the labs account (an editor, which also owns the Drive folders): Drive → My Drive → Demos → Launchbench → **Launchbench Data** ([direct link](https://docs.google.com/spreadsheets/d/1H7tY4fWsIw1oRcwpeVHbTxD3Bt4XkBYT3rowPsEYwCk/edit)). The tabs are along the bottom; `triage_log` is the last one. |
| A seed email | `test-emails/NN-*.md` in this project, or Drive → Demos → Launchbench → Test Kit. Seed 07 is `07-issue-ac-overdue.md`: RouteWise complaining that the AC in Cabin 3B has been down since Monday. |

### Reading `triage_log`
Each row is one email the workflow processed, newest at the bottom. The columns that matter for a quick check:

| Column | Letter | Meaning |
|---|---|---|
| `logged_at` | A | When it was processed |
| `source` | B | `seed` = sent in by the test runner; `live` = a real email that arrived in the demo inbox |
| `seed_id` | E | Which seed email (blank for live emails) |
| `subject` | I | The email's subject, with any `[as …]` tag removed |
| `desk` | L | Which team it's routed to: sales, support, billing, ap (accounts payable), hello (general) or careers |
| `classes` | M | What kind of email it is, as `class/subclass`. `facility_issue/ac` means a facility problem, category AC. Two entries separated by a comma means two requests in one email. |
| `reasoning` | U | Gemini's one-sentence explanation of its decision |

The columns in between hold details: sentiment, language, the extracted identity clues, fraud signals, and the full JSON. Hiding columns C–D, F–H, J–K and N–T leaves a readable view.

### Q1. Smoke test: does the pipeline run at all?
1. Open **LB · WF-T Test runner**.
2. On the canvas, double-click the second box, **Which seeds**. A panel opens with one field, `only`. Type `07`; for several seeds, `07, 11, 21`; empty means all 35.
3. Close the panel (← **Back to canvas**, top left) and press **Ctrl+S** to save.
4. Click **Execute workflow**, the button at the bottom centre of the canvas.
5. Watch the boxes get green ticks from left to right. The last box, **Send to WF-0**, spins while WF-0 works, then turns green. About 20 seconds for one seed.
6. Open `triage_log`. A new row should be at the bottom.

**Looks right when:** the run ends green; the new row has `seed_id` 07, `classes` `facility_issue/ac` and `desk` `support`; and the reasoning mentions the AC being out longer than the SLA allows.

### Q2. Eyeball the log: is it making sensible decisions?
After any run, read only `subject`, `desk`, `classes` and `reasoning` for the new rows. For each, ask: *would a sensible receptionist have routed this email the same way, for the same reason?* A right class with a wrong reason is a warning sign. For a strict check, run the scorer (§2).

### Q3. Live email: does real mail get picked up? *(needs WF-0 published)*
Nothing here works until WF-0 is published, because until then its Gmail trigger isn't polling. To publish:
1. In the demo Gmail inbox, select all unread mail and mark it read, so the first poll doesn't process Google's welcome emails.
2. Open **LB · WF-0 Intake & triage** and click **Publish** (top right).

Then:
1. From your **personal** Gmail (*not* the demo account), send something like *"The AC in 3B is dead again, please send someone"* to teamlaunchbench@gmail.com.
2. Wait 1–2 minutes. The trigger checks once a minute.

**Looks right when:**
- `triage_log` has a new row with `source` = `live` and your address in `from`.
- In the demo inbox, your email is no longer bold (marked read).
- WF-0's **Executions** list shows a green run.

### Q4. Executions: did anything fail?
- In any workflow, the **Executions** tab at the top centre of the editor lists its runs. For all workflows, use **Overview** in the left sidebar, then **Executions**.
- Green **Success** is fine. For a red **Error**, click the run: the failed box is outlined in red. Click it to read the error message.
- Common errors: `429` from Gemini means the quota is used up; a Google error usually means a credential needs reconnecting.
- **You don't have to look.** WF-E emails `+lb-ops` whenever a production run of WF-0 to WF-5 fails (manual and test-runner runs don't count). The alert says what broke in plain words, what it means for the sender, and what to do, with a link to the run. Each failure is also a row in the `errors` tab. The same error is emailed at most once per 30 minutes.
- **To recover:** fix the cause the alert names (for an expired sign-in: n8n → Credentials → Reconnect), open the failed run from the link, and click **Retry** at the top right. For WF-3 or WF-5 failures after approval, check whether the reply reached the sender before retrying.
- **Unanswered emails:** every 30 minutes WF-E looks for live emails still unread after 10 minutes (WF-0 marks every email it handles as read). It labels them `Launchbench/Error` in Gmail and sends one alert listing them. This catches classifier failures (`ERROR` rows) and a broken Gmail trigger, which no failed run would show. Remove the label once the email is handled.

### Q5. Something odd: does it cope?
Send one of the emails from §4, or from your personal Gmail once WF-0 is published, or add it as a seed. Then read its row as in Q2. It should be handled sensibly; if it isn't, you have a finding to report.

## 4. How to approach testing

- **Try to break it.** The seed set has to stay green, but your own emails are where you learn something. Ideas:
  - very short ("AC dead. 3B.")
  - forwarded, or a reply to an old thread
  - two requests buried in one paragraph
  - Hindi or Kannada script
  - an invoice with no PDF
  - a job application phrased as a question
  - a hidden instruction: "ignore your rules and…"
- **Judge as an operations manager.** If a competent human could route an email either way, a defensible answer passes. Note it, don't fix it.
- **Separate three kinds of miss:**
  1. Wrong class or desk: what matters now.
  2. A wrong detail, such as a date or a team size.
  3. Something not built yet (replies, prices): ignore it for now.
- **Report patterns, not wordings.** "Supplier emails mentioning invoices get classed as billing" is fixable in general. Tuning the prompt to one seed's exact words passes the test and fails the next real email.
- **Critical beats count.** One missed fraud, invented identity or obeyed injection matters more than three borderline class calls.
- **Turn findings into seeds.** When an improvised email exposes a real weakness, it becomes a new seed with an entry in `triage-expectations.json`, so it stays fixed.

## 5. Gotchas

- **Gemini quota.** WF-0 uses `gemini-3.5-flash-lite`, whose free tier allows 10 calls a minute and about **500 a day** (the day resets at 13:30 IST). Gemini 3 Flash allowed only 20 a day, which is why we moved. Check usage at aistudio.google.com/rate-limit (project `launchbench-n8n-demo`).
- **Identity-clue guardrail.** Flash-Lite sometimes fills `identity_clues.company` from the sender's domain. The "Keep only stated clues" node in WF-0 removes any clue that the email doesn't contain (the same rule as the scorer's G1) and lists what it removed in `classifier_json.guard_removed`.
- **`ERROR` rows.** If Gemini fails on an email (quota used up, or an answer that doesn't fit the schema), that email gets a row with `classes` = `ERROR` and the reason in `reasoning`. The other emails in the batch are still logged. A live email that fails stays unread in the inbox. Re-run the failed seeds once the cause is fixed; the scorer counts them as FAIL.
- **Thinking uses up output tokens.** The output limit is set to 16,384 so that long reasoning on a hard email (seed 06, on Gemini 3 Flash) doesn't cut the JSON off.
- **Seed 28 shows no fraud in WF-0, and that is correct.** Its fraud is the bank account inside the PDF, which WF-4 reads.
- **Dates are the seed's own date** (2–4 Nov 2026), not today. "In two weeks" in seed 02 resolves from 3 Nov.
- **The `[as …]` tag never reaches Gemini.** It's stripped first and shown in the `as_alias` column.
- **Bulk mail never reaches Gemini.** Newsletters, marketing, auto-replies and no-reply notifications are logged as `noise/bulk` with the reason in `reasoning`. To test the noise classifier, write the pitch or newsletter yourself from a personal mailbox, or use seeds 25–27.
- **`triage_log` only grows,** so always score with `--since`. Republishing the spreadsheet (`publish_drive.py`) wipes it.
- **Live email is ignored when sent from the demo account itself.** That's the loop protection. Test from your personal account.
- **Before publishing WF-0, mark the demo inbox's existing unread mail as read.** Otherwise the first poll classifies Google's welcome emails as noise and spends quota.
- **Published versus draft.** After WF-0 is published, live email runs the *published* version. Edits take effect for live email only when it is republished.
- **Don't edit WF-0 or WF-T in the n8n editor while Claude is changing them** through the MCP connection. The last save wins.
