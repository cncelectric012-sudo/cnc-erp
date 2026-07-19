// aisone-sync.js — Aisone ERP → Supabase Live Sync
// Runs on Z840 via PM2. No extra npm packages needed.

const { exec } = require('child_process');
const { randomUUID } = require('crypto');
const path = require('path');

const SQL_SERVER   = '.\\AISONESQL22';
const SQL_DB       = 'Cognitive solutions private limited';
const SQL_FILE     = path.join(__dirname, 'aisone-query.sql');
const SQL_TXN_FILE = path.join(__dirname, 'aisone-txn-query.sql');
const SQL_DISCOVER = path.join(__dirname, 'aisone-txn-discover.sql');
const SQL_COLS     = path.join(__dirname, 'aisone-txn-cols.sql');
const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const SYNC_INTERVAL = 5 * 60 * 1000; // 5 minutes

const SB_HEADERS = {
  'apikey': SUPABASE_KEY,
  'Authorization': `Bearer ${SUPABASE_KEY}`,
  'Content-Type': 'application/json',
};

// ── Run sqlcmd with a file and return parsed rows ─────────────
function runSQL(sqlFile, separator = '~') {
  return new Promise((resolve) => {
    const cmd = `sqlcmd -S ".\\AISONESQL22" -d "Cognitive solutions private limited" -i "${sqlFile}" -s "${separator}" -h-1 -W`;
    exec(cmd, { timeout: 120000, shell: 'cmd.exe' }, (err, stdout, stderr) => {
      if (err) {
        console.error('[AisoneSync] SQL error:', stderr || err.message);
        return resolve([]);
      }
      const lines = stdout
        .trim()
        .split(/\r?\n/)
        .filter(l => l.trim() && !l.match(/^[-~\s]+$/) && !l.match(/^\d+ rows affected/i) && !l.match(/^Changed database/i));
      const rows = lines.map(l => l.split(separator).map(v => v.trim()));
      resolve(rows);
    });
  });
}

// ── Supabase fetch ────────────────────────────────────────────
async function sbFetch(urlPath, method, body) {
  const r = await fetch(`${SUPABASE_URL}${urlPath}`, {
    method,
    headers: SB_HEADERS,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!r.ok && r.status !== 409) {
    const t = await r.text();
    console.error(`[AisoneSync] Supabase ${method} ${urlPath} → ${r.status}:`, t);
  }
  return r;
}

// ── Auto-update from git ──────────────────────────────────────
function gitPull() {
  return new Promise((resolve) => {
    exec('git pull origin main', { cwd: __dirname, timeout: 30000, shell: 'cmd.exe' }, (err, stdout) => {
      if (err) { console.error('[AisoneSync] git pull failed:', err.message); }
      else if (!stdout.includes('Already up to date')) { console.log('[AisoneSync] Updated from git:', stdout.trim()); }
      resolve();
    });
  });
}

// ── Discover ERP table structure (runs once at startup) ───────
async function discoverTableStructure() {
  console.log('[AisoneSync] Discovering ERP table structure...');

  const cols = await runSQL(SQL_COLS);
  if (cols.length) {
    console.log('[AisoneSync] TBU_AccountAging columns:');
    cols.forEach(r => console.log('  ', r[0], '-', r[1]));
  }

  const tables = await runSQL(SQL_DISCOVER);
  if (tables.length) {
    console.log('[AisoneSync] Transaction-related tables found:');
    tables.forEach(r => console.log('  ', r[0]));
  } else {
    console.log('[AisoneSync] No transaction tables found in discovery.');
  }
}

// ── Sync client accounts (batch mode) ────────────────────────
async function syncClients() {
  const ts = new Date().toLocaleTimeString('en-PK');
  console.log(`[AisoneSync] ${ts} — starting sync...`);
  await gitPull();

  const rows = await runSQL(SQL_FILE);
  if (!rows.length) {
    console.log('[AisoneSync] No data returned from SQL.');
    return;
  }

  const accounts = rows.filter(r => r.length >= 4 && r[1] && r[1].length > 0);
  console.log(`[AisoneSync] ${accounts.length} accounts from ERP`);

  // Fetch all existing erp_live clients in one call
  const existRes = await sbFetch('/clients?record_source=eq.erp_live&select=id,erp_id&limit=2000', 'GET');
  const existing = await existRes.json();
  const existMap = {};
  if (Array.isArray(existing)) existing.forEach(e => { existMap[e.erp_id] = e.id; });

  let inserted = 0, updated = 0, errors = 0;
  const toInsert = [], toUpdate = [];

  for (const r of accounts) {
    const [erpId, name, phone, outStr, creditStr] = r;
    const outstanding = parseFloat(outStr) || 0;
    const payload = {
      name,
      phone: phone || null,
      outstanding_amount: Math.abs(outstanding),
      outstanding_type: outstanding >= 0 ? 'Dr' : 'Cr',
      credit_limit: parseFloat(creditStr) || 0,
      record_source: 'erp_live',
      erp_id: erpId,
      status: 'Active',
    };
    if (existMap[erpId]) {
      toUpdate.push(payload);
    } else {
      toInsert.push({ ...payload, id: randomUUID() });
    }
  }

  // Batch insert new clients (chunks of 500)
  for (let i = 0; i < toInsert.length; i += 500) {
    try {
      await sbFetch('/clients', 'POST', toInsert.slice(i, i + 500));
      inserted += Math.min(500, toInsert.length - i);
    } catch(e) { errors++; }
  }

  // Update existing clients one by one via PATCH
  for (const p of toUpdate) {
    const r = await sbFetch(`/clients?erp_id=eq.${p.erp_id}&record_source=eq.erp_live`, 'PATCH', {
      outstanding_amount: p.outstanding_amount,
      outstanding_type: p.outstanding_type,
      credit_limit: p.credit_limit,
      name: p.name, phone: p.phone,
    });
    if (r.ok) updated++;
    else errors++;
  }

  console.log(`[AisoneSync] ✓ Clients — inserted:${inserted} updated:${updated} errors:${errors}`);

  // Sync transactions if query file exists
  const fs = require('fs');
  if (fs.existsSync(SQL_TXN_FILE)) {
    await syncTransactions();
  }
}

// ── Sync transactions ─────────────────────────────────────────
async function syncTransactions() {
  console.log('[AisoneSync] Syncing transactions...');
  const rows = await runSQL(SQL_TXN_FILE);
  const txns = rows.filter(r => r.length >= 5 && r[0]);

  if (!txns.length) {
    console.log('[AisoneSync] No transactions returned.');
    return;
  }

  console.log(`[AisoneSync] ${txns.length} transactions from ERP`);

  // Clear old and re-insert
  await sbFetch('/erp_transactions?id=not.is.null', 'DELETE', undefined);

  const batch = txns.map(r => ({
    id: randomUUID(),
    erp_account_id: r[0],
    txn_date: r[1] || null,
    txn_type: r[2] || 'Transaction',
    amount: parseFloat(r[3]) || 0,
    voucher_no: r[4] || null,
    description: r[5] || null,
  }));

  // Insert in chunks of 500
  for (let i = 0; i < batch.length; i += 500) {
    const chunk = batch.slice(i, i + 500);
    await sbFetch('/erp_transactions', 'POST', chunk);
    console.log(`[AisoneSync] Inserted transactions ${i}–${i + chunk.length}`);
  }

  console.log(`[AisoneSync] ✓ Transactions synced: ${batch.length}`);
}

// ── Start ─────────────────────────────────────────────────────
console.log('[AisoneSync] Service started. Syncing every 5 minutes.');
discoverTableStructure().then(() => {
  syncClients().catch(console.error);
});
setInterval(() => syncClients().catch(console.error), SYNC_INTERVAL);
