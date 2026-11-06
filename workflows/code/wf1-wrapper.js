
// ===== n8n wrapper (WF-1 "Build the quote") =====
const MONEY = new Set(['list_monthly', 'monthly', 'monthly_incl_gst', 'deposit', 'months_1_6', 'months_1_6_incl_gst',
  'per_seat_list', 'list_price', 'price', 'price_incl_gst', 'advance_50pct', 'advance_incl_gst', 'budget_inr', 'monthly_fee']);
const inrFmt = n => {
  const s = String(Math.round(n));
  return s.length <= 3 ? '₹' + s : '₹' + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
};
const forAi = v => {
  if (Array.isArray(v)) return v.map(forAi);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = MONEY.has(k) && typeof x === 'number' && x > 0 ? inrFmt(x) : forAi(x);
    return o;
  }
  return v;
};

const pricing = {};
for (const r of $('Read pricing').all()) pricing[r.json.sku] = Number(r.json.value);
const availability = $('Read availability').all().map(i => i.json);
const localities = $('Read localities').all().map(i => i.json);

const out = [];
for (const [index, item] of $('From WF-0').all().entries()) {
  const j = item.json;
  const c = j.classifier || {};
  const leadIntent = (c.intents || []).find(i => i.class === 'lead') || {};
  const quote = quoteLead({ lead: c.lead || {}, subclass: leadIntent.subclass, member: j.member || null, now: j.now },
    { pricing, availability, localities });
  const rec = quote.options[quote.recommended];
  // The name the sender signs with beats the display name on the account.
  const contactFirst = String(c.sender_name || j.from_name || '').trim().split(/\s+/)[0] || 'there';
  const ownerFirst = String(quote.owner).split(' ')[0];
  const quote_for_ai = forAi({
    contact_first_name: contactFirst,
    enquiry: quote.kind, team_size: quote.team_size, move_in: quote.move_in, area_asked_for: quote.area,
    budget_inr: quote.budget_inr, budget_includes_gst: quote.budget_includes_gst, partner: quote.partner,
    existing_member: quote.member,
    recommended_option: rec || null,
    other_options: quote.alternatives.map(i => quote.options[i]),
    notes: quote.notes,
    account_manager: quote.owner,
  });
  out.push({ json: {
    ...j, lead_intent: leadIntent, quote, quote_for_ai, contact_first: contactFirst,
    reply_subject: /^re:/i.test(j.subject || '') ? j.subject : 'Re: ' + (j.subject || 'your enquiry'),
    ack_body: `Hi ${contactFirst},\n\nThanks for getting in touch with Launchbench. ${ownerFirst} from our sales team has your enquiry and will send you options and pricing shortly.\n\nTeam Launchbench`,
  }, pairedItem: { item: index } });
}
return out;
