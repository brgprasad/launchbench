
// ===== n8n wrapper (WF-5 "Check the draft") =====
// Code, not the AI, decides whether a reply goes out without a person, writes
// the demo line, the approval email, the staff notes and the requests row.
const a = $('Work out the request').first().json;
const ran = name => { try { const n = $(name); return n.isExecuted ? n.first().json : null; } catch (err) { return null; } };
const first = ran('Draft the reply');
const second = ran('Draft again');
const out = (first && first.output) || (second && second.output) || null;
const draft = out ? String(out.reply || '').trim() : '';
const p = a.plan;
const m = a.member;
const ownerFirst = String(a.owner).split(' ')[0];
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- checks ----
const chk = checkReply(draft, a.allowed_text, a.must_mention);
const conf = out ? Number(out.confidence) || 0 : 0;
const whyNot = [];
if (a.path === 'change') whyNot.push('membership changes always need the account manager\'s approval');
else {
  if (!draft) whyNot.push('the AI draft failed');
  if (out && out.needs_staff) whyNot.push('the AI asked for a person to check: ' + (out.staff_reason || 'no reason given'));
  if (out && conf < 0.8) whyNot.push(`the AI's confidence is ${conf} (needs 0.8)`);
  if (chk.unknown.length) whyNot.push('an amount is not in the price list');
}
const autoSend = a.path === 'query' && whyNot.length === 0 && chk.ok;
const source = a.path === 'change' ? 'the computed facts' : 'the price list and knowledge base';
const checkText = !draft ? 'The AI draft failed, so a holding reply is shown instead.'
  : [chk.unknown.length ? `CHECK BEFORE APPROVING: ${chk.unknown.join(', ')} ${chk.unknown.length > 1 ? 'are' : 'is'} not in ${source}.` : '',
     chk.missing.length ? `CHECK BEFORE APPROVING: the draft doesn't mention ${chk.missing.join(', ')}.` : ''].filter(Boolean).join(' ')
    || `Checks passed: ${chk.amounts.length === 1 ? `the one amount matches ${source}` : chk.amounts.length ? `all ${chk.amounts.length} amounts match ${source}` : 'no amounts quoted'}${a.must_mention.length ? `; it states ${a.must_mention.join(' and ')}` : ''}.`;

const fallback = a.path === 'change'
  ? `Hi ${a.contact_first},\n\nThanks for your email. I have your request and will get back to you shortly with the details.\n\n${ownerFirst}\nTeam Launchbench`
  : `Hi ${a.contact_first},\n\nThanks for your email. Our team will get back to you shortly.\n\nLaunchbench Community Team`;
const body = (a.demo_line ? a.demo_line + '\n\n' : '') + (draft || fallback);

// ---- ids, labels ----
// Test-runner seeds repeat, so their id also carries this run's execution number.
const requestId = 'R-' + String(a.now).slice(0, 10).replace(/-/g, '') + '-' + (a.seed_id ? `S${a.seed_id}-x${$execution.id}` : String(a.message_id || Date.parse(a.now)).slice(-5));
const kind = a.path === 'change' ? (p && p.type) || 'change' : 'question';
const company = m ? m.company : (a.identity.company || '');
const who = company || a.contact_first || a.from_name;
const received = String(a.now || '').replace('T', ' ').slice(0, 16);

// ---- approval email ----
const box = 'white-space:pre-wrap;text-align:left;padding:10px 14px;border-radius:6px;';
const okColour = chk.ok && draft ? '#E3F1E7' : '#FDECEA';
const rows = [
  ['From', `${esc(a.from_name)} &lt;${esc(a.reply_to)}&gt;`],
  ['Member', m ? `${esc(m.company)} (${m.member_id}): ${esc(m.plan)}, ${m.seats} seats, ${esc(CENTRE_NAMES[m.centre] || m.centre)}${m.space && m.space !== 'Open area' ? ', ' + esc(m.space) : ''}` +
    `<br>${inr(Number(m.monthly_seat_fee_inr))}/month, deposit ${inr(Number(m.security_deposit_inr))}${m.lock_in_end ? `, lock-in to ${nice(m.lock_in_end)}` : ', no lock-in'}` +
    (a.identity.source ? ` <span style="color:#666">(matched by ${esc(a.identity.source)})</span>` : '') : 'Not matched to a member'],
];
if (a.path === 'change') {
  rows.push(['Request', `<b>${esc(kind)}</b>${p && p.summary ? ': ' + esc(p.summary.replace(new RegExp('^' + kind + ',? ?'), '')) : ''}`]);
  if (p && p.reply_due) rows.push(['Reply due', `${nice(p.reply_due)} (notices are confirmed within 2 business days)`]);
  if (a.churn_risk) rows.push(['Churn risk', '<b>Yes</b>, flagged by the classifier']);
} else {
  rows.push(['Question', esc(a.intents.filter(i => i.class === 'general_query').map(i => i.summary).join(' | ') || a.subject)]);
  rows.push(['AI confidence', String(conf) + (out && out.needs_staff ? ` (asked for a person: ${esc(out.staff_reason)})` : '')]);
  if (out && out.upsell_hint) rows.push(['Upsell idea', esc(out.upsell_hint)]);
}
const list = xs => `<ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
const html = `<div style="text-align:left">`
  + `<p style="padding:8px 12px;border-radius:6px;background:${okColour}">${esc(checkText)}</p>`
  + (p && p.flags && p.flags.length ? `<p style="padding:8px 12px;border-radius:6px;background:#FFF4D6">${esc(p.flags.join('. '))}.</p>` : '')
  + `<p>${a.path === 'change' ? `A membership change for <b>${esc(a.owner)}</b>${p && p.fyi.length ? ` (FYI ${esc(p.fyi.join(', '))}: ${esc(p.fyi_reason)})` : ''}. Every date and fee was computed from the membership terms; Gemini only wrote the wording.`
      : `A question for <b>${esc(a.owner)}</b> to check, because ${esc(whyNot.join('; ') || 'a check failed')}.`}</p>`
  + `<table cellpadding="4" style="border-collapse:collapse;text-align:left">${rows.map(r => `<tr><td style="color:#666;vertical-align:top">${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`
  + (p && p.internal_facts && p.internal_facts.length ? `<p><b>For you only</b> (not in the reply)</p>${list(p.internal_facts)}` : '')
  + (p && p.fee_basis ? `<p style="color:#666">Fee basis: ${esc(p.fee_basis)}. Indicative; confirm before quoting.</p>` : '')
  + `<p><b>Their email</b>, received ${esc(received)} IST:</p>`
  + `<div style="${box}background:#F6F1E9"><b>Subject:</b> ${esc(a.subject || '(none)')}\n\n${esc(a.body || '')}</div>`
  + (p ? `<p><b>The reply covers</b></p>${list(p.customer_facts)}` : '')
  + `<p><b>Draft reply</b> to ${esc(a.reply_to)} (sent when you approve):</p>`
  + `<div style="${box}border-left:3px solid #F26B1D;border-radius:0">${esc(body)}</div>`
  + `</div>`;

// ---- staff notes (no approval needed) ----
const notes = [];
if (p && p.fyi_emails && p.fyi_emails.length) {
  notes.push({ to: p.fyi_emails.join(','), subject: `FYI: ${who} wants to ${kind === 'exit' ? 'leave' : kind} (${p.fyi_reason})`,
    html: `<div style="text-align:left"><p>${esc(a.owner)} has been asked to approve the reply. ${esc(p.summary)}.</p>${list(p.internal_facts)}`
      + `<p><b>Their email:</b></p><div style="${box}background:#F6F1E9">${esc(a.body)}</div></div>` });
}
if (a.path === 'query' && m && out && out.upsell_hint) {
  notes.push({ to: STAFF_EMAIL[m.account_manager] || STAFF_EMAIL[HEAD_OF_SALES], subject: `Upsell idea: ${m.company}`,
    html: `<div style="text-align:left"><p>${esc(out.upsell_hint)}</p><p>${esc(m.company)} (${m.member_id}) has ${m.seats} × ${esc(m.plan)} at ${esc(CENTRE_NAMES[m.centre] || m.centre)}. `
      + `${autoSend ? 'Their question was answered automatically.' : 'Their question is waiting for approval.'}</p>`
      + `<p><b>Their email:</b></p><div style="${box}background:#F6F1E9">${esc(a.body)}</div></div>` });
}

return [{ json: {
  request_id: requestId, received_at: a.now, source: a.source, seed_id: a.seed_id, member_id: m ? m.member_id : '',
  company, sender: a.reply_to, kind,
  summary: a.path === 'change' ? (p && p.summary) || '' : a.intents.filter(i => i.class === 'general_query').map(i => i.summary).join(' | '),
  effective_date: p ? p.exit_date || p.effective || '' : '', new_monthly_inr: p && p.new_monthly ? p.new_monthly : '',
  fee_inr: p && p.fee_inr ? p.fee_inr : '', confidence: out ? conf : '',
  decision: autoSend ? 'auto-send' : 'approval', status: autoSend ? 'Sending automatically' : 'Awaiting approval',
  owner: a.owner, draft_check: checkText, draft_reply: body,
  // fields for the email nodes
  auto_send: autoSend, message_id: a.message_id, reply_to: a.reply_to, reply_subject: a.reply_subject, reply_body: body,
  owner_email: a.owner_email,
  approval_subject: `${chk.ok && draft ? '' : '[CHECK] '}Approve reply: ${who} (${kind}${p && (p.exit_date || p.effective) ? ', ' + nice(p.exit_date || p.effective) : ''})`,
  approval_html: html, staff_notes: notes,
} }];
