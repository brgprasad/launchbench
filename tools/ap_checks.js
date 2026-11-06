// Launchbench accounts-payable checks (WF-4 "Check the invoice" Code node).
//
// Gemini only reads the PDF into fields; this code applies the rules in
// kb/08-vendors.md, decides the outcome and writes every message. The same
// text is pasted into n8n; tools/test_ap_checks.js runs it locally.
//
// checkInvoice(input, data) -> result
//   input: { email, classifier, identity, invoice, extraction_failed }
//     email:   { from_address, effective_from, tagged, subject, body, now, has_pdf }
//     invoice: Gemini's extraction of the PDF, or null when there is no PDF
//   data:  { vendors: [rows], ap_invoices: [rows], tickets: [rows] }

const OUR_GSTIN = '29AAFCL4821M1Z7';
const OUR_NAME = 'Launchbench Workspaces Pvt. Ltd.';
const FINANCE = { name: 'Lakshmi Narayan', email: 'teamlaunchbench+lb-lakshmi@gmail.com' };
const COO = { name: 'Meera Iyer', email: 'teamlaunchbench+lb-meera@gmail.com' };
const APPROVAL_LIMIT = 200000;
const FRAUD_LABELS = {
  bank_change_request: 'asks us to change the bank details on file',
  payment_to_new_account: 'asks us to pay into a new account',
  urgency_pressure: 'presses for urgent payment',
  new_contact_number: 'gives a new phone number to call instead of the one on file',
  lookalike_domain: 'comes from a look-alike domain',
  bank_mismatch: 'the bank account on the invoice differs from the account on file',
};

function checkInvoice(input, data) {
  const email = input.email || {};
  const cls = input.classifier || {};
  const inv = input.invoice || null;
  const today = String(email.now || '').slice(0, 10);
  const vendors = data.vendors || [];
  const ap = data.ap_invoices || [];
  const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const num = v => Number(String(v == null ? '' : v).replace(/[^0-9.\-]/g, '')) || 0;
  const checks = [];
  const add = (n, name, ok, detail) => checks.push({ n, name, ok, detail });

  // ---------- who is the vendor? ----------
  const byGstin = g => vendors.find(v => g && norm(v.gstin) === norm(g));
  const idVendor = input.identity && input.identity.vendor_id ? vendors.find(v => v.vendor_id === input.identity.vendor_id) : null;
  const clueGstin = (cls.identity_clues || {}).gstin;
  let vendor = (inv && byGstin(inv.vendor_gstin)) || idVendor || byGstin(clueGstin) || null;
  if (!vendor) {
    const words = String((inv && inv.vendor_name) || (cls.identity_clues || {}).company || '').toLowerCase().match(/[a-z]{5,}/g) || [];
    const hits = vendors.filter(v => words.length && words.some(w => v.vendor_name.toLowerCase().includes(w)));
    if (hits.length === 1) vendor = hits[0];
  }

  // ---------- fraud signals (override every other outcome) ----------
  const fraud = new Set((cls.fraud_signals || []).filter(f => FRAUD_LABELS[f]));
  const senderDomain = String(email.effective_from || email.from_address || '').split('@')[1] || '';
  if (vendor && email.tagged && senderDomain && senderDomain.toLowerCase() !== vendor.email_domain.toLowerCase()) {
    const root = vendor.email_domain.split('.')[0].toLowerCase();
    if (senderDomain.toLowerCase().includes(root) || editDistance(senderDomain.split('.')[0], root) <= 3) fraud.add('lookalike_domain');
  }
  const bankOnInvoice = inv ? String(inv.bank_account_last4 || '').replace(/\D/g, '').slice(-4) : '';
  if (inv && vendor && bankOnInvoice && bankOnInvoice !== String(vendor.bank_account_last4)) fraud.add('bank_mismatch');

  // ---------- the 7 checks (only when there is an invoice to check) ----------
  let outcome = '';
  const flags = [];
  let adhoc = null;
  if (inv) {
    // 1. Known vendor (and the sender's domain, when a persona tag sets the sender)
    const domainOk = !email.tagged || !vendor || senderDomain.toLowerCase() === vendor.email_domain.toLowerCase();
    add(1, 'Known vendor', Boolean(vendor) && domainOk,
      !vendor ? `GSTIN ${inv.vendor_gstin || '(none)'} is not in the vendor master`
        : domainOk ? `${vendor.vendor_id} ${vendor.vendor_name}, GSTIN matches${email.tagged ? ', sender domain matches' : ''}`
          : `sent from ${senderDomain}, but ${vendor.vendor_name} bills from ${vendor.email_domain}`);
    // 2. Addressed to us
    const toUs = norm(inv.bill_to_gstin) === OUR_GSTIN && /launchbench/i.test(inv.bill_to_name || '');
    add(2, 'Addressed to us', toUs, toUs ? `${OUR_NAME}, GSTIN ${OUR_GSTIN}` : `bill-to is "${inv.bill_to_name || '?'}", GSTIN ${inv.bill_to_gstin || '(none)'}; must be ${OUR_GSTIN}`);
    // 3. PO quoted
    const po = String(inv.po_number || '').trim();
    const poMissing = !po || /^[-—–\s]*$/.test(po) || /^n\/?a$/i.test(po);
    const poOk = vendor && !poMissing && norm(po) === norm(vendor.po_number);
    add(3, 'PO quoted', poOk, poMissing ? `no PO on the invoice; it should quote ${vendor ? vendor.po_number : 'our PO'}` : poOk ? po : `quotes ${po}; ours is ${vendor ? vendor.po_number : '(unknown vendor)'}`);
    // 4. Amount within range
    const taxable = num(inv.taxable_amount);
    let amountOk = true, amountDetail = inr(taxable);
    if (vendor) {
      const min = num(vendor.expected_min_inr), max = num(vendor.expected_max_inr);
      const range = min === max ? `${inr(min)} exactly` : `${inr(min)} – ${inr(max)}`;
      amountOk = taxable >= min && taxable <= max;
      if (amountOk) amountDetail = `${inr(taxable)}, expected ${range}`;
      else {
        const ref = taxable > max ? max : min;
        const pct = ((taxable - ref) / ref * 100).toFixed(1);
        amountDetail = `${inr(taxable)} vs expected ${taxable > max ? 'max' : 'min'} ${inr(ref)}, ${taxable > ref ? '+' : ''}${inr(taxable - ref).replace('₹-', '-₹')} (${taxable > ref ? '+' : ''}${pct}%)`;
        // Which single line explains it? Of the lines whose removal brings the
        // total into range, pick the one that leaves the amount closest to the
        // vendor's previous invoice (else the smallest: one-off extras usually are).
        const lines = (inv.line_items || []).map((l, i) => ({ i: i + 1, d: l.description, a: num(l.amount) }));
        const prev = vendor ? ap.filter(r => r.vendor_id === vendor.vendor_id && num(r.taxable_amount)).slice(-1)[0] : null;
        const prevAmt = prev ? num(prev.taxable_amount) : 0;
        const hit = lines.filter(l => taxable - l.a >= min && taxable - l.a <= max)
          .sort((x, y) => prevAmt ? Math.abs(taxable - x.a - prevAmt) - Math.abs(taxable - y.a - prevAmt) : x.a - y.a)[0];
        if (hit) adhoc = hit;
        const sameAsLast = hit && prev && taxable - hit.a === prevAmt;
        flags.push(`Amount ${amountDetail}${hit ? `. Line ${hit.i}, "${hit.d}" (${inr(hit.a)}), looks like ad-hoc work: without it the invoice is ${inr(taxable - hit.a)}${sameAsLast ? `, the same as last invoice ${prev.invoice_no}` : ', within range'}. Ad-hoc work needs its own PO` : ''}`);
      }
    }
    add(4, 'Amount within range', amountOk, amountDetail);
    // 5. GST arithmetic (CGST 9% + SGST 9%, or IGST 18%), to within ₹1
    const tax = num(inv.cgst) + num(inv.sgst) + num(inv.igst);
    const total = num(inv.total_amount);
    const gstOk = Math.abs(tax - taxable * 0.18) <= 1 && Math.abs(total - taxable * 1.18) <= 1;
    add(5, 'GST arithmetic', gstOk, `${inr(taxable)} + GST ${inr2(tax)} = ${inr2(total)}${gstOk ? '' : `; expected ${inr2(taxable * 1.18)}`}`);
    // 6. Not a duplicate
    const dup = vendor && ap.find(r => r.vendor_id === vendor.vendor_id && norm(r.invoice_no) === norm(inv.invoice_no));
    add(6, 'Not a duplicate', !dup, dup ? `${inv.invoice_no} was already received on ${dup.received_at} (${dup.validation_status})` : `${inv.invoice_no} is new`);
    // 7. Billing period
    const months = periodMonths(inv.billing_period);
    const thisMonth = today.slice(0, 7);
    let periodOk = true, periodDetail = inv.billing_period || '(none)';
    if (!months.length) { periodOk = false; periodDetail = `can't read the billing period "${inv.billing_period || ''}"`; }
    else if (months[0] > thisMonth) { periodOk = false; periodDetail = `${inv.billing_period} is in the future`; }
    else if (vendor) {
      const prior = ap.find(r => r.vendor_id === vendor.vendor_id && norm(r.invoice_no) !== norm(inv.invoice_no)
        && periodMonths(r.billing_period).some(m => months.includes(m)));
      if (prior) { periodOk = false; periodDetail = `${inv.billing_period} was already billed on ${prior.invoice_no}`; }
    }
    add(7, 'Billing period', periodOk, periodDetail);
    if (!periodOk) flags.push(`Billing period: ${periodDetail}`);

    // ---------- decide ----------
    if (fraud.size) outcome = 'SUSPECTED_FRAUD';
    else if (dup) outcome = 'DUPLICATE';
    else if (!vendor) outcome = 'HOLD_UNKNOWN_VENDOR';
    else if (!toUs || (!poMissing && !poOk) || !gstOk) outcome = 'RETURN';
    else if (poMissing) outcome = 'HOLD_NO_PO';
    else if (!amountOk || !periodOk || !domainOk) outcome = 'FLAG';
    else outcome = 'PASS';
  } else if (fraud.size) outcome = 'SUSPECTED_FRAUD';
  else if (input.extraction_failed) outcome = 'HOLD_UNREADABLE';
  else if (cls.attachments_claimed_but_missing) outcome = 'HOLD_NO_ATTACHMENT';
  else outcome = 'QUERY';

  // ---------- approvers and payment run ----------
  const taxable = inv ? num(inv.taxable_amount) : 0;
  const approvers = taxable > APPROVAL_LIMIT ? [FINANCE, COO] : [FINANCE];
  const run = ['PASS', 'FLAG'].includes(outcome) ? paymentRun(today) : '';
  const invNo = inv ? inv.invoice_no : '';
  const vName = vendor ? vendor.vendor_name : (inv && inv.vendor_name) || (cls.identity_clues || {}).company || 'Unknown sender';

  // Context for Finance: recent complaints in this vendor's area.
  let tickets = [];
  if (vendor && outcome === 'FLAG') {
    const word = vendor.category.split(/\s/)[0].toLowerCase();
    tickets = (data.tickets || []).filter(t => String(t.category).toLowerCase().includes(word)).slice(-5);
  }

  // ---------- messages (written by code) ----------
  const STATUS = {
    PASS: 'Pending approval', FLAG: 'Flagged - pending review', HOLD_NO_PO: 'On hold - missing PO',
    HOLD_UNKNOWN_VENDOR: 'On hold - unknown vendor', RETURN: 'Returned to vendor', DUPLICATE: 'Rejected - duplicate',
    SUSPECTED_FRAUD: 'Suspected fraud - payment held', HOLD_UNREADABLE: 'On hold - PDF unreadable',
    HOLD_NO_ATTACHMENT: 'On hold - invoice not attached', QUERY: 'Query',
  };
  const fraudList = [...fraud].map(f => FRAUD_LABELS[f] + (f === 'bank_mismatch' ? ` (invoice: ending ${bankOnInvoice}; on file: ending ${vendor.bank_account_last4})` : f === 'lookalike_domain' ? ` (${senderDomain}; the vendor's is ${vendor ? vendor.email_domain : '?'})` : ''));
  const referenced = [...new Set([invNo, ...((cls.identity_clues || {}).invoice_numbers || []), ...((cls.billing || {}).invoice_numbers || [])].filter(Boolean))];
  const result = {
    outcome, status: STATUS[outcome], vendor_id: vendor ? vendor.vendor_id : '', vendor_name: vName,
    checks, flags, fraud: [...fraud], fraud_text: fraudList, adhoc_line: adhoc, approvers: approvers.map(a => a.name),
    payment_run: run, invoice_no: invNo, referenced_invoices: referenced, tickets,
    path: outcome === 'SUSPECTED_FRAUD' ? 'fraud' : ['PASS', 'FLAG', 'HOLD_UNKNOWN_VENDOR', 'HOLD_UNREADABLE'].includes(outcome) ? 'notice' : 'reply',
  };

  const sign = '\n\nRegards,\nAccounts Payable\nLaunchbench Workspaces Pvt. Ltd.';
  const hello = `Dear ${vName} team,\n\n`;
  if (outcome === 'HOLD_NO_PO') result.vendor_reply = `${hello}Thank you for invoice ${invNo}. We can't process it yet because it doesn't quote our purchase order. Please re-issue the invoice quoting PO ${vendor.po_number} and send it to this address.${sign}`;
  if (outcome === 'RETURN') result.vendor_reply = `${hello}Thank you for invoice ${invNo}. We are returning it for correction:\n${checks.filter(c => !c.ok && [2, 3, 5].includes(c.n)).map(c => `- ${c.name}: ${c.detail}`).join('\n')}\n\nPlease send a corrected invoice to this address.${sign}`;
  if (outcome === 'DUPLICATE') { const d = ap.find(r => r.vendor_id === vendor.vendor_id && norm(r.invoice_no) === norm(invNo)); result.vendor_reply = `${hello}Thank you for invoice ${invNo}. We already received it on ${niceDate(d.received_at)}, so there is nothing more you need to send. Its current status is: ${d.validation_status}${d.scheduled_payment_run ? `, payment run ${niceDate(d.scheduled_payment_run)}` : ''}.${sign}`; }
  if (outcome === 'HOLD_NO_ATTACHMENT') result.vendor_reply = `${hello}Thank you for your email. The invoice it mentions was not attached. Please send it again with the PDF attached.${sign}`;
  if (outcome === 'QUERY') {
    const found = referenced.map(n => ap.find(r => norm(r.invoice_no) === norm(n))).filter(Boolean);
    if (!vendor && !found.length) result.vendor_reply = `Dear ${vName},\n\nThank you for your email. We couldn't match it to an approved supplier or an invoice on our records. Could you tell us your company name, GSTIN and the invoice number concerned?${sign}`;
    else if (!found.length) result.vendor_reply = `${hello}Thank you for your email. We couldn't find ${referenced.length ? `invoice ${referenced.join(', ')}` : 'the invoice you mention'} in our records. Could you send us a copy so we can look into it?${sign}`;
    else result.vendor_reply = hello + found.map(r => {
      const runDate = r.scheduled_payment_run;
      const paid = runDate && runDate < today;
      return `Invoice ${r.invoice_no} (${inr(num(r.total_amount))} including GST) is ${String(r.validation_status).toLowerCase()}${runDate ? ` and was scheduled for our payment run on ${niceDate(runDate)}` : ''}.${paid ? ` As it hasn't reached your account, our Finance Manager will check the transfer with our bank and confirm the payment details to you.` : runDate ? '' : ' We will confirm the payment date once it is approved.'}`;
    }).join('\n\n') + sign;
  }

  result.subject = {
    fraud: `URGENT: suspected payment fraud - ${vName}${referenced.length ? ' - ' + referenced.join(', ') : ''}`,
    notice: `${outcome === 'PASS' ? 'Invoice ready for approval' : outcome === 'FLAG' ? 'Invoice flagged for review' : 'Invoice on hold'}: ${vName}${invNo ? ' ' + invNo : ''}${inv ? ` (${inr(taxable)} + GST)` : ''}`,
    reply: `Approve reply to ${vName}${invNo ? ' about ' + invNo : ''} (${STATUS[outcome].toLowerCase()})`,
  }[result.path];
  result.to = result.path === 'fraud' ? [FINANCE, COO] : result.path === 'notice' ? approvers : [FINANCE];
  result.to_emails = result.to.map(p => p.email).join(', ');
  result.html = html();
  return result;

  // ---------- helpers ----------
  function html() {
    const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const box = 'white-space:pre-wrap;text-align:left;padding:10px 14px;border-radius:6px;';
    const banner = (bg, t) => `<p style="padding:10px 14px;border-radius:6px;background:${bg}">${t}</p>`;
    let h = '<div style="text-align:left">';
    if (outcome === 'SUSPECTED_FRAUD') {
      h += banner('#FDECEA', `<b>Suspected fraud: do not reply, do not change any bank details, and hold payment${referenced.length ? ` of ${esc(referenced.join(', '))}` : ''}.</b>`);
      h += `<p>This email to Accounts Payable ${fraudList.length > 1 ? 'shows these warning signs' : 'shows this warning sign'}:</p><ul>${fraudList.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`;
      if (vendor) h += `<p><b>Next step:</b> call ${esc(vendor.vendor_name)} on the number in our vendor master, <b>${esc(vendor.phone_on_file)}</b>. Never use a number given in the email. A real bank change needs a signed request on letterhead and a cancelled cheque.</p>`;
      else h += '<p><b>Next step:</b> the sender does not match any approved vendor. Do not engage; forward to IT security.</p>';
    } else if (result.path === 'notice') {
      h += banner(outcome === 'PASS' ? '#E3F1E7' : '#FFF4D6', outcome === 'PASS' ? '<b>All 7 checks passed.</b> Ready for approval.' : `<b>${esc(STATUS[outcome])}.</b> ${esc(flags[0] || (outcome === 'HOLD_UNKNOWN_VENDOR' ? 'The sender is not an approved vendor: find out who at Launchbench engaged them.' : 'The PDF could not be read.'))}`);
    } else {
      h += banner('#FFF4D6', `<b>${esc(STATUS[outcome])}.</b> The reply below goes to the vendor when you approve it.`);
    }
    if (inv) {
      h += `<table cellpadding="4" style="border-collapse:collapse;text-align:left">`
        + [['Vendor', `${esc(vName)}${vendor ? ` (${vendor.vendor_id})` : ''}`], ['Invoice', `${esc(invNo)}, dated ${esc(inv.invoice_date)}, period ${esc(inv.billing_period)}`],
          ['PO', esc(inv.po_number || '(none)')], ['Amount', `${inr(taxable)} + GST ${inr2(num(inv.cgst) + num(inv.sgst) + num(inv.igst))} = <b>${inr2(num(inv.total_amount))}</b>`],
          ...(run ? [['Payment run', `${niceDate(run)} (Net 30 from receipt)`]] : []), ['Approval', approvers.map(a => a.name).join(' and ')]]
          .map(r => `<tr><td style="color:#666;vertical-align:top">${r[0]}</td><td>${r[1]}</td></tr>`).join('') + '</table>';
      h += `<p><b>Checks</b></p><table cellpadding="3" style="border-collapse:collapse;text-align:left">${checks.map(c => `<tr><td>${c.ok ? '✅' : '❌'}</td><td>${c.n}. ${esc(c.name)}</td><td style="color:#555">${esc(c.detail)}</td></tr>`).join('')}</table>`;
      if (flags.length > 1) h += `<ul>${flags.slice(1).map(f => `<li>${esc(f)}</li>`).join('')}</ul>`;
      h += '{{PDF_LINK}}';
    }
    if (tickets.length) h += `<p><b>Context:</b> recent ${esc(vendor.category.toLowerCase())} complaints from members, worth weighing before paying any extra charge:</p><ul>${tickets.map(t => `<li>${esc(t.ticket_id)} (${esc(t.company)}, ${esc(t.centre)} ${esc(t.location)}, ${esc(String(t.received_at).slice(0, 10))}): ${esc(t.description)}</li>`).join('')}</ul>`;
    if (result.vendor_reply) h += `<p><b>Reply to ${esc(email.reply_to || email.from_address)}</b> (sent when you approve):</p><div style="${box}border-left:3px solid #F26B1D;border-radius:0">${esc(result.vendor_reply)}</div>`;
    h += `<p><b>Their email</b>, received ${esc(String(email.now || '').replace('T', ' ').slice(0, 16))} IST from ${esc(email.from_address)}${email.tagged && email.effective_from && email.effective_from !== email.from_address ? ` (as ${esc(email.effective_from)})` : ''}:</p><div style="${box}background:#F6F1E9"><b>Subject:</b> ${esc(email.subject || '')}\n\n${esc(email.body || '')}</div>`;
    return h + '</div>';
  }
  function inr(n) {
    const neg = n < 0; const s = String(Math.round(Math.abs(n)));
    const out = s.length <= 3 ? s : s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
    return (neg ? '-' : '') + '₹' + out;
  }
  function inr2(n) { const r = Math.round(n * 100) / 100; return Number.isInteger(r) ? inr(r) : inr(Math.floor(r)) + '.' + String(Math.round((r % 1) * 100)).padStart(2, '0'); }
  function niceDate(iso) {
    const d = new Date(String(iso).slice(0, 10) + 'T00:00:00Z');
    return isNaN(d) ? String(iso) : `${d.getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  }
  // The latest payment run (10th or 25th) on or before Net 30 from receipt.
  function paymentRun(received) {
    const due = new Date(received + 'T00:00:00Z'); due.setUTCDate(due.getUTCDate() + 30);
    const runs = [];
    for (let m = -1; m <= 2; m++) for (const day of [10, 25]) {
      const d = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + m, day));
      if (d <= due && d.toISOString().slice(0, 10) >= received) runs.push(d);
    }
    runs.sort((a, b) => b - a);
    return runs.length ? runs[0].toISOString().slice(0, 10) : '';
  }
  // "October 2026", "Oct 2026", "Oct-Dec 2026", "2026-10" -> ["2026-10", ...]
  function periodMonths(p) {
    const M = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const s = String(p || '').toLowerCase();
    let m = s.match(/^(\d{4})-(\d{2})/);
    if (m) return [`${m[1]}-${m[2]}`];
    m = s.match(/([a-z]{3})[a-z]*\s*(?:[-–to]+\s*([a-z]{3})[a-z]*)?\s*(\d{4})/);
    if (!m) return [];
    const a = M.indexOf(m[1]), b = m[2] ? M.indexOf(m[2]) : a, y = Number(m[3]);
    if (a < 0 || b < 0) return [];
    const out = [];
    for (let i = a; i <= (b >= a ? b : b + 12); i++) out.push(`${y + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}`);
    return out;
  }
  function editDistance(a, b) {
    a = String(a).toLowerCase(); b = String(b).toLowerCase();
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }
}
