// Run the facility-ticket rules locally against data/*.csv and the classifier
// output captured for seeds 07-10, 15, 30, 31 (test-emails/facility-inputs.json),
// and check each seed's expected priority, owner and escalation.
//
//   node tools/test_facility_rules.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'facility_rules.js'), 'utf8'), ctx);
const planTicket = vm.runInContext('planTicket', ctx);

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
const personas = csv('personas.csv');
// The pending SparkleServ invoice that WF-4 logs for seed 19.
const ap = [...csv('ap_invoices.csv'), { vendor_id: 'V01', invoice_no: 'SS/26-27/0611', total_amount: '525100', validation_status: 'Flagged', received_at: '2026-11-02' }];
const data = { tickets: csv('tickets.csv'), vendors: csv('vendors.csv'), ap_invoices: ap };
const inputs = JSON.parse(fs.readFileSync(path.join(ROOT, 'test-emails', 'facility-inputs.json'), 'utf8'));
const seedBody = id => {
  const f = fs.readdirSync(path.join(ROOT, 'test-emails')).find(n => n.startsWith(id + '-'));
  const md = fs.readFileSync(path.join(ROOT, 'test-emails', f), 'utf8');
  return md.split(/\n---\n/)[1].trim();
};
// Who WF-0 resolves each seed to (persona tag from the sender, else cabin + centre clue).
const memberFor = (id, x) => {
  const addr = (String(x.from).match(/<([^>]+)>/) || [])[1];
  const p = personas.find(p => p.as_email === addr && p.type === 'member');
  if (p) return members.find(m => m.member_id === p.ref_id);
  const cl = x.classifier.identity_clues || {};
  const hits = members.filter(m => cl.cabin && cl.centre && m.centre === cl.centre && m.space.replace(/\s/g, '').toLowerCase().includes(cl.cabin.replace(/cabin|\s/gi, '').toLowerCase()));
  return hits.length === 1 ? hits[0] : null;
};

const out = {};
let n = 2100;
for (const id of Object.keys(inputs).sort()) {
  const x = inputs[id];
  out[id] = planTicket({ ticket_id: 'T-' + (n++), email: { subject: x.subject, body: seedBody(id), now: x.now }, now: x.now, classifier: x.classifier, member: memberFor(id, x) }, data);
}

const fails = [];
const check = (id, cond, msg) => { if (!cond) fails.push(`${id}: ${msg}`); };
const t = id => out[id];
check('07', t('07').priority === 'P1' && t('07').base_priority === 'P2' && t('07').overdue, `P2 raised to P1 as overdue; got ${t('07').base_priority}->${t('07').priority}`);
check('07', t('07').escalated_to === 'Kavya Reddy' && t('07').cc.includes('Sneha Pillai') && t('07').cc.includes('Deepa Menon'), `Kavya, cc Sneha + Deepa; got ${t('07').to} cc ${t('07').cc}`);
check('07', t('07').customer_facts.some(f => /may be eligible for a service credit/.test(f)) && t('07').customer_facts.some(f => /meeting room/.test(f)), 'credit wording and workaround');
check('08', t('08').priority === 'P1' && t('08').owner === "Rohan D'Souza" && t('08').linked.includes('T-1052'), `P1 floor outage, Rohan, linked T-1052; got ${t('08').priority} ${t('08').owner} ${t('08').linked}`);
check('08', t('08').resolution_due === '2026-11-03 14:31', `fix by 2:31 pm; got ${t('08').resolution_due}`);
check('09', t('09').priority === 'P3' && t('09').owner === 'Aditya Kulkarni' && t('09').unconfirmed_repeat, `P3, Aditya, unconfirmed repeat noted; got ${t('09').priority} ${t('09').owner}`);
check('09', t('09').resolution_due === '2026-11-06 18:47' && t('09').customer_facts.some(f => /spare chairs/.test(f)), `3 business days -> 6 Nov 6:47 pm, spare chairs; got ${t('09').resolution_due}`);
check('10', t('10').priority === 'P2' && t('10').report_count === 3 && t('10').stage === 2, `P3 raised to P2, 3rd report, stage 2; got ${t('10').priority} ${t('10').report_count} ${t('10').stage}`);
check('10', t('10').internal_facts.some(f => /SS\/26-27\/0611/.test(f)) && t('10').internal_facts.some(f => /Churn risk/.test(f)), 'SparkleServ invoice and churn note');
check('10', !t('10').customer_facts.some(f => /lock-in|exit/i.test(f)) && t('10').customer_facts.some(f => /will call you/.test(f)), 'no lock-in talk; Kavya will call');
check('15', t('15').priority === 'P2' && t('15').owner === 'Imran Qureshi' && t('15').stage === 1, `P2, Imran, no escalation; got ${t('15').priority} ${t('15').owner} ${t('15').stage}`);
// The classifier sometimes marks "keeps dropping for the last 2 days" as reported before;
// the email never says so, so it must stay P2 (not overdue).
const x15 = JSON.parse(JSON.stringify(inputs['15']));
x15.classifier.issue = { ...(x15.classifier.issue || {}), repeat_claimed: true, since: '2026-11-01' };
const t15b = planTicket({ ticket_id: 'T-2999', email: { subject: x15.subject, body: seedBody('15'), now: x15.now }, now: x15.now, classifier: x15.classifier, member: memberFor('15', x15) }, data);
check('15b', t15b.priority === 'P2' && !t15b.overdue, `AI says reported before, the email doesn't: stays P2; got ${t15b.priority}`);
check('30', t('30').owner === 'Kavya Reddy' && t('30').customer_facts.some(f => /which centre/.test(f)), `no member: Kavya, asks for centre; got ${t('30').owner}`);
check('31', t('31').priority === 'P2' && t('31').owner === "Rohan D'Souza" && t('31').row.member_id === 'M001', `P2 KOR Cabin 2A (Tiffinly), Rohan; got ${t('31').priority} ${t('31').owner} ${t('31').row.member_id}`);

for (const [id, x] of Object.entries(out)) {
  console.log(`\n== ${id} ${x.ticket_id} ${x.priority} (rules ${x.base_priority}, AI ${x.ai_priority}) ${x.category} @ ${x.location} | owner ${x.owner} | stage ${x.stage} -> to ${x.to} cc ${x.cc} | fix by ${x.fix_by}`);
  console.log('   subject: ' + x.staff_subject);
  for (const f of x.customer_facts) console.log('   C: ' + f);
  for (const f of x.internal_facts) console.log('   I: ' + f);
  console.log('   must mention: ' + x.must_mention.join(' | '));
}
console.log(fails.length ? `\n${fails.length} CHECK(S) FAILED\n` + fails.join('\n') : '\nALL CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
