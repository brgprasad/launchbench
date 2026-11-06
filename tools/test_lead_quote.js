// Run the lead quote engine locally against data/*.csv and check the figures
// that each lead seed's expected_action quotes.
//
//   node tools/test_lead_quote.js [inputs.json]
//
// inputs.json maps seed id -> { now, as_alias, classifier } (the classifier
// JSON from triage_log). Default: test-emails/lead-quote-inputs.json, captured
// from the Gemini 3.5 Flash-Lite regression on 2026-11-05.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(__dirname, 'lead_quote.js'), 'utf8'), ctx);

function csv(name) {
  const text = fs.readFileSync(path.join(ROOT, 'data', name), 'utf8').replace(/\r/g, '');
  const rows = [];
  let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1);
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const pricing = Object.fromEntries(csv('pricing.csv').map(r => [r.sku, Number(r.value)]));
const availability = csv('availability.csv');
const members = csv('members.csv');
const personas = csv('personas.csv');
const localities = csv('localities.csv');

// Fields the classifier will extract once the schema gains them.
const EXTRA = {
  '01': { timeline_firm: true }, '02': { timeline_firm: true }, '03': { timeline_firm: false },
  '05': { timeline_firm: true }, '06': { timeline_firm: true },
  '23': { timeline_firm: true, event_guests: 60, event_hours: 4 },
};

const file = process.argv[2] || path.join(ROOT, 'test-emails', 'lead-quote-inputs.json');
const inputs = JSON.parse(fs.readFileSync(file, 'utf8'));
// Synthetic cases: an area that isn't one of our centres, in and out of the table.
const synth = (lead) => ({ now: '2026-11-05T18:16:18+05:30', as_alias: '', classifier: { intents: [{ class: 'lead', subclass: 'new' }], lead } });
inputs['A1'] = synth({ team_size: 8, centres: [], area: 'Jayanagar', area_centres: ['KOR'], timeline_firm: false, move_in: '' });
inputs['A2'] = synth({ team_size: 8, centres: [], area: 'Nelamangala', area_centres: ['HSR', 'KOR'], timeline_firm: false, move_in: '' });
const out = {};
for (const id of Object.keys(inputs).sort()) {
  const x = inputs[id];
  const c = x.classifier;
  const leadIntent = c.intents.find(i => i.class === 'lead');
  if (!leadIntent) continue;
  const persona = personas.find(p => p.alias === x.as_alias && p.type === 'member');
  const member = persona ? members.find(m => m.member_id === persona.ref_id) : null;
  const r = vm.runInContext('quoteLead', ctx)(
    { lead: { ...c.lead, ...(EXTRA[id] || {}) }, subclass: leadIntent.subclass, member, now: x.now },
    { pricing, availability, localities });
  out[id] = r;
}

// ---------- checks from the seed files' expected_action ----------
const fails = [];
const check = (id, cond, msg) => { if (!cond) fails.push(`${id}: ${msg}`); };
const rec = id => out[id] && out[id].options[out[id].recommended];
const notes = id => (out[id] ? out[id].notes.join(' ') : '');

if (out['01']) {
  const o = rec('01');
  check('01', o && o.centre === 'WHF' && o.seats === 16 && o.available_from === '2027-01-01', `recommend WHF 16-seat from 2027-01-01, got ${out['01'].recommended_text}`);
  check('01', o && o.terms[12].monthly === 144000 && o.terms[12].monthly_incl_gst === 169920, 'WHF 12-month ₹1,44,000 / ₹1,69,920 incl GST');
  check('01', /Indiranagar is not recommended: ₹2,01,600/.test(notes('01')), 'explain Indiranagar over budget at ₹2,01,600');
  check('01', /Hebbal \(Manyata\) is cheaper at ₹1,36,800/.test(notes('01')), 'mention Hebbal ₹1,36,800 if GST included');
  check('01', out['01'].owner === 'Deepa Menon' && out['01'].score === 'hot', `owner Deepa / hot, got ${out['01'].owner} / ${out['01'].score}`);
}
if (out['02']) {
  const o = rec('02');
  check('02', o && o.centre === 'KOR' && o.seats === 40 && o.spaces.length === 3, `KOR 4A+4B+4C = 40, got ${out['02'].recommended_text}`);
  check('02', o && o.terms[6].monthly === 513000 && o.terms[12].monthly === 486000, '6-month ₹5,13,000, 12-month ₹4,86,000');
  check('02', /HSR Layout is free only from 2026-12-01/.test(notes('02')), 'HSR cannot make 17 Nov');
  check('02', out['02'].owner === 'Ananya Bose' && out['02'].cc.includes('Farhan Sheikh') && out['02'].score === 'hot', 'Ananya, cc Farhan, hot');
}
if (out['03']) {
  const r = out['03'];
  const cab = c => r.options.find(o => o.centre === c && o.product === 'Private cabin');
  check('03', cab('KOR') && cab('KOR').list_monthly === 81000 && cab('HSR') && cab('HSR').list_monthly === 72000, '6-seat cabins KOR ₹81,000, HSR ₹72,000 list');
  check('03', r.options.some(o => o.product === 'Dedicated desk'), 'dedicated desks offered');
  check('03', r.score === 'warm' && r.owner === 'Vikram Shetty', `warm / Vikram, got ${r.score} / ${r.owner}`);
}
if (out['04']) check('04', out['04'].kind === 'day_pass' && rec('04').price === 600 && out['04'].score === 'cold', 'day pass ₹600, cold');
if (out['05']) {
  const o = rec('05');
  check('05', o && o.centre === 'IND' && o.seats === 8 && o.available_from === '2027-01-01', `IND 8-seat Cabin 2D from 2027-01-01, got ${out['05'].recommended_text}`);
  check('05', o && o.list_monthly === 112000 && o.terms[6].monthly === 106400 && o.terms[12].monthly === 100800, '₹1,12,000 / ₹1,06,400 / ₹1,00,800');
  check('05', out['05'].member && out['05'].member.id === 'M006' && out['05'].owner === 'Ananya Bose', 'member M006, Ananya');
}
if (out['06']) {
  const o = rec('06');
  check('06', o && o.product === 'Founders Plan' && o.centre === 'IND' && o.list_monthly === 18000, 'Founders 2 × ₹9,000 at IND');
  check('06', o && o.partner && o.partner.months_1_6 === 15300 && o.terms[3].deposit === 0, 'partner ₹15,300, no deposit');
  check('06', out['06'].score === 'hot' && out['06'].owner === 'Ananya Bose', `hot / Ananya, got ${out['06'].score} / ${out['06'].owner}`);
}
if (out['23']) {
  const o = rec('23');
  check('23', o && o.centre === 'KOR' && o.list_price === 22000 && o.price === 17600 && o.advance_50pct === 8800, 'KOR half day ₹22,000 - 20% = ₹17,600, advance ₹8,800');
  check('23', /No clash with Demo Night, which is on 2026-11-27/.test(notes('23')), 'Demo Night 27 Nov, no clash');
  check('23', out['23'].owner === 'Ananya Bose', 'route to Ananya');
}

for (const [id, r] of Object.entries(out)) check(id, r.alternatives.length <= 2, `at most 2 alternatives, got ${r.alternatives.length}`);
if (out['A1']) {
  const r = out['A1'];
  check('A1', r.area_source === 'table' && /centre in Jayanagar\. The nearest are Koramangala \(about 4 km away\) and HSR Layout/.test(notes('A1')), `Jayanagar -> Koramangala, HSR from the table; got ${notes('A1')}`);
  check('A1', r.options.every(o => ['KOR', 'HSR'].includes(o.centre)), 'only KOR and HSR priced');
  check('A1', r.options[r.recommended].centre === 'KOR' && r.owner === 'Ananya Bose', `nearest centre (Koramangala) recommended, got ${r.recommended_text} / ${r.owner}`);
}
if (out['A2']) check('A2', out['A2'].area_source === 'ai' && /probably HSR Layout and Koramangala/.test(notes('A2')), 'unknown area falls back to the AI guess');

for (const [id, r] of Object.entries(out)) {
  console.log(`\n== ${id}  ${r.kind}  ${r.score} (${r.score_reason})  owner ${r.owner}${r.cc.length ? ' cc ' + r.cc : ''}`);
  console.log(`   recommended: ${r.recommended_text}  quoted ${r.quoted_monthly_inr}  alternatives: ${r.alternatives.map(i => r.options[i].product + ' ' + (r.options[i].centre || '')).join('; ')}`);
  for (const o of r.options) {
    const t = o.terms ? Object.values(o.terms).map(t => `${t.months}m ${t.monthly}`).join(', ') : `price ${o.price}`;
    console.log(`   - ${o.product} ${o.centre || ''} ${o.seats || ''} ${o.spaces ? o.spaces.map(s => s.ref).join('+') : ''} from ${o.available_from || o.date || ''} | list ${o.list_monthly || o.list_price || ''} | ${t}${o.partner ? ' | partner ' + o.partner.months_1_6 : ''}`);
  }
  for (const n of r.notes) console.log(`   * ${n}`);
}
console.log(fails.length ? `\n${fails.length} CHECK(S) FAILED\n` + fails.join('\n') : '\nALL CHECKS PASSED');
process.exit(fails.length ? 1 : 0);
