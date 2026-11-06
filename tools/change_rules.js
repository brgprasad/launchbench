// Launchbench membership-change rules and reply checks (WF-5 Code nodes).
//
// Gemini only writes the wording. This code applies kb/03-membership-terms.md:
// notice periods, exit dates, lock-ins, early-exit and partial-exit fees,
// smaller/bigger/other-centre spaces, deposit refunds, and open invoices. It
// also checks every draft (amounts and key dates) before anything is sent.
// The same text is pasted into n8n; tools/test_change_rules.js runs it locally.
//
// planChange(input, data) -> plan
//   input: { change: {type, seats_from, seats_to, effective, to_centre}, member: members row,
//            now: ISO time received, churn_risk }
//   data:  { pricing: {sku: value}, availability: [rows], invoices: [rows] }
// checkReply(text, allowedText, mustMention) -> { ok, amounts, unknown, missing }
// demoLine(member) -> "Demo: you're writing as ..." (code-written, never the AI)

const CENTRE_NAMES = { KOR: 'Koramangala', IND: 'Indiranagar', HSR: 'HSR Layout', WHF: 'Whitefield', HEB: 'Hebbal (Manyata)' };
const STAFF_EMAIL = {
  'Ananya Bose': 'teamlaunchbench+lb-ananya@gmail.com',
  'Vikram Shetty': 'teamlaunchbench+lb-vikram@gmail.com',
  'Deepa Menon': 'teamlaunchbench+lb-deepa@gmail.com',
  'Farhan Sheikh': 'teamlaunchbench+lb-farhan@gmail.com',
  'Kavya Reddy': 'teamlaunchbench+lb-kavya@gmail.com',
};
const HEAD_OF_SALES = 'Farhan Sheikh';
const HEAD_OF_OPS = 'Kavya Reddy';
const FIXED_HOLIDAYS = ['01-26', '08-15', '10-02', '11-01', '12-25'];
const BIG_ACCOUNT_INR = 100000; // monthly fee at or above this: Head of Sales hears about any exit or downsize

// kb/03-membership-terms.md §2 (lock-in), §4 (notice); deposits from the price list.
const PLAN_RULES = {
  'Hot desk': { kind: 'desk', sku: 'HOT', notice: 1, minLock: 0, depositMonths: 1 },
  'Dedicated desk': { kind: 'desk', sku: 'DED', notice: 1, minLock: 3, depositMonths: 2 },
  'Founders Plan': { kind: 'desk', sku: 'FND', notice: 1, minLock: 3, depositMonths: 1 },
  'Private cabin': { kind: 'cabin', sku: 'CAB', notice: 2, minLock: 6, depositMonths: 2 },
  'Virtual office': { kind: 'virtual', sku: 'VO', notice: 0, minLock: 12, depositMonths: 0 },
};

function planChange(input, data) {
  const P = data.pricing || {};
  const m = input.member;
  const ch = input.change || {};
  const today = String(input.now || '').slice(0, 10);
  if (!m) return { ok: false, type: ch.type || '', reason: 'No member record', customer_facts: [], internal_facts: [], must_mention: [] };

  const planName = String(m.plan || '');
  const rules = PLAN_RULES[planName] || (planName.startsWith('Virtual office') ? PLAN_RULES['Virtual office'] : PLAN_RULES['Dedicated desk']);
  const seats = Number(m.seats) || 0;
  const monthly = Number(m.monthly_seat_fee_inr) || 0;
  const perSeat = seats ? monthly / seats : 0;
  const deposit = Number(m.security_deposit_inr) || 0;
  const lockEnd = isoOk(m.lock_in_end) ? m.lock_in_end : '';
  const centre = m.centre;
  const centreName = CENTRE_NAMES[centre] || centre;
  const rate = (kind, c) => Number(P[`${kind === 'cabin' ? 'CAB' : rules.sku}-${c}`] || 0);
  // Their price relative to today's list price (lock-in discount, escalation), so a
  // new space is estimated on the same terms.
  const memberList = rate(rules.kind, centre) * seats;
  const ratio = memberList ? monthly / memberList : 1;

  const requested = isoOk(ch.effective) ? ch.effective : '';
  const type = ['exit', 'downsize', 'upgrade', 'move'].includes(ch.type) ? ch.type : 'unclear';
  const am = m.account_manager || HEAD_OF_SALES;
  const amFirst = am.split(' ')[0];

  const plan = {
    ok: true, type, member_id: m.member_id, company: m.company, centre, centre_name: centreName,
    plan: planName, seats, space: m.space, monthly, deposit, lock_in_end: lockEnd,
    received: today, requested, notice_months: rules.notice, notice_end: '', effective: '', exit_date: '',
    refund_by: '', fee_inr: 0, fee_basis: '', new_monthly: 0, options: [],
    customer_facts: [], internal_facts: [], must_mention: [], flags: [],
    approver: am, approver_email: STAFF_EMAIL[am] || STAFF_EMAIL[HEAD_OF_SALES], fyi: [], fyi_emails: [],
    reply_due: addBusinessDays(today, 2),
  };
  const C = s => plan.customer_facts.push(s);
  const I = s => plan.internal_facts.push(s);

  // ---- open invoices (every change) ----
  const open = (data.invoices || []).filter(r => r.member_id === m.member_id && !/^(paid|cancelled)/i.test(r.status || ''))
    .map(r => ({ no: r.invoice_no, total: Number(r.total_inr) || 0, due: r.due_date, status: r.status, late_fee: Number(r.late_fee_inr) || 0,
      days: r.due_date && today > r.due_date ? daysBetween(r.due_date, today) : 0 }));
  plan.open_invoices = open;
  for (const v of open) {
    if (v.days > 0) {
      I(`Invoice ${v.no} (${inr(v.total)}, due ${nice(v.due)}) is overdue at day ${v.days}. ` +
        (v.days < 30 ? `The day-30 suspension warning is due ${nice(addDays(v.due, 30))}.` : v.days < 45 ? `Access may be suspended from ${nice(addDays(v.due, 45))}.` : 'It is past day 45: access may be suspended.'));
      C(`Our records show invoice ${v.no} (${inr(v.total)}, due ${nice(v.due)}) is still unpaid.`);
    } else {
      I(`Invoice ${v.no} (${inr(v.total)}) is due ${nice(v.due)}${v.late_fee ? `; it includes a late fee of ${inr(v.late_fee)}` : ''}.`);
    }
  }

  if (type === 'exit') exit();
  else if (type === 'downsize') downsize();
  else if (type === 'upgrade') upgrade();
  else if (type === 'move') move();
  else {
    plan.flags.push('The change requested is unclear');
    C(`${amFirst} will call to understand exactly what you would like to change.`);
  }

  // Who hears about it besides the account manager.
  const fyi = input.churn_risk || plan.fee_inr > 0 || (['exit', 'downsize'].includes(type) && monthly >= BIG_ACCOUNT_INR);
  if (fyi && am !== HEAD_OF_SALES) {
    plan.fyi = [HEAD_OF_SALES];
    plan.fyi_emails = [STAFF_EMAIL[HEAD_OF_SALES]];
    plan.fyi_reason = [input.churn_risk && 'churn risk flagged', plan.fee_inr > 0 && `a fee of about ${inr(plan.fee_inr)}`,
      ['exit', 'downsize'].includes(type) && monthly >= BIG_ACCOUNT_INR && `a ${inr(monthly)}/month account`].filter(Boolean).join('; ');
  }
  plan.summary = summary();
  return plan;

  // ---------------- change types ----------------
  function exit() {
    if (rules.kind === 'virtual') {
      plan.exit_date = lockEnd || addMonths(today, 1);
      plan.notice_end = today;
      C(`A virtual office needs no notice: it simply does not renew. Your current term ends ${nice(plan.exit_date)}, so the membership ends then.`);
      plan.must_mention.push(nice(plan.exit_date));
      I(`Virtual office ends at the term end, ${nice(plan.exit_date)}. Prepaid annually; no refund for the remaining months.`);
      return;
    }
    plan.notice_end = addMonths(today, rules.notice);
    const standard = maxDate(requested, plan.notice_end, lockEnd);
    plan.exit_date = standard;
    plan.effective = standard;
    C(`We received the notice on ${nice(today)}. The ${planName.toLowerCase()} notice period is ${months(rules.notice)}, which runs to ${nice(plan.notice_end)}.`);
    if (requested && requested < plan.notice_end) C(`The date asked for (${nice(requested)}) is inside the notice period, so it cannot be the exit date.`);
    if (lockEnd && lockEnd >= maxDate(requested, plan.notice_end)) {
      const early = maxDate(requested, plan.notice_end);
      const mo = monthsBetween(early, addDays(lockEnd, 1));
      plan.fee_inr = Math.round(monthly * mo);
      plan.fee_basis = `early exit: ${inr(monthly)} × ${mo} months left in the lock-in after ${nice(early)}`;
      C(`The lock-in runs to ${nice(lockEnd)}, so the standard exit date is ${nice(standard)}. Leaving earlier, from ${nice(early)}, is possible with an early-exit fee equal to the seat fees for the rest of the lock-in, which can be adjusted against the deposit. ${amFirst} will call to go through the figures.`);
      I(`Early exit from ${nice(early)} would cost about ${inr(plan.fee_inr)} (${plan.fee_basis}). The Head of Sales may waive part of it if the space is re-let; never promise this.`);
    } else {
      C(`Your exit date is ${nice(standard)}.`);
    }
    plan.must_mention.push(nice(standard));
    const endMonth = monthName(standard);
    C(`Seat fees are billed up to the exit date, so the last seat-fee invoice is for ${endMonth}${standard.slice(8) !== String(lastDay(standard)).padStart(2, '0') ? ' (pro-rata)' : ''}. Any usage charges for ${endMonth} are settled from the deposit or on a final invoice.`);
    plan.refund_by = addDays(standard, 30);
    C(`The security deposit of ${inr(deposit)} is refunded to your registered bank account by ${nice(plan.refund_by)} (within 30 days of the exit date), less any unpaid invoices, usage charges, damage beyond normal wear, and ${inr(Number(P['CARD-REPLACE']) || 500)} for each access card not returned (${seats} card${seats === 1 ? '' : 's'} issued). An itemised deduction statement comes with the refund.`);
    plan.must_mention.push(nice(plan.refund_by));
    C(`We confirm every notice in writing within 2 business days; this email is that confirmation once sent.`);
    I(`Revenue lost: ${inr(monthly)}/month from ${nice(standard)}. ${amFirst} may want to ask why they are leaving.`);
  }

  function downsize() {
    const to = Number(ch.seats_to) || 0;
    const from = Number(ch.seats_from) || seats;
    if (from && from !== seats) I(`They wrote ${from} seats; our records show ${seats}.`);
    if (!to || to >= seats) {
      plan.flags.push('Target seat count unclear');
      C(`${amFirst} will call to confirm how many seats you need.`);
      return;
    }
    const released = seats - to;
    if (rules.kind === 'cabin') return cabinDownsize(to, released);
    if (rules.kind === 'virtual') { plan.flags.push('Virtual office has no seats'); return; }

    const normal = maxDate(requested, addMonths(today, rules.notice));
    const inLock = lockEnd && normal <= lockEnd;
    if (!inLock) {
      plan.notice_end = addMonths(today, rules.notice);
      plan.effective = normal;
      plan.new_monthly = Math.round(perSeat * to);
      C(`${lockEnd ? `Your lock-in ended ${nice(lockEnd)}, so` : 'With no lock-in,'} reducing from ${seats} to ${to} seats needs only the normal ${months(rules.notice)} notice and carries no fee. The earliest date is ${nice(plan.effective)}.`);
      plan.must_mention.push(nice(plan.effective));
    } else {
      plan.notice_end = addMonths(today, 2);
      plan.effective = maxDate(requested, plan.notice_end);
      const allowance = Math.floor(seats * 0.2);
      const extra = Math.max(0, released - allowance);
      const mo = lockEnd > plan.effective ? monthsBetween(plan.effective, addDays(lockEnd, 1)) : 0;
      plan.new_monthly = Math.round(perSeat * to);
      C(`During the lock-in (to ${nice(lockEnd)}) desks can be reduced once by up to 20% of seats (${allowance} of your ${seats}) with 2 months' notice, so the earliest date is ${nice(plan.effective)}.`);
      plan.must_mention.push(nice(plan.effective));
      if (extra > 0 && mo > 0) {
        plan.fee_inr = Math.round(extra * perSeat * mo);
        plan.fee_basis = `partial early exit: ${extra} seats beyond the 20% allowance × ${inr(perSeat)} × ${mo} months left after ${nice(plan.effective)}`;
        C(`Releasing ${released} seats goes beyond that, so the ${extra} extra seat${extra === 1 ? '' : 's'} count as a partial early exit: their seat fees remain payable until the lock-in ends. ${amFirst} will call to go through the figures.`);
        I(`Partial early-exit fee ≈ ${inr(plan.fee_inr)} (${plan.fee_basis}).`);
      } else {
        C(`That is within the 20% allowance, so there is no fee.`);
      }
    }
    const newDep = Math.round(plan.new_monthly * rules.depositMonths);
    I(`New fee about ${inr(plan.new_monthly)}/month for ${to} seats (from ${inr(monthly)}). Deposit ${inr(deposit)} → ${inr(newDep)}; the excess can be refunded or set against any fee.`);
  }

  function cabinDownsize(to, released) {
    C(`A cabin can't be partly released: a smaller team moves to a smaller cabin, if one is free.`);
    plan.notice_end = addMonths(today, 2);
    const fits = (data.availability || []).filter(r => /cabin/i.test(r.space_type) && Number(r.cabin_size) >= to && Number(r.cabin_size) < seats)
      .map(r => ({ centre: r.centre, centre_name: CENTRE_NAMES[r.centre] || r.centre, size: Number(r.cabin_size), ref: r.space_ref, from: r.available_from }))
      // The smallest cabin that fits wins (what they asked for); ties go to their own centre.
      .sort((a, b) => a.size - b.size || (a.centre === centre ? 0 : 1) - (b.centre === centre ? 0 : 1) || (a.from < b.from ? -1 : 1));
    // Show the best fit anywhere, plus the best at their own centre if that is a different cabin.
    const sameBest = fits.find(o => o.centre === centre);
    const chosen = [fits[0], sameBest].filter((o, i, a) => o && a.indexOf(o) === i);
    if (!chosen.length) {
      plan.flags.push('No smaller cabin free');
      plan.effective = maxDate(requested, plan.notice_end);
      C(`Cabins need 2 months' notice, so the earliest a change could take effect is ${nice(plan.effective)}. There is no smaller cabin free at any centre right now; ${amFirst} will call to discuss the options.`);
      plan.must_mention.push(nice(plan.effective));
      return;
    }
    for (const o of chosen) {
      o.monthly = Math.round(o.size * rate('cabin', o.centre) * ratio);
      o.effective = maxDate(requested, plan.notice_end, o.from);
      o.diff = Math.round((seats - o.size) * perSeat);
      o.months = lockEnd && lockEnd > o.effective ? monthsBetween(o.effective, addDays(lockEnd, 1)) : 0;
      o.fee = Math.round(o.diff * o.months);
    }
    plan.options = chosen;
    const best = chosen[0];
    plan.effective = best.effective;
    plan.new_monthly = best.monthly;
    plan.fee_inr = best.fee;
    plan.fee_basis = best.fee ? `partial early exit: ${inr(best.diff)}/month difference (${seats - best.size} seats × ${inr(perSeat)}) × ${best.months} months left in the lock-in after ${nice(best.effective)}` : '';
    const when = requested && requested < plan.notice_end ? `, so it cannot take effect on ${nice(requested)}` : '';
    C(`Cabins need 2 months' notice${when}. The earliest date for the move is ${nice(best.effective)}.`);
    plan.must_mention.push(nice(best.effective));
    if (best.centre === centre) {
      C(`${best.ref} at ${centreName} (${best.size} seats) is free from ${nice(best.from)}.`);
    } else {
      C(`There is no ${to}-seat cabin free at ${centreName}. ${best.ref} at ${best.centre_name} (${best.size} seats) is free from ${nice(best.from)}; moving there means changing centre, at ${best.centre_name} rates.`);
      if (sameBest) C(`At ${centreName}, the smallest free cabin is ${sameBest.ref} (${sameBest.size} seats), free from ${nice(sameBest.from)}.`);
      plan.flags.push(`No ${to}-seat cabin at ${centreName}`);
    }
    if (best.fee) {
      C(`Your lock-in runs to ${nice(lockEnd)}. Moving to a smaller cabin during the lock-in counts as a partial early exit: the difference in seat fees is payable for the lock-in months left after the move. ${amFirst} will call to go through the figures.`);
    } else {
      C(`${lockEnd ? `Your lock-in ends ${nice(lockEnd)}, before the move, so` : 'As there is no lock-in,'} there is no partial-exit fee.`);
    }
    for (const o of chosen) {
      I(`${o.ref} at ${o.centre_name} (${o.size} seats, free ${nice(o.from)}): from ${nice(o.effective)} about ${inr(o.monthly)}/month at ${o.centre_name} rates on their current terms` +
        (o.fee ? `; partial-exit difference ${inr(o.diff)}/month × ${o.months} months ≈ ${inr(o.fee)}.` : '; no partial-exit fee.'));
    }
    if (best.size > to) I(`They asked for ${to} seats; the smallest suitable cabin has ${best.size}.`);
    const newDep = Math.round(best.monthly * rules.depositMonths);
    I(`Deposit ${inr(deposit)} → ${inr(newDep)} for the new cabin; the excess can be set against the partial-exit fee.`);
  }

  function upgrade() {
    const to = Number(ch.seats_to) || 0;
    C(`Upgrades are allowed at any time, subject to availability, with no fee. A new ${rules.minLock}-month minimum lock-in starts on the upgrade date, and the deposit is topped up to match the new plan.`);
    if (!to || to <= seats) { plan.flags.push('Target seat count unclear'); C(`${amFirst} will call to confirm how many seats you need.`); return; }
    if (rules.kind === 'cabin') {
      const big = (data.availability || []).filter(r => r.centre === centre && /cabin/i.test(r.space_type) && Number(r.cabin_size) >= to)
        .sort((a, b) => Number(a.cabin_size) - Number(b.cabin_size) || (a.available_from < b.available_from ? -1 : 1))[0];
      if (big) {
        plan.effective = maxDate(requested, big.available_from, today);
        plan.new_monthly = Math.round(Number(big.cabin_size) * rate('cabin', centre) * ratio);
        C(`${big.space_ref} at ${centreName} (${big.cabin_size} seats) is free from ${nice(big.available_from)}. ${amFirst} will send the revised figures.`);
        plan.must_mention.push(big.space_ref);
        I(`${big.space_ref}: about ${inr(plan.new_monthly)}/month on their current terms (list ${inr(Number(big.cabin_size) * rate('cabin', centre))}).`);
      } else {
        plan.flags.push(`No ${to}-seat cabin free at ${centreName}`);
        C(`There is no cabin for ${to} at ${centreName} right now; ${amFirst} will call with options at other centres.`);
      }
    } else {
      const row = (data.availability || []).find(r => r.centre === centre && r.space_type === (planName === 'Founders Plan' ? 'Dedicated desk' : planName));
      const free = row ? Number(row.units_available) : 0;
      plan.new_monthly = Math.round(perSeat * to);
      if (free >= to - seats) {
        plan.effective = maxDate(requested, row.available_from, today);
        C(`${to - seats} more ${planName.toLowerCase()} seat${to - seats === 1 ? ' is' : 's are'} free at ${centreName}. ${amFirst} will send the revised figures.`);
      } else {
        plan.flags.push(`Only ${free} desks free at ${centreName}`);
        C(`Only ${free} more seat${free === 1 ? ' is' : 's are'} free at ${centreName} right now; ${amFirst} will call with options.`);
      }
      I(`About ${inr(plan.new_monthly)}/month for ${to} seats at their current per-seat rate.`);
    }
  }

  function move() {
    const to = String(ch.to_centre || '').toUpperCase();
    if (!CENTRE_NAMES[to] || to === centre) {
      plan.flags.push('Target centre unclear');
      C(`Moving between centres needs 1 month's notice, subject to availability; ${amFirst} will call to confirm which centre you have in mind.`);
      return;
    }
    plan.notice_end = addMonths(today, 1);
    const toName = CENTRE_NAMES[to];
    let space = null;
    if (rules.kind === 'cabin') {
      space = (data.availability || []).filter(r => r.centre === to && /cabin/i.test(r.space_type) && Number(r.cabin_size) >= seats)
        .sort((a, b) => Number(a.cabin_size) - Number(b.cabin_size) || (a.available_from < b.available_from ? -1 : 1))[0];
    } else {
      space = (data.availability || []).find(r => r.centre === to && r.space_type === (planName === 'Founders Plan' ? 'Dedicated desk' : planName) && Number(r.units_available) >= seats);
    }
    const newRate = rate(rules.kind, to);
    if (!space || !newRate) {
      plan.flags.push(`Nothing suitable at ${toName}`);
      C(`Moving to ${toName} needs 1 month's notice, but nothing suitable for ${seats} is free there right now. ${amFirst} will call with options.`);
      return;
    }
    const size = rules.kind === 'cabin' ? Number(space.cabin_size) : seats;
    plan.effective = maxDate(requested, plan.notice_end, space.available_from);
    plan.new_monthly = Math.round(size * newRate * ratio);
    C(`Moving between centres needs 1 month's notice, so the earliest move date is ${nice(plan.effective)}. ${rules.kind === 'cabin' ? `${space.space_ref} at ${toName} (${size} seats) is free from ${nice(space.available_from)}.` : `${planName} seats are free at ${toName}.`}`);
    C(`Prices change to ${toName} rates from the move date${lockEnd && lockEnd > plan.effective ? `, and the remaining lock-in (to ${nice(lockEnd)}) carries over` : ''}. ${amFirst} will send the revised figures.`);
    plan.must_mention.push(nice(plan.effective));
    if (size > seats) C('As the new space has more seats, it counts as an upgrade: a new minimum lock-in starts and the deposit is topped up.');
    I(`At ${toName}: about ${inr(plan.new_monthly)}/month (${size} seats × ${inr(newRate)} on their current terms), from ${inr(monthly)}.`);
  }

  function summary() {
    const bits = [type];
    if (plan.exit_date) bits.push('exit ' + plan.exit_date);
    else if (plan.effective) bits.push('from ' + plan.effective);
    if (plan.new_monthly) bits.push('new fee ' + inr(plan.new_monthly));
    if (plan.fee_inr) bits.push('fee ≈ ' + inr(plan.fee_inr));
    if (plan.flags.length) bits.push(plan.flags.join('; '));
    return bits.join(', ');
  }

  // ---------------- small utilities ----------------
  function months(n) { return n === 1 ? '1 month' : `${n} months`; }
}

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

// ---------------- date and money helpers (shared) ----------------
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
// Months from a to b (b exclusive), whole months plus the fraction of the last one.
function monthsBetween(a, b) {
  if (b <= a) return 0;
  let n = 0;
  while (addMonths(a, n + 1) <= b) n++;
  const start = addMonths(a, n), next = addMonths(a, n + 1);
  return Math.round((n + daysBetween(start, b) / daysBetween(start, next)) * 100) / 100;
}
function maxDate(...xs) { return xs.filter(isoOk).sort().pop() || ''; }
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
