
// ===== n8n wrapper (WF-4 "Check the invoice") =====
// WF-0 runs WF-4 once per email, so there is exactly one item.
const e = $('From WF-0').first().json;
const ran = name => { try { const n = $(name); return n.isExecuted ? n.first().json : null; } catch (err) { return null; } };
let invoice = null;
let failed = false;
if (e.has_pdf) {
  const a = ran('Read the invoice');
  const b = ran('Read the invoice again');
  invoice = (a && a.output) || (b && b.output) || null;
  failed = !invoice;
}
const r = checkInvoice({
  email: { from_address: e.from_address, effective_from: e.effective_from, tagged: e.tagged, subject: e.subject,
    body: e.body, now: e.now, reply_to: e.reply_to, has_pdf: e.has_pdf },
  classifier: e.classifier || {}, identity: e.identity || {}, invoice, extraction_failed: failed,
}, {
  vendors: $('Read vendors').all().map(i => i.json),
  // Test-runner emails ignore rows written by earlier test runs, so a re-run
  // isn't rejected as a duplicate of itself. Live email sees every row.
  ap_invoices: $('Read ap_invoices').all().map(i => i.json).filter(row => !(e.source === 'seed' && row.source === 'seed')),
  tickets: $('Read tickets').all().map(i => i.json),
});

const gst = invoice ? Number(invoice.cgst || 0) + Number(invoice.sgst || 0) + Number(invoice.igst || 0) : 0;
const row = invoice ? {
  received_at: String(e.now).slice(0, 10), vendor_id: r.vendor_id, vendor_name: r.vendor_name, vendor_gstin: invoice.vendor_gstin,
  invoice_no: invoice.invoice_no, invoice_date: invoice.invoice_date, billing_period: invoice.billing_period,
  po_number: invoice.po_number, taxable_amount: invoice.taxable_amount, gst_amount: Math.round(gst * 100) / 100,
  total_amount: invoice.total_amount, validation_status: r.status,
  flags: [...r.flags, ...r.fraud_text.map(f => 'FRAUD: ' + f)].join(' | '),
  approver: r.approvers.join('; '), scheduled_payment_run: r.payment_run,
  seed_id: e.seed_id || '', sender: e.from_address, checks: r.checks.map(c => c.n + (c.ok ? '✓' : '✗')).join(' '),
} : {};
return [{
  json: {
    ...row, source: e.source, has_invoice: Boolean(invoice),
    file_name: invoice ? `${r.vendor_id || 'UNKNOWN'} ${String(invoice.invoice_no).replace(/[\\/]/g, '-')} (${r.status}).pdf` : '',
    check: r, message_id: e.message_id || '', reply_to: e.reply_to,
    reply_subject: /^re:/i.test(e.subject || '') ? e.subject : 'Re: ' + (e.subject || 'your invoice'),
  },
  binary: $('From WF-0').first().binary || {},
}];
