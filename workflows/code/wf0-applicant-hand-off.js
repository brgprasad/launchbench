// A job application is noise to the pipeline but comes from a real person, so it
// is acknowledged at once and passed to HR (part of Operations; careers@ in
// kb/00-company-profile.md). Other noise (pitches, newsletters, spam) gets no reply.
const e = $('Attach knowledge base').item.json;
const r = $('Resolve identity').item.json;
const intent = ((r.output || {}).intents || []).find(i => i.class === 'noise' && /job/i.test(i.subclass || '')) || {};
const first = String(e.from_name || '').trim().split(/\s+/)[0];
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const box = 'white-space:pre-wrap;text-align:left;padding:10px 14px;border-radius:6px;';
const ack = `${first ? 'Hi ' + first : 'Hello'},\n\nThank you for your application to Launchbench. Our HR team has it and will be in touch if your experience matches the role.\n\nLaunchbench Careers`;
return { json: {
  source: e.source, message_id: e.message_id, reply_to: e.reply_to,
  reply_subject: /^re:/i.test(e.subject || '') ? e.subject : 'Re: ' + (e.subject || 'your application'),
  ack_body: ack,
  hr_to: 'teamlaunchbench+lb-kavya@gmail.com',
  hr_subject: `Job application: ${e.from_name || e.from_address}${e.subject ? ' (' + e.subject + ')' : ''}`,
  hr_html: `<div style="text-align:left"><p>A job application for HR. ${esc(intent.summary || '')}</p>`
    + `<p>The applicant has already been sent this acknowledgement:</p><div style="${box}background:#EEF1F5">${esc(ack)}</div>`
    + `<p><b>Their email</b> from ${esc(e.from_name)} &lt;${esc(e.from_address)}&gt;, received ${esc(String(e.now || '').replace('T', ' ').slice(0, 16))} IST:</p>`
    + `<div style="${box}background:#F6F1E9"><b>Subject:</b> ${esc(e.subject || '(none)')}\n\n${esc(e.body || '')}</div></div>`,
} };
