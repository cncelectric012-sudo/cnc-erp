/**
 * sync_to_supabase.js
 * Existing JSON databases → Supabase
 * Run: node scripts/sync_to_supabase.js
 */

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

const DB_DIR = path.join(__dirname, '../database');

function load(file) {
  try { return JSON.parse(fs.readFileSync(path.join(DB_DIR, file), 'utf8')); }
  catch (e) { return {}; }
}

function cleanKey(str) {
  return str.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g,'_').replace(/^_|_$/g,'');
}

async function syncClients() {
  const ledgerDB    = load('ledger_db.json');
  const salespersonDB = load('salesperson_db.json');

  const clients = Object.entries(ledgerDB)
    .filter(([k]) => !k.startsWith('__'))
    .map(([key, d]) => {
      const sp = salespersonDB[key] || salespersonDB[d.name?.trim().toLowerCase()] || {};
      const inv = Number(d.totalInvoiced) || 0;
      const paid = Number(d.totalPaid) || 0;
      const os = Number(d.outstandingAmount) || 0;
      return {
        id:                cleanKey(key),
        name:              d.name || key,
        phone:             d.phone || '',
        address:           d.address || '',
        city:              d.city || '',
        contact_person:    d.contactPerson || '',
        email:             d.email || '',
        outstanding_amount: os,
        outstanding_type:  d.outstandingType || 'Dr',
        total_invoiced:    inv,
        total_paid:        paid,
        pending_amount:    d.outstandingType === 'Dr' ? os : 0,
        avg_payment_days:  d.avgPaymentDays || 'N/A',
        risk_level:        d.riskLevel || 'Medium',
        risk_notes:        d.riskNotes || [],
        behavior_summary:  d.behaviorSummary || '',
        salesperson:       sp.salesperson || '',
        salesperson_number: sp.salespersonNumber || '',
        transactions:      (d.transactions || []).map(t => ({
          date: t.date || '', type: t.type || '',
          amount: Number(String(t.amount||0).replace(/,/g,''))||0,
          voucher: t.voucher || '', description: t.description || ''
        })),
        from_date:    d.fromDate || '',
        to_date:      d.toDate || '',
        filename:     d.filename || '',
        source:       d.source || 'pdf',
        last_updated: d.lastUpdated || new Date().toISOString()
      };
    });

  console.log(`📦 Syncing ${clients.length} clients...`);
  const chunkSize = 50;
  let done = 0;
  for (let i = 0; i < clients.length; i += chunkSize) {
    const chunk = clients.slice(i, i + chunkSize);
    const { error } = await supabase.from('clients').upsert(chunk, { onConflict: 'id' });
    if (error) console.error('❌ clients error:', error.message);
    done += chunk.length;
    console.log(`  ✅ ${done}/${clients.length}`);
  }
}

async function syncPayments() {
  const data = load('payments_db.json');
  const payments = data.payments || {};
  const rows = [];
  for (const [key, val] of Object.entries(payments)) {
    const list = Array.isArray(val) ? val : [val];
    for (const p of list) {
      rows.push({
        client_key: cleanKey(key),
        client_name: p.name || key,
        amount: Number(String(p.amount||0).replace(/,/g,''))||0,
        date: p.date || '', bank: p.bank || '',
        txn_id: p.txnId || '', account_no: p.account_no || '',
        stored_at: p.storedAt ? new Date(p.storedAt).toISOString() : new Date().toISOString()
      });
    }
  }
  if (!rows.length) { console.log('ℹ️  No payments to sync'); return; }
  console.log(`💳 Syncing ${rows.length} payments...`);
  const { error } = await supabase.from('payments').insert(rows);
  if (error) console.error('❌ payments error:', error.message);
  else console.log(`  ✅ ${rows.length} payments synced`);
}

async function syncApprovals() {
  const data = load('decisions_db.json');
  const rows = Object.entries(data).map(([invoiceNo, d]) => ({
    invoice_no: invoiceNo,
    client_name: d.clientName || '',
    bot_decision: d.botDecision || '',
    discount: d.discount || 0,
    had_payment: d.hadPayment || false,
    payment_total: d.paymentTotal || 0,
    had_ledger: d.hadLedger || false,
    ledger_outstanding: d.ledgerOutstanding || 0,
    ledger_type: d.ledgerType || 'Dr',
    ai_reason: d.aiReason || '',
    doubt_alert: d.doubtAlert || false,
    overridden: d.overridden || false,
    owner_action: d.ownerAction || '',
    created_at: d.timestamp || new Date().toISOString()
  }));
  if (!rows.length) { console.log('ℹ️  No approvals to sync'); return; }
  console.log(`✅ Syncing ${rows.length} approvals...`);
  const { error } = await supabase.from('approvals').upsert(rows, { onConflict: 'invoice_no' });
  if (error) console.error('❌ approvals error:', error.message);
  else console.log(`  ✅ ${rows.length} approvals synced`);
}

async function syncSalespersons() {
  const data = load('salesperson_db.json');
  const rows = Object.entries(data).map(([key, d]) => ({
    client_key: cleanKey(key),
    client_name: d.clientName || d.name || key,
    salesperson: d.salesperson || '',
    salesperson_number: d.salespersonNumber || '',
    invoice_count: d.invoiceCount || 0,
    payment_count: d.paymentCount || 0,
    first_seen: d.firstSeen || new Date().toISOString(),
    last_seen: d.lastSeen || new Date().toISOString()
  }));
  if (!rows.length) { console.log('ℹ️  No salespersons to sync'); return; }
  console.log(`👤 Syncing ${rows.length} salespersons...`);
  const { error } = await supabase.from('salespersons').upsert(rows, { onConflict: 'client_key' });
  if (error) console.error('❌ salespersons error:', error.message);
  else console.log(`  ✅ ${rows.length} salespersons synced`);
}

async function main() {
  console.log('🚀 Starting Supabase sync...\n');
  await syncClients();
  await syncPayments();
  await syncApprovals();
  await syncSalespersons();
  console.log('\n✅ All done!');
  process.exit(0);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
