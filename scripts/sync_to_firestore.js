/**
 * sync_to_firestore.js
 * Existing ledger_db.json + salesperson_db.json → Firestore clients collection
 * Run: node scripts/sync_to_firestore.js
 */

const fs   = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const admin = require('firebase-admin');

const SA_PATH = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
if (!SA_PATH) { console.error('❌ FIREBASE_SERVICE_ACCOUNT_PATH not set in .env'); process.exit(1); }

const saFile = path.resolve(__dirname, '..', SA_PATH);
if (!fs.existsSync(saFile)) { console.error('❌ Service account file not found:', saFile); process.exit(1); }

admin.initializeApp({ credential: admin.credential.cert(require(saFile)) });
const db = admin.firestore();

const LEDGER_DB    = path.join(__dirname, '../database/ledger_db.json');
const SALESPERSON  = path.join(__dirname, '../database/salesperson_db.json');

const ledgerDB    = JSON.parse(fs.readFileSync(LEDGER_DB, 'utf8'));
const salespersonDB = fs.existsSync(SALESPERSON)
  ? JSON.parse(fs.readFileSync(SALESPERSON, 'utf8')) : {};

function cleanKey(str) {
  return str.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

async function main() {
  const clients = Object.entries(ledgerDB)
    .filter(([k]) => !k.startsWith('__'));

  console.log(`📦 Syncing ${clients.length} clients to Firestore...`);

  const batch_size = 400; // Firestore batch limit is 500
  let done = 0;

  for (let i = 0; i < clients.length; i += batch_size) {
    const chunk = clients.slice(i, i + batch_size);
    const batch = db.batch();

    for (const [key, data] of chunk) {
      const spData = salespersonDB[key] || salespersonDB[data.name ? data.name.trim().toLowerCase() : ''];
      const firestoreKey = cleanKey(key);
      const ref = db.collection('clients').doc(firestoreKey);

      const totalInvoiced = Number(data.totalInvoiced) || 0;
      const totalPaid     = Number(data.totalPaid)     || 0;
      const outstanding   = Number(data.outstandingAmount) || 0;

      batch.set(ref, {
        name:              data.name || key,
        phone:             data.phone || '',
        address:           data.address || '',
        city:              data.city || '',
        contactPerson:     data.contactPerson || '',
        email:             data.email || '',
        outstandingAmount: outstanding,
        outstandingType:   data.outstandingType || 'Dr',
        totalInvoiced,
        totalPaid,
        pendingAmount:     data.outstandingType === 'Dr' ? outstanding : 0,
        transactions:      (data.transactions || []).map(t => ({
          date:        t.date || '',
          type:        t.type || '',
          amount:      Number(String(t.amount || 0).replace(/,/g, '')) || 0,
          voucher:     t.voucher || '',
          description: t.description || ''
        })),
        fromDate:          data.fromDate || '',
        toDate:            data.toDate || '',
        avgPaymentDays:    data.avgPaymentDays || 'N/A',
        riskLevel:         data.riskLevel || 'Medium',
        riskNotes:         data.riskNotes || [],
        behaviorSummary:   data.behaviorSummary || '',
        salesperson:       spData ? (spData.salesperson || '') : '',
        salespersonNumber: spData ? (spData.salespersonNumber || '') : '',
        filename:          data.filename || '',
        lastUpdated:       data.lastUpdated || new Date().toISOString(),
        source:            data.source || 'pdf'
      }, { merge: true });

      done++;
    }

    await batch.commit();
    console.log(`  ✅ ${done}/${clients.length} clients synced`);
  }

  console.log(`\n✅ Done — ${done} clients in Firestore`);
  process.exit(0);
}

main().catch(err => { console.error('❌', err); process.exit(1); });
