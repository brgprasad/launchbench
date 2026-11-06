
// ===== n8n wrapper (WF-5 "Work out the request") =====
// WF-0 runs WF-5 once per email, so there is exactly one item.
// Change requests: the rules above compute every date and fee. Questions are
// answered from the KB. The wording Gemini gets is in the next node,
// "Write the prompt", so it can be tuned without touching the rules.
const e = $('From WF-0').first().json;
const c = e.classifier || {};
const intents = c.intents || [];
const isChange = intents.some(i => i.class === 'change_request');
const member = e.member || null;
const pricing = {};
for (const r of $('Read pricing').all()) pricing[r.json.sku] = Number(r.json.value);

let plan = null;
let owner, ownerEmail, allowed, mustMention = [];
if (isChange) {
  plan = member
    ? planChange({ change: c.change || {}, member, now: e.now, churn_risk: Boolean(c.churn_risk) },
        { pricing, availability: $('Read availability').all().map(i => i.json), invoices: $('Read invoices').all().map(i => i.json) })
    : { ok: false, type: (c.change || {}).type || '', customer_facts: ['We could not match this email to a membership, so our team will reply personally.'],
        internal_facts: ['No member matched: reply personally.'], must_mention: [], flags: ['No member matched'], fyi: [], fyi_emails: [],
        approver: HEAD_OF_SALES, approver_email: STAFF_EMAIL[HEAD_OF_SALES], summary: 'no member matched' };
  owner = plan.approver;
  ownerEmail = plan.approver_email;
  allowed = plan.customer_facts.join('\n');
  mustMention = plan.must_mention;
} else {
  owner = member ? member.account_manager : HEAD_OF_OPS;
  ownerEmail = STAFF_EMAIL[owner] || STAFF_EMAIL[HEAD_OF_OPS];
  allowed = e.kb || '';
}

return [{ json: {
  source: e.source, seed_id: e.seed_id || '', message_id: e.message_id || '', reply_to: e.reply_to,
  from_name: e.from_name, from_address: e.from_address, subject: e.subject, body: e.body, now: e.now,
  path: isChange ? 'change' : 'query', contact_first: String(c.sender_name || e.from_name || '').trim().split(/\s+/)[0] || 'there',
  member, member_text: member ? `${member.company} (${member.member_id}), ${member.plan}, ${member.seats} seats, ${CENTRE_NAMES[member.centre] || member.centre}${member.space && member.space !== 'Open area' ? ', ' + member.space : ''}. Account manager: ${member.account_manager}.` : '',
  identity: e.identity || {}, churn_risk: Boolean(c.churn_risk), intents, plan, owner, owner_email: ownerEmail,
  allowed_text: allowed, must_mention: mustMention, demo_line: demoLine(member),
  reply_subject: /^re:/i.test(e.subject || '') ? e.subject : 'Re: ' + (e.subject || 'your email'),
} }];
