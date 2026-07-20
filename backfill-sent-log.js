// backfill-sent-log.js — PM2 log se wa_broadcast_log backfill
// Run: node backfill-sent-log.js

const fs = require('fs');

const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const SB_HDR = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
};

const LOG_FILE = 'C:\\CNC-ERP\\sent-today.txt';

function parseLog(text) {
  const rows = [];
  const sentAt = new Date().toISOString();

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (!line.includes('[Bot]')) continue;
    if (line.includes('Done —')) continue;
    if (line.includes('Report ')) continue;
    if (line.includes('clients —')) continue;
    if (line.includes('Inbox mein')) continue;
    if (line.includes('Trigger')) continue;
    if (line.includes('shuru')) continue;
    if (line.includes('Ready')) continue;
    if (line.includes('Agli')) continue;
    if (line.includes('save hue')) continue;

    // Match phone number pattern (923xxxxxxxxx) — present in sent lines
    const phoneMatch = line.match(/\((\d{10,13})\)/);
    if (phoneMatch) {
      // Extract client name: everything between [Bot] XX and (phone)
      const nameMatch = line.match(/\[Bot\]\s+.{0,3}\s+(.+?)\s+\(\d+\)/);
      const name = nameMatch ? nameMatch[1].trim() : '';
      const phone = phoneMatch[1];

      // Failed lines contain ✗ or common error keywords
      const isFailed = line.includes('✗') || line.includes('error') || line.includes('fail');
      rows.push({
        contact_name: name,
        phone,
        label: 'Daily Ledger',
        template: 'daily_ledger',
        status: isFailed ? 'failed' : 'sent',
        sent_at: sentAt
      });
      continue;
    }

    // Lines with — but no phone = failed (phone was invalid)
    if ((line.includes('✗') || line.includes('error')) && line.includes('[Bot]')) {
      const nameMatch = line.match(/\[Bot\]\s+.{0,3}\s+(.+?)\s+[—\-]/);
      if (nameMatch) {
        rows.push({
          contact_name: nameMatch[1].trim(),
          phone: '',
          label: 'Daily Ledger',
          template: 'daily_ledger',
          status: 'failed',
          sent_at: sentAt
        });
      }
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
      method: 'POST', headers: SB_HDR, body: JSON.stringify(batch)
    });
    if (!r.ok) {
      console.error(`Batch ${i} fail:`, await r.text());
    } else {
      saved += batch.length;
      process.stdout.write(`\r✓ ${saved}/${rows.length} saved...`);
    }
  }
  console.log('\nDone!');
}

async function main() {
  if (!fs.existsSync(LOG_FILE)) {
    console.error(`File nahi mili: ${LOG_FILE}`);
    process.exit(1);
  }

  // Try multiple encodings
  let text;
  try { text = fs.readFileSync(LOG_FILE, 'utf8'); }
  catch(e) { text = fs.readFileSync(LOG_FILE, 'utf16le'); }

  // Debug: pehli 5 matching lines print karo
  const sample = text.split('\n').filter(l => l.includes('[Bot]')).slice(0, 5);
  console.log('Sample lines:');
  sample.forEach(l => console.log(' |', l.trim()));

  const rows = parseLog(text);
  console.log(`\n${rows.length} entries mili`);

  if (!rows.length) {
    console.log('Koi entry nahi mili. Encoding issue ho sakta hai.');
    process.exit(0);
  }

  const sent   = rows.filter(r => r.status === 'sent').length;
  const failed = rows.filter(r => r.status === 'failed').length;
  console.log(`  ✓ Sent: ${sent}  ✗ Failed: ${failed}`);
  console.log('Saving to Supabase...');

  await save(rows);
  console.log('Inbox ka Sent Log tab refresh karo!');
}

main().catch(e => { console.error(e); process.exit(1); });
