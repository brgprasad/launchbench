// Run the customer-billing rules locally against data/*.csv and the classifier
// output captured for seeds 11-15 (test-emails/billing-inputs.json), plus edge
// cases, and check each case's facts, actions and attachments.
//
//   node tools/test_billing_rules.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'billing_rules.js'), 'utf8'), ctx);
const planBilling = vm.runInContext('planBilling', ctx);
const checkReply = vm.runInContext('checkReply', ctx);

function csv(name) {
  const text = fs.readFileSync(path.join(ROOT, 'data', name), 'utf8').replace(/\r/g, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1);
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
const members = csv('members.csv');
const data = { invoices: csv('invoices.csv'), usage: csv('meeting_room_usage.csv') };
const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-emails', 'billing-inputs.json'), 'utf8'));
const member = id => members.find(m => m.member_id === id);

function seedEmail(id) {
  const f = fs.readdirSync(path.join(ROOT, 'test-emails')).find(n => n.startsWith(id + '-'));
  const t = fs.readFileSync(path.join(ROOT, 'test-emails', f), 'utf8');
  const body = t.split(/^---$/m).slice(2).join('---').trim();
  const from = (t.match(/^from: .*<([^>]+)>/m) || [])[1];
  return { subject: (t.match(/^subject: (.*)$/m) || [])[1], body, from_address: from, attachments: '' };
}
function seed(id, memberId, extra = {}) {
  const s = inputs[id];
  return { now: s.now, email: { ...seedEmail(id), ...(extra.email || {}) }, classifier: s.classifier, member: member(memberId),
    identity: { type: 'member', source: s.as_alias ? 'tag ' + s.as_alias : 'sender domain' }, ...extra.input };
}

let failures = 0;
function expect(name, cond, detail) {
  if (!cond) failures++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${cond ? '' : '  <-- ' + (detail || '')}`);
}
const all = r => r.customer_facts.join('\n');
function show(id, r) {
  console.log(`\n=== ${id}: ${r.summary} | topics ${r.topics.join(',')} | amount ${r.amount_inr} | priority ${r.priority}`);
  r.customer_facts.forEach(f => console.log('   C ' + f));
  r.internal_facts.forEach(f => console.log('   I ' + f));
  console.log('   actions: ' + r.actions.join(' | '));
  console.log('   must: ' + r.must_mention.join(', ') + (r.attach_invoices.length ? ' | attach: ' + r.attach_invoices.join(',') : '') + (r.fyi.length ? ` | FYI ${r.fyi} (${r.fyi_reason})` : '') + (r.flags.length ? ' | flags: ' + r.flags.join('; ') : ''));
}

// ---- seed 11: overage dispute ----
let r = planBilling(seed('11', 'M001'), data); show('11', r);
expect('topic overage', r.topics.includes('overage'));
expect('14 h x ₹800 = ₹11,200', /14 × ₹800 = ₹11,200/.test(all(r)));
expect('48 included, 62 used', /48 meeting-room credits.*used 62/.test(all(r)));
expect('no rollover', /don't roll over/.test(all(r)));
expect('held ₹13,216 incl GST', /₹13,216/.test(all(r)));
expect('pay ₹1,72,044 by 7 Nov', /₹1,72,044, by the due date, 7 Nov 2026/.test(all(r)));
expect('window open until 16 Nov', /open until 16 Nov 2026/.test(all(r)), all(r));
expect('booking log offered', /October 2026 booking log/.test(all(r)));
expect('record matches invoice', /matches the invoice line/.test(r.internal_facts.join(' ')));
expect('approver Lakshmi, no FYI', r.approver === 'Lakshmi Narayan' && !r.fyi.length);
expect('nothing attached', !r.attach_invoices.length);

// ---- seed 12: billed after exit + deposit ----
r = planBilling(seed('12', 'M024'), data); show('12', r);
expect('topics after_exit + deposit', r.topics.includes('after_exit') && r.topics.includes('deposit'));
expect('0424 and 0447 cancelled', /LB\/26-27\/0424 \(October 2026, ₹30,680\) and LB\/26-27\/0447 \(November 2026, ₹30,680\)/.test(all(r)) && /credit notes/.test(all(r)));
expect('nothing to refund (unpaid)', !/already been paid/.test(all(r)));
expect('deposit ₹26,000 overdue since 30 Oct', /₹26,000 was due by 30 Oct 2026 and is overdue/.test(all(r)));
expect('5 days overdue internally', /5 days overdue/.test(r.internal_facts.join(' ')));
expect('registered bank account', /registered when you joined/.test(all(r)));
expect('high priority, FYI Deepa', r.priority === 'high' && r.fyi[0] === 'Deepa Menon', r.fyi);
expect('no payment-status lines', !r.topics.includes('payment') && !/all your invoices are paid/.test(all(r)), r.topics);

// ---- seed 13: GSTIN change, certificate missing ----
r = planBilling(seed('13', 'M018'), data); show('13', r);
expect('topic gstin', r.topics.includes('gstin'));
expect('certificate asked for', /wasn't attached\. Please send it/.test(all(r)));
expect('from December 2026', /by 25 Nov 2026, your December 2026 invoice/.test(all(r)));
expect('0443 correctable', /LB\/26-27\/0443 .*can be corrected/.test(all(r)));
expect('0420 not correctable (33 days)', /LB\/26-27\/0420 .*can't be changed.*33 days old/.test(all(r)));
expect('same PAN noted', /same PAN/.test(r.internal_facts.join(' ')));
expect('new GSTIN must be mentioned', r.must_mention.includes('29AALCK9914T2Z4'));

// ---- seed 14: TDS under 194C ----
r = planBilling(seed('14', 'M016'), data); show('14', r);
expect('194C refused', /can't accept TDS under Section 194C/.test(all(r)));
expect('194-I at 10% before GST', /194-I at 10%.*before GST/.test(all(r)));
expect('₹64,600 -> ₹6,460', /₹64,600, so the TDS is ₹6,460/.test(all(r)));
expect('net ₹69,768', /₹69,768/.test(all(r)));
expect('Form 16A quarterly', /Form 16A every quarter/.test(all(r)));

// ---- seed 15: invoice copy (billing half) ----
r = planBilling(seed('15', 'M005'), data); show('15', r);
expect('topic copy only', r.topics.join() === 'copy', r.topics);
expect('October invoice 0407 attached', r.attach_invoices.join() === 'LB/26-27/0407');
expect('₹1,61,424 paid 6 Oct', /₹1,61,424\) is attached\. It was paid on 6 Oct 2026/.test(all(r)));

// ---- edge cases ----
r = planBilling({ ...seed('11', 'M001'), now: '2026-11-20T10:00:00+05:30' }, data); show('A overage after 15 days', r);
expect('window closed 16 Nov', /window closed on 16 Nov 2026/.test(all(r)) && !/on hold/.test(all(r)));

r = planBilling({ ...seed('13', 'M018', { email: { attachments: 'gst-certificate.pdf' } }), now: '2026-11-27T10:00:00+05:30' }, data); show('B GSTIN after the 25th, certificate attached', r);
expect('from January 2027', /Your January 2027 invoice and later ones/.test(all(r)));
expect('0443 still correctable (26 days)', /0443 .*can be corrected/.test(all(r)));

r = planBilling({ ...seed('15', 'M005', { email: { from_address: 'neha.kapoor@gmail.com' } }), identity: { type: 'member', source: 'email company' } }, data); show('C copy to an outside address', r);
expect('copy refused, nothing attached', /can't send it to this address/.test(all(r)) && !r.attach_invoices.length);

const paidAfterExit = { ...data, invoices: data.invoices.map(i => i.invoice_no === 'LB/26-27/0424' ? { ...i, status: 'Paid', paid_on: '2026-10-06' } : i) };
r = planBilling(seed('12', 'M024'), paidAfterExit); show('D paid invoice after exit', r);
expect('refund ₹30,680 in 10 business days', /0424 has already been paid, so we'll refund ₹30,680 within 10 business days/.test(all(r)));

r = planBilling(seed('13', 'M018', { email: { body: 'Our new GSTIN is 27AALCK9914T2Z4. Please update.' } }), { ...data });
r = planBilling({ ...seed('13', 'M018', { email: { body: 'Our new GSTIN is 27AALCK9914T2Z4. Please update.' } }), classifier: { ...inputs['13'].classifier, billing: { new_gstin: '27AALCK9914T2Z4' } } }, data); show('E GSTIN outside Karnataka', r);
expect('Maharashtra GSTIN refused', /outside Karnataka \(state code 27\)/.test(all(r)) && r.flags.length);

r = planBilling({ now: '2026-11-04T10:00:00+05:30', email: { subject: 'Still being billed', body: 'We vacated last month, why are we still being billed? Please cancel invoice LB/26-27/0426.', from_address: 'rahul@tiffinly.in' },
  classifier: { intents: [{ class: 'customer_billing', subclass: 'dispute', summary: 'Says they vacated and wants the invoice cancelled' }], billing: { invoice_numbers: ['LB/26-27/0426'] } }, member: member('M001'), identity: { source: 'email company' } }, data); show('F active member claims exit', r);
expect('records show active, nothing cancelled', /membership as active/.test(all(r)) && r.fyi[0] === 'Ananya Bose' && !r.actions.some(a => /Credit note/.test(a)));

r = planBilling(seed('11', 'M001', { email: { body: 'Please explain invoice LB/26-27/0447 and the meeting room overage.' } }), { ...data }); show("G another member's invoice", r);
expect("0447 not disclosed", /couldn't find invoice LB\/26-27\/0447/.test(all(r)) && !/Cartwheel|30,680/.test(all(r)));

r = planBilling({ now: '2026-11-03T10:00:00+05:30', email: { subject: 'Late fee', body: 'Sorry for the delay on October. Can you waive the late fee? How do we pay, can we send a cheque?', from_address: 'shruti@paysetu.in' },
  classifier: { intents: [{ class: 'customer_billing', subclass: 'payment_delay', summary: '' }], billing: {} }, member: member('M002'), identity: { source: 'email company' } }, data); show('H overdue + waiver + cheque', r);
expect('0404 27 days overdue', /0404 \(October 2026, ₹2,97,360\) was due on 7 Oct 2026 and is 27 days overdue/.test(all(r)));
expect('day-30 warning 6 Nov', /still unpaid on 6 Nov 2026/.test(all(r)));
expect('waiver to Lakshmi', /review your request to waive/.test(all(r)));
expect('no cheques', /don't accept cheques/.test(all(r)));

r = planBilling({ ...seed('14', 'M016'), classifier: { intents: [{ class: 'customer_billing', subclass: 'tds', summary: '' }], billing: { tds_section: '194-I' } } }, data); show('I TDS already under 194-I', r);
expect('no refusal line', !/can't accept/.test(all(r)));

// ---- reply check sanity ----
const s11 = planBilling(seed('11', 'M001'), data);
const good = checkReply('Hi Rahul, invoice LB/26-27/0426 has 14 hours at ₹800 = ₹11,200. Please pay ₹1,72,044 by 7 Nov.', s11.customer_facts.join('\n'), s11.must_mention);
const bad = checkReply('Hi Rahul, we will waive ₹5,000 of LB/26-27/0426.', s11.customer_facts.join('\n'), s11.must_mention);
expect('check passes a faithful reply', good.ok, JSON.stringify(good));
expect('check catches an invented amount and a missing figure', !bad.ok && bad.unknown.length && bad.missing.length, JSON.stringify(bad));

console.log(failures ? `\n${failures} CHECK(S) FAILED` : '\nALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
