// ===== WF-E "Sum up the stuck emails" =====
// Every email WF-0 handles is marked read, so an unread inbox email older than
// 10 minutes was never handled: the classifier failed (an ERROR row in
// triage_log), WF-0 failed before "Mark as read", or the Gmail trigger itself
// is broken. They are now labelled Launchbench/Error; send one alert listing them.
const mails = $('Find stuck emails').all().map(i => i.json).filter(j => j.id);
const now = $now.setZone('Asia/Kolkata');
const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const when = j => j.internalDate ? DateTime.fromMillis(Number(j.internalDate)).setZone('Asia/Kolkata').toFormat('d LLL, h:mm a') : '';
const list = mails.map(j => `<li><b>${esc(j.Subject || '(no subject)')}</b><br>from ${esc(j.From || '?')}, received ${when(j)} IST</li>`).join('');
const n = mails.length;
const diagnosis = `${n} email${n === 1 ? '' : 's'} in the inbox ${n === 1 ? 'was' : 'were'} never handled (still unread after 10 minutes).`;
const action = 'Check triage_log for an ERROR row (classifier failure) and n8n Executions for a failed WF-0 run. If there is no run at all, the Gmail trigger is not working: open WF-0 and check that it is published and its Gmail credential is connected. To reprocess an email, retry its failed run, or forward it to the inbox again.';
const html = `<div style="text-align:left">`
  + `<p style="padding:8px 12px;border-radius:6px;background:#FDECEA"><b>${esc(diagnosis)}</b> They are labelled Launchbench/Error in Gmail.</p>`
  + `<ul>${list}</ul>`
  + `<p><b>What it means:</b> these senders have had no reply.</p>`
  + `<p><b>What to do:</b> ${esc(action)}</p>`
  + `<p style="color:#666">Remove the label once handled; labelled emails are not reported again.</p></div>`;
return [{ json: {
  logged_at: now.toFormat('yyyy-MM-dd HH:mm:ss'), kind: 'stuck email', workflow: 'LB · WF-0 Intake & triage', node: 'New email',
  error: mails.map(j => `${j.From || '?'}: ${j.Subject || '(no subject)'}`).join(' | ').slice(0, 500),
  diagnosis, impact: 'The senders have had no reply.', action, execution_url: '', alert_key: 'stuck|' + mails.map(j => j.id).join(','), emailed: 'yes',
  subject: `n8n alert: ${n} unanswered email${n === 1 ? '' : 's'} in the inbox`, html,
} }];
