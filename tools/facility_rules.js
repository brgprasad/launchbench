// Launchbench facility-ticket rules (WF-2 "Raise the ticket" Code node).
//
// Gemini reads the email (category, location, since, repeat claimed) and later
// writes the reply. This code applies kb/05-facility-sla.md: priority, SLA due
// times, owner, escalation stage, repeat detection, workarounds and the credit
// wording, and writes the ticket row and staff email. The same text is pasted
// into n8n; tools/test_facility_rules.js runs it locally.
//
// planTicket(input, data) -> ticket
//   input: { ticket_id, source, email: {subject, body, now}, classifier, member }
//   data:  { tickets: [rows], vendors: [rows], ap_invoices: [rows] }
// checkReply(text, allowedText, mustMention) and demoLine(member) as in WF-5.

const CENTRE_NAMES = { KOR: 'Koramangala', IND: 'Indiranagar', HSR: 'HSR Layout', WHF: 'Whitefield', HEB: 'Hebbal (Manyata)' };
const CENTRE_MANAGERS = { KOR: "Rohan D'Souza", IND: 'Priya Nair', HSR: 'Aditya Kulkarni', WHF: 'Sneha Pillai', HEB: 'Imran Qureshi' };
const ACCOUNT_MANAGERS = { KOR: 'Ananya Bose', IND: 'Ananya Bose', HSR: 'Vikram Shetty', WHF: 'Deepa Menon', HEB: 'Deepa Menon' };
const STAFF_EMAIL = {
  "Rohan D'Souza": 'teamlaunchbench+lb-rohan@gmail.com', 'Priya Nair': 'teamlaunchbench+lb-priya@gmail.com',
  'Aditya Kulkarni': 'teamlaunchbench+lb-aditya@gmail.com', 'Sneha Pillai': 'teamlaunchbench+lb-sneha@gmail.com',
  'Imran Qureshi': 'teamlaunchbench+lb-imran@gmail.com', 'Ananya Bose': 'teamlaunchbench+lb-ananya@gmail.com',
  'Vikram Shetty': 'teamlaunchbench+lb-vikram@gmail.com', 'Deepa Menon': 'teamlaunchbench+lb-deepa@gmail.com',
  'Kavya Reddy': 'teamlaunchbench+lb-kavya@gmail.com', 'Meera Iyer': 'teamlaunchbench+lb-meera@gmail.com',
};
const HEAD_OF_OPS = 'Kavya Reddy';
const COO = 'Meera Iyer';
const FIXED_HOLIDAYS = ['01-26', '08-15', '10-02', '11-01', '12-25'];
const IST_MS = 330 * 60000;

// kb/05-facility-sla.md: first response and resolution targets.
const SLA = {
  P1: { label: 'P1 (critical)', response: { hours: 0.5 }, resolution: { hours: 4 } },
  P2: { label: 'P2 (high)', response: { hours: 2 }, resolution: { hours: 24 } },
  P3: { label: 'P3 (medium)', response: { bdays: 1 }, resolution: { bdays: 3 } },
  P4: { label: 'P4 (low / request)', response: { bdays: 2 }, resolution: { bdays: 7 } },
};
// Classifier words -> ticket category, base priority, and the supplier who does the work.
const CATEGORIES = [
  { name: 'Safety', re: /safety|fire|smoke|leak|flood|lift|elevator|stuck|theft|security|gas|spark|shock|injur/, base: 'P1' },
  { name: 'Network', re: /internet|wi-?fi|lan|network|ethernet/, base: 'P2', wide: 'P1', vendor: /internet/i },
  { name: 'Power', re: /power|electric|socket|ups/, base: 'P2', wide: 'P1' },
  { name: 'HVAC', re: /\bac\b|hvac|air ?con|cooling|heat/, base: 'P2', vendor: /hvac|\bac\b/i },
  { name: 'Water & washrooms', re: /water|washroom|toilet|plumb/, base: 'P2' },
  { name: 'Access', re: /access|card|door|\block\b/, base: 'P2' },
  { name: 'Housekeeping', re: /housekeep|clean|dust|bin|garbage|pantry/, base: 'P3', vendor: /housekeeping/i },
  { name: 'Printer', re: /print|toner|scan/, base: 'P3', vendor: /printer/i },
  { name: 'Furniture', re: /furniture|chair|desk|table|light|bulb/, base: 'P3' },
  { name: 'Noise', re: /noise|noisy|loud/, base: 'P3' },
  { name: 'Request', re: /request|nameplate|signage|whiteboard|plant|new card|suggest/, base: 'P4' },
];
const WIDE = /\b(whole|entire|everyone|everybody|all of us)\b|\bfloor\b|\bcentre\b|\bcenter\b|building|other (people|members|companies|teams)/i;
const LEGAL = /\blawyer|legal (action|notice)|\bcourt\b|consumer forum|\bsue\b|\binjur|\bhurt\b|hospital/i;

function planTicket(input, data) {
  const c = input.classifier || {};
  const m = input.member || null;
  const issue = c.issue || {};
  const clues = c.identity_clues || {};
  const nowIso = String(input.now || input.email.now);
  const now = Date.parse(nowIso);
  const text = `${input.email.subject || ''}\n${input.email.body || ''}`;
  const facilityIntents = (c.intents || []).filter(i => i.class === 'facility_issue');
  const words = [issue.category, ...facilityIntents.map(i => i.subclass)].filter(Boolean).join(' ').toLowerCase();
  const summaryText = facilityIntents.map(i => i.summary).join(' ') || text;

  // ---- category and base priority (code, not the classifier's suggestion) ----
  let cats = CATEGORIES.filter(k => k.re.test(words));
  if (!cats.length) cats = CATEGORIES.filter(k => k.re.test(summaryText.toLowerCase()));
  if (!cats.length) cats = [{ name: 'Other', base: 'P3' }];
  // Health, safety and security are always P1, however the email is worded.
  const safety = cats.some(k => k.name === 'Safety') || /\b(fire|smoke|leak(ing)?|stuck in|theft|stolen|injur\w*|sparks?|gas)\b/i.test(summaryText);
  const wide = WIDE.test(`${issue.location || ''} ${text}`);
  const baseOf = k => (wide && k.wide) || k.base;
  let base = safety ? 'P1' : cats.map(baseOf).sort()[0];
  const category = cats.map(k => k.name).join(' + ');

  const centre = (m && m.centre) || clues.centre || '';
  const location = [issue.location || clues.cabin || (m && m.space) || '', centre && !String(issue.location || '').toLowerCase().includes(String(CENTRE_NAMES[centre] || '').toLowerCase().split(' ')[0]) ? CENTRE_NAMES[centre] : '']
    .filter(Boolean).join(', ');

  // ---- repeats: same member, same category, in the last 30 days ----
  const catNames = cats.map(k => k.name);
  const prior = (data.tickets || []).filter(t => m && t.member_id === m.member_id && t.ticket_id !== input.ticket_id
    && catNames.some(n => String(t.category || '').toLowerCase().includes(n.toLowerCase().split(' ')[0]))
    && Date.parse(String(t.received_at).replace(' ', 'T') + ':00+05:30') > now - 30 * 864e5
    && Date.parse(String(t.received_at).replace(' ', 'T') + ':00+05:30') < now);
  const reportCount = prior.length + 1;
  const linked = prior.map(t => t.ticket_id);

  // ---- overdue: they say they reported it earlier, and our target for it has passed ----
  const sinceMs = parseSince(issue.since);
  // "Reported before" must be in the email itself: the classifier sometimes reads
  // "keeps dropping for the last 2 days" as an earlier report (seed 15).
  const saysReportedBefore = /\b(reported|complain(ed|t|ts)?|told|informed|raised|mentioned|flagged|ticket|again|still|already|repeatedly|(second|third|fourth|\d+(st|nd|rd|th)) time|no one (came|has come)|nothing (has been|was) (done|fixed)|phir se|dobara)\b|फिर से|दोबारा|पहले|शिकायत/i.test(text);
  const overdue = Boolean(issue.repeat_claimed && saysReportedBefore && sinceMs && addTarget(sinceMs, SLA[base].resolution) < now);

  // ---- raise by one level (once) for a confirmed repeat or an overdue issue ----
  const raiseWhy = [];
  if (prior.length) raiseWhy.push(`repeat of ${linked.join(', ')} within 30 days`);
  if (overdue) raiseWhy.push(`reported since ${niceDateTime(sinceMs, true)}, so the ${SLA[base].label} resolution target has passed`);
  const priority = raiseWhy.length && base !== 'P1' ? 'P' + (Number(base[1]) - 1) : base;
  const unconfirmedRepeat = issue.repeat_claimed && !prior.length && !overdue;

  // ---- SLA times ----
  const responseDue = addTarget(now, SLA[priority].response);
  const resolutionDue = addTarget(now, SLA[priority].resolution);

  // ---- who ----
  const cm = CENTRE_MANAGERS[centre] || '';
  const am = (m && m.account_manager) || ACCOUNT_MANAGERS[centre] || '';
  const churn = Boolean(c.churn_risk);
  const legal = LEGAL.test(text);
  const stage = legal ? 3 : (reportCount >= 3 || overdue || churn) ? 2 : 1;
  const owner = cm || HEAD_OF_OPS;
  const escalatedTo = stage === 3 ? COO : stage === 2 ? HEAD_OF_OPS : '';
  const to = [stage === 3 ? COO : stage === 2 ? HEAD_OF_OPS : owner];
  const cc = [...new Set([owner, stage >= 2 ? am : '', stage === 3 ? HEAD_OF_OPS : ''].filter(n => n && !to.includes(n)))];
  const stageWhy = [legal && 'a legal threat or injury', reportCount >= 3 && `report ${reportCount} in 30 days`, overdue && 'the resolution target has passed',
    churn && 'the member hints at leaving'].filter(Boolean);

  // ---- what the reply must say (customer facts) ----
  const ownerRole = cm ? `our ${CENTRE_NAMES[centre]} centre manager` : 'our Head of Operations';
  const due = niceDue(resolutionDue, now);
  const facts = [];
  facts.push(`Ticket ${input.ticket_id}, priority ${SLA[priority].label}.`);
  facts.push(`${owner}, ${ownerRole}, is handling it, and we aim to have it fixed by ${due}.`);
  if (stage >= 2) facts.push(`We are sorry this has ${overdue ? 'gone on this long' : reportCount >= 3 ? 'happened again' : 'caused so much trouble'}. It has been escalated to ${escalatedTo}, our ${stage === 3 ? 'COO' : 'Head of Operations'}${churn ? `, who will call you to discuss what will change` : ''}.`);
  else if (prior.length) facts.push(`We are sorry this has happened again so soon after ticket ${linked[linked.length - 1]}.`);
  for (const k of cats) {
    if (['Network', 'HVAC', 'Power'].includes(k.name) && centre) facts.push(`If your team needs to move meanwhile, reception at ${CENTRE_NAMES[centre]} will find you a free meeting room or open-area desks for today.`);
    if (k.name === 'Network') facts.push('The guest Wi-Fi network ("Launchbench-Guest") is separate from the member network and may still work in the meantime.');
    if (k.name === 'Furniture' && /chair/i.test(summaryText)) facts.push('Reception will bring spare chairs today if any are available.');
  }
  const credits = (overdue || prior.length) && m && Number(m.seats) > 0;
  if (credits && base === 'P2' && /cabin/i.test(m.plan)) facts.push('If the issue stays unresolved for more than 3 business days, you may be eligible for a service credit under our facility policy; the centre manager confirms any credit.');
  else if (credits && base === 'P1') facts.push('If the issue stops your space from being used for more than 24 hours, you may be eligible for a service credit under our facility policy; the centre manager confirms any credit.');
  if (!m) facts.push('Please tell us your company and which centre you are at, as cabin names repeat across our centres.');
  const [fixTime] = due.match(/\d{1,2}:\d{2}/) || [''];
  const mustMention = [input.ticket_id, fixTime].filter(Boolean);

  // ---- internal notes (staff email only) ----
  const notes = [];
  notes.push(`Priority ${priority}: rules give ${base} for ${category}${wide && cats.some(k => k.wide) ? ' (affects more than one cabin)' : ''}${raiseWhy.length && base !== 'P1' ? `, raised one level: ${raiseWhy.join('; ')}` : raiseWhy.length ? ` (${raiseWhy.join('; ')})` : ''}. Gemini suggested ${issue.suggested_priority || 'none'}.`);
  notes.push(`First response due ${niceDateTime(responseDue)}; resolution due ${niceDateTime(resolutionDue)}.`);
  if (stage >= 2) notes.push(`Escalation stage ${stage} (${stageWhy.join('; ')}): ${escalatedTo}, with ${cc.join(', ')} in copy.`);
  for (const t of prior) notes.push(`Earlier ticket ${t.ticket_id} (${t.received_at}, ${t.priority}, ${t.status}): ${t.description}`);
  if (unconfirmedRepeat) notes.push(`The member says this has happened before, but there is no earlier ${category} ticket for them in the last 30 days. Check with the facilities team; raise the priority only if earlier reports are confirmed.`);
  if (churn) notes.push(`Churn risk flagged by the classifier. ${m ? `${m.company}: ${m.seats} seats, ₹${fmt(Number(m.monthly_seat_fee_inr))}/month${m.lock_in_end ? `, lock-in to ${m.lock_in_end}` : ''}.` : ''} Don't raise lock-in or exit fees in the reply.`);
  if (legal) notes.push('The email mentions legal action or an injury: COO informed.');
  for (const k of cats.filter(k => k.vendor)) {
    const v = (data.vendors || []).find(x => k.vendor.test(x.category));
    if (!v) continue;
    // Only an invoice still waiting on a decision is worth flagging.
    const inv = (data.ap_invoices || []).filter(r => r.vendor_id === v.vendor_id && /flag|hold|pending|review/i.test(r.validation_status || ''))
      .sort((a, b) => String(b.received_at).localeCompare(String(a.received_at)))[0];
    notes.push(`Supplier: ${v.vendor_name.replace(/\.$/, '')}.` + (inv ? ` Its invoice ${inv.invoice_no} (₹${fmt(Number(inv.total_amount))}) is ${String(inv.validation_status || 'pending').toLowerCase()}; consider this complaint before it is paid.` : ''));
  }
  if (!m) notes.push(`No member matched (clues: ${[clues.company, clues.cabin, clues.centre].filter(Boolean).join(', ') || 'none'}). The reply asks for their company and centre.`);

  const who = m ? m.company.replace(/ (Pvt\.? )?Ltd\.?| LLP/g, '') : (clues.company || 'unknown member');
  const short = (facilityIntents[0] && facilityIntents[0].summary) || input.email.subject || category;
  return {
    ticket_id: input.ticket_id, priority, base_priority: base, ai_priority: issue.suggested_priority || '', raised: raiseWhy,
    category, location, centre, wide, overdue, linked, report_count: reportCount, unconfirmed_repeat: unconfirmedRepeat,
    response_due: ymdhm(responseDue), resolution_due: ymdhm(resolutionDue), fix_by: due,
    owner, owner_email: STAFF_EMAIL[owner], stage, escalated_to: escalatedTo,
    to_emails: to.map(n => STAFF_EMAIL[n]).join(','), cc_emails: cc.map(n => STAFF_EMAIL[n]).join(','), to, cc,
    customer_facts: facts, internal_facts: notes, must_mention: mustMention,
    staff_subject: `${priority === 'P1' ? '[P1] ' : ''}${stage >= 2 ? 'ESCALATED: ' : ''}${input.ticket_id} ${who}, ${location || 'location unknown'}: ${short}`.slice(0, 180),
    row: {
      ticket_id: input.ticket_id, received_at: ymdhm(now), member_id: m ? m.member_id : '', company: m ? m.company : (clues.company || ''),
      centre, location, category, priority, description: facilityIntents.map(i => i.summary).join(' | ') || input.email.subject,
      sla_response_due: ymdhm(responseDue), sla_resolution_due: ymdhm(resolutionDue), assigned_to: owner,
      escalated_to: escalatedTo, status: 'Open', linked_tickets: linked.join(', '),
    },
  };

  // ---------------- helpers ----------------
  function parseSince(s) {
    s = String(s || '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return Date.parse(s + 'T09:00:00+05:30'); // a date alone: assume the start of the working day
    const t = Date.parse(s);
    return isNaN(t) ? 0 : t;
  }
}

// Due time: wall-clock hours (P1, P2) or business days at the same time of day (P3, P4).
function addTarget(ms, t) {
  if (t.hours) return ms + t.hours * 3600e3;
  let d = ms, n = t.bdays;
  while (n > 0) {
    d += 864e5;
    const ist = new Date(d + IST_MS);
    const w = ist.getUTCDay();
    const md = String(ist.getUTCMonth() + 1).padStart(2, '0') + '-' + String(ist.getUTCDate()).padStart(2, '0');
    if (w !== 0 && w !== 6 && !FIXED_HOLIDAYS.includes(md)) n--;
  }
  return d;
}
function ist(ms) { return new Date(ms + IST_MS); }
function ymdhm(ms) { return ist(ms).toISOString().slice(0, 16).replace('T', ' '); }
function clock(ms) {
  const d = ist(ms); let h = d.getUTCHours(); const mm = String(d.getUTCMinutes()).padStart(2, '0');
  const ap = h >= 12 ? 'pm' : 'am'; h = h % 12 || 12;
  return `${h}:${mm} ${ap}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
function dayMonth(ms) { const d = ist(ms); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`; }
function niceDateTime(ms, dateOnly) { return dateOnly ? `${dayMonth(ms)} ${ist(ms).getUTCFullYear()}` : `${clock(ms)}, ${dayMonth(ms)}`; }
// "4:20 pm today", "4:20 pm tomorrow (5 Nov)", "6:47 pm on Friday, 6 Nov"
function niceDue(ms, nowMs) {
  const days = Math.round((Date.UTC(ist(ms).getUTCFullYear(), ist(ms).getUTCMonth(), ist(ms).getUTCDate())
    - Date.UTC(ist(nowMs).getUTCFullYear(), ist(nowMs).getUTCMonth(), ist(nowMs).getUTCDate())) / 864e5);
  if (days === 0) return `${clock(ms)} today`;
  if (days === 1) return `${clock(ms)} tomorrow (${dayMonth(ms)})`;
  return `${clock(ms)} on ${DAYS[ist(ms).getUTCDay()]}, ${dayMonth(ms)}`;
}
function fmt(n) { const s = String(Math.round(n)); return s.length <= 3 ? s : s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3); }

// Every rupee amount in the text must appear in allowedText; every mustMention
// string must appear in the text.
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
