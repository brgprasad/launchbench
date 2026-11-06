// ===== WF-E "Describe the failure" =====
// n8n runs this workflow when WF-0 to WF-5 fail in a production run. Turn the
// raw error into what happened, what it means for the sender, and what to do,
// and decide whether to email: the same workflow + node + error is emailed at
// most once per 30 minutes (a Gemini outage sends one alert, not twenty).
const t = $('On any failure').first().json;
const ex = t.execution || {};
const wf = t.workflow || {};
const trig = t.trigger || null;               // the trigger itself failed (e.g. Gmail polling)
const err = ex.error || (trig && trig.error) || {};
const message = String(err.message || 'Unknown error').slice(0, 500);
const detail = String(err.description || '').slice(0, 500);
const node = ex.lastNodeExecuted || (err.node && err.node.name) || (trig ? 'trigger' : 'unknown');
const nodeType = String((err.node && err.node.type) || '');
const all = `${message} ${detail} ${err.httpCode || ''}`;
const wfName = String(wf.name || 'unknown workflow');
const wfShort = (wfName.match(/WF-[0-9A-Z]+/) || [wfName])[0];
const now = $now.setZone('Asia/Kolkata');

// ---- what went wrong (first match wins) ----
const isGemini = /gemini|palm|generativelanguage/i.test(nodeType + ' ' + all) || /^(Draft|Classify|Gemini)/.test(node);
const isSheets = /googleSheets/i.test(nodeType) || /sheets/i.test(all) || /^(Read|Log|Mark|Remember)\b/.test(node);
const isGmail = /gmail/i.test(nodeType) || /^(Reply|Send|Ask|Notify|Mark as read|New email)/.test(node);
const isDrive = /googleDrive/i.test(nodeType) || /^(Find|Download|File)/.test(node);
const credential = isGmail ? 'teamlaunchbench@gmail.com' : isSheets ? 'Google Sheets account' : isDrive ? 'Google Drive account' : isGemini ? 'Google Gemini(PaLM) Api account' : 'the Google credential this node uses';
let diagnosis, action;
if (/429|quota|RESOURCE_EXHAUSTED|rate.?limit|too many requests/i.test(all) && isGemini) {
  diagnosis = 'Gemini refused the call: the free quota is used up (per minute, or the 500-a-day limit).';
  action = 'If it is the daily limit, it resets at 1:30 pm IST. Otherwise wait a minute. Then retry the run.';
} else if (/429|quota|rate.?limit|too many requests/i.test(all)) {
  diagnosis = `Google limited the number of requests${isSheets ? ' to the spreadsheet (about 60 writes a minute)' : ''}.`;
  action = 'Wait a minute, then retry the run.';
} else if (/invalid_grant|unauthori[sz]ed|\b401\b|token (has been )?(expired|revoked)|invalid credentials|forbidden|\b403\b/i.test(all)) {
  diagnosis = `A Google sign-in has expired or been revoked: most likely "${credential}".`;
  action = `In n8n open Credentials → "${credential}" → Reconnect, signing in as ${isGmail ? 'teamlaunchbench@gmail.com' : isGemini ? 'the AI Studio account (or paste a new API key)' : 'the Google account that credential was first connected with'}. Then retry the run.`;
} else if (/timed? ?out|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up|\b50[0234]\b|service unavailable|bad gateway/i.test(all)) {
  diagnosis = 'A temporary network or service problem (timeout or a 5xx answer from Google).';
  action = 'Retry the run. If it keeps happening, check status.cloud.google.com.';
} else if (/TypeError|ReferenceError|SyntaxError|is not defined|Cannot read prop|is not a function/i.test(all)) {
  diagnosis = `A bug in the "${node}" Code node.`;
  action = 'Open the run, read the error on the red node, fix the code in the repo (workflows/code/) and in n8n, then retry the run.';
} else {
  diagnosis = 'An error the handler does not recognise.';
  action = 'Open the run, read the error on the red node, fix the cause, then retry the run.';
}

// ---- what it means for the person who emailed ----
const afterApproval = /^(Reply to sender|Send to sender|Reply with the PDF|Send with the PDF|Mark sent|Mark held)$/.test(node);
const IMPACT = {
  'WF-0': 'The email was not fully triaged. If it failed before "Mark as read", the email is still unread in the inbox, and the stuck-email check will label it Launchbench/Error.',
  'WF-1': 'The lead may not have received the acknowledgement, and the quote may not have gone for approval.',
  'WF-2': 'The member may not have received the ticket acknowledgement, and the centre manager may not have been told.',
  'WF-3': 'The billing reply may not have been drafted or sent for Finance approval.',
  'WF-4': 'The vendor invoice may not have been checked, filed in Drive or logged.',
  'WF-5': 'The reply to the question or change may not have been sent, or sent for approval.',
};
const impact = afterApproval
  ? 'It failed after the reply was approved: the approved reply may not have reached the sender.'
  : trig ? `The trigger itself failed, so new emails are not being picked up until it works again.`
  : (IMPACT[wfShort] || 'The automation did not finish this run.');

// ---- email it, or is this a repeat? ----
const key = `${wfShort}|${node}|${message.slice(0, 80)}`;
const since = now.minus({ minutes: 30 }).toFormat('yyyy-MM-dd HH:mm:ss');
const repeat = $('Read recent errors').all().some(r => r.json.alert_key === key && r.json.emailed === 'yes' && String(r.json.logged_at) >= since);
const url = ex.url || '';
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const rows = [['Workflow', esc(wfName)], ['Failed at', esc(node)], ['When', now.toFormat('d LLL yyyy, h:mm a') + ' IST'], ['Error', esc(message) + (detail ? `<br><span style="color:#666">${esc(detail)}</span>` : '')]];
const html = `<div style="text-align:left">`
  + `<p style="padding:8px 12px;border-radius:6px;background:#FDECEA"><b>${esc(diagnosis)}</b></p>`
  + `<p><b>What it means:</b> ${esc(impact)}</p>`
  + `<p><b>What to do:</b> ${esc(action)}</p>`
  + `<table cellpadding="4" style="border-collapse:collapse;text-align:left">${rows.map(r => `<tr><td style="color:#666;vertical-align:top">${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</table>`
  + (url ? `<p><a href="${esc(url)}">Open the failed run in n8n</a> (it shows the email being handled; Retry is at the top right).</p>` : '')
  + `<p style="color:#666">Repeats of this error in the next 30 minutes are logged in the errors tab but not emailed.</p></div>`;

return [{ json: {
  logged_at: now.toFormat('yyyy-MM-dd HH:mm:ss'), kind: trig ? 'trigger failure' : 'failure', workflow: wfName, node,
  error: message, diagnosis, impact, action, execution_url: url, alert_key: key, emailed: repeat ? 'no (repeat)' : 'yes',
  send: !repeat, subject: `n8n alert: ${wfShort} failed at "${node}"`, html,
} }];
