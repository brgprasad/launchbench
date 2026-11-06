// Who is this email from? Demo-mode rules, docs/workflow-design.md section 2.
// 1. An [as <alias>] subject tag (test runner, presenter) picks a persona.
// 2. Else a member named in the email: exactly one match on member ID, GSTIN,
//    company name, or cabin plus centre (cabin names repeat across centres).
// 3. Else, for member-only classes (facility issue, billing, change request):
//    a. the sender's domain is a member's domain (seed emails), else
//    b. the tester's member_alias in the testers tab, else
//    c. the member persona assigned to the fewest testers, remembered in the
//       testers tab (the "Remember the assignment" step), so a tester is the
//       same company in every email.
// 4. Else the sender is a prospect.
const MEMBER_CLASSES = ['facility_issue', 'customer_billing', 'change_request'];
const ref = $('Attach knowledge base').item.json;
const personas = ref.personas || [];
const members = ref.members || [];
const testers = ref.testers || [];
const clues = ($json.output && $json.output.identity_clues) || {};
const norm = s => String(s || '').trim().toLowerCase();
const GENERIC = ['private', 'limited', 'technologies', 'solutions', 'studio', 'labs', 'india', 'services', 'payments'];
const words = s => (norm(s).match(/[a-z0-9]{4,}/g) || []).filter(w => !GENERIC.includes(w));

let member = null;
let assign = null;
let identity = { type: 'prospect', member_id: '', vendor_id: '', company: clues.company || '', source: 'none' };
const asMember = (m, source) => { member = m; identity = { type: 'member', member_id: m.member_id, vendor_id: '', company: m.company, source }; };

const persona = ref.as_alias ? personas.find(p => norm(p.alias) === norm(ref.as_alias) || norm(p.ref_id) === norm(ref.as_alias)) : null;
if (persona) {
  if (persona.type === 'member') member = members.find(m => m.member_id === persona.ref_id) || null;
  identity = { type: persona.type, member_id: member ? member.member_id : '', vendor_id: persona.type === 'member' ? '' : persona.ref_id,
    company: member ? member.company : persona.as_name, source: 'tag ' + persona.alias };
} else {
  const tests = [
    ['member ID', m => clues.member_id && norm(m.member_id) === norm(clues.member_id)],
    ['GSTIN', m => clues.gstin && norm(m.gstin) === norm(clues.gstin)],
    ['company', m => { const w = words(clues.company); return w.length > 0 && w.every(x => norm(m.company).includes(x)); }],
    ['cabin', m => clues.cabin && clues.centre && m.centre === clues.centre && norm(m.space).replace(/\s/g, '').includes(norm(clues.cabin).replace(/cabin|\s/g, ''))],
  ];
  for (const [label, test] of tests) {
    const hits = members.filter(test);
    if (hits.length === 1) { asMember(hits[0], 'email ' + label); break; }
  }
}

const intents = ($json.output && $json.output.intents) || [];
if (!member && identity.type === 'prospect' && intents.some(i => MEMBER_CLASSES.includes(i.class))) {
  const sender = norm(ref.from_address);
  const domain = sender.split('@')[1] || '';
  const byDomain = members.filter(m => domain && norm(m.email_domain) === domain);
  const tester = testers.find(t => norm(t.tester_email) === sender);
  const pinned = tester && tester.member_alias
    ? personas.find(p => p.type === 'member' && (norm(p.alias) === norm(tester.member_alias) || norm(p.ref_id) === norm(tester.member_alias))) : null;
  const pinnedMember = pinned && members.find(m => m.member_id === pinned.ref_id);
  if (byDomain.length === 1) asMember(byDomain[0], 'sender domain');
  else if (pinnedMember) asMember(pinnedMember, 'tester ' + pinned.alias);
  else if (ref.source === 'live' && sender) {
    const used = {};
    for (const t of testers) if (t.member_alias) used[norm(t.member_alias)] = (used[norm(t.member_alias)] || 0) + 1;
    const pool = personas.filter(p => p.type === 'member' && members.some(m => m.member_id === p.ref_id && m.status === 'Active'))
      .sort((a, b) => (used[norm(a.alias)] || 0) - (used[norm(b.alias)] || 0));
    if (pool.length) {
      asMember(members.find(m => m.member_id === pool[0].ref_id), 'assigned ' + pool[0].alias);
      assign = { tester_email: sender, tester_name: (tester && tester.tester_name) || ref.from_name || '',
        member_alias: pool[0].alias, assigned_on: String(ref.now).slice(0, 10) };
    }
  }
}
return { json: { output: $json.output, identity, member, assign } };
