
// ===== n8n wrapper (WF-3 "Work out the case") =====
// WF-0 runs WF-3 once per email, so there is exactly one item. The rules above
// check the claim against the invoices and usage records and compute every
// amount and date. Gemini's wording is in the next node, "Write the prompt".
const e = $('From WF-0').first().json;
const c = e.classifier || {};
const member = e.member || null;
const plan = planBilling(
  { now: e.now, email: { subject: e.subject, body: e.body, from_address: e.from_address, attachments: e.attachments || '' },
    classifier: c, member, identity: e.identity || {} },
  { invoices: $('Read invoices').all().map(i => i.json), usage: $('Read usage').all().map(i => i.json) });

return [{ json: {
  source: e.source, seed_id: e.seed_id || '', message_id: e.message_id || '', reply_to: e.reply_to,
  from_name: e.from_name, from_address: e.from_address, subject: e.subject, body: e.body, now: e.now,
  attachments: e.attachments || '', language: c.language || 'en',
  contact_first: String(c.sender_name || e.from_name || '').trim().split(/\s+/)[0] || 'there',
  member, member_text: member ? `${member.company} (${member.member_id}), ${member.plan}, ${member.seats} seats, ${CENTRE_NAMES[member.centre] || member.centre}${member.space && member.space !== 'Open area' ? ', ' + member.space : ''}. Status: ${member.status}${member.exit_date ? ', exited ' + nice(member.exit_date) : ''}.` : '',
  identity: e.identity || {}, churn_risk: Boolean(c.churn_risk), intents: c.intents || [], plan,
  owner: plan.approver, owner_email: plan.approver_email,
  allowed_text: plan.customer_facts.join('\n'), must_mention: plan.must_mention, demo_line: demoLine(member),
  reply_subject: /^re:/i.test(e.subject || '') ? e.subject : 'Re: ' + (e.subject || 'your email'),
} }];
