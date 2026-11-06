// Reply check and helpers, shared with tools/billing_rules.js.
const CENTRE_NAMES = { KOR: 'Koramangala', IND: 'Indiranagar', HSR: 'HSR Layout', WHF: 'Whitefield', HEB: 'Hebbal (Manyata)' };
const FIXED_HOLIDAYS = ['01-26', '08-15', '10-02', '11-01', '12-25'];

// Every rupee amount in the text must appear in allowedText; every mustMention
// string must appear in the text. Amounts are compared as digits, so ₹1,500,
// Rs 1500 and INR 1,500 all match.
function checkReply(text, allowedText, mustMention) {
  const t = String(text || '');
  const digits = s => s.replace(/[^\d]/g, '').replace(/^0+/, '');
  const find = s => (String(s).match(/(?:₹|\bRs\.?|\bINR)\s?\d[\d,]*/g) || []);
  const allowed = new Set(find(allowedText).map(digits));
  const amounts = find(t).map(x => x.replace(/\s/g, ''));
  const unknown = [...new Set(amounts.filter(a => !allowed.has(digits(a))))];
  const flat = t.toLowerCase().replace(/\s+/g, ' ');
  const missing = (mustMention || []).filter(s => !flat.includes(String(s).toLowerCase()));
  return { ok: Boolean(t.trim()) && !unknown.length && !missing.length, amounts, unknown, missing };
}

function demoLine(member) {
  if (!member) return '';
  const where = [CENTRE_NAMES[member.centre] || member.centre, member.space && member.space !== 'Open area' && member.space !== 'Virtual' ? member.space : ''].filter(Boolean).join(', ');
  return `Demo: you're writing as ${member.company} (${member.member_id}, ${where}).`;
}

// ---------------- date and money helpers (shared with change_rules.js) ----------------
function isoOk(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function d0(iso) { return new Date(String(iso).slice(0, 10) + 'T00:00:00Z'); }
function iso(d) { return d.toISOString().slice(0, 10); }
function addDays(s, n) { const d = d0(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); }
function lastDay(s) { const d = d0(s); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate(); }
function addMonths(s, n) {
  const d = d0(s); const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  t.setUTCDate(Math.min(day, lastDay(iso(t))));
  return iso(t);
}
function daysBetween(a, b) { return Math.round((d0(b) - d0(a)) / 86400000); }
function addBusinessDays(s, n) {
  let d = s;
  while (n > 0) { d = addDays(d, 1); const w = d0(d).getUTCDay(); if (w !== 0 && w !== 6 && !FIXED_HOLIDAYS.includes(d.slice(5))) n--; }
  return d;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function nice(s) { if (!isoOk(s)) return String(s || ''); const d = d0(s); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function monthName(s) { const d = d0(s); return `${MONTHS_LONG[d.getUTCMonth()]} ${d.getUTCFullYear()}`; }
function inr(n) {
  const neg = n < 0; const s = String(Math.round(Math.abs(n)));
  const out = s.length <= 3 ? s : s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  return (neg ? '-' : '') + '₹' + out;
}

// ===== n8n wrapper (WF-3 "Check the draft") =====
// Every billing reply waits for the Finance Manager. Code checks the draft's
// amounts and key items against the facts; if it fails, the reply offered for
// approval is built from the facts themselves. Also builds the approval email,
// the account manager's FYI and the billing_cases row.
const a = $('Work out the case').first().json;
const ran = name => { try { const n = $(name); return n.isExecuted ? n.first().json : null; } catch (err) { return null; } };
const first = ran('Draft the reply');
const second = ran('Draft again');
const aiDraft = String((first && first.text) || (second && second.text) || '').trim();
const p = a.plan;
const m = a.member;
const ownerFirst = String(a.owner).split(' ')[0];
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ---- check, with a facts-only fallback ----
const chk = checkReply(aiDraft, a.allowed_text, a.must_mention);
const usedAi = Boolean(aiDraft) && chk.ok;
const template = `Hi ${a.contact_first},\n\nThank you for your email. Here is where things stand:\n\n${p.customer_facts.map(f => '- ' + f).join('\n')}\n\n${ownerFirst}\nFinance, Launchbench Workspaces`;
const draft = usedAi ? aiDraft : template;
const body = (a.demo_line ? a.demo_line + '\n\n' : '') + draft;
const checkText = !aiDraft ? 'The AI draft failed, so the reply below is built directly from the checked facts.'
  : !chk.ok ? `The AI draft failed the check (${[chk.unknown.length ? `${chk.unknown.join(', ')} not in the facts` : '', chk.missing.length ? `missing ${chk.missing.join(', ')}` : ''].filter(Boolean).join('; ')}), so the reply below is built directly from the checked facts.`
  : `Checks passed: ${chk.amounts.length === 1 ? 'the one amount matches the records' : chk.amounts.length ? `all ${chk.amounts.length} amounts match the records` : 'no amounts quoted'}${a.must_mention.length ? `; it states ${a.must_mention.join(', ')}` : ''}.`;

// ---- ids, labels ----
// Test-runner seeds repeat, so their id also carries this run's execution number.
const caseId = 'B-' + String(a.now).slice(0, 10).replace(/-/g, '') + '-' + (a.seed_id ? `S${a.seed_id}-x${$execution.id}` : String(a.message_id || Date.parse(a.now)).slice(-5));
const company = m ? m.company : (a.identity.company || '');
const who = (m && m.company.replace(/ (Pvt\.|Private) Ltd\.?$/i, '')) || a.contact_first || a.from_name;
const received = String(a.now || '').replace('T', ' ').slice(0, 16);
const files = (p.attach_invoices || []).map(n => n.replace(/\//g, '-') + '.pdf');

// ---- approval email ----
const box = 'white-space:pre-wrap;text-align:left;padding:10px 14px;border-radius:6px;';
const rows = [
  ['From', `${esc(a.from_name)} &lt;${esc(a.reply_to)}&gt;`],
  ['Member', m ? `${esc(m.company)} (${m.member_id}): ${esc(m.plan)}, ${m.seats} seats, ${esc(CENTRE_NAMES[m.centre] || m.centre)}${m.space && m.space !== 'Open area' ? ', ' + esc(m.space) : ''}, ${esc(m.status)}${m.exit_date ? ' (exited ' + nice(m.exit_date) + ')' : ''}`
    + `<br>Billing contact ${esc(m.contact_email)}; account manager ${esc(m.account_manager)}`
    + (a.identity.source ? ` <span style="color:#666">(matched by ${esc(a.identity.source)})</span>` : '') : 'Not matched to a member'],
  ['Topic', `<b>${esc(p.summary)}</b>`],
  ['Priority', p.priority === 'high' ? '<b style="color:#B3261E">High</b>' : 'Normal'],
  ['Reply due', `${nice(p.reply_due)} (billing replies within 1 business day)`],
];
if (a.churn_risk) rows.push(['Churn risk', '<b>Yes</b>, flagged by the classifier']);
if (files.length) rows.push(['Attached when sent', esc(files.join(', '))]);
const list = xs => `<ul>${xs.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
const html = `<div style="text-align:left">`
  + `<p style="padding:8px 12px;border-radius:6px;background:${usedAi ? '#E3F1E7' : '#FFF4D6'}">${esc(checkText)}</p>`
  + (p.flags.length ? `<p style="padding:8px 12px;border-radius:6px;background:#FDECEA">${esc(p.flags.join('. '))}.</p>` : '')
  + `<p>A billing reply for <b>${esc(a.owner)}</b> to approve${p.fyi.length ? ` (FYI ${esc(p.fyi.join(', '))}: ${esc(p.fyi_reason)})` : ''}. The claim was checked against the invoices and usage records; Gemini only wrote the wording.</p>`
  + `<table cellpadding="4" style="border-collapse:collapse;text-align:left">${rows.map(r => `<tr><td style="color:#666;vertical-align:top">${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`
  + (p.actions.length ? `<p><b>Finance to do</b></p>${list(p.actions)}` : '')
  + (p.internal_facts.length ? `<p><b>For you only</b> (not in the reply)</p>${list(p.internal_facts)}` : '')
  + `<p><b>Their email</b>, received ${esc(received)} IST${a.attachments ? ', attachments: ' + esc(a.attachments) : ', no attachments'}:</p>`
  + `<div style="${box}background:#F6F1E9"><b>Subject:</b> ${esc(a.subject || '(none)')}\n\n${esc(a.body || '')}</div>`
  + `<p><b>The reply covers</b></p>${list(p.customer_facts)}`
  + `<p><b>Reply</b> to ${esc(a.reply_to)} (sent when you approve):</p>`
  + `<div style="${box}border-left:3px solid #F26B1D;border-radius:0">${esc(body)}</div>`
  + (!usedAi && aiDraft ? `<p style="color:#666"><b>The AI draft that failed the check</b>, for reference:</p><div style="${box}color:#666;background:#F4F4F4">${esc(aiDraft)}</div>` : '')
  + `</div>`;

// ---- FYI to the account manager (no approval needed) ----
const notes = [];
if (p.fyi_emails.length) {
  notes.push({ to: p.fyi_emails.join(','), subject: `FYI billing: ${who} (${p.fyi_reason})`,
    html: `<div style="text-align:left"><p>${esc(a.owner)} has been asked to approve a reply to ${esc(a.from_name)}: ${esc(p.summary)}.</p>`
      + (p.flags.length ? `<p><b>${esc(p.flags.join('. '))}.</b></p>` : '') + list(p.internal_facts)
      + (p.actions.length ? `<p><b>Finance to do</b></p>${list(p.actions)}` : '')
      + `<p><b>Their email:</b></p><div style="${box}background:#F6F1E9">${esc(a.body)}</div></div>` });
}

return [{ json: {
  case_id: caseId, received_at: a.now, source: a.source, seed_id: a.seed_id, member_id: m ? m.member_id : '',
  company, sender: a.reply_to, topics: p.topics.join(', '), invoices: p.invoices.join(', '), amount_inr: p.amount_inr,
  actions: p.actions.join('; '), priority: p.priority, status: 'Awaiting approval', owner: a.owner,
  draft_check: checkText, draft_reply: body,
  // fields for the email nodes
  message_id: a.message_id, reply_to: a.reply_to, reply_subject: a.reply_subject, reply_body: body,
  owner_email: a.owner_email, attach_files: files,
  approval_subject: `${p.priority === 'high' ? 'URGENT: ' : ''}${usedAi ? '' : '[CHECK] '}Approve billing reply: ${who} (${p.summary.split(':')[0]})`,
  approval_html: html, staff_notes: notes,
} }];
