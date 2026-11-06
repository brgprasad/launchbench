// Bulk mail (newsletters, marketing, mailing lists, auto-replies, no-reply
// notifications) is filed without an AI call, so spam sent to a harvested
// address can't use up the Gemini quota. A person writing from their own
// mailbox never sends these headers, so testers and real customers get through.
const j = $json;
const h = j.headers || {};
const val = k => String(h[k] || '').replace(/^[^:]*:\s*/, '').trim().toLowerCase();
const from = String((j.from && j.from.value && j.from.value[0] && j.from.value[0].address) || '').toLowerCase();
const binary = $input.item.binary || {};
const hasPdf = Object.values(binary).some(b => b.mimeType === 'application/pdf' || /\.pdf$/i.test(b.fileName || ''));

const reasons = [];
if (h['list-unsubscribe']) reasons.push('List-Unsubscribe header');
if (h['list-id']) reasons.push('List-Id header');
if (/^(bulk|list|junk)$/.test(val('precedence'))) reasons.push('Precedence: ' + val('precedence'));
if (val('auto-submitted') && val('auto-submitted') !== 'no') reasons.push('Auto-Submitted: ' + val('auto-submitted'));
const cat = (j.labelIds || []).find(l => ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS'].includes(l));
if (cat) reasons.push('Gmail category ' + cat.replace('CATEGORY_', '').toLowerCase());
if (/^(no-?reply|do-?not-?reply|mailer-daemon|postmaster)@/.test(from)) reasons.push('no-reply sender');

// Never skipped: anything with a PDF (a supplier's billing system may add list
// headers to an invoice).
const keep = hasPdf;
return { json: { ...j, bulk_reason: keep ? '' : reasons.join('; ') }, binary };