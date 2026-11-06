// Launchbench customer-billing rules (WF-3 "Work out the case" Code node).
//
// Gemini reads the email (billing topic, invoice numbers, new GSTIN, TDS
// section) and later writes the reply. This code checks the member's claim
// against invoices and meeting_room_usage and applies kb/04-billing-policy.md
// (plus the deposit terms in kb/03-membership-terms.md §8): overage, invoices
// after an exit, deposit refunds, GSTIN changes, TDS, invoice copies, late
// payment. Every amount and date in the reply comes from here. The same text
// is pasted into n8n; tools/test_billing_rules.js runs it locally.
//
// planBilling(input, data) -> case
//   input: { now, email: {subject, body, from_address, attachments}, classifier, member, identity }
//   data:  { invoices: [rows], usage: [rows] }
// checkReply(text, allowedText, mustMention) and demoLine(member) as in WF-5.

const CENTRE_NAMES = { KOR: 'Koramangala', IND: 'Indiranagar', HSR: 'HSR Layout', WHF: 'Whitefield', HEB: 'Hebbal (Manyata)' };
const FINANCE = 'Lakshmi Narayan';
const STAFF_EMAIL = {
  'Lakshmi Narayan': 'teamlaunchbench+lb-lakshmi@gmail.com',
  'Ananya Bose': 'teamlaunchbench+lb-ananya@gmail.com',
  'Vikram Shetty': 'teamlaunchbench+lb-vikram@gmail.com',
  'Deepa Menon': 'teamlaunchbench+lb-deepa@gmail.com',
  'Farhan Sheikh': 'teamlaunchbench+lb-farhan@gmail.com',
  'Kavya Reddy': 'teamlaunchbench+lb-kavya@gmail.com',
};
const FIXED_HOLIDAYS = ['01-26', '08-15', '10-02', '11-01', '12-25'];
// kb/04-billing-policy.md
const DISPUTE_DAYS = 15;        // §7
const CORRECTION_DAYS = 30;     // §2, issued invoices
const CHANGE_CUTOFF_DAY = 25;   // §2, GSTIN / name / address changes
const DEPOSIT_DAYS = 30;        // §9, membership terms §8
const AFTER_EXIT_REFUND_DAYS = 10; // §7, business days
const TDS_RATE = 0.10;          // §3, Section 194-I
const ROOM_BY_RATE = { 480: '4-seater rooms', 800: '8-seater rooms', 1200: 'the boardroom' }; // §6

function planBilling(input, data) {
  const now = String(input.now || '').slice(0, 10);
  const email = input.email || {};
  const c = input.classifier || {};
  const m = input.member || null;
  const b = c.billing || {};
  const text = `${email.subject || ''}\n${email.body || ''}`;
  const subs = (c.intents || []).filter(i => i.class === 'customer_billing').map(i => `${i.subclass} ${i.summary}`).join(' ') + ' ' + (b.topic || '');
  const has = re => re.test(subs) || re.test(text);

  const customer = [], internal = [], must = [], flags = [], actions = [], attach = [], used = [];
  const use = i => { if (i && !used.includes(i.invoice_no)) used.push(i.invoice_no); };
  const fyiWhy = [];
  let amount = null;
  const firstAmount = n => { if (amount === null && n) amount = n; };

  if (!m) {
    return {
      ok: false, topics: ['unmatched'], member_id: '', invoices: [], amount_inr: '', priority: 'normal',
      customer_facts: ['We could not match this email to a member account. Please reply with your company name and the invoice number, and our finance team will look into it.'],
      internal_facts: ['No member matched: reply personally once the sender confirms their company.'], must_mention: [], flags: ['No member matched'],
      actions: ['Confirm who the sender is'], attach_invoices: [], fyi: [], fyi_emails: [], fyi_reason: '',
      approver: FINANCE, approver_email: STAFF_EMAIL[FINANCE], reply_due: addBusinessDays(now, 1), summary: 'billing query, member not matched',
    };
  }

  const mine = (data.invoices || []).filter(i => i.member_id === m.member_id).sort((x, y) => String(x.invoice_date).localeCompare(String(y.invoice_date)));
  const latest = mine[mine.length - 1] || null;
  const total = i => Number(i.total_inr) || 0;
  const paid = i => /^paid/i.test(String(i.status || ''));
  const label = i => `${i.invoice_no} (${monthName(i.billing_period + '-01')}, ${inr(total(i))})`;

  // ---- which invoices the email means ----
  const named = [...new Set([...(b.invoice_numbers || []), ...((c.identity_clues || {}).invoice_numbers || []), ...(text.match(/LB\/\d{2}-\d{2}\/\d{3,4}/gi) || [])]
    .map(s => String(s).trim().toUpperCase()).filter(Boolean))];
  const mentioned = [], notOurs = [];
  for (const n of named) {
    const hit = mine.find(i => i.invoice_no.toUpperCase() === n || (/^\d{3,4}$/.test(n) && i.invoice_no.endsWith('/' + n.padStart(4, '0'))));
    if (hit) { if (!mentioned.includes(hit)) mentioned.push(hit); } else notOurs.push(n);
  }
  const byMonth = [];
  for (const mo of monthsIn(text)) {
    const hit = mine.filter(i => Number(String(i.billing_period).slice(5, 7)) === mo && i.billing_period <= now.slice(0, 7)).pop();
    if (hit && !byMonth.includes(hit)) byMonth.push(hit);
  }
  for (const n of notOurs) {
    customer.push(`We couldn't find invoice ${n} on your account. Please check the number.`);
    internal.push(`Invoice ${n} named in the email is not on ${m.member_id}'s account (another member's or not issued). Nothing about it was disclosed.`);
  }

  // ---- topics ----
  const exited = Boolean(m.exit_date) || /exit/i.test(String(m.status));
  const afterExit = exited && m.exit_date ? mine.filter(i => String(i.billing_period) + '-01' > m.exit_date) : [];
  const claimsExit = /\b(vacated|we left|moved out|after (we|our) (exit|left|vacat)|exited|gave notice|our exit)\b/i.test(text);
  const topics = [];
  if (afterExit.length || claimsExit) topics.push('after_exit');
  if (/deposit/i.test(text)) topics.push('deposit');
  if (has(/overage|meeting[- ]?rooms?|credits?\b/i)) topics.push('overage');
  if (b.new_gstin || /gstin|gst (number|registration|no\b)/i.test(text)) topics.push('gstin');
  if (b.tds_section || /\btds\b|194[- ]?[a-z]\b/i.test(text)) topics.push('tds');
  if (has(/invoice_copy|\bcop(y|ies)\b|statement of account|ledger|re-?send/i)) topics.push('copy');
  if (/bank (account|details)|account number|\bifsc\b/i.test(text) && /chang|new|updat/i.test(text)) topics.push('bank');
  // Payment status: from the email's own words or the classifier's subclass (not its
  // summary, where "delayed deposit refund" would read as a late payment).
  const subclasses = (c.intents || []).filter(i => i.class === 'customer_billing').map(i => i.subclass).join(' ');
  if (/payment|late|overdue|reminder|waive/i.test(subclasses) || /late fee|overdue|waive|waiver|reminder|cheque|how (do|can|should) (we|i) pay|payment method|(delay|late)\w* (in|on|with) (the |our )?(payment|invoice)/i.test(text)) topics.push('payment');
  if (!topics.length) topics.push('general');

  // ---- overage (§6, §7) ----
  if (topics.includes('overage')) {
    const inv = mentioned.find(i => Number(i.usage_inr) > 0) || mine.filter(i => Number(i.usage_inr) > 0).pop() || mentioned[0] || latest;
    const usageMonth = inv ? addMonths(inv.billing_period + '-01', -1).slice(0, 7) : '';
    const u = (data.usage || []).find(r => r.member_id === m.member_id && r.month === usageMonth);
    const hours = u ? Number(u.overage_hours) || 0 : 0;
    use(inv);
    if (inv && u && hours > 0) {
      const rate = Number(u.overage_rate_inr), amt = Number(u.overage_amount_inr), gst = Math.round(amt * 0.18), held = amt + gst;
      const mon = monthName(usageMonth + '-01');
      const deadline = addDays(inv.invoice_date, DISPUTE_DAYS);
      customer.push(`Invoice ${inv.invoice_no} (dated ${nice(inv.invoice_date)}) includes meeting-room overage for ${mon}: your plan includes ${u.credits_included} meeting-room credits a month (1 credit is 1 hour in a 4- or 8-seater room), and your team used ${u.credits_used}, which is ${hours} hours over.`);
      customer.push(`Hours over the included credits are billed at the member rate${ROOM_BY_RATE[rate] ? ' for ' + ROOM_BY_RATE[rate] : ''}, ${inr(rate)} an hour: ${hours} × ${inr(rate)} = ${inr(amt)}, plus GST.`);
      customer.push(`Unused credits don't roll over to the next month, so a quieter month can't offset a busier one.`);
      customer.push(`We'll send you the ${mon} booking log from the member app, which shows who booked each slot and when.`);
      customer.push(`We remove overage only when it comes from a system error, such as a double booking or a cancelled booking that was still charged. If the log shows one, reply with the booking and we'll correct it with a credit note.`);
      if (now <= deadline) {
        customer.push(`You've raised this within the ${DISPUTE_DAYS}-day dispute window (open until ${nice(deadline)}), so the overage of ${inr(held)} including GST is on hold while we review it, and no late fee applies to it. We aim to resolve disputes within 5 business days.`);
        if (!paid(inv)) { customer.push(`Please pay the rest of the invoice, ${inr(total(inv) - held)}, by the due date, ${nice(inv.due_date)}.`); must.push(fmt(total(inv) - held)); }
        actions.push(`Hold ${inr(held)} (overage incl. GST) on ${inv.invoice_no} pending review`);
      } else {
        customer.push(`Disputes need to be raised within ${DISPUTE_DAYS} days of the invoice date. This invoice is dated ${nice(inv.invoice_date)}, so the window closed on ${nice(deadline)}, and the full amount is payable.`);
        internal.push(`Outside the dispute window (closed ${nice(deadline)}): no hold.`);
      }
      const match = Number(inv.usage_inr) === amt;
      internal.push(`Usage record for ${mon}: ${u.credits_included} credits included, ${u.credits_used} used, ${hours} h over at ${inr(rate)} = ${inr(amt)}${match ? ', which matches the invoice line' : `, but the invoice shows ${inr(Number(inv.usage_inr))}: CHECK THE INVOICE`}.${u.note ? ' ' + u.note + '.' : ''}`);
      internal.push('Policy: no waiver unless the booking log shows a system error (billing policy §6).');
      if (!match) { flags.push('The overage on the invoice does not match the usage record'); fyiWhy.push('an invoice error'); }
      actions.push(`Send the ${mon} booking log`);
      must.push(inv.invoice_no);
      firstAmount(amt);
    } else {
      customer.push(`Our records show no meeting-room overage on ${inv ? 'invoice ' + inv.invoice_no : 'your recent invoices'}${u ? `: in ${monthName(usageMonth + '-01')} your team used ${u.credits_used} of the ${u.credits_included} included credits` : ''}.`);
      internal.push(`No overage in meeting_room_usage for ${usageMonth || 'recent months'}: check what the member is looking at.`);
    }
  }

  // ---- invoices after an exit (§7) ----
  if (topics.includes('after_exit')) {
    if (exited && m.exit_date) {
      if (afterExit.length) {
        const list = afterExit.map(label);
        const many = afterExit.length > 1;
        customer.push(`Our records confirm your membership ended on ${nice(m.exit_date)}. ${many ? 'Invoices' : 'Invoice'} ${joinAnd(list)} ${many ? 'were' : 'was'} raised after that date in error, and we're sorry for the mix-up.`);
        customer.push(`We'll cancel ${many ? 'them' : 'it'} in full with ${many ? 'credit notes' : 'a credit note'}, so nothing is payable on ${many ? 'them' : 'it'}.`);
        const paidOnes = afterExit.filter(paid);
        for (const i of paidOnes) customer.push(`Invoice ${i.invoice_no} has already been paid, so we'll refund ${inr(total(i))} within ${AFTER_EXIT_REFUND_DAYS} business days of the credit note, to the bank account registered when you joined.`);
        internal.push(`Exit date ${nice(m.exit_date)} (members tab). Invoices after it, raised in error: ${afterExit.map(i => `${i.invoice_no} ${inr(total(i))} ${i.status}`).join('; ')}.`);
        actions.push(`Credit note${many ? 's' : ''} cancelling ${afterExit.map(i => i.invoice_no).join(', ')}`);
        if (paidOnes.length) actions.push(`Refund ${inr(paidOnes.reduce((s, i) => s + total(i), 0))} for paid invoices after exit`);
        afterExit.forEach(i => must.push(i.invoice_no));
        firstAmount(afterExit.reduce((s, i) => s + total(i), 0));
        fyiWhy.push('invoices raised after the exit date');
        flags.push('Billing error on our side: invoices raised after the exit date');
      } else {
        customer.push(`Our records show your membership ended on ${nice(m.exit_date)}, and no invoices were raised after that date.`);
      }
    } else {
      customer.push(`Our records show your membership as active, with no exit date on file, so our team will check this with your account manager and come back to you.`);
      internal.push(`The email says they have left, but ${m.member_id} is ${m.status} with no exit date: check with ${m.account_manager} before anything is cancelled.`);
      flags.push('Member says they left, but records show them as active');
      fyiWhy.push('the member says they have left');
    }
  }

  // ---- security deposit (§9, membership terms §8) ----
  if (topics.includes('deposit')) {
    const dep = Number(m.security_deposit_inr) || 0;
    if (exited && m.exit_date) {
      const due = addDays(m.exit_date, DEPOSIT_DAYS);
      if (now > due) {
        const late = daysBetween(due, now);
        customer.push(`Your security deposit refund of ${inr(dep)} was due by ${nice(due)} and is overdue, and we apologise. ${FINANCE}, our Finance Manager, is following it up personally and will confirm the refund date.`);
        internal.push(`Deposit ${inr(dep)}: refund was due ${nice(due)}, now ${late} day${late === 1 ? '' : 's'} overdue.`);
        flags.push(`Deposit refund ${late} day${late === 1 ? '' : 's'} overdue`);
        actions.push(`Refund deposit ${inr(dep)} (overdue since ${nice(due)})`);
        fyiWhy.push('an overdue deposit refund');
      } else {
        customer.push(`Your security deposit of ${inr(dep)} will be refunded by ${nice(due)}, 30 days after your exit date.`);
        actions.push(`Refund deposit ${inr(dep)} by ${nice(due)}`);
      }
      const unpaidBefore = mine.filter(i => !paid(i) && !afterExit.includes(i));
      internal.push(`Deductions to check before paying: unpaid invoices up to the exit: ${unpaidBefore.length ? unpaidBefore.map(i => `${i.invoice_no} ${inr(total(i))}`).join(', ') : 'none'}${afterExit.length ? ' (the invoices after the exit are cancelled, not deducted)' : ''}; unreturned access cards at ₹500 each: confirm with the centre manager; any damage.`);
      customer.push(`The refund goes only to the bank account registered when you joined, with an itemised statement of any deductions.`);
      must.push(fmt(dep));
      firstAmount(dep);
    } else {
      customer.push(`Your security deposit of ${inr(dep)} is refunded within 30 days of your exit date, after any deductions, to the bank account registered when you joined. It can't be adjusted against monthly invoices while your membership is active.`);
    }
  }

  // ---- GSTIN change (§2) ----
  if (topics.includes('gstin')) {
    const old = String(m.gstin || '');
    const found = (text.toUpperCase().match(/\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g) || []).filter(g => g !== old);
    const g = String(b.new_gstin || found[0] || '').toUpperCase().replace(/\s/g, '');
    const valid = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(g);
    const attached = Boolean(String(email.attachments || '').trim());
    const certMissing = !attached;
    const day = Number(now.slice(8, 10));
    const first = addMonths(now.slice(0, 7) + '-01', day <= CHANGE_CUTOFF_DAY ? 1 : 2);
    const cutoff = addMonths(first, -1).slice(0, 8) + String(CHANGE_CUTOFF_DAY);
    if (!g) {
      customer.push(`To change the GSTIN on your invoices, please send the new GSTIN with your GST registration certificate.`);
    } else if (!valid) {
      customer.push(`The GSTIN in your email, ${g}, doesn't look right: a GSTIN has 15 characters in a set pattern. Please check it and send it again with your GST registration certificate.`);
      flags.push('The new GSTIN is not in a valid format');
    } else if (g.slice(0, 2) !== '29') {
      customer.push(`The new GSTIN ${g} is registered outside Karnataka (state code ${g.slice(0, 2)}). Our services are supplied in Karnataka, so our invoices need a Karnataka (state code 29) GSTIN, and we can't put this one on them.`);
      flags.push('The new GSTIN is not a Karnataka registration');
    } else {
      customer.push(certMissing
        ? `${c.attachments_claimed_but_missing ? 'Your email mentions the GST registration certificate, but it wasn\'t attached.' : 'We need your new GST registration certificate to make the change.'} Please send it. If we have it by ${nice(cutoff)}, your ${monthName(first)} invoice and later ones will carry the new GSTIN ${g}.`
        : `Thank you for the certificate. Your ${monthName(first)} invoice and later ones will carry the new GSTIN ${g}.`);
      if (g.slice(2, 12) !== old.slice(2, 12)) {
        internal.push(`The PAN in the new GSTIN (${g.slice(2, 12)}) differs from the one on file (${old.slice(2, 12) || 'none'}): that is a different legal entity, so check with ${m.account_manager} before changing the billing name.`);
        flags.push('New GSTIN has a different PAN: a different legal entity');
      }
      internal.push(`GSTIN on file ${old || '(none)'}; new ${g}, Karnataka${g.slice(2, 12) === old.slice(2, 12) ? ', same PAN' : ''}. Certificate ${certMissing ? 'NOT attached' : 'attached: ' + email.attachments}. Changes received by the ${CHANGE_CUTOFF_DAY}th apply from the next invoice.`);
      actions.push(`Update GSTIN to ${g} from the ${monthName(first)} invoice${certMissing ? ' (once the certificate arrives)' : ''}`);
      must.push(g);
      // Issued invoices: correctable only within 30 days of the invoice date and in the same financial year.
      const asked = [...mentioned, ...byMonth.filter(i => !mentioned.includes(i))];
      const wantsReissue = /re-?issue|revis|correct|previous|past|earlier|old(er)? invoice/i.test(text);
      const consider = asked.length ? asked : wantsReissue ? mine.filter(i => daysBetween(i.invoice_date, now) <= 62) : [];
      const fixable = [];
      for (const i of consider) {
        use(i);
        const age = daysBetween(i.invoice_date, now);
        const sameFy = fy(i.invoice_date) === fy(now);
        if (age <= CORRECTION_DAYS && sameFy) {
          fixable.push(i);
          customer.push(`Invoice ${i.invoice_no} (${monthName(i.billing_period + '-01')}, dated ${nice(i.invoice_date)}) can be corrected because it is within 30 days of its date: we'll cancel it with a credit note and re-issue it with the new GSTIN${certMissing ? ' once we have the certificate' : ''}.`);
          must.push(i.invoice_no);
        } else {
          customer.push(`Invoice ${i.invoice_no} (${monthName(i.billing_period + '-01')}, dated ${nice(i.invoice_date)}) can't be changed: issued invoices can be corrected only within 30 days of the invoice date and in the same financial year, and this one is ${sameFy ? age + ' days old' : 'from an earlier financial year'}.`);
          internal.push(`${i.invoice_no} (${nice(i.invoice_date)}, ${age} days) is outside the correction window: the member keeps the old GSTIN on it.`);
          must.push(i.invoice_no);
        }
      }
      if (fixable.length) actions.push(`Credit note and re-issue ${fixable.map(i => i.invoice_no).join(', ')} with the new GSTIN`);
    }
  }

  // ---- TDS (§3) ----
  if (topics.includes('tds')) {
    const raw = String(b.tds_section || (text.match(/194\s*-?\s*[a-z]\b/i) || [''])[0]).toUpperCase().replace(/[^0-9A-Z]/g, '');
    const sec = raw ? (raw.startsWith('194') ? raw : '194' + raw) : '';
    const inv = mentioned[0] || latest;
    use(inv);
    if (sec && sec !== '194I') {
      customer.push(`We can't accept TDS under Section ${sec.slice(0, 3)}${sec.slice(3)} for seat fees.`);
      internal.push(`The member proposed Section ${sec}${(text.match(/(\d+(?:\.\d+)?)\s?%/) || [])[1] ? ' at ' + text.match(/(\d+(?:\.\d+)?)\s?%/)[1] + '%' : ''}: not accepted (billing policy §3).`);
    }
    customer.push(`Please deduct TDS under Section 194-I at 10% (rent for the use of a building), on the invoice amount before GST.`);
    if (inv) {
      const taxable = Number(inv.taxable_inr), tds = Math.round(taxable * TDS_RATE);
      customer.push(`For example, on invoice ${inv.invoice_no} (${monthName(inv.billing_period + '-01')}), the amount before GST is ${inr(taxable)}, so the TDS is ${inr(tds)}. The invoice total is ${inr(total(inv))} including GST of ${inr(Number(inv.gst_18_inr))}, so you would pay us ${inr(total(inv) - tds)}.`);
      must.push(fmt(tds));
      firstAmount(tds);
    }
    customer.push(`Please send us Form 16A every quarter, within 15 days of the TDS return due date. TDS that doesn't show in our Form 26AS by the following quarter is treated as an amount outstanding.`);
    must.push('194-I', '16A');
    actions.push('Confirm the TDS terms (194-I at 10%)');
  }

  // ---- invoice copies (§8) ----
  if (topics.includes('copy')) {
    const want = mentioned.length ? mentioned : byMonth.length ? byMonth : latest ? [latest] : [];
    const sender = String(email.from_address || '').trim().toLowerCase();
    const domain = sender.split('@')[1] || '';
    const src = String((input.identity || {}).source || '');
    const standIn = /^(tag|tester|assigned)/.test(src);
    const allowed = sender === String(m.contact_email || '').toLowerCase() || (domain && domain === String(m.email_domain || '').toLowerCase()) || standIn;
    if (!want.length) {
      customer.push(`We couldn't find that invoice on your account. Please tell us the invoice number or month.`);
    } else if (allowed) {
      for (const i of want) {
        use(i);
        customer.push(`A copy of invoice ${i.invoice_no} (${monthName(i.billing_period + '-01')}, ${inr(total(i))}) is attached. It ${paid(i) ? `was paid on ${nice(i.paid_on)}` : `is due by ${nice(i.due_date)}`}.`);
        attach.push(i.invoice_no);
        must.push(i.invoice_no);
      }
      customer.push(`Copies of all your invoices are also in the Launchpad member app.`);
      internal.push(`Sender ${sender} ${standIn ? `is a demo tester standing in for ${m.company} (${src})` : sender === String(m.contact_email).toLowerCase() ? 'is the billing contact' : 'is on the company domain ' + m.email_domain}, so a copy may be sent (billing policy §8).`);
      actions.push(`Send a copy of ${want.map(i => i.invoice_no).join(', ')}`);
    } else {
      customer.push(`For security, we send invoice copies only to your registered billing contact or to an address on your company's email domain, so we can't send it to this address. Please ask your billing contact, or write to us from your company email.`);
      internal.push(`Copy refused: ${sender} is neither the billing contact nor on ${m.email_domain} (billing policy §8).`);
      flags.push('Invoice copy requested from an address outside the member\'s domain');
      actions.push('No copy sent (sender not authorised)');
    }
  }

  // ---- bank details (§4) ----
  if (topics.includes('bank')) {
    customer.push(`We never change bank details on the strength of an email. To update the account we refund to, please send a signed letter on your letterhead with a cancelled cheque; we'll also confirm by calling a number we already hold for you.`);
    flags.push('The email asks to change bank details: no change by email');
    internal.push('Bank details change requested by email: not actioned (billing policy §4).');
  }

  // ---- payment status, late fees (§4, §5) ----
  if (topics.includes('payment') || topics.includes('general')) {
    const open = mine.filter(i => !paid(i) && !afterExit.includes(i));
    const lastPaid = mine.filter(paid).pop();
    if (!open.length && lastPaid) customer.push(`Our records show all your invoices are paid; the latest, ${lastPaid.invoice_no}, was paid on ${nice(lastPaid.paid_on)}.`);
    for (const i of open) {
      use(i);
      const over = daysBetween(i.due_date, now);
      customer.push(over > 0 ? `Invoice ${i.invoice_no} (${monthName(i.billing_period + '-01')}, ${inr(total(i))}) was due on ${nice(i.due_date)} and is ${over} day${over === 1 ? '' : 's'} overdue.` : `Invoice ${i.invoice_no} (${monthName(i.billing_period + '-01')}, ${inr(total(i))}) is due by ${nice(i.due_date)}.`);
      must.push(i.invoice_no);
      if (over > 0) {
        internal.push(`${i.invoice_no}: ${over} days overdue. Day 30 (formal reminder and suspension warning) ${nice(addDays(i.due_date, 30))}; day 45 (access cards suspended) ${nice(addDays(i.due_date, 45))}.`);
        if (over >= 20) customer.push(`If it is still unpaid on ${nice(addDays(i.due_date, 30))}, a formal reminder and suspension warning will be sent.`);
        firstAmount(total(i));
      }
    }
    if (open.some(i => daysBetween(i.due_date, now) > 0)) customer.push('A late fee of 1.5% a month applies to overdue amounts and is added to the next invoice.');
    if (/cheque|how (do|can|should) (we|i) pay|payment method|\bcard\b/i.test(text)) customer.push('Please pay by NEFT, RTGS, IMPS or UPI to the bank account printed on the invoice, quoting the invoice number. We don\'t accept cheques, and cards only for day passes and event bookings.');
    if (/waive|waiver/i.test(text)) {
      const yearAgo = addMonths(now, -12);
      const fees = mine.filter(i => Number(i.late_fee_inr) > 0 && i.invoice_date >= yearAgo);
      customer.push(`${FINANCE}, our Finance Manager, will review your request to waive the late fee. A waiver is possible once in 12 months, for members with a clean payment history.`);
      internal.push(`Waiver request: late fees in the last 12 months: ${fees.length ? fees.map(i => `${i.invoice_no} ${inr(Number(i.late_fee_inr))}${i.late_fee_note ? ' (' + i.late_fee_note + ')' : ''}`).join('; ') : 'none'}. ${fees.length > 1 ? 'Not a clean history: one waiver per 12 months at most.' : 'Check for a waiver already given this year.'}`);
      actions.push('Decide on the late-fee waiver');
    }
    if (topics.includes('general')) internal.push('No specific billing topic recognised: reply covers their invoice status; add anything else they asked.');
  }

  // ---- who ----
  if (c.churn_risk) fyiWhy.push('churn risk');
  const am = m.account_manager;
  const fyi = fyiWhy.length && am ? [am] : [];
  const priority = topics.includes('after_exit') || flags.some(f => /overdue|error/i.test(f)) || c.churn_risk ? 'high' : 'normal';
  const summary = `${topics.map(t => TOPIC_LABEL[t]).join(', ')}${mentioned.length ? ': ' + mentioned.map(i => i.invoice_no).join(', ') : ''}`;
  return {
    ok: true, topics, member_id: m.member_id, invoices: [...new Set([...mentioned.map(i => i.invoice_no), ...afterExit.map(i => i.invoice_no), ...used])],
    amount_inr: amount === null ? '' : amount, priority,
    customer_facts: customer, internal_facts: internal, must_mention: [...new Set(must)], flags, actions,
    attach_invoices: attach, fyi, fyi_emails: fyi.map(n => STAFF_EMAIL[n]).filter(Boolean), fyi_reason: [...new Set(fyiWhy)].join(', '),
    approver: FINANCE, approver_email: STAFF_EMAIL[FINANCE], reply_due: addBusinessDays(now, 1), summary,
  };
}

const TOPIC_LABEL = { after_exit: 'billed after exit', deposit: 'deposit refund', overage: 'meeting-room overage', gstin: 'GSTIN change',
  tds: 'TDS', copy: 'invoice copy', bank: 'bank details', payment: 'payment status', general: 'billing query' };

// Months named in the text, as 1-12. "May" counts only as "May invoice" or "May 2026".
function monthsIn(text) {
  const names = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const out = [];
  const re = /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b(\s+(?:invoice|20\d\d|'?\d\d\b))?/gi;
  let x;
  while ((x = re.exec(String(text || '')))) {
    const k = x[1].toLowerCase().slice(0, 3);
    if (k === 'may' && !x[2]) continue;
    const n = names.indexOf(k) + 1;
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}
function fy(s) { const y = Number(s.slice(0, 4)), mo = Number(s.slice(5, 7)); return mo >= 4 ? y : y - 1; }
function joinAnd(xs) { return xs.length <= 1 ? (xs[0] || '') : xs.slice(0, -1).join(', ') + ' and ' + xs[xs.length - 1]; }
function fmt(n) { return inr(n).replace('₹', ''); }

// Every rupee amount in the text must appear in allowedText; every mustMention
// string must appear in the text. Amounts are compared as digits, so ₹1,500,
// Rs 1500 and INR 1,500 all match.
function checkReply(text, allowedText, mustMention) {
  const t = String(text || '');
  const digits = s => s.replace(/[^\d]/g, '').replace(/^0+/, '');
  const find = s => (String(s).match(/(?:₹|\bRs\.?|\bINR)\s?\d[\d,]*/g) || []);
  const allowed = new Set(find(allowedText).map(digits));
  const amounts = find(t).map(x => x.replace(/\s/g, ''));
  const unknown = [...new Set(amounts.filter(a => !allowed.has(digits(a))))];
  const flat = t.toLowerCase().replace(/\s+/g, ' ');
  const missing = (mustMention || []).filter(s => !flat.includes(String(s).toLowerCase()));
  return { ok: Boolean(t.trim()) && !unknown.length && !missing.length, amounts, unknown, missing };
}

function demoLine(member) {
  if (!member) return '';
  const where = [CENTRE_NAMES[member.centre] || member.centre, member.space && member.space !== 'Open area' && member.space !== 'Virtual' ? member.space : ''].filter(Boolean).join(', ');
  return `Demo: you're writing as ${member.company} (${member.member_id}, ${where}).`;
}

// ---------------- date and money helpers (shared with change_rules.js) ----------------
function isoOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function d0(iso) { return new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); }
function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(s, n) { const d = d0(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
function lastDay(s) { const d = d0(s); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }
function addMonths(s, n) {
  const d = d0(s); const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  t.setUTCDate(Math.min(day, lastDay(iso(t))));
  return iso(t);
}
function daysBetween(a, b) { return Math.round((d0(b) - d0(a)) / 86400000); }
function addBusinessDays(s, n) {
  let d = s;
  while (n > 0) { d = addDays(d, 1); const w = d0(d).getUTCDay(); if (w !== 0 && w !== 6 && !FIXED_HOLIDAYS.includes(d.slice(5))) n--; }
  return d;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function nice(s) { if (!isoOk(s)) return String(s || ''); const d = d0(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function monthName(s) { const d = d0(s); return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function inr(n) {
  const neg = n < 0; const s = String(Math.round(Math.abs(n)));
  const out = s.length <= 3 ? s : s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  return (neg ? '-' : '') + '₹' + out;
}
