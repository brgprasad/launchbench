// Launchbench lead quote engine (WF-1 "Build the quote" Code node).
//
// The AI only extracts the lead's facts; this code decides what to offer and
// computes every rupee. Gemini then words the reply from the result, and is
// never asked to do arithmetic.
//
// quoteLead(input, data) -> result
//   input: { lead, subclass, member, now }      lead = classifier "lead" object
//   data:  { pricing: {sku: value}, availability: [rows], localities: [rows] }
//
// The same text is pasted into n8n; tools/test_lead_quote.js runs it locally
// against data/*.csv. Facts not in the CSVs (centre names, metro access, event
// halls, account managers) come from kb/00-company-profile.md and
// kb/01-centres.md.

const CENTRES = {
  KOR: { name: 'Koramangala', lat: 12.9343, lon: 77.6268, metro: '', hall: 80, am: 'Ananya Bose', sizes: [4, 6, 8, 12, 16, 20] },
  IND: { name: 'Indiranagar', lat: 12.9719, lon: 77.6412, metro: 'Indiranagar Metro (Purple Line), about 600 m', hall: 0, am: 'Ananya Bose', sizes: [4, 6, 8, 10, 12, 16, 20] },
  HSR: { name: 'HSR Layout', lat: 12.9150, lon: 77.6480, metro: '', hall: 0, am: 'Vikram Shetty', sizes: [4, 6, 8, 10, 12, 16, 20] },
  WHF: { name: 'Whitefield', lat: 12.9870, lon: 77.7380, metro: 'Kadugodi Tree Park Metro (Purple Line), about 800 m', hall: 120, am: 'Deepa Menon', sizes: [4, 6, 8, 12, 16, 20, 30] },
  HEB: { name: 'Hebbal (Manyata)', lat: 13.0450, lon: 77.6200, metro: '', hall: 0, am: 'Deepa Menon', sizes: [4, 6, 8, 12, 16, 20, 30] },
};
const STAFF = {
  'Ananya Bose': 'teamlaunchbench+lb-ananya@gmail.com',
  'Vikram Shetty': 'teamlaunchbench+lb-vikram@gmail.com',
  'Deepa Menon': 'teamlaunchbench+lb-deepa@gmail.com',
  'Farhan Sheikh': 'teamlaunchbench+lb-farhan@gmail.com',
};
const HEAD_OF_SALES = 'Farhan Sheikh';
const FIXED_HOLIDAYS = ['01-26', '08-15', '10-02', '11-01', '12-25'];

function quoteLead(input, data) {
  const P = data.pricing;
  const lead = input.lead || {};
  const member = input.member || null;
  const today = String(input.now || '').slice(0, 10);
  const subclass = String(input.subclass || '').toLowerCase();
  const interest = String(lead.plan_interest || '').toLowerCase();
  const team = Math.max(0, Math.round(Number(lead.team_size) || 0));
  const moveIn = /^\d{4}-\d{2}-\d{2}$/.test(lead.move_in || '') ? lead.move_in : '';
  const budget = Number(lead.budget_inr) || 0;
  const partner = String(lead.partner || '').trim();
  const notes = [];
  const firm = lead.timeline_firm === undefined ? Boolean(lead.move_in) : Boolean(lead.timeline_firm);

  const round = n => Math.round(n);
  const gst = n => round(n * (1 + P['TAX-GST'] / 100));
  const days = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  const pct = sku => (100 - P[sku]) / 100;
  const centreName = c => CENTRES[c] ? CENTRES[c].name : c;

  let centres = (lead.centres || []).map(c => String(c).toUpperCase()).filter(c => CENTRES[c]);
  if (!centres.length && member) centres = [member.centre];
  // An area that isn't one of our centres (e.g. Jayanagar): the locality table
  // gives its coordinates and code picks the nearest centres. If the area isn't
  // in the table, fall back to the classifier's guess and say so.
  const area = String(lead.area || '').trim();
  let areaSource = '';
  if (!centres.length && area) {
    const loc = findLocality(area, data.localities || []);
    if (loc) {
      const ranked = Object.keys(CENTRES).map(c => [c, km(loc.lat, loc.lon, CENTRES[c].lat, CENTRES[c].lon)]).sort((a, b) => a[1] - b[1]);
      areaSource = 'table';
      if (ranked[0][1] < 1.5) centres = [ranked[0][0]];
      else {
        centres = ranked.slice(0, 2).map(r => r[0]);
        notes.push(`We don't have a centre in ${loc.locality}. The nearest are ${ranked.slice(0, 2).map(r => `${centreName(r[0])} (about ${Math.round(r[1])} km away)`).join(' and ')}.`);
      }
    } else {
      const guess = (lead.area_centres || []).map(c => String(c).toUpperCase()).filter(c => CENTRES[c]).slice(0, 2);
      if (guess.length) {
        centres = guess;
        areaSource = 'ai';
        notes.push(`We don't have a centre in ${area}. The nearest are probably ${guess.map(centreName).join(' and ')}.`);
      }
    }
  }
  const stated = centres.length > 0;
  if (lead.near_metro) {
    const metro = centres.filter(c => CENTRES[c].metro);
    centres = metro.length ? metro : Object.keys(CENTRES).filter(c => CENTRES[c].metro);
  }
  if (!centres.length) centres = Object.keys(CENTRES);

  // ---------- what kind of enquiry ----------
  let kind;
  if (subclass === 'event_booking' || /event|launch|hall/.test(interest)) kind = 'event';
  else if (subclass === 'day_pass' || /day pass/.test(interest)) kind = 'day_pass';
  else if (/founder/.test(interest) || (team > 0 && team <= 3 && (partner || lead.incorporated === 'yes'))) kind = 'founders';
  else kind = 'space';

  // ---------- helpers for seat plans ----------
  function seatPlan(product, centre, seats, perSeat, minLock, depositMonths, credits, spaces, from) {
    const list = seats * perSeat;
    const terms = {};
    for (const [m, sku] of [[3, null], [6, 'DISC-LOCKIN-6'], [12, 'DISC-LOCKIN-12']]) {
      if (m < minLock) continue;
      const fee = round(list * (sku ? pct(sku) : 1));
      terms[m] = { months: m, monthly: fee, monthly_incl_gst: gst(fee), deposit: fee * depositMonths };
    }
    const opt = {
      product, centre, centre_name: centreName(centre), seats, per_seat_list: perSeat,
      list_monthly: list, min_lock_in_months: minLock, terms,
      meeting_credits: credits, spaces: spaces || [], available_from: from && from > today ? from : today,
      fits_move_in: !moveIn || (from || today) <= moveIn,
      metro: CENTRES[centre].metro,
    };
    if (partner) {
      const p = round(list * pct('DISC-PARTNER'));
      opt.partner = { name: partner, months_1_6: p, months_1_6_incl_gst: gst(p) };
    }
    return opt;
  }

  // Cabins billed on full capacity. A single cabin if one fits; otherwise the
  // smallest combination at one centre. Prefer spaces free by the move-in date.
  function cabinOption(centre) {
    if (!firm) {
      const size = CENTRES[centre].sizes.find(z => z >= team);
      if (!size) return null;
      const o = seatPlan('Private cabin', centre, size, P['CAB-' + centre], 6, 2, 4 * size, [], '');
      o.fits_move_in = true;
      o.available_from = '';
      o.availability_note = 'indicative: the exact cabin depends on availability nearer the move-in date';
      return o;
    }
    const units = [];
    for (const r of data.availability) {
      if (r.centre !== centre || r.space_type !== 'Private cabin') continue;
      const n = Number(r.units_available) || 0;
      const refs = n > 1 ? expandRefs(r.space_ref, n) : [r.space_ref];
      for (let i = 0; i < n; i++) units.push({ ref: refs[i] || r.space_ref, size: Number(r.cabin_size), from: r.available_from, note: r.notes || '' });
    }
    const sets = [];
    const nUnits = Math.min(units.length, 10);
    for (let mask = 1; mask < (1 << nUnits); mask++) {
      const s = units.filter((_, i) => mask & (1 << i));
      const seats = s.reduce((a, u) => a + u.size, 0);
      if (seats < team) continue;
      const from = s.map(u => u.from).sort().pop();
      sets.push({ s, seats, from, fits: !moveIn || from <= moveIn });
    }
    if (!sets.length) return null;
    const oversized = x => (team > 0 && x.seats > Math.max(team * 1.5, team + 2)) ? 1 : 0;
    const rank = x => [oversized(x), x.fits ? 0 : 1, x.s.length > 1 ? 1 : 0, x.seats, x.from, x.s.length];
    sets.sort((a, b) => cmp(rank(a), rank(b)));
    const best = sets[0];
    const spaces = best.s.map(u => ({ ref: u.ref, seats: u.size, available_from: u.from, note: /occupant/i.test(u.note) ? '' : u.note }));
    return seatPlan('Private cabin', centre, best.seats, P['CAB-' + centre], 6, 2, 4 * best.seats, spaces, best.from);
  }

  function deskOption(centre, product) {
    const row = data.availability.find(r => r.centre === centre && r.space_type === 'Dedicated desk');
    if (!row || Number(row.units_available) < team) return null;
    if (product === 'Founders Plan') {
      if (!P['FND-' + centre]) return null;
      const o = seatPlan('Founders Plan', centre, team, P['FND-' + centre], 3, 1, 10, [], row.available_from);
      delete o.terms[6]; delete o.terms[12];
      if (o.partner) o.terms[3].deposit = 0;
      return o;
    }
    return seatPlan('Dedicated desk', centre, team, P['DED-' + centre], 3, 2, 4 * team, [], row.available_from);
  }

  const result = {
    kind, team_size: team, move_in: moveIn, budget_inr: budget,
    budget_includes_gst: lead.budget_includes_gst || '', partner,
    member: member ? { id: member.member_id, company: member.company, centre: member.centre, plan: member.plan,
      seats: Number(member.seats), monthly_fee: Number(member.monthly_seat_fee_inr), deposit: Number(member.security_deposit_inr) } : null,
    options: [], recommended: -1, notes,
  };

  // ---------- event hall ----------
  if (kind === 'event') {
    const guests = Number(lead.event_guests) || team;
    const hours = Number(lead.event_hours) || 0;
    const date = moveIn;
    let centre = centres.find(c => CENTRES[c].hall >= (guests || 1)) ||
      Object.keys(CENTRES).find(c => CENTRES[c].hall >= (guests || 1));
    if (!centre) {
      notes.push(`No event hall seats ${guests} guests; the largest is Whitefield at 120.`);
    } else {
      if (stated && !centres.includes(centre)) notes.push(`${centres.map(centreName).join(' and ')} has no event hall big enough, so this quote is for ${centreName(centre)}.`);
      const blocks = hours ? [hours <= 5 ? 'HALF' : 'FULL'] : ['HALF', 'FULL'];
      for (const b of blocks) {
        const listPrice = P[`EVT-${centre}-${b}`];
        const price = member ? round(listPrice * pct('DISC-MEMBER-ROOMS')) : listPrice;
        result.options.push({
          product: `Event hall, ${b === 'HALF' ? 'half day (up to 5 hours)' : 'full day (up to 10 hours)'}`,
          centre, centre_name: centreName(centre), capacity: CENTRES[centre].hall, guests, hours, date,
          list_price: listPrice, member_discount_pct: member ? P['DISC-MEMBER-ROOMS'] : 0,
          price, price_incl_gst: gst(price), advance_50pct: round(price / 2), advance_incl_gst: gst(price / 2),
        });
      }
      result.recommended = 0;
      notes.push('Includes AV, a projector, 2 wireless microphones and basic seating layouts.');
      notes.push(`Catering is quoted separately${centre === 'KOR' ? ', through the Burn Rate Café or an approved caterer' : ', through an approved caterer'}.`);
      notes.push('A 50% advance confirms the booking. Cancelling more than 7 days before gets a full refund; within 7 days the advance is forfeited.');
      if (guests > 20) {
        const lead7 = date ? days(today, date) : null;
        notes.push(`More than 20 external guests needs 7 days' notice and a guest list${lead7 !== null ? (lead7 >= 7 ? ` (${date} is ${lead7} days away, so that's fine)` : ` (${date} is only ${lead7} days away, so the team must confirm)`) : ''}.`);
      }
      if (date && centre === 'KOR') {
        const dn = lastFriday(date);
        const gap = Math.abs(days(dn, date));
        if (gap === 0) notes.push(`${date} is Demo Night in the Koramangala hall, so the hall is not free that evening.`);
        else if (gap <= 3) notes.push(`No clash with Demo Night, which is on ${dn}.`);
      }
      if (date && isClosedDay(date)) notes.push(`${date} is a Sunday or public holiday; the team must confirm the hall can open.`);
    }
  }

  // ---------- day pass ----------
  else if (kind === 'day_pass') {
    result.options.push({
      product: 'Day pass', price: P['DAY-ALL'], price_incl_gst: gst(P['DAY-ALL']),
      hours: '8 am to 9 pm, Monday to Saturday, at any centre',
      includes: 'up to 1 hour in a 4-seater meeting room, subject to availability',
    });
    result.recommended = 0;
    notes.push('Centres are closed to day-pass users on Sundays and on Republic Day, Ugadi, Independence Day, Gandhi Jayanti, Deepavali, Kannada Rajyotsava and Christmas.');
    const hot = Object.keys(CENTRES).map(c => [c, P['HOT-' + c]]).sort((a, b) => a[1] - b[1])[0];
    notes.push(`For regular use, hot desks start at ${inr(hot[1])} a month + GST, at ${centreName(hot[0])}.`);
    notes.push('Do not offer the Founders Plan: freelancers and sole proprietors are not eligible.');
  }

  // ---------- Founders Plan ----------
  else if (kind === 'founders') {
    const fc = centres.filter(c => P['FND-' + c]);
    for (const c of (fc.length ? fc : ['KOR', 'IND', 'HSR'])) {
      const o = deskOption(c, 'Founders Plan');
      if (o) result.options.push(o);
    }
    if (!fc.length) notes.push('The Founders Plan is offered only at Koramangala, Indiranagar and HSR Layout.');
    if (team > 3) notes.push('The Founders Plan covers 1 to 3 seats; a larger team needs regular desks or a cabin.');
    notes.push('Eligibility: incorporated less than 3 years ago (certificate of incorporation needed) or DPIIT-recognised. Sole proprietors and freelancers are not eligible.');
    notes.push('To start: the certificate of incorporation (or DPIIT recognition), KYC (company PAN, GSTIN if any), the signed Membership Agreement' + (partner ? `, and a referral email from ${partner} or the cohort listing` : '') + '.');
    if (partner) {
      notes.push(`As a ${partner} referral, the ${P['DISC-PARTNER']}% partner discount applies for the first 6 months and no security deposit is needed.`);
      const o = result.options[0];
      if (o) notes.push(`From month 7 the regular fee applies: ${inr(o.list_monthly)} a month + GST.`);
    }
    result.recommended = result.options.length ? 0 : -1;
  }

  // ---------- desks and cabins ----------
  else {
    for (const c of centres) {
      if (team > 0 && team <= 10) { const d = deskOption(c, 'Dedicated desk'); if (d) result.options.push(d); }
      if (team >= 4 || /cabin/.test(interest)) { const k = cabinOption(c); if (k) result.options.push(k); }
    }
    if (!team) notes.push('The team size is not stated, so ask for it before quoting.');
    // Recommend: free by the move-in date, then within budget, then cheapest per month (12-month or best term).
    const headline = o => (o.terms[12] || o.terms[6] || o.terms[3]).monthly;
    const prefCabin = team >= 4 || /cabin/.test(interest);
    // When the lead named an area, centres are ordered by distance, and nearness beats price.
    const near = c => areaSource ? centres.indexOf(c) : 0;
    const scored = result.options.map((o, i) => ({ i, k: [o.fits_move_in ? 0 : 1, budget && headline(o) > budget ? 1 : 0, prefCabin && o.product !== 'Private cabin' ? 1 : 0, near(o.centre), headline(o)] }));
    scored.sort((a, b) => cmp(a.k, b.k));
    result.recommended = scored.length ? scored[0].i : -1;
    const best = result.options[result.recommended];
    // At most two alternatives: another plan at the same centre first, then the
    // best of the rest by the same ranking.
    if (best) {
      result.alternatives = scored.slice(1)
        .map(x => ({ i: x.i, k: [result.options[x.i].centre === best.centre ? 0 : 1, ...x.k] }))
        .sort((a, b) => cmp(a.k, b.k)).slice(0, 2).map(x => x.i);
    }
    const shown = [best, ...(result.alternatives || []).map(i => result.options[i])].filter(Boolean);

    for (const o of shown) {
      if (!o.fits_move_in && moveIn) notes.push(`${o.product} at ${o.centre_name} is free only from ${o.available_from}, later than the requested ${moveIn}.`);
    }
    if (best && budget) {
      const h = headline(best);
      for (const o of shown) {
        if (o !== best && headline(o) > budget && o.product === best.product) notes.push(`${o.centre_name} is not recommended: ${inr(headline(o))} a month is over the ${inr(budget)} budget.`);
      }
      if (lead.budget_includes_gst !== 'no' && gst(h) > budget && h <= budget) {
        notes.push(`The budget may or may not include GST. ${best.centre_name} is ${inr(h)} + GST = ${inr(gst(h))} including GST, which is over ${inr(budget)} if the budget includes GST; ask which it is.`);
        if (lead.near_metro) {
          const alt = Object.keys(CENTRES).filter(c => !CENTRES[c].metro).map(cabinOption).filter(Boolean)
            .filter(o => o.fits_move_in).sort((a, b) => headline(a) - headline(b))[0];
          if (alt && headline(alt) < h) notes.push(`If GST is included in the budget, ${alt.centre_name} is cheaper at ${inr(headline(alt))} + GST (${alt.seats}-seat, 12-month lock-in) but is not near a metro.`);
        }
      }
    }
    if (best && best.product === 'Private cabin') notes.push('Cabins are billed on full capacity, not headcount.');
    if (best && best.spaces.length > 1) notes.push(`${best.spaces.length} cabins together make up ${best.seats} seats${best.spaces.some(s => /same floor|adjacent/i.test(s.note)) ? ', all on the same floor' : ''}.`);
    if (team >= 5) notes.push('Teams of 5 or more seats can have a free 1-day trial of the shortlisted space before signing.');
    if (team > 40) notes.push('More than 40 seats needs Head of Sales approval.');
    if (member && best) {
      const m = result.member;
      notes.push(`Existing member ${m.company} (${m.id}) pays ${inr(m.monthly_fee)} a month for ${m.seats} × ${m.plan} at ${centreName(m.centre)}.`);
      notes.push('Upgrades have no fee. A new minimum lock-in starts on the upgrade date, and the deposit is topped up to match the new plan.');
      const t = best.terms[12] || best.terms[6];
      if (t) notes.push(`On a ${t.months}-month lock-in the deposit for the new space is ${inr(t.deposit)}; with ${inr(m.deposit)} already held, the top-up is ${inr(Math.max(0, t.deposit - m.deposit))}.`);
    }
  }

  // ---------- score and owner ----------
  const soon = moveIn && firm && days(today, moveIn) <= 60;
  if (kind === 'day_pass') { result.score = 'cold'; result.score_reason = 'Day pass enquiry'; }
  else if (soon && (budget > 0 || team >= 5 || stated)) {
    result.score = 'hot';
    result.score_reason = `Firm date ${moveIn} (${days(today, moveIn)} days away)` + (budget ? `, budget ${inr(budget)}` : '') + (team >= 5 ? `, ${team} seats` : '') + (stated ? `, centre ${centres.map(c => c).join('/')}` : '');
  } else {
    result.score = 'warm';
    result.score_reason = !firm ? 'No firm move-in date' : (moveIn ? `Move-in ${moveIn} is more than 60 days away` : 'No budget, date or centre yet');
  }

  if (!result.alternatives) result.alternatives = result.options.map((_, i) => i).filter(i => i !== result.recommended).slice(0, 2);
  result.area = area;
  result.area_source = areaSource;
  const rec = result.options[result.recommended];
  const space = kind === 'space' || kind === 'founders';
  const ownerCentre = rec && rec.centre ? rec.centre : (stated ? centres[0] : '');
  let owner = member ? member.account_manager : (ownerCentre ? CENTRES[ownerCentre].am : HEAD_OF_SALES);
  if ((space && team > 40) || (space && !rec)) owner = HEAD_OF_SALES;
  result.owner = owner;
  result.owner_email = STAFF[owner] || STAFF[HEAD_OF_SALES];
  result.cc = space && team >= 40 && owner !== HEAD_OF_SALES ? [HEAD_OF_SALES] : [];
  result.cc_emails = result.cc.map(n => STAFF[n]);
  result.recommended_text = rec ? describe(rec) : '';
  result.quoted_monthly_inr = rec ? (rec.terms ? (rec.partner ? rec.partner.months_1_6 : (rec.terms[12] || rec.terms[6] || rec.terms[3]).monthly) : rec.price) : 0;
  return result;

  // ---------- small utilities ----------
  function describe(o) {
    if (o.spaces && o.spaces.length) return `${o.centre_name}: ${o.spaces.map(s => `${s.ref} (${s.seats})`).join(' + ')}, from ${o.available_from}`;
    if (o.centre_name) return `${o.centre_name}: ${o.product}${o.seats ? ` × ${o.seats}` : ''}`;
    return o.product;
  }
  function cmp(a, b) { for (let i = 0; i < a.length; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; } return 0; }
  function inr(n) {
    const s = String(Math.round(n));
    if (s.length <= 3) return '₹' + s;
    return '₹' + s.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + s.slice(-3);
  }
  function expandRefs(ref, n) {
    // "Cabins 4A-4B" -> ["Cabin 4A", "Cabin 4B"]; "Cabins 2E-2F" likewise.
    const m = String(ref).match(/(\d+)([A-Z])-(\d+)([A-Z])/);
    if (!m) return Array.from({ length: n }, () => ref);
    const out = [];
    for (let c = m[2].charCodeAt(0); c <= m[4].charCodeAt(0) && out.length < n; c++) out.push(`Cabin ${m[1]}${String.fromCharCode(c)}`);
    return out;
  }
  function lastFriday(iso) {
    const d = new Date(iso + 'T00:00:00Z');
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    last.setUTCDate(last.getUTCDate() - ((last.getUTCDay() - 5 + 7) % 7));
    return last.toISOString().slice(0, 10);
  }
  function km(lat1, lon1, lat2, lon2) {
    const r = d => d * Math.PI / 180;
    const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lon2 - lon1) / 2) ** 2;
    return 6371 * 2 * Math.asin(Math.sqrt(a));
  }
  function findLocality(text, rows) {
    const n = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const t = n(text);
    const names = r => [r.locality, ...String(r.aliases || '').split('|')].map(n).filter(x => x.length >= 3);
    const hit = rows.find(r => names(r).includes(t)) || rows.find(r => names(r).some(x => x.length >= 4 && (t.includes(x) || x.includes(t))));
    return hit ? { locality: hit.locality, lat: Number(hit.lat), lon: Number(hit.lon) } : null;
  }
  function isClosedDay(iso) {
    return new Date(iso + 'T00:00:00Z').getUTCDay() === 0 || FIXED_HOLIDAYS.includes(iso.slice(5));
  }
}
