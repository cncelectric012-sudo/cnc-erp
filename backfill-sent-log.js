// backfill-sent-log.js
// PM2 log file se aaj ke sent messages wa_broadcast_log mein save karo
// Run: node backfill-sent-log.js

const fs   = require('fs');
const path = require('path');

const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const SB_HDR = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' };

// Log file path — Z840 pe yeh path use ho raha hai
const LOG_FILE = 'C:\\CNC-ERP\\sent-today.txt';

function parseLog(text) {
  const rows = [];
  const sentAt = new Date().toISOString(); // aaj ki date

  for (const line of text.split('\n')) {
    // Sent: [Bot] ✓ Client Name (923xxxxxxxxx)
    const sentMatch = line.match(/\[Bot\]\s+[✓✓]\s+(.+?)\s+\((\d+)\)/u);
    if (sentMatch) {
      rows.push({
        contact_name: sentMatch[1].trim(),
        phone: sentMatch[2].trim(),
        label: 'Daily Ledger',
        template: 'daily_ledger',
        status: 'sent',
        sent_at: sentAt
      });
      continue;
    }

    // Failed: [Bot] ✗ Client Name — error
    const failMatch = line.match(/\[Bot\]\s+[✗✗]\s+(.+?)\s+[—-]/u);
    if (failMatch) {
      rows.push({
        contact_name: failMatch[1].trim(),
        phone: '',
        label: 'Daily Ledger',
        template: 'daily_ledger',
        status: 'failed',
        sent_at: sentAt
      });
    }
  }
  return rows;
}

async function save(rows) {
  const BATCH = 100;
  let saved = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const r = await fetch(`${SUPABASE_URL}/wa_broadcast_log`, {
      method: 'POST',
      headers: SB_HDR,
      body: JSON.stringify(batch)
    });
    if (!r.ok) {
      const e = await r.text();
      console.error(`Batch ${i}-${i+BATCH} fail:`, e);
    } else {
      saved += batch.length;
      console.log(`✓ ${saved}/${rows.length} saved...`);
    }
  }
}

async function main() {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`File nahi mili: ${LOG_FILE}`);
    console.error('Pehle yeh run karo:');
    console.error('  pm2 logs whatsapp-bot --lines 3000 --nostream | Out-File -Encoding utf8 "C:\\CNC-ERP\\sent-today.txt"');
    process.exit(1);
  }

  const text = fs.readFileSync(LOG_FILE, 'utf8');
  const rows = parseLog(text);
  console.log(`Log file mein ${rows.length} entries mili`);

  if (!rows.length) {
    console.log('Koi parseable entry nahi mili. Log file check karo.');
    process.exit(0);
  }

  const sent    = rows.filter(r => r.status === 'sent').length;
  const failed  = rows.filter(r => r.status === 'failed').length;
  console.log(`  ✓ Sent: ${sent}  ✗ Failed: ${failed}`);

  await save(rows);
  console.log('Done! Inbox ke Sent Log tab mein refresh karo.');
}

main().catch(e => { console.error(e); process.exit(1); });
