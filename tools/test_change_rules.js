// Run the membership-change rules locally against data/*.csv and check the
// expected outcomes for seeds 16 and 17 plus made-up cases.
//
//   node tools/test_change_rules.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'change_rules.js'), 'utf8'), ctx);
const planChange = vm.runInContext('planChange', ctx);
const checkReply = vm.runInContext('checkReply', ctx);
const demoLine = vm.runInContext('demoLine', ctx);
const checkGrounding = vm.runInContext('checkGrounding', ctx);

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
const pricing = {};
for (const r of csv('pricing.csv')) pricing[r.sku] = Number(r.value);
const data = { pricing, availability: csv('availability.csv'), invoices: csv('invoices.csv') };
const M = id => members.find(m => m.member_id === id);

const CASES = {
  'S16 Paysetu cabin 20->12': { member: M('M002'), now: '2026-11-03T17:40:00+05:30', churn_risk: false, change: { type: 'downsize', seats_from: 20, seats_to: 12, effective: '2026-12-01' } },
  'S17 Fernweh exit': { member: M('M009'), now: '2026-11-03T09:05:00+05:30', change: { type: 'exit', effective: '2026-12-31' } },
  'A cabin exit in lock-in': { member: M('M001'), now: '2026-11-05T10:00:00+05:30', change: { type: 'exit', effective: '2026-12-31' } },
  'B desk cut within 20%': { member: M('M025'), now: '2026-11-05T10:00:00+05:30', change: { type: 'downsize', seats_from: 5, seats_to: 4 } },
  'C desk cut beyond 20%': { member: M('M025'), now: '2026-11-05T10:00:00+05:30', change: { type: 'downsize', seats_from: 5, seats_to: 2 } },
  'D cabin move KOR->HSR': { member: M('M013'), now: '2026-11-05T10:00:00+05:30', change: { type: 'move', to_centre: 'HSR' } },
  'E desk after lock-in': { member: M('M006'), now: '2026-11-05T10:00:00+05:30', change: { type: 'downsize', seats_from: 4, seats_to: 2 } },
  'F cabin upgrade': { member: M('M008'), now: '2026-11-05T10:00:00+05:30', change: { type: 'upgrade', seats_from: 8, seats_to: 16 } },
};
const out = {};
for (const [k, c] of Object.entries(CASES)) out[k] = planChange(c, data);

const fails = [];
const check = (id, cond, msg) => { if (!cond) fails.push(`${id}: ${msg}`); };
const s16 = out['S16 Paysetu cabin 20->12'];
const txt16 = s16.customer_facts.join(' ');
check('S16', s16.effective === '2027-01-03', `earliest 3 Jan 2027, got ${s16.effective}`);
check('S16', s16.options[0] && s16.options[0].ref === 'Cabin 4B' && s16.options[0].centre === 'KOR' && s16.options[1] && s16.options[1].ref === 'Cabin 3A' && s16.options[1].centre === 'IND', 'KOR Cabin 4B (12) as the fit, IND Cabin 3A (16) as the same-centre option');
check('S16', /no 12-seat cabin free at Indiranagar/.test(txt16), 'says no smaller cabin at Indiranagar');
check('S16', s16.options[0].diff === 100800, `difference ₹1,00,800/month, got ${s16.options[0].diff}`);
check('S16', !/1,00,800|2,52,000/.test(txt16), 'no fee figures in customer facts');
check('S16', s16.internal_facts.some(f => /LB\/26-27\/0404.*day 27.*6 Nov 2026/.test(f)), 'overdue 0404 at day 27, warning 6 Nov');
check('S16', s16.internal_facts.some(f => /4,460/.test(f)), 'late fee ₹4,460 on the November invoice');
check('S16', s16.fyi.join() === 'Farhan Sheikh' && s16.approver === 'Ananya Bose', 'Ananya approves, Farhan FYI');
const s17 = out['S17 Fernweh exit'];
check('S17', s17.exit_date === '2026-12-31' && s17.notice_end === '2026-12-03', `exit 31 Dec, notice end 3 Dec; got ${s17.exit_date} ${s17.notice_end}`);
check('S17', s17.refund_by === '2027-01-30' && /₹25,500.*30 Jan 2027/.test(s17.customer_facts.join(' ')), 'deposit ₹25,500 by 30 Jan 2027');
check('S17', s17.fee_inr === 0 && s17.fyi.length === 0, 'no fee, no FYI');
check('S17', /December 2026/.test(s17.customer_facts.join(' ')), 'final invoice December');
const a = out['A cabin exit in lock-in'];
check('A', a.exit_date === '2027-01-31' && a.fee_inr > 0, `exit at lock-in end 31 Jan 2027 with early-exit option; got ${a.exit_date} fee ${a.fee_inr}`);
check('B', out['B desk cut within 20%'].fee_inr === 0 && out['B desk cut within 20%'].effective === '2027-01-05', `no fee, 2 months notice; got ${out['B desk cut within 20%'].effective}`);
const c = out['C desk cut beyond 20%'];
check('C', c.fee_inr > 0 && /2 seats beyond/.test(c.fee_basis), `2 extra seats charged; got ${c.fee_basis}`);
const d = out['D cabin move KOR->HSR'];
check('D', d.effective === '2026-12-05' && d.new_monthly === Math.round(16 * 12000 * (102600 / (8 * 13500))) && !/carries over/.test(d.customer_facts.join(' ')), `move 5 Dec into HSR Cabin 3A (16, no 8-seat there) at HSR rates, lock-in already over; got ${d.effective} ${d.new_monthly}`);
const e = out['E desk after lock-in'];
check('E', e.fee_inr === 0 && e.effective === '2026-12-05', `after lock-in, 1 month notice no fee; got ${e.effective}`);
check('F', /Cabin 3A/.test(out['F cabin upgrade'].customer_facts.join(' ')), 'HSR Cabin 3A (16) for the upgrade');

const r1 = checkReply('Hi, the deposit of ₹25,500 is refunded by 30 Jan 2027.', s17.customer_facts.join(' '), s17.must_mention);
check('checkReply', !r1.ok && r1.missing.includes('31 Dec 2026'), 'missing exit date detected');
const r2 = checkReply('Exit 31 Dec 2026. Refund ₹25,500 (Rs 25500) by 30 Jan 2027. Fee ₹999.', s17.customer_facts.join(' '), s17.must_mention);
check('checkReply', !r2.ok && r2.unknown.join() === '₹999', 'unknown amount detected');
check('demoLine', demoLine(M('M002')) === "Demo: you're writing as Paysetu Fintech Pvt. Ltd. (M002, Indiranagar, Cabin 4A).", demoLine(M('M002')));

// Grounding: synthetic cases, not real tester questions.
const KB = '## House rules\n- **Quiet hours** in the open area run 9 am to 6 pm.\n- Printing is free up to 100 pages a month per member.\n- Two-wheeler parking costs ₹800 a month at Whitefield.';
const g1 = checkGrounding(['Printing is free up to 100 pages a month per member.'], KB, 'Printing\nHow many pages can we print each month?');
check('grounding', g1.ok, `exact quote that matches the question passes; got ${g1.reason}`);
const g2 = checkGrounding(['Quiet hours in the open area run 9 am to 6 pm'], KB, 'Noise\nWhat are the quiet hours?');
check('grounding', g2.ok, `markdown bold and trailing full stop ignored; got ${g2.reason}`);
const g3 = checkGrounding([], KB, 'Lockers\nDo you rent lockers?');
check('grounding', !g3.ok && /no knowledge-base sentence/.test(g3.reason), 'no quotes: not grounded');
const g4 = checkGrounding(['Lockers cost ₹500 a month at every centre.'], KB, 'Lockers\nDo you rent lockers?');
check('grounding', !g4.ok && /not in the knowledge base/.test(g4.reason), 'invented policy quote rejected');
const g5 = checkGrounding(['Quiet hours in the open area run 9 am to 6 pm.'], KB, 'Lockers\nDo you rent lockers for laptops?');
check('grounding', !g5.ok && /share no subject/.test(g5.reason), 'real quote about a different subject rejected');
const g7 = checkGrounding(['Two-wheeler parking costs ₹800 a month at Whitefield.'], KB, 'Lockers\nCan we rent a locker at Whitefield?');
check('grounding', !g7.ok, 'sharing only the centre name is not related');
const g8 = checkGrounding(['Two-wheeler parking costs ₹800 a month at Whitefield.'], KB, 'Where can I park at Whitefield?');
check('grounding', g8.ok, `park / parking match; got ${g8.reason}`);
const g9 = checkGrounding(['Printing is free up to 100 pages a month per member.'], KB, 'Pets\nCan I bring my dog?');
check('grounding', !g9.ok, 'a month and per member are not a shared subject');
const KB2 = KB + '\n- Pets are allowed only at HSR Layout, in the Paws Zone.';
const g10 = checkGrounding(['Pets are allowed only at HSR Layout, in the Paws Zone.'], KB2, 'Can I bring my nephew along to HSR? Is that allowed?');
check('grounding', !g10.ok, 'allowed / bring / centre are not a shared subject');
const g11 = checkGrounding(['"Quiet hours" in the open area run 9 am to 6 pm.'], KB, 'What are the quiet hours?');
check('grounding', g11.ok, `added quotation marks are ignored; got ${g11.reason}`);
const g12 = checkGrounding(['Quiet hours in the open area run 9 am to 7 pm.'], KB, 'What are the quiet hours?');
check('grounding', !g12.ok, 'a changed time is caught');
const g6 = checkGrounding('Printing is free', KB, 'printing');
check('grounding', !g6.ok, 'a non-array or too-short quote is not grounding');

for (const [k, p] of Object.entries(out)) {
  console.log(`\n== ${k}: ${p.summary}   approver=${p.approver}${p.fyi.length ? ' fyi=' + p.fyi : ''}  reply due ${p.reply_due}`);
  for (const f of p.customer_facts) console.log('   C: ' + f);
  for (const f of p.internal_facts) console.log('   I: ' + f);
  console.log('   must mention: ' + p.must_mention.join(' | '));
}
console.log(fails.length ? `\n${fails.length} CHECK(S) FAILED\n` + fails.join('\n') : '\nALL CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
