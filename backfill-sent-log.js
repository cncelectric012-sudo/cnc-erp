// backfill-sent-log.js
// Aaj ke broadcast ki retroactive log banao clients table se
// Run: node backfill-sent-log.js

const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const REST  = SUPABASE_URL + '/rest/v1';
const HDR   = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };

function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, '');
  if (p.startsWith('0092'))                       p = '92' + p.slice(4);
  else if (p.startsWith('92') && p.length === 12) {}
  else if (p.startsWith('0') && p.length === 11)  p = '92' + p.slice(1);
  else if (p.length === 10)                       p = '92' + p;
  if (p.length !== 12 || !p.startsWith('92')) return null;
  return p;
}

async function main() {
  // Aaj ki date/time Pakistan
  const sentAt = new Date().toISOString();

  console.log('Clients fetch ho rahe hain...');
  const r = await fetch(`${REST}/clients?record_source=eq.erp_live&status=eq.Active&select=name,phone&limit=2000`, { headers: HDR });
  const clients = await r.json();
  if (!Array.isArray(clients)) { console.error('Clients fetch fail:', clients); process.exit(1); }
  console.log(`${clients.length} active clients mile`);

  const rows = clients.map(c => {
    const phone = normalizePhone(c.phone);
    return {
      phone: phone || (c.phone || ''),
      contact_name: c.name || '',
      label: 'Daily Ledger',
      template: 'daily_ledger',
      status: phone ? 'sent' : 'skipped',
      sent_at: sentAt
    };
  });

  const sent    = rows.filter(r => r.status === 'sent').length;
  const skipped = rows.filter(r => r.status === 'skipped').length;
  console.log(`  ✓ Sent: ${sent}  Skipped (invalid phone): ${skipped}`);
  console.log('Supabase mein save ho raha hai...');

  const BATCH = 100;
  let saved = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const res = await fetch(`${REST}/wa_broadcast_log`, { method: 'POST', headers: HDR, body: JSON.stringify(batch) });
    if (!res.ok) { console.error('Batch fail:', await res.text()); }
    else { saved += batch.length; process.stdout.write(`\r  Saved: ${saved}/${rows.length}`); }
  }

  console.log('\nDone! Inbox ka Sent Log tab refresh karo.');
}

main().catch(e => { console.error(e); process.exit(1); });
