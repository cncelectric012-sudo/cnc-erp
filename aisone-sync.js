// aisone-sync.js — Aisone ERP → Supabase Live Sync
// Runs on Z840 via PM2. No extra npm packages needed.

const { exec } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');

const SQL_SERVER   = '.\\AISONESQL22';
const SQL_DB       = 'Cognitive solutions private limited';
const SQL_FILE     = path.join(__dirname, 'aisone-query.sql');
const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Run sqlcmd and return parsed rows ────────────────────────
function runSQL() {
  return new Promise((resolve) => {
    const cmd = `sqlcmd -S "${SQL_SERVER}" -d "${SQL_DB}" -i "${SQL_FILE}" -s "|" -h -1 -W`;
    exec(cmd, { timeout: 60000 }, (err, stdout, stderr) => {
      if (err) {
        console.error('[AisoneSync] SQL error:', stderr || err.message);
        return resolve([]);
      }
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .filter(l => l.trim() && !l.match(/^[-| ]+$/) && !l.match(/^\d+ rows affected/i));
      const rows = lines.map(l => l.split('|').map(v => v.trim()));
      resolve(rows);
    });
  });
}

// ── Supabase upsert ──────────────────────────────────────────
async function sbFetch(path, method, body) {
  const r = await fetch(`${SUPABASE_URL}${path}`, {
    method,
    headers: SB_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 409) {
    const t = await r.text();
    console.error(`[AisoneSync] Supabase ${method} ${path} → ${r.status}:`, t);
  }
  return r;
}

// ── Main sync ────────────────────────────────────────────────
async function syncClients() {
  const ts = new Date().toLocaleTimeString('en-PK');
  console.log(`[AisoneSync] ${ts} — starting sync...`);

  const rows = await runSQL();
  if (!rows.length) {
    console.log('[AisoneSync] No data returned from SQL.');
    return;
  }

  // rows: [AutoID, CompanyName, Phone, Outstanding, CreditLimit]
  const accounts = rows.filter(r => r.length >= 4 && /^\d+$/.test(r[0]));
  console.log(`[AisoneSync] ${accounts.length} accounts from ERP`);

  let inserted = 0, updated = 0, errors = 0;

  for (const r of accounts) {
    const [autoId, name, phone, outStr, creditStr] = r;
    const outstanding = parseFloat(outStr) || 0;
    const creditLimit = parseFloat(creditStr) || 0;

    const payload = {
      name,
      phone: phone || null,
      outstanding_amount: Math.abs(outstanding),
      outstanding_type: outstanding >= 0 ? 'Dr' : 'Cr',
      credit_limit: creditLimit,
      record_source: 'erp_live',
      erp_id: autoId,
      status: 'Active',
    };

    try {
      // Check if already exists
      const checkRes = await sbFetch(`/clients?erp_id=eq.${autoId}&record_source=eq.erp_live&select=id`, 'GET');
      const existing = await checkRes.json();

      if (Array.isArray(existing) && existing.length > 0) {
        await sbFetch(`/clients?erp_id=eq.${autoId}&record_source=eq.erp_live`, 'PATCH', {
          outstanding_amount: payload.outstanding_amount,
          outstanding_type: payload.outstanding_type,
          credit_limit: payload.credit_limit,
          name: payload.name,
          phone: payload.phone,
        });
        updated++;
      } else {
        await sbFetch('/clients', 'POST', { ...payload, id: randomUUID() });
        inserted++;
      }
    } catch (e) {
      console.error(`[AisoneSync] Error on ${name}:`, e.message);
      errors++;
    }
  }

  console.log(`[AisoneSync] ✓ Done — inserted:${inserted} updated:${updated} errors:${errors}`);
}

// ── Start ────────────────────────────────────────────────────
console.log('[AisoneSync] Service started. Syncing every 5 minutes.');
syncClients().catch(console.error);
setInterval(() => syncClients().catch(console.error), SYNC_INTERVAL);
