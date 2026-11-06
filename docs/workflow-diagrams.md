# Launchbench Email Automation: Diagrams

These are companion diagrams to [workflow-design.md](workflow-design.md).
- **Legend:** ✦ = AI step (Gemini). ⚙ = plain code (rules and arithmetic, no AI).
- **Viewing:** GitHub renders these diagrams. VS Code needs the *Markdown Preview Mermaid Support* extension.

## 1. The big picture
There is one address and one main workflow (WF-0). It reads every incoming email, works out what it is and who sent it, then hands it to one of five specialist workflows.

```mermaid
flowchart TD
    T["Tester's own Gmail<br/>'AC in Cabin 3B down since Monday'"] --> IN["teamlaunchbench@gmail.com<br/>the only address"]
    IN --> GT

    subgraph WF0["WF-0 · Intake & triage"]
        GT["Gmail trigger<br/>checks every minute"] --> F{"Sent by the<br/>demo account itself?"}
        F -- "yes: a reply, notification<br/>or approval" --> STOP["Never fetched<br/>trigger query is -from:me"]
        F -- no --> KB["Drive: knowledge base"]
        WT["WF-T test runner<br/>seed emails, no mail sent"] --> KB
        KB --> CL["✦ Gemini: classify and extract<br/>class, desk, identity clues,<br/>key fields, sentiment as JSON"]
        CL --> WHO["⚙ Who is the sender?<br/>depends on the class (diagram 2)"]
        WHO --> REC["Sheets: member or vendor record"]
        REC --> SPL["Split: one item per request"]
        SPL --> SW{"Switch on class"}
    end

    SW --> L["WF-1 · Leads"]
    SW --> I["WF-2 · Facility issues"]
    SW --> B["WF-3 · Customer billing"]
    SW --> V["WF-4 · Vendor invoices"]
    SW --> C["WF-5 · Changes & queries"]
    SW --> N["Noise: label and archive<br/>job applications acknowledged, HR notified"]

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#1e1b4b
    classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
    class CL ai
    class WHO,F code
```

There are two more workflows that sit outside this flow:
- **WF-E (errors):** if any step fails, it emails `+lb-ops` and labels the message, so nothing disappears silently.
- **WF-T (test runner):** a button that passes the chosen seed emails straight into WF-0, each with its `[as <alias>]` tag and scripted date, so every run gives the same results without sending any mail.

## 2. Who is the sender? (identity, demo mode)
Testers write from their own Gmail, so the workflow can't match them by email domain. Instead, the class decides what kind of sender to look for. Replies always go back to the real person.

```mermaid
flowchart TD
    A["Classified email"] --> TAG{"[as …] tag in subject?<br/>test runner / presenter only"}
    TAG -- yes --> P["Use that persona"]
    TAG -- no --> K{"Class?"}

    K -- "lead, query, noise" --> N1{"Member named<br/>in the email?"}
    N1 -- yes --> M["That member"]
    N1 -- no --> PR["A new prospect"]

    K -- "issue, billing, change" --> N2{"Member named<br/>in the email?"}
    N2 -- yes --> M
    N2 -- no --> TT{"Tester already has a<br/>member in the testers tab?"}
    TT -- yes --> M2["That member"]
    TT -- no --> AS["⚙ Assign the least-used member<br/>and save it to the testers tab"]

    K -- "vendor invoice" --> G{"GSTIN on the invoice<br/>in the vendor master?"}
    G -- yes --> VV["That vendor<br/>then the 7 checks + fraud checks"]
    G -- no --> UV["Unknown vendor → HOLD"]

    P & M & PR & M2 & AS & VV & UV --> Z["Replies go to the REAL sender,<br/>never to a persona's address.<br/>Member replies open with<br/>'Demo: you're writing as …'"]

    classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
    class AS code
```

With `demo_mode` off, every branch above becomes "match by sender domain", and an unknown member gets "we couldn't find your account".

## 3. Inside every specialist: the same five steps
The design rule is this: **code decides and calculates, Gemini only writes the words.** Every number in a reply can therefore be checked against the spreadsheet.

```mermaid
flowchart LR
    A["Get records<br/>from Sheets"] --> B["⚙ Apply rules<br/>and do maths"] --> C["✦ Gemini writes<br/>the reply"] --> D{"Send policy"}
    D -- "FAQ or acknowledgement" --> E["Send automatically"]
    D -- "money or contracts" --> F["Approve / Decline email<br/>to the staff alias"]
    F -- Approve --> E2["Send the reply"]
    F -- Decline --> G["Keep as a draft for staff"]
    D -- "suspected fraud" --> H["No reply<br/>urgent alert to Finance and COO"]
    E & E2 & G & H --> Z["Log to Sheets · notify staff · label in Gmail"]

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#1e1b4b
    classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
    class C ai
    class B code
```

| Workflow | ⚙ Code works out | ✦ Gemini writes | Sent how |
|---|---|---|---|
| WF-1 Leads | Which cabins fit; the price at each lock-in length; the deposit; hot, warm or cold | A reply with the options and a tour invitation | Acknowledgement automatically; the quote after approval |
| WF-2 Facility issues | Priority P1–P4 (raised if repeated or overdue); deadlines in clock time | Acknowledgement with ticket, deadline, workaround | Automatically |
| WF-3 Customer billing | Whether the customer's claim matches the invoice, usage and exit records | An explanation from the checked facts, with no promised waivers | After approval |
| WF-4 Vendor invoices | The 7 vendor checks and fraud signals; the payment-run date | The invoice fields extracted from the PDF; a request for a missing PO | HOLD after approval; fraud never |
| WF-5 Changes & queries | Exit date, deposit refund date, the fee difference when downsizing | A knowledge-base answer, or a change confirmation | Queries automatically; changes after approval |

## 4. One email from start to finish
A tester, with no tag and no instructions, sends *"AC not working in Cabin 3B since Monday, we're RouteWise at Whitefield"*:

```mermaid
sequenceDiagram
    actor T as Tester
    participant G as Gmail (demo inbox)
    participant W0 as WF-0 Triage
    participant S as Google Sheets
    participant AI as Gemini
    participant W2 as WF-2 Facility issues
    participant ST as Staff aliases

    T->>G: AC not working in Cabin 3B since Monday
    G->>W0: new email (trigger)
    W0->>AI: classify and extract (with knowledge base)
    AI-->>W0: facility issue · support desk · AC · suggested P2 · negative<br/>clues: RouteWise, Cabin 3B, Whitefield
    W0->>S: resolve identity from the clues
    S-->>W0: RouteWise · M007 · Whitefield Cabin 3B
    W0->>W2: hand off with the member record
    W2->>S: read tickets (repeat? overdue?)
    Note over W2: ⚙ open more than 24 h, so P2 becomes P1<br/>fix due within 4 h · escalate
    W2->>AI: write the reply from these facts
    AI-->>W2: apology · ticket T-1053 · fixed by 1:20 pm · spare room offer
    W2->>T: "Demo: you're writing as RouteWise (M007)…" + reply (sent automatically)
    W2->>S: append ticket T-1053
    W2->>ST: notify +lb-sneha (centre manager) and +lb-kavya (Head of Ops)
    W2->>G: label Launchbench/Issue/P1
```

Had the tester not named a company, they would have been assigned a member, and the same flow runs against that member's cabin and tickets.

## 5. Vendor invoices: checks and outcomes
This specialist relies most heavily on rules. Gemini only reads the PDF. Every decision after that is code. Fraud checks run first and override everything else.

```mermaid
flowchart TD
    P["Email with an invoice PDF"] --> X["✦ Gemini extracts the invoice fields<br/>incl. GSTIN and bank account"]
    X --> FR{"⚙ Fraud signals?"}
    FR -- "bank account ≠ the one on file" --> FA["Suspected fraud<br/>No reply · alert Finance and COO"]
    FR -- "asks to change bank or pay a<br/>new account · urgency" --> FA
    FR -- "look-alike sender domain<br/>(tagged sender only)" --> FA
    FR -- none --> C1{"GSTIN in vendor master,<br/>our GSTIN correct?"}
    C1 -- "unknown vendor" --> HOLD["HOLD"]
    C1 -- "wrong GSTIN" --> RET["RETURN to vendor"]
    C1 -- ok --> C2{"PO quoted<br/>and matching?"}
    C2 -- missing --> HOLD
    C2 -- wrong --> RET
    C2 -- ok --> C3{"GST maths right, not a duplicate,<br/>billing period valid?"}
    C3 -- "maths or period wrong" --> RET
    C3 -- duplicate --> REJ["REJECT as duplicate"]
    C3 -- ok --> C4{"Amount within<br/>expected range?"}
    C4 -- no --> FLAG["FLAG for Finance review"]
    C4 -- yes --> PASS["PASS"]
    PASS & FLAG --> AP["Approver: Finance up to ₹2L, plus COO above<br/>payment run on the 10th or 25th"]
    HOLD --> ASK["Draft to vendor, e.g. 'please re-issue with the PO'<br/>sent after approval"]
    AP & ASK & RET & REJ & FA --> LOG["Log to ap_invoices · file PDF in Drive · label in Gmail"]

    classDef ai fill:#ede9fe,stroke:#7c3aed,color:#1e1b4b
    classDef code fill:#e0f2fe,stroke:#0284c7,color:#0c4a6e
    classDef bad fill:#fee2e2,stroke:#dc2626,color:#7f1d1d
    class X ai
    class FR,C1,C2,C3,C4 code
    class FA bad
```

Three ways to see the fraud path:

| How | Seed | What catches it |
|---|---|---|
| Forward the Guardian Shield PDF from the Test Kit | 28 | Bank account ends 8851; the vendor master says 3356. Every other check passes. |
| Improvise a "we've changed banks, pay urgently" email | 21 is the scripted version | The bank-change request and the urgency in the text |
| Presenter sends seed 21 with `[as sparkleserv-fake]` | 21 | The look-alike domain `sparkleserv-billing.in` |

## 6. What a viewer sees during the demo
```mermaid
flowchart LR
    subgraph Tester["Tester's own inbox"]
        R1["The reply, within a minute or two"]
    end
    subgraph Labs["Demo inbox (teamlaunchbench)"]
        R2["Incoming mail labelled by class and priority"]
        R3["Staff notifications and Approve buttons"]
    end
    subgraph Sheet["Launchbench Data spreadsheet"]
        R4["New rows in leads, tickets, ap_invoices<br/>and testers (member assignments)"]
    end
```
