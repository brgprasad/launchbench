
// ===== n8n wrapper (WF-2 "Check the reply") =====
// The reply goes out without a person (ticket acknowledgements are auto-send),
// so code checks it first: the ticket number and fix-by time must be there and
// no rupee amount may appear. If the draft fails, a template built from the
// same facts goes instead, so a P1 is never held up.
const a = $('Raise the ticket').first().json;
const t = a.ticket;
const ran = name => { try { const n = $(name); return n.isExecuted ? n.first().json : null; } catch (err) { return null; } };
const first = ran('Draft the reply');
const second = ran('Draft again');
const draft = String((first && first.text) || (second && second.text) || '').trim();
const chk = checkReply(draft, t.customer_facts.join('\n'), t.must_mention);
const template = `Hi ${a.contact_first},\n\nThank you for letting us know, and sorry for the trouble.\n\n${t.customer_facts.join('\n\n')}\n\nLaunchbench Support`;
const used = chk.ok ? 'ai' : 'template';
const body = (a.demo_line ? a.demo_line + '\n\n' : '') + (chk.ok ? draft : template);
const checkText = !draft ? 'The AI draft failed; the template reply was sent.'
  : chk.ok ? `Reply checked: it states ${t.must_mention.join(' and ')}${chk.amounts.length ? '' : ' and quotes no amounts'}.`
  : `The AI draft failed the check (${[chk.missing.length && 'missing ' + chk.missing.join(', '), chk.unknown.length && 'amounts ' + chk.unknown.join(', ')].filter(Boolean).join('; ')}); the template reply was sent.`;

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const m = a.member;
const box = 'white-space:pre-wrap;text-align:left;padding:10px 14px;border-radius:6px;';
const colour = { P1: '#FDECEA', P2: '#FFF4D6', P3: '#EEF3FB', P4: '#F2F2F2' }[t.priority];
const rows = [
  ['Ticket', `<b>${esc(t.ticket_id)}</b>, ${t.priority} ${esc(t.category)}`],
  ['Member', m ? `${esc(m.company)} (${m.member_id}), ${esc(m.plan)}, ${m.seats} seats` + (a.identity.source ? ` <span style="color:#666">(matched by ${esc(a.identity.source)})</span>` : '') : 'Not matched: the reply asks for their company and centre'],
  ['Location', esc(t.location || 'unknown')],
  ['From', `${esc(a.from_name)} &lt;${esc(a.reply_to)}&gt;`],
  ['First response due', esc(t.response_due) + ' (this acknowledgement covers it)'],
  ['Fix by', `<b>${esc(t.resolution_due)}</b>`],
  ['Owner', esc(t.owner) + (t.stage >= 2 ? `; <b>escalated to ${esc(t.escalated_to)}</b> (stage ${t.stage})` : '')],
  ...(t.linked.length ? [['Linked tickets', esc(t.linked.join(', '))]] : []),
];
const html = `<div style="text-align:left">`
  + `<p style="padding:8px 12px;border-radius:6px;background:${colour}"><b>${t.priority}</b>: fix by ${esc(t.fix_by)}.${t.stage >= 2 ? ` Escalated to ${esc(t.escalated_to)}.` : ''}</p>`
  + `<table cellpadding="4" style="border-collapse:collapse;text-align:left">${rows.map(r => `<tr><td style="color:#666;vertical-align:top">${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`
  + `<p><b>Notes</b></p><ul>${t.internal_facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>`
  + `<p><b>Their email</b>, received ${esc(String(a.now).replace('T', ' ').slice(0, 16))} IST:</p>`
  + `<div style="${box}background:#F6F1E9"><b>Subject:</b> ${esc(a.subject || '(none)')}\n\n${esc(a.body || '')}</div>`
  + `<p><b>Our reply</b> (sent automatically to ${esc(a.reply_to)}; ${esc(checkText)})</p>`
  + `<div style="${box}border-left:3px solid #F26B1D;border-radius:0">${esc(body)}</div>`
  + `</div>`;

return [{ json: {
  ...t.row, source: a.source, seed_id: a.seed_id, sender: a.reply_to, reply_by: used,
  // fields for the email nodes
  message_id: a.message_id, reply_to: a.reply_to, reply_subject: a.reply_subject, reply_body: body,
  staff_to: t.to_emails, staff_cc: t.cc_emails, staff_subject: t.staff_subject, staff_html: html,
} }];
