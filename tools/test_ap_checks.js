// Run the accounts-payable checks locally against data/*.csv and the vendor
// seed emails (18-21, 28, 33), and check each seed's expected outcome.
//
//   node tools/test_ap_checks.js
//
// Inputs: test-emails/ap-checks-inputs.json (classifier output captured from
// triage_log) plus the invoice fields below, transcribed from the test PDFs as
// Gemini's extraction should return them.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'ap_checks.js'), 'utf8'), ctx);

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
const data = { vendors: csv('vendors.csv'), ap_invoices: csv('ap_invoices.csv'), tickets: csv('tickets.csv') };
const personas = csv('personas.csv');

const bill = { bill_to_name: 'Launchbench Workspaces Pvt. Ltd.', bill_to_gstin: '29AAFCL4821M1Z7' };
const INVOICES = {
  '18': { vendor_name: 'AirLink Fibernet Pvt. Ltd.', vendor_gstin: '29AAGCA5520K1ZQ', ...bill, invoice_no: 'ALF/2026/11/0912', invoice_date: '2026-11-01', billing_period: 'November 2026', po_number: 'LB-PO-2026-009', taxable_amount: 185000, cgst: 16650, sgst: 16650, igst: 0, total_amount: 218300, bank_account_last4: '9082',
    line_items: [1, 2, 3, 4, 5].map(i => ({ description: `1 Gbps leased line ${i}`, amount: 37000 })) },
  '19': { vendor_name: 'SparkleServ Facility Services Pvt. Ltd.', vendor_gstin: '29AAKCS7731P1Z2', ...bill, invoice_no: 'SS/26-27/0611', invoice_date: '2026-11-02', billing_period: 'October 2026', po_number: 'LB-PO-2026-014', taxable_amount: 445000, cgst: 40050, sgst: 40050, igst: 0, total_amount: 525100, bank_account_last4: '4417',
    line_items: [['Housekeeping services - Koramangala (14 staff)', 78500], ['Housekeeping services - Indiranagar (11 staff)', 62000], ['Housekeeping services - HSR Layout (12 staff)', 68000], ['Housekeeping services - Whitefield (16 staff)', 90000], ['Housekeeping services - Hebbal (11 staff)', 64000], ['Festival deep-cleaning (Deepavali) - all 5 centres, incl. facade & carpet shampoo', 82500]].map(([description, amount]) => ({ description, amount })) },
  '20': { vendor_name: 'BeanBox Pantry Supplies LLP', vendor_gstin: '29AARFB9042H1Z5', ...bill, invoice_no: 'BBX/1964', invoice_date: '2026-11-02', billing_period: 'October 2026', po_number: '—', taxable_amount: 122780, cgst: 11050.2, sgst: 11050.2, igst: 0, total_amount: 144880, bank_account_last4: '7720',
    line_items: [['Coffee beans', 52000], ['Assorted tea', 24800], ['Milk, oat milk & sugar', 21480], ['Biscuits & snacks', 18600], ['Paper cups', 5900]].map(([description, amount]) => ({ description, amount })) },
  '28': { vendor_name: 'Guardian Shield Security Services', vendor_gstin: '29AAHFG3318R1Z9', ...bill, invoice_no: 'GSS-2026-1121', invoice_date: '2026-11-03', billing_period: 'October 2026', po_number: 'LB-PO-2026-017', taxable_amount: 224000, cgst: 20160, sgst: 20160, igst: 0, total_amount: 264320, bank_account_last4: '8851',
    line_items: [48000, 40000, 42000, 52000, 42000].map((amount, i) => ({ description: `Manned guarding ${i + 1}`, amount })) },
};

const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-emails', 'ap-checks-inputs.json'), 'utf8'));
const out = {};
for (const id of Object.keys(inputs).sort()) {
  const x = inputs[id];
  const persona = personas.find(p => p.alias === x.as_alias);
  const fromAddr = (String(x.from).match(/<([^>]+)>/) || [])[1] || x.from;
  out[id] = vm.runInContext('checkInvoice', ctx)({
    email: { from_address: fromAddr, effective_from: persona ? persona.as_email : fromAddr, tagged: Boolean(persona), subject: x.subject, body: '', now: x.now, reply_to: 'teamlaunchbench+lb-testrun@gmail.com' },
    classifier: x.classifier,
    identity: persona ? { type: persona.type, vendor_id: persona.type === 'member' ? '' : persona.ref_id } : { type: 'prospect' },
    invoice: INVOICES[id] || null,
  }, data);
}

const fails = [];
const check = (id, cond, msg) => { if (!cond) fails.push(`${id}: ${msg}`); };
const r = id => out[id];
check('18', r('18').outcome === 'PASS' && r('18').checks.every(c => c.ok), `PASS with all 7 checks, got ${r('18').outcome}`);
check('18', r('18').payment_run === '2026-11-25' && r('18').approvers.join() === 'Lakshmi Narayan', `run 25 Nov, Lakshmi alone; got ${r('18').payment_run} / ${r('18').approvers}`);
check('19', r('19').outcome === 'FLAG' && /\+₹65,000 \(\+17\.1%\)/.test(r('19').flags[0]), `FLAG +₹65,000 (+17.1%), got ${r('19').outcome}: ${r('19').flags[0]}`);
check('19', r('19').adhoc_line && r('19').adhoc_line.i === 6 && /₹3,62,500/.test(r('19').flags[0]), 'line 6 deep-cleaning identified, ₹3,62,500 without it');
check('19', r('19').approvers.length === 2 && r('19').tickets.some(t => t.ticket_id === 'T-1047'), 'Lakshmi + Meera; housekeeping tickets T-1031/T-1047 as context');
check('20', r('20').outcome === 'HOLD_NO_PO' && /LB-PO-2026-021/.test(r('20').vendor_reply || ''), `HOLD asking for PO LB-PO-2026-021, got ${r('20').outcome}`);
check('21', r('21').outcome === 'SUSPECTED_FRAUD' && r('21').path === 'fraud' && !r('21').vendor_reply, `fraud, no reply; got ${r('21').outcome}`);
check('21', r('21').fraud.includes('lookalike_domain') && /\+91 80 0000 1101/.test(r('21').html) && /SS\/26-27\/0611/.test(r('21').html), 'look-alike domain, call-back number, hold SS/26-27/0611');
check('28', r('28').outcome === 'SUSPECTED_FRAUD' && r('28').checks.every(c => c.ok) && r('28').fraud.join() === 'bank_mismatch', `all checks pass but bank mismatch -> fraud; got ${r('28').outcome} ${r('28').fraud}`);
check('28', /ending 8851.*ending 3356/.test(r('28').fraud_text[0]) && /\+91 80 0000 1103/.test(r('28').html), 'bank 8851 vs 3356, call-back +91 80 0000 1103');
check('33', r('33').outcome === 'QUERY' && r('33').fraud.length === 0 && /GSS-2026-1093.*25 Oct 2026/s.test(r('33').vendor_reply || ''), `payment-status reply for GSS-2026-1093, no fraud; got ${r('33').outcome}`);

for (const [id, x] of Object.entries(out)) {
  console.log(`\n== ${id}  ${x.outcome}  (${x.status})  path=${x.path}  to=${x.to_emails}  run=${x.payment_run || '-'}`);
  console.log(`   subject: ${x.subject}`);
  for (const c of x.checks) console.log(`   ${c.ok ? 'ok ' : 'NO '} ${c.n}. ${c.name}: ${c.detail}`);
  for (const f of x.flags) console.log(`   flag: ${f}`);
  for (const f of x.fraud_text) console.log(`   FRAUD: ${f}`);
  if (x.vendor_reply) console.log('   reply: ' + x.vendor_reply.replace(/\n/g, '\n          '));
}
console.log(fails.length ? `\n${fails.length} CHECK(S) FAILED\n` + fails.join('\n') : '\nALL CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
