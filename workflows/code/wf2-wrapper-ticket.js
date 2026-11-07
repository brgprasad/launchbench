
// ===== n8n wrapper (WF-2 "Raise the ticket") =====
// WF-0 runs WF-2 once per email, so there is exactly one item. The ticket
// number comes from this run's execution number, so parallel emails never
// collide. Test-runner emails ignore tickets made by earlier test runs.
const e = $('From WF-0').first().json;
const c = e.classifier || {};
const ticketId = 'T-' + (2000 + Number($execution.id));
// Test runs ignore tickets made by earlier test runs, so a re-run doesn't count its
// own earlier tickets as repeats: test-runner seeds and [as ...]-tagged emails (a
// presenter or tools/send_seeds.py; testers don't use tags) skip test-runner
// tickets, and tagged emails also skip earlier tickets from the same real sender.
const tagged = /^tag /.test(String((e.identity || {}).source || ''));
const tickets = $('Read tickets').all().map(i => i.json)
  .filter(r => r.ticket_id && !((e.source === 'seed' || tagged) && r.source === 'seed') && !(tagged && r.sender === e.reply_to));
const t = planTicket({ ticket_id: ticketId, now: e.now, email: { subject: e.subject, body: e.body, now: e.now }, classifier: c, member: e.member || null },
  { tickets, vendors: $('Read vendors').all().map(i => i.json), ap_invoices: $('Read ap_invoices').all().map(i => i.json) });
return [{ json: {
  source: e.source, seed_id: e.seed_id || '', message_id: e.message_id || '', reply_to: e.reply_to,
  from_name: e.from_name, from_address: e.from_address, subject: e.subject, body: e.body, now: e.now,
  contact_first: String(c.sender_name || e.from_name || '').trim().split(/\s+/)[0] || 'there',
  language: c.language || 'en', member: e.member || null, identity: e.identity || {}, ticket: t,
  demo_line: demoLine(e.member || null),
  reply_subject: /^re:/i.test(e.subject || '') ? e.subject : 'Re: ' + (e.subject || 'your request'),
} }];
