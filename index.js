const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ─── Supabase (optional — only if keys configured) ────────────
let supabase = null;
if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
    try {
        const { createClient } = require('@supabase/supabase-js');
        supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
        console.log('✅ Supabase connected');
    } catch (err) {
        console.warn('⚠️  Supabase init failed:', err.message);
    }
} else {
    console.log('ℹ️  Supabase not configured — JSON-only mode');
}

function cleanKey(str) {
    return str.trim().toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
}

function syncSupabase(table, id, data) {
    if (!supabase) return;
    supabase.from(table).upsert({ id, ...data }, { onConflict: 'id' })
      .then(({ error }) => { if (error) console.error(`❌ Supabase sync error (${table}):`, error.message); })
      .catch(err => console.error(`❌ Supabase error (${table}):`, err.message));
}

function syncSupabaseNoId(table, data, conflictCol) {
    if (!supabase) return;
    supabase.from(table).upsert(data, { onConflict: conflictCol })
      .then(({ error }) => { if (error) console.error(`❌ Supabase sync error (${table}):`, error.message); })
      .catch(err => console.error(`❌ Supabase error (${table}):`, err.message));
}

// ─── Config ───────────────────────────────────────────────
const PAYMENTS_GROUP          = process.env.PAYMENTS_GROUP          || 'Payments';
const INVOICE_GROUP           = process.env.INVOICE_GROUP           || 'CS INVOICES APPROVAL';
const ACCOUNT_GROUP           = process.env.ACCOUNT_GROUP           || 'Account';
const PAYMENT_APPROVAL_GROUP  = process.env.PAYMENT_APPROVAL_GROUP  || 'Payment Approval';
const REGULAR_LIMIT           = 25;
const CASH_SALE_LIMIT         = 10;
const HARD_BLOCK_LIMIT        = 30;
const LEDGER_BLOCK_LIMIT      = 300000; // 3 lakh — manual approval threshold
const SUPABASE_URL_RAW        = process.env.SUPABASE_URL;
const SUPABASE_KEY_RAW        = process.env.SUPABASE_SERVICE_ROLE_KEY;

// ─── Supabase Direct API Helpers ──────────────────────────
const https = require('https');

function supabaseGet(path) {
    return new Promise(resolve => {
        if (!SUPABASE_URL_RAW || !SUPABASE_KEY_RAW) return resolve([]);
        const url = new URL(SUPABASE_URL_RAW);
        const opts = { hostname: url.hostname, path, method: 'GET', headers: { 'apikey': SUPABASE_KEY_RAW, 'Authorization': 'Bearer ' + SUPABASE_KEY_RAW } };
        https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch{resolve([])}; }); }).on('error',()=>resolve([])).end();
    });
}

function supabasePatch(path, body) {
    return new Promise(resolve => {
        if (!SUPABASE_URL_RAW || !SUPABASE_KEY_RAW) return resolve(false);
        const url = new URL(SUPABASE_URL_RAW);
        const b = JSON.stringify(body);
        const opts = { hostname: url.hostname, path, method: 'PATCH', headers: { 'apikey': SUPABASE_KEY_RAW, 'Authorization': 'Bearer ' + SUPABASE_KEY_RAW, 'Content-Type': 'application/json', 'Prefer': 'return=minimal', 'Content-Length': Buffer.byteLength(b) } };
        const req = https.request(opts, res => { res.on('data',()=>{}); res.on('end',()=>resolve(res.statusCode===204||res.statusCode===200)); });
        req.on('error',()=>resolve(false)); req.write(b); req.end();
    });
}

function normName(s){ return String(s||'').toLowerCase().replace(/[^a-z0-9]/g,''); }

// ─── Bot Settings from Supabase ───────────────────────────
let botSettings = {};
async function loadBotSettings() {
    try {
        const data = await supabaseGet('/rest/v1/bot_settings?select=key,value');
        if (Array.isArray(data)) data.forEach(s => botSettings[s.key] = s.value);
        console.log('⚙️ Bot settings:', JSON.stringify(botSettings));
    } catch(e) { console.error('Bot settings load error:', e.message); }
}
function isEnabled(key) { return botSettings[key] !== false; }

async function getClientFromSupabase(clientName) {
    const n = normName(clientName);
    const data = await supabaseGet('/rest/v1/clients?select=id,name,outstanding_amount,outstanding_type,transactions,branch&source=in.(cnc_ledger,cspl_ledger,cst_ledger)&limit=500');
    if (!Array.isArray(data)) return null;
    return data.find(c => {
        const cn = normName(c.name);
        return cn === n || cn.includes(n) || n.includes(cn);
    }) || null;
}

async function updateSupabaseLedger(clientName, paymentAmount, paymentDate, bankName, txnId) {
    const client = await getClientFromSupabase(clientName);
    if (!client) { console.log(`⚠️ Client not found in Supabase: ${clientName}`); return; }
    const amt = parseFloat(String(paymentAmount).replace(/,/g,''))||0;
    if (amt <= 0) return;
    const newOs = Math.max(0, (client.outstanding_amount||0) - amt);
    const txns = Array.isArray(client.transactions) ? client.transactions : [];
    txns.push({ date: paymentDate||new Date().toISOString().slice(0,10), type:'Payment', voucher: txnId||'WA-PAY', description:`Payment via ${bankName||'bank'} — WhatsApp`, amount: amt });
    const ok = await supabasePatch(`/rest/v1/clients?id=eq.${client.id}`, { outstanding_amount: newOs, transactions: txns, last_updated: new Date().toISOString() });
    if (ok) console.log(`✅ Supabase ledger updated: ${clientName} — Outstanding: ${newOs.toLocaleString()}`);
}

const ALWAYS_APPROVE_CLIENTS = ['cncelectric.pk cod', 'cncelectric.pk', 'cnc electric', 'cncelectric', 'web cod afzaal', 'web cod'];

function isAlwaysApproveExtended(name) {
    const n = name.trim().toLowerCase();
    // Check standard list
    if (ALWAYS_APPROVE_CLIENTS.some(c => n.includes(c))) return true;
    // Check if name contains both 'cnc' and 'cod'
    if (n.includes('cnc') && n.includes('cod')) return true;
    // Check if name contains 'cncelectric'
    if (n.includes('cncelectric')) return true;
    return false;
}

const BOSS_NUMBERS = [
    process.env.MUDDASIR_NUMBER + '@c.us',
    process.env.AWAIS_NUMBER   + '@c.us'
];
const BOSS_RAW = [
    process.env.MUDDASIR_NUMBER,
    process.env.AWAIS_NUMBER
];

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Commitments Database ─────────────────────────────────
// Stores sales person payment commitments for follow-up alerts
let commitmentsDB = {};

function loadCommitmentsDB() {
    try {
        if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
        if (fs.existsSync(COMMITMENTS_DB_FILE)) {
            commitmentsDB = JSON.parse(fs.readFileSync(COMMITMENTS_DB_FILE, 'utf8'));
            console.log(`✅ Commitments DB loaded — ${Object.keys(commitmentsDB).length} commitments`);
        } else {
            commitmentsDB = {};
            saveCommitmentsDB();
            console.log('✅ New commitments database created');
        }
    } catch (err) {
        console.error('❌ Commitments DB load error:', err.message);
        commitmentsDB = {};
    }
}

function saveCommitmentsDB() {
    try {
        if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
        fs.writeFileSync(COMMITMENTS_DB_FILE, JSON.stringify(commitmentsDB, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Commitments DB save error:', err.message);
    }
}

function saveCommitment(invoiceNo, data) {
    commitmentsDB[invoiceNo] = {
        ...data,
        createdAt: new Date().toISOString(),
        alertSent: false
    };
    saveCommitmentsDB();
    console.log(`💬 Commitment saved: ${invoiceNo} — due: ${data.dueDateStr}`);
}

// Check commitments daily and send alerts for overdue ones
async function checkCommitments() {
    const now = Date.now();
    for (const [invoiceNo, commitment] of Object.entries(commitmentsDB)) {
        if (commitment.alertSent) continue;
        if (!commitment.dueDate) continue;

        const dueDate = new Date(commitment.dueDate).getTime();
        if (now >= dueDate) {
            // Payment overdue — send alerts
            const overdueMsg =
                `⚠️ *PAYMENT COMMITMENT OVERDUE*
` +
                `${'─'.repeat(35)}
` +
                `*Invoice:* ${invoiceNo}
` +
                `*Client:* ${commitment.clientName}
` +
                `*Amount:* PKR ${commitment.invoiceAmount}
` +
                `*Sales Person:* ${commitment.salesPerson || 'Unknown'}
` +
                `*Commitment:* ${commitment.commitmentText}
` +
                `*Due Date:* ${commitment.dueDateStr}
` +
                `${'─'.repeat(35)}
` +
                `Payment not received yet. Please follow up.`;

            // Alert bosses
            for (const num of BOSS_NUMBERS) {
                await client.sendMessage(num, overdueMsg);
            }

            // Alert in invoice group
            try {
                const chats = await client.getChats();
                const invoiceGroup = chats.find(c => c.name === INVOICE_GROUP);
                if (invoiceGroup) {
                    await invoiceGroup.sendMessage(
                        `⚠️ *Payment Follow-up Required*
` +
                        `Invoice: ${invoiceNo} | Client: ${commitment.clientName}
` +
                        `Sales commitment was: "${commitment.commitmentText}"
` +
                        `Due: ${commitment.dueDateStr} — Payment not received yet.`
                    );
                }
            } catch (err) {
                console.error('❌ Commitment alert error:', err.message);
            }

            // Mark as alerted
            commitmentsDB[invoiceNo].alertSent = true;
            commitmentsDB[invoiceNo].alertedAt = new Date().toISOString();
            saveCommitmentsDB();
            console.log(`⚠️ Commitment alert sent: ${invoiceNo}`);
        }
    }
}

// ─── Salesperson Database ──────────────────────────────────
let salespersonDB = {};

function loadSalespersonDB() {
    try {
        if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
        salespersonDB = fs.existsSync(SALESPERSON_DB_FILE)
            ? JSON.parse(fs.readFileSync(SALESPERSON_DB_FILE, 'utf8'))
            : {};
        console.log(`✅ Salesperson DB loaded — ${Object.keys(salespersonDB).length} records`);
    } catch (err) {
        console.error('❌ Salesperson DB load error:', err.message);
        salespersonDB = {};
    }
}

function saveSalespersonDB() {
    try {
        fs.writeFileSync(SALESPERSON_DB_FILE, JSON.stringify(salespersonDB, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Salesperson DB save error:', err.message);
    }
}

function recordSalesperson(clientName, senderName, senderNumber, type, invoiceNo) {
    const key = clientName.trim().toLowerCase();
    if (!salespersonDB[key]) {
        salespersonDB[key] = {
            clientName: clientName,
            salesperson: senderName,
            salespersonNumber: senderNumber,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            invoiceCount: 0,
            paymentCount: 0,
            invoices: []
        };
    }
    salespersonDB[key].salesperson = senderName;
    salespersonDB[key].salespersonNumber = senderNumber;
    salespersonDB[key].lastSeen = new Date().toISOString();

    if (type === 'invoice') {
        salespersonDB[key].invoiceCount++;
        salespersonDB[key].invoices.push({
            invoiceNo, date: new Date().toISOString(), sender: senderName
        });
    } else if (type === 'payment') {
        salespersonDB[key].paymentCount++;
    }

    saveSalespersonDB();
    console.log(`👤 Salesperson recorded: ${senderName} → ${clientName}`);
}

// ─── Decisions Database (Audit Trail) ─────────────────────
let decisionsDB = {};
let correctionsDB = {};
let patternsDB = {};

function loadDecisionsDB() {
    try {
        if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
        decisionsDB  = fs.existsSync(DECISIONS_DB_FILE)   ? JSON.parse(fs.readFileSync(DECISIONS_DB_FILE,   'utf8')) : {};
        correctionsDB = fs.existsSync(CORRECTIONS_DB_FILE) ? JSON.parse(fs.readFileSync(CORRECTIONS_DB_FILE, 'utf8')) : {};
        patternsDB   = fs.existsSync(PATTERNS_DB_FILE)    ? JSON.parse(fs.readFileSync(PATTERNS_DB_FILE,    'utf8')) : {};
        console.log(`✅ Decisions DB: ${Object.keys(decisionsDB).length} | Corrections: ${Object.keys(correctionsDB).length} | Patterns: ${Object.keys(patternsDB).length}`);
    } catch (err) {
        console.error('❌ Decisions DB load error:', err.message);
    }
}

function saveDecisionsDB() {
    try {
        fs.writeFileSync(DECISIONS_DB_FILE,   JSON.stringify(decisionsDB,   null, 2), 'utf8');
        fs.writeFileSync(CORRECTIONS_DB_FILE, JSON.stringify(correctionsDB, null, 2), 'utf8');
        fs.writeFileSync(PATTERNS_DB_FILE,    JSON.stringify(patternsDB,    null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Decisions DB save error:', err.message);
    }
}

function recordDecision(invoiceNo, decisionData) {
    decisionsDB[invoiceNo] = {
        ...decisionData,
        timestamp: new Date().toISOString(),
        overridden: false
    };
    saveDecisionsDB();
    syncSupabaseNoId('approvals', { invoice_no: invoiceNo, ...decisionsDB[invoiceNo],
        client_name: decisionsDB[invoiceNo].clientName,
        bot_decision: decisionsDB[invoiceNo].botDecision,
        had_payment: decisionsDB[invoiceNo].hadPayment,
        payment_total: decisionsDB[invoiceNo].paymentTotal,
        had_ledger: decisionsDB[invoiceNo].hadLedger,
        ledger_outstanding: decisionsDB[invoiceNo].ledgerOutstanding,
        ledger_type: decisionsDB[invoiceNo].ledgerType,
        ai_reason: decisionsDB[invoiceNo].aiReason,
        doubt_alert: decisionsDB[invoiceNo].doubtAlert,
        created_at: decisionsDB[invoiceNo].timestamp
    }, 'invoice_no');
    console.log(`📝 Decision recorded: ${invoiceNo} → ${decisionData.botDecision}`);
}

function recordCorrection(invoiceNo, ownerAction) {
    const original = decisionsDB[invoiceNo];
    if (!original) return;

    // Record correction
    correctionsDB[invoiceNo] = {
        invoiceNo,
        clientName: original.clientName,
        originalDecision: original.botDecision,
        ownerAction,
        discount: original.discount,
        hadPayment: original.hadPayment,
        paymentTotal: original.paymentTotal,
        hadLedger: original.hadLedger,
        ledgerOutstanding: original.ledgerOutstanding,
        ledgerType: original.ledgerType,
        correctedAt: new Date().toISOString()
    };

    // Mark original as overridden
    decisionsDB[invoiceNo].overridden = true;
    decisionsDB[invoiceNo].ownerAction = ownerAction;

    // Learn pattern
    learnFromCorrection(correctionsDB[invoiceNo]);
    saveDecisionsDB();
    syncSupabaseNoId('approvals', { invoice_no: invoiceNo, overridden: true, owner_action: ownerAction }, 'invoice_no');
    console.log(`🧠 Correction recorded: ${invoiceNo} — Bot said ${original.botDecision}, Owner said ${ownerAction}`);
}

function learnFromCorrection(correction) {
    // Build pattern key based on situation
    const patternKey = [
        `disc_${Math.floor(correction.discount / 5) * 5}`, // Round to nearest 5%
        correction.hadPayment ? 'has_payment' : 'no_payment',
        correction.hadLedger ? `ledger_${correction.ledgerType}` : 'no_ledger',
    ].join('_');

    if (!patternsDB[patternKey]) {
        patternsDB[patternKey] = {
            patternKey,
            situations: [],
            approveCount: 0,
            holdCount: 0,
            blockCount: 0,
            recommendation: null
        };
    }

    patternsDB[patternKey].situations.push({
        invoiceNo: correction.invoiceNo,
        ownerAction: correction.ownerAction,
        timestamp: correction.correctedAt
    });

    if (correction.ownerAction === 'APPROVE') patternsDB[patternKey].approveCount++;
    else if (correction.ownerAction === 'NOT APPROVE') patternsDB[patternKey].holdCount++;

    // Update recommendation based on majority
    const total = patternsDB[patternKey].approveCount + patternsDB[patternKey].holdCount;
    if (total >= 2) {
        if (patternsDB[patternKey].approveCount / total >= 0.7) {
            patternsDB[patternKey].recommendation = 'APPROVE';
        } else if (patternsDB[patternKey].holdCount / total >= 0.7) {
            patternsDB[patternKey].recommendation = 'HOLD';
        }
    }

    console.log(`🧠 Pattern learned: ${patternKey} → Approve: ${patternsDB[patternKey].approveCount}, Hold: ${patternsDB[patternKey].holdCount}`);
}

function getPatternRecommendation(discount, hadPayment, hadLedger, ledgerType) {
    const patternKey = [
        `disc_${Math.floor(discount / 5) * 5}`,
        hadPayment ? 'has_payment' : 'no_payment',
        hadLedger ? `ledger_${ledgerType}` : 'no_ledger',
    ].join('_');

    return patternsDB[patternKey] || null;
}

// ─── Image Hash Store (duplicate screenshot detection) ────
const processedImageHashes = new Map(); // hash -> { name, amount, date }

function simpleHash(base64Data) {
    // Take samples from start, middle, end of image data
    const len = base64Data.length;
    const samples = [
        base64Data.substring(0, 100),
        base64Data.substring(Math.floor(len * 0.25), Math.floor(len * 0.25) + 100),
        base64Data.substring(Math.floor(len * 0.5), Math.floor(len * 0.5) + 100),
        base64Data.substring(Math.floor(len * 0.75), Math.floor(len * 0.75) + 100),
        base64Data.substring(len - 100)
    ].join('');

    // Simple hash
    let hash = 0;
    for (let i = 0; i < samples.length; i++) {
        const char = samples.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

function checkDuplicateImage(base64Data, newName) {
    const hash = simpleHash(base64Data);
    if (processedImageHashes.has(hash)) {
        const existing = processedImageHashes.get(hash);
        if (existing.name.toLowerCase() !== newName.toLowerCase()) {
            console.log(`🚨 FRAUD ALERT: Same screenshot sent with different name!`);
            console.log(`   Original: ${existing.name} — Rs. ${existing.amount}`);
            console.log(`   New name: ${newName}`);
            return { isDuplicate: true, isFraud: true, original: existing };
        } else {
            console.log(`⚠️  Duplicate screenshot ignored — ${newName}`);
            return { isDuplicate: true, isFraud: false, original: existing };
        }
    }
    return { isDuplicate: false, isFraud: false };
}

function storeImageHash(base64Data, name, amount, date) {
    const hash = simpleHash(base64Data);
    processedImageHashes.set(hash, { name, amount, date, storedAt: Date.now() });
}

// ─── Invoice Memory ────────────────────────────────────────
// Stores invoice details so approve/reject messages have full info
const invoiceMemory = {};

function storeInvoice(invoiceNo, data) {
    invoiceMemory[invoiceNo.trim().toUpperCase()] = { ...data, storedAt: Date.now() };
}

function getInvoice(invoiceNo) {
    return invoiceMemory[invoiceNo.trim().toUpperCase()] || null;
}

// ─── Paths ─────────────────────────────────────────────────
const PRICE_LIST_PATH = path.join(__dirname, 'pricelist.pdf');
const LEDGERS_DIR     = path.join(__dirname, 'ledgers');
const DATABASE_DIR    = path.join(__dirname, 'database');
const DB_FILE         = path.join(DATABASE_DIR, 'ledger_db.json');
const PAYMENTS_DB_FILE   = path.join(DATABASE_DIR, 'payments_db.json');
const COMMITMENTS_DB_FILE  = path.join(DATABASE_DIR, 'commitments_db.json');
const DECISIONS_DB_FILE    = path.join(DATABASE_DIR, 'decisions_db.json');
const CORRECTIONS_DB_FILE  = path.join(DATABASE_DIR, 'corrections_db.json');
const PATTERNS_DB_FILE     = path.join(DATABASE_DIR, 'patterns_db.json');
const SALESPERSON_DB_FILE  = path.join(DATABASE_DIR, 'salesperson_db.json');

// ─── Database ──────────────────────────────────────────────
let ledgerDB = {};

function loadDB() {
    try {
        if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
        if (fs.existsSync(DB_FILE)) {
            ledgerDB = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
            console.log(`✅ Database loaded — ${Object.keys(ledgerDB).length} clients`);
        } else {
            ledgerDB = {};
            saveDB();
            console.log('✅ New database created');
        }
    } catch (err) {
        console.error('❌ DB load error:', err.message);
        ledgerDB = {};
    }
}

function saveDB() {
    try {
        if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
        fs.writeFileSync(DB_FILE, JSON.stringify(ledgerDB, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ DB save error:', err.message);
    }
}

function updateClientInDB(data) {
    const key = data.client_name.trim().toLowerCase();
    const existing = ledgerDB[key];

    let allTxns = existing ? [...(existing.transactions || [])] : [];
    for (const txn of (data.transactions || [])) {
        const exists = allTxns.some(t => t.date === txn.date && t.amount === txn.amount && t.type === txn.type);
        if (!exists) allTxns.push(txn);
    }
    allTxns.sort((a, b) => new Date(a.date) - new Date(b.date));

    ledgerDB[key] = {
        name: data.client_name,
        outstandingAmount: data.outstandingAmount,
        outstandingType: data.outstandingType,
        lastUpdated: new Date().toISOString(),
        transactions: allTxns,
        riskLevel: data.riskLevel || (existing ? existing.riskLevel : 'Medium'),
        riskNotes: data.riskNotes || (existing ? existing.riskNotes : []),
        behaviorSummary: data.behaviorSummary || (existing ? existing.behaviorSummary : ''),
        totalInvoiced: data.totalInvoiced || (existing ? existing.totalInvoiced : 0),
        totalPaid: data.totalPaid || (existing ? existing.totalPaid : 0),
        avgPaymentDays: data.avgPaymentDays || (existing ? existing.avgPaymentDays : 'Unknown'),
        source: data.source || 'pdf'
    };

    saveDB();
    const clientKey = cleanKey(data.client_name);
    syncSupabase('clients', clientKey, ledgerDB[data.client_name.trim().toLowerCase()]);
    console.log(`💾 DB updated: ${data.client_name} — ${data.outstandingType} PKR ${data.outstandingAmount.toLocaleString()}`);
}

function findInDB(clientName) {
    const key = clientName.trim().toLowerCase();
    // Skip system keys
    if (key.startsWith('__')) return null;
    // Exact match only
    if (ledgerDB[key]) return ledgerDB[key];
    return null;
}

// ─── Price List ────────────────────────────────────────────
let priceListBase64 = null;

function loadPriceList() {
    try {
        if (fs.existsSync(PRICE_LIST_PATH)) {
            priceListBase64 = fs.readFileSync(PRICE_LIST_PATH).toString('base64');
            console.log('✅ Price list loaded');
        } else {
            console.warn('⚠️  pricelist.pdf not found');
        }
    } catch (err) {
        console.error('❌ Price list error:', err.message);
    }
}

// ─── Ledger PDF Batch Processor ────────────────────────────
async function loadAllLedgerPDFs() {
    if (!fs.existsSync(LEDGERS_DIR)) {
        console.warn('⚠️  ledgers/ folder not found');
        return;
    }
    const files = fs.readdirSync(LEDGERS_DIR).filter(f => f.endsWith('.pdf'));
    if (!files.length) { console.log('⚠️  No PDFs in ledgers/'); return; }

    // Skip already processed files using processed flag OR filename match
    const processedFilenames = new Set(
        (ledgerDB['__processed_files__'] && ledgerDB['__processed_files__'].files) || []
    );
    const filenameProcessed = new Set(
        Object.values(ledgerDB)
            .filter(c => c.source === 'pdf' && c.filename)
            .map(c => c.filename)
    );

    const newFiles = files.filter(f => !processedFilenames.has(f) && !filenameProcessed.has(f));

    if (newFiles.length === 0) {
        console.log(`✅ All ${files.length} ledgers already in database — skipping`);
        return;
    }

    console.log(`📂 Processing ${newFiles.length} new ledgers (${files.length - newFiles.length} already in DB)...`);
    const batchSize = 5;
    let processed = 0;

    for (let i = 0; i < newFiles.length; i += batchSize) {
        const batch = newFiles.slice(i, i + batchSize);
        await Promise.all(batch.map(async f => {
            try {
                const b64 = fs.readFileSync(path.join(LEDGERS_DIR, f)).toString('base64');
                const data = await extractLedgerData(b64, 'pdf');
                if (data) updateClientInDB({ ...data, source: 'pdf', filename: f });
            } catch (err) {
                console.error(`❌ PDF error (${f}):`, err.message);
            }
        }));
        processed += batch.length;
        console.log(`📋 Progress: ${processed}/${newFiles.length} new ledgers processed`);
        if (i + batchSize < newFiles.length) await sleep(2000);
    }
    console.log(`✅ Done — ${Object.keys(ledgerDB).length} total clients in DB`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─── Ledger Data Extractor ─────────────────────────────────
async function extractLedgerData(base64Data, type, captionName = '') {
    try {
        const contentItem = type === 'pdf'
            ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
            : { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Data } };

        const nameHint = captionName ? `Caption/client name hint: "${captionName}"` : '';

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 1500,
            messages: [{
                role: 'user',
                content: [
                    contentItem,
                    {
                        type: 'text',
                        text: `Analyze this customer ledger ${type}. ${nameHint}

Risk patterns:
- Partial clearing then takes more credit
- Long gaps between purchase and payment
- Increasing outstanding trend

Return ONLY valid JSON:
{
  "client_name": "exact client name",
  "outstandingAmount": "ending balance number only",
  "outstandingType": "Dr or Cr",
  "fromDate": "from date",
  "toDate": "to date",
  "transactions": [
    { "date": "date", "type": "Invoice or Payment", "amount": "number", "description": "brief", "voucher": "voucher" }
  ],
  "totalInvoiced": "number",
  "totalPaid": "number",
  "avgPaymentDays": "estimated days",
  "riskLevel": "Low or Medium or High",
  "riskNotes": ["note1", "note2"],
  "behaviorSummary": "2-3 line summary"
}`
                    }
                ]
            }]
        });

        const raw = response.content[0].text;
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return null;
        const d = JSON.parse(match[0]);

        return {
            client_name: d.client_name,
            outstandingAmount: parseFloat(String(d.outstandingAmount).replace(/,/g, '')) || 0,
            outstandingType: d.outstandingType || 'Dr',
            fromDate: d.fromDate,
            toDate: d.toDate,
            transactions: d.transactions || [],
            totalInvoiced: parseFloat(String(d.totalInvoiced).replace(/,/g, '')) || 0,
            totalPaid: parseFloat(String(d.totalPaid).replace(/,/g, '')) || 0,
            avgPaymentDays: d.avgPaymentDays || 'Unknown',
            riskLevel: d.riskLevel || 'Medium',
            riskNotes: d.riskNotes || [],
            behaviorSummary: d.behaviorSummary || ''
        };
    } catch (err) {
        console.error('❌ Extract error:', err.message);
        return null;
    }
}

// ─── Payment Memory (Persistent) ──────────────────────────
let paymentMemory = {};
const processedTxnIds = new Set();

function loadPaymentsDB() {
    try {
        if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
        if (fs.existsSync(PAYMENTS_DB_FILE)) {
            const data = JSON.parse(fs.readFileSync(PAYMENTS_DB_FILE, 'utf8'));
            paymentMemory = data.payments || {};
            const txnIds = data.txnIds || [];
            txnIds.forEach(id => processedTxnIds.add(id));
            console.log(`✅ Payments DB loaded — ${Object.keys(paymentMemory).length} payments`);
        } else {
            paymentMemory = {};
            savePaymentsDB();
            console.log('✅ New payments database created');
        }
    } catch (err) {
        console.error('❌ Payments DB load error:', err.message);
        paymentMemory = {};
    }
}

function savePaymentsDB() {
    try {
        if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR, { recursive: true });
        fs.writeFileSync(PAYMENTS_DB_FILE, JSON.stringify({
            payments: paymentMemory,
            txnIds: Array.from(processedTxnIds),
            lastSaved: new Date().toISOString()
        }, null, 2), 'utf8');
    } catch (err) {
        console.error('❌ Payments DB save error:', err.message);
    }
}

function isDuplicatePayment(data) {
    // Check by transaction ID
    if (data.txnId && data.txnId !== 'N/A' && data.txnId !== '') {
        if (processedTxnIds.has(data.txnId.trim())) {
            console.log(`⚠️  Duplicate payment ignored — TXN: ${data.txnId}`);
            return true;
        }
    }
    // Check by amount + date + sender combo
    const dupKey = `${data.sender_name}-${data.amount}-${data.date}`.toLowerCase().trim();
    if (processedTxnIds.has(dupKey)) {
        console.log(`⚠️  Duplicate payment ignored — ${data.sender_name} Rs.${data.amount} on ${data.date}`);
        return true;
    }
    return false;
}

function storePayment(name, data) {
    // Check duplicate
    if (isDuplicatePayment({ ...data, sender_name: name })) return;

    const key = name.trim().toLowerCase();
    const newPayment = { ...data, name, storedAt: Date.now() };

    // Store as array — multiple payments per client
    if (!paymentMemory[key]) {
        paymentMemory[key] = [newPayment];
    } else if (Array.isArray(paymentMemory[key])) {
        paymentMemory[key].push(newPayment);
    } else {
        // Convert old single payment to array
        paymentMemory[key] = [paymentMemory[key], newPayment];
    }

    // Mark as processed
    if (data.txnId && data.txnId !== 'N/A' && data.txnId !== '') {
        processedTxnIds.add(data.txnId.trim());
    }
    const dupKey = `${name}-${data.amount}-${data.date}`.toLowerCase().trim();
    processedTxnIds.add(dupKey);

    // Save to persistent DB
    savePaymentsDB();

    const savedPayment = paymentMemory[key];
    const lastPay = Array.isArray(savedPayment) ? savedPayment[savedPayment.length-1] : savedPayment;
    if (lastPay) syncSupabaseNoId('payments', {
        client_key: cleanKey(name), client_name: name,
        amount: Number(String(lastPay.amount||0).replace(/,/g,''))||0,
        date: lastPay.date||'', bank: lastPay.bank||'',
        txn_id: lastPay.txnId||'', account_no: lastPay.account_no||''
    }, 'id');

    const { total, count } = getTotalPaymentsForClient(name);
    console.log(`💾 Payment stored: ${name} — Rs. ${data.amount} | TXN: ${data.txnId || 'N/A'} | Total: Rs. ${total.toLocaleString()} (${count} payments)`);
}

function findPayment(clientName) {
    const key = clientName.trim().toLowerCase();
    if (paymentMemory[key]) return paymentMemory[key];
    return null;
}

// Get ALL payments for a client (merged total)
function getAllPaymentsForClient(clientName) {
    const key = clientName.trim().toLowerCase();
    const payments = [];

    for (const [k, val] of Object.entries(paymentMemory)) {
        if (k === key) {
            // Could be array or single payment
            if (Array.isArray(val)) {
                payments.push(...val);
            } else {
                payments.push(val);
            }
        }
    }
    return payments;
}

function getTotalPaymentsForClient(clientName) {
    const payments = getAllPaymentsForClient(clientName);
    const total = payments.reduce((sum, p) => sum + (parseFloat(String(p.amount).replace(/,/g, '')) || 0), 0);
    return { total, payments, count: payments.length };
}

// Check if total payments cover invoice amount (or any single invoice)
function isPaymentSufficient(clientName, invoiceAmount) {
    const inv = parseFloat(String(invoiceAmount).replace(/,/g, '')) || 0;
    const { total, payments, count } = getTotalPaymentsForClient(clientName);

    // Single payment exact/more
    for (const p of payments) {
        const pAmt = parseFloat(String(p.amount).replace(/,/g, '')) || 0;
        if (pAmt >= inv * 0.95) {
            return { sufficient: true, matchType: 'single', matchedAmount: pAmt, total, count };
        }
    }

    // Merged payments >= invoice
    if (total >= inv * 0.95) {
        return { sufficient: true, matchType: 'merged', matchedAmount: total, total, count };
    }

    // Partial payment (at least 50% received)
    if (total >= inv * 0.5) {
        return { sufficient: false, partial: true, matchedAmount: total, total, count, shortage: inv - total };
    }

    return { sufficient: false, partial: false, matchedAmount: total, total, count };
}

function isCashSale(name) {
    const n = name.trim().toLowerCase();
    return n.includes('cash sale') || (n.includes('cash') && n.includes('sale'));
}

function isAlwaysApprove(name) {
    return isAlwaysApproveExtended(name);
}

function isAmountMatching(payAmt, invAmt) {
    const pay = parseFloat(String(payAmt).replace(/,/g, ''));
    const inv = parseFloat(String(invAmt).replace(/,/g, ''));
    if (!pay || !inv) return false;
    return Math.abs(pay - inv) / inv <= 0.05;
}

function generateRef() {
    const now = new Date();
    const month = now.toLocaleString('en-US', { month: 'short' }).toUpperCase();
    return `${month}-${now.getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
}

// ─── Ledger Alert ──────────────────────────────────────────
function buildLedgerAlert(ledger, invoiceNo, invoiceAmt) {
    const bal = ledger.outstandingAmount.toLocaleString();
    const riskEmoji = ledger.riskLevel === 'High' ? '🔴' : ledger.riskLevel === 'Medium' ? '🟡' : '🟢';
    const recent = (ledger.transactions || []).slice(-5);
    const txLines = recent.map(t =>
        `  ${t.date} — ${t.type === 'Invoice' ? '📦' : '💳'} ${t.type}: PKR ${Number(t.amount).toLocaleString()}`
    ).join('\n');
    const riskLines = (ledger.riskNotes || []).map(n => `  • ${n}`).join('\n');
    const updated = ledger.lastUpdated ? new Date(ledger.lastUpdated).toLocaleDateString('en-PK') : 'Unknown';

    return (
        `📒 *LEDGER CLIENT ALERT*\n${'─'.repeat(35)}\n` +
        `*Client:* ${ledger.name}\n` +
        `*Invoice:* ${invoiceNo} — PKR ${Number(invoiceAmt).toLocaleString()}\n` +
        `*Outstanding:* PKR ${bal} ${ledger.outstandingType}\n` +
        `*DB Updated:* ${updated}\n` +
        `${'─'.repeat(35)}\n` +
        `${riskEmoji} *Risk: ${ledger.riskLevel}*\n${riskLines}\n` +
        `${'─'.repeat(35)}\n` +
        `*Behavior:* ${ledger.behaviorSummary}\n` +
        `${'─'.repeat(35)}\n` +
        `*Recent Transactions:*\n${txLines}\n` +
        `${'─'.repeat(35)}\n` +
        `*Total Invoiced:* PKR ${ledger.totalInvoiced.toLocaleString()}\n` +
        `*Total Paid:* PKR ${ledger.totalPaid.toLocaleString()}\n` +
        `*Avg Payment Time:* ${ledger.avgPaymentDays} days`
    );
}

// ─── WhatsApp Client ───────────────────────────────────────
const client = new Client({
    authStrategy: new LocalAuth({ clientId: 'cnc-bot' }),
    puppeteer: {
        headless: true,
        executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    console.log('\n📱 Scan QR with WhatsApp (+92 321 7198443):\n');
    qrcode.generate(qr, { small: true });
});

client.on('ready', () => {
    console.log('\n✅ CNC WhatsApp Bot is LIVE!\n');
    console.log(`📂 Groups: ${PAYMENTS_GROUP} | ${INVOICE_GROUP} | ${ACCOUNT_GROUP}`);
    console.log(`🏷️  Limits: Cash Sale ${CASH_SALE_LIMIT}% | Regular ${REGULAR_LIMIT}% | Block ${HARD_BLOCK_LIMIT}%+`);
    console.log(`📋 Price list: ${priceListBase64 ? 'Loaded ✅' : 'Not found ⚠️'}`);
    console.log(`📒 Database: ${Object.keys(ledgerDB).length} clients\n`);
});

client.on('auth_failure', () => {
    console.error('❌ Auth failed. Delete .wwebjs_auth and restart.');
});

// ─── Main Handler ──────────────────────────────────────────
client.on('message', async (message) => {
    try {
        const chat = await message.getChat();
        const chatName = chat.name;
        const contact = await message.getContact();
        const senderNumber = contact.number;

        if (BOSS_RAW.includes(senderNumber)) {
            await handleBossReply(message);
            return;
        }

        // ── Payment Approval Group → Auto Approve ─────────────
        if (chatName === PAYMENT_APPROVAL_GROUP && message.hasMedia && isEnabled('payment_approval')) {
            const media = await message.downloadMedia();
            if (media && media.mimetype && media.mimetype.startsWith('image/')) {
                try {
                    const response = await anthropic.messages.create({
                        model: 'claude-haiku-4-5-20251001', max_tokens: 200,
                        messages: [{ role: 'user', content: [
                            { type: 'image', source: { type: 'base64', media_type: media.mimetype, data: media.data } },
                            { type: 'text', text: 'Extract payment info. Return ONLY JSON: {"amount":"number","bank":"bank name","client":"client name if visible","txnId":"txn id or empty"}' }
                        ]}]
                    });
                    const raw = response.content[0].text;
                    const m = raw.match(/\{[\s\S]*\}/);
                    const p = m ? JSON.parse(m[0]) : {};
                    await chat.sendMessage(
                        `✅ *Payment Approved*\n${'─'.repeat(30)}\n` +
                        `Amount: PKR ${p.amount||'—'}\nBank: ${p.bank||'—'}\n${p.client?'Client: '+p.client+'\n':''}` +
                        `${'─'.repeat(30)}\nAuto-approved ✅`
                    );
                    console.log(`✅ Payment Approval group: auto approved PKR ${p.amount}`);
                } catch(e) {
                    await chat.sendMessage('✅ Payment screenshot received and approved.');
                }
            }
        }

        // ── Payments Group → read + update Supabase ledger ────
        if (chatName === PAYMENTS_GROUP && message.hasMedia && isEnabled('payments_ledger')) {
            const media = await message.downloadMedia();
            if (media && media.mimetype && media.mimetype.startsWith('image/')) {
                const caption = message.body ? message.body.trim() : '';
                await readPaymentSilently(media, caption, chat);
            }
        }

        if (chatName === ACCOUNT_GROUP && message.hasMedia && isEnabled("account_check")) {
            const media = await message.downloadMedia();
            if (media && media.mimetype && media.mimetype.startsWith('image/')) {
                const caption = message.body ? message.body.trim() : '';
                console.log(`📒 Ledger image in Account — caption: "${caption}"`);
                const clientHint = caption.replace(/^client\s+/i, '').trim();
                const data = await extractLedgerData(media.data, 'image', clientHint);
                if (data && data.client_name) {
                    updateClientInDB({ ...data, source: 'account_group_image' });
                    console.log(`✅ DB updated from Account group: ${data.client_name}`);

                    // Compare with Supabase portal
                    try {
                        const sbClient = await getClientFromSupabase(data.client_name);
                        if (sbClient) {
                            const sbOs = sbClient.outstanding_amount || 0;
                            const imgOs = parseFloat(String(data.outstandingAmount||0).replace(/,/g,''))||0;
                            const diff = Math.abs(sbOs - imgOs);
                            if (diff > 100) {
                                const discMsg =
                                    `⚠️ *Ledger Discrepancy — ${data.client_name}*\n${'─'.repeat(35)}\n` +
                                    `Screenshot: PKR ${imgOs.toLocaleString()}\n` +
                                    `Portal: PKR ${sbOs.toLocaleString()}\n` +
                                    `Difference: PKR ${diff.toLocaleString()}\n${'─'.repeat(35)}\n` +
                                    `Please verify.`;
                                for (const num of BOSS_NUMBERS) await client.sendMessage(num, discMsg);
                                await chat.sendMessage(discMsg);
                                console.log(`⚠️ Ledger discrepancy: ${data.client_name} — diff PKR ${diff}`);
                            } else {
                                await chat.sendMessage(`✅ *${data.client_name}* — Ledger matches portal ✅\nOutstanding: PKR ${sbOs.toLocaleString()}`);
                            }
                        }
                    } catch(e) { console.error('Account compare error:', e.message); }
                }
            }
        }

        if (chatName === INVOICE_GROUP && message.hasMedia && isEnabled("invoice_approval")) {
            const media = await message.downloadMedia();
            if (media && media.mimetype === 'application/pdf') {
                const caption = message.body ? message.body.trim() : '';
                const contact = await message.getContact();
                const senderName = contact.pushname || contact.name || senderNumber;
                console.log(`📄 Invoice PDF received from: ${senderName} — caption: "${caption}"`);
                await handleInvoice(message, media, caption, senderName);
            }
        }

    } catch (err) {
        console.error('❌ Error:', err.message);
    }
});

// ─── Silent Payment Reader ─────────────────────────────────
async function readPaymentSilently(media, caption, chat) {
    try {
        // Use AI to extract client name from caption
        // Handles all formats like:
        // "Cash Received Lodhi Sab Salaar Engineering"
        // "Salaar Engineering Cash Received by Lodhi Sab"
        // "Amount received Salaar Engineering"
        // "(Salaar Engineering) Cash Received"
        let clientName = caption.trim();

        if (clientName.length > 0) {
            try {
                const captionResponse = await anthropic.messages.create({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 100,
                    messages: [{
                        role: 'user',
                        content: `Extract ONLY the client/customer name from this payment caption. 
Staff names (accounts dept): Lodhi Sab, Usman Sab, Abbas Sab, Abbas Bhai
Ignore words like: cash, received, payment, amount, by, received by, Cash Received
Caption: "${clientName}"
Return ONLY the client name, nothing else. No explanation.`
                    }]
                });
                const extracted = captionResponse.content[0].text.trim();
                if (extracted && extracted.length > 0) {
                    clientName = extracted;
                }
            } catch (err) {
                // If AI fails, use original caption
                console.log('Caption AI parse failed, using raw caption');
            }
        }

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 500,
            messages: [{
                role: 'user',
                content: [
                    { type: 'image', source: { type: 'base64', media_type: media.mimetype, data: media.data } },
                    { type: 'text', text: `Extract payment info. Caption (client name): "${clientName}". Use caption as sender_name if provided.\nThis may be a cash payment screenshot or bank transfer.\nReturn ONLY JSON: { "sender_name": "name", "amount": "number only", "date": "date", "bank": "bank or Cash if cash payment", "txnId": "transaction or reference ID, empty string if not found", "account_no": "beneficiary account number if shown, else empty" }` }
                ]
            }]
        });
        const raw = response.content[0].text;
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) return;
        const p = JSON.parse(match[0]);
        // Check for duplicate/fraud image
        const imageCheck = checkDuplicateImage(media.data, p.sender_name);

        if (imageCheck.isFraud) {
            const fraudMsg =
                `🚨 *FRAUD ALERT — Duplicate Screenshot*\n` +
                `${'─'.repeat(35)}\n` +
                `Same payment screenshot sent with different client name!\n\n` +
                `*Original:* ${imageCheck.original.name} — PKR ${Number(imageCheck.original.amount).toLocaleString()} (${imageCheck.original.date})\n` +
                `*New name:* ${p.sender_name}\n` +
                `*Amount:* PKR ${Number(p.amount).toLocaleString()}\n` +
                `${'─'.repeat(35)}\n` +
                `Please investigate immediately.`;

            // Alert bosses
            for (const num of BOSS_NUMBERS) {
                await client.sendMessage(num, fraudMsg);
            }

            // Also post in invoice group
            const chats = await client.getChats();
            const invoiceGroup = chats.find(c => c.name === INVOICE_GROUP);
            if (invoiceGroup) {
                await invoiceGroup.sendMessage(fraudMsg);
            }
            return;
        }

        if (imageCheck.isDuplicate) {
            return;
        }

        storePayment(p.sender_name, { name: p.sender_name, amount: p.amount, date: p.date, bank: p.bank, txnId: p.txnId || "", account_no: p.account_no || "" });
        storeImageHash(media.data, p.sender_name, p.amount, p.date);

        // ── Update Supabase ledger automatically ──────────────
        await updateSupabaseLedger(p.sender_name, p.amount, p.date, p.bank, p.txnId);

        // Notify in Payments group
        if (chat) {
            try {
                await chat.sendMessage(
                    `💳 *Payment Recorded*\n${'─'.repeat(28)}\n` +
                    `Client: *${p.sender_name}*\nAmount: PKR ${Number(p.amount).toLocaleString()}\n` +
                    `Bank: ${p.bank||'—'} | Date: ${p.date||'Today'}\n${'─'.repeat(28)}\n` +
                    `Ledger updated ✅`
                );
            } catch(e) {}
        }

        // Record salesperson for payment
        try {
            const payContact = await message.getContact();
            const paySender = payContact.pushname || payContact.name || message.from;
            recordSalesperson(p.sender_name, paySender, message.from, 'payment', null);
        } catch(e) {}

    } catch (err) {
        console.error('❌ Payment read error:', err.message);
    }
}

// ─── Smart AI Decision Engine ─────────────────────────────
async function makeSmartDecision(inv, discount, discountDetail, netAmt, ledger, recentPayments, salesComment = null) {
    const ledgerSummary = ledger
        ? `Client has ledger: PKR ${ledger.outstandingAmount.toLocaleString()} ${ledger.outstandingType} outstanding. Risk: ${ledger.riskLevel}. Behavior: ${ledger.behaviorSummary}`
        : 'No ledger record found for this client.';

    const paymentsSummary = recentPayments.length > 0
        ? recentPayments.map(p =>
            `- ${p.date}: PKR ${Number(p.amount).toLocaleString()} from ${p.name} via ${p.bank} (TXN: ${p.txnId || 'N/A'})`
          ).join('\n')
        : 'No recent payments found for this client.';

    // Get ALL time payment history for client
    const allClientPayments = getAllPaymentsForClient(inv.client_name);
    const totalEverPaid = allClientPayments.reduce((s,p) => s + (parseFloat(String(p.amount).replace(/,/g,''))||0), 0);
    const paymentHistorySummary = allClientPayments.length > 0
        ? `Client has made ${allClientPayments.length} total payment(s) totaling PKR ${totalEverPaid.toLocaleString()}. Recent: ${allClientPayments.slice(-3).map(p => `PKR ${Number(p.amount).toLocaleString()} on ${p.date}`).join(', ')}`
        : 'No payment history found in database for this client.';

    const cashConfirmation = (cashOnInvoice || cashNote)
        ? `CASH CONFIRMED ON INVOICE: YES — "${cashNote || 'Cash Received noted on invoice'}"`
        : 'No cash confirmation on invoice';

    const paymentCheckSummary = `Payment analysis:
- Total payments received: PKR ${recentPayments.reduce((s,p) => s + (parseFloat(String(p.amount).replace(/,/g,''))||0), 0).toLocaleString()} (${recentPayments.length} payment(s))
- Invoice amount: PKR ${netAmt}
- Payment sufficient: ${recentPayments.reduce((s,p) => s + (parseFloat(String(p.amount).replace(/,/g,''))||0), 0) >= parseFloat(String(netAmt).replace(/,/g,'')) * 0.95 ? 'YES' : 'NO'}
- Individual payments: ${recentPayments.map(p => `PKR ${Number(p.amount).toLocaleString()} on ${p.date}`).join(', ') || 'None'}`;

    const salesCommentSummary = salesComment
        ? `Sales person comment: "${salesComment.summary}"
- Claims payment received: ${salesComment.claims_payment_received}
- Has future commitment: ${salesComment.has_commitment}
- Commitment: ${salesComment.commitment_text || 'None'}
- Days promised: ${salesComment.days_until_payment || 'N/A'}`
        : 'No sales person comment provided.';

    const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-5',
        max_tokens: 1000,
        messages: [{
            role: 'user',
            content: `You are the intelligent invoice approval brain for CNC Electric Pakistan — a wholesale electrical components distributor.

Your job is to think like an experienced business manager. Use common sense, context, and all available information to make the RIGHT decision. Do not follow rigid rules blindly — understand the SITUATION.

KEY BUSINESS CONTEXT:
- CNC Electric sells to dealers, contractors, solar companies, and walk-in customers
- Most customers pay before receiving goods (advance/bank transfer)
- Some trusted clients have credit arrangements (ledger clients)
- Cash payments are common — sales person collects cash and delivers goods
- "Cash Received", "Cash Handover", "Cash Given" on invoice or in comment = payment confirmed
- Multiple payments from same client can cover one invoice
- Client may have paid more than invoice amount (credit balance)
- Sales persons write comments in Urdu/English mix — understand both

SMART APPROVAL SIGNALS (these indicate you should APPROVE):
- Invoice says "Cash Received" or similar → payment confirmed
- Caption says "Cash Handover", "Cash Received", "Cash Diya", "Naqad" → payment confirmed
- Total payments received >= invoice amount (even if multiple payments)
- Payment received within last 7 days matches invoice amount
- Client has credit balance (paid more than owed)
- Trusted/regular client with small invoice and reasonable discount
- Sales person explicitly confirms payment in comment

HOLD SIGNALS (manual review needed):
- No payment found anywhere AND no cash confirmation
- Discount between 25-30% (needs boss approval)
- Amount mismatch with no explanation
- Suspicious patterns

BLOCK SIGNALS (hard stop):
- Discount above 30% (non-negotiable hard limit)
- Ledger outstanding above PKR 500,000 Dr AND no payment received

MANUAL APPROVAL (HOLD) — ONLY for these situations:
- Client has a LEDGER (credit account) AND no payment received → send to owner
- Discount between 25-30% → send to owner
- That is ALL. Do not hold for any other reason.

EVERYTHING ELSE → YOU DECIDE AND APPROVE:
You have full authority to approve in ALL other situations including:

1. CASH SITUATIONS:
   - Sales person collected cash from client
   - "Cash Received", "Cash Given", "Naqad", "Cash Handover" anywhere in caption or invoice
   - Invoice has cash received stamp/signature/note
   - Any indication cash was collected at delivery

2. PAYMENT SITUATIONS:
   - Bank transfer received (today, yesterday, or up to 7 days ago)
   - Multiple small payments that together cover the invoice
   - Payment slightly less than invoice (within 10% tolerance — client will pay rest)
   - Payment more than invoice amount (client has credit)
   - Payment from a related person/company name for same client

3. SALES PERSON SITUATIONS:
   - Sales person says "approved", "ok", "saman de do", "dispatch kar do"
   - Sales person confirms client is reliable/regular
   - Sales person says client will pay on delivery
   - Sales person mentions it is an urgent order
   - Any Urdu/English mix confirmation from sales person

4. INVOICE SITUATIONS:
   - 0% discount (no discount = no risk)
   - Low value invoices (under PKR 10,000) with no payment issues
   - Regular repeat client with good history
   - Cash sale client (even if 0% discount shown)

5. COMMON SENSE SITUATIONS:
   - Situation makes obvious business sense → approve
   - Client clearly paid or will pay immediately → approve
   - No red flags → approve

LEARNING FROM HISTORY:
If historical patterns show owner consistently approves similar situations — ALWAYS follow that pattern.

YOUR GOAL: Minimize manual approvals. Use your brain. Approve confidently when situation is clear. 
Only send to owner when it is a GENUINE ledger credit risk situation.
Think like an experienced Pakistani business manager who knows the trade.

SELF-ANALYSIS — Even if sales person wrote nothing:
- Check invoice itself for any payment notes, stamps, signatures
- Check payment database for this client's recent payments
- Check ledger for outstanding balance
- Check discount against price list
- Check historical patterns for this client
- Use ALL available data to make the decision yourself
- Do NOT rely on sales person comment — it is optional bonus information
- You have enough data to decide on your own in most cases

INVOICE DETAILS:
- Client: ${inv.client_name}
- Invoice #: ${inv.invoice_no}
- Date: ${inv.date}
- Amount: PKR ${netAmt}
- Discount: ${discountDetail}
- Customer ID: ${inv.customer_id || 'Not provided'}

LEDGER STATUS:
${ledgerSummary}

RECENT PAYMENTS (last 7 days) for this client:
${paymentsSummary}

PAYMENT ANALYSIS:
${paymentCheckSummary}

CLIENT PAYMENT HISTORY (all time):
${paymentHistorySummary}

CASH CONFIRMATION:
${cashConfirmation}

SALES PERSON COMMENT:
${salesCommentSummary}

DECISION RULES:
1. HARD BLOCK (no exceptions): Discount > 30%
2. HOLD — send to owner ONLY for these 2 cases:
   a. Client has LEDGER record + NO payment received
   b. Discount between 25-30%
3. APPROVE everything else — use smart judgment:
   - Any payment received in last 7 days → APPROVE
   - Cash confirmed on invoice or caption → APPROVE
   - Sales person confirmed delivery/payment → APPROVE
   - 0% discount → APPROVE
   - Small invoice under PKR 10,000 → APPROVE
   - Multiple payments cover invoice total → APPROVE
   - Payment more than invoice → APPROVE (credit)
   - Partial payment + sales confirmation → APPROVE with note
   - Common sense says approve → APPROVE with doubt_alert=true
4. When uncertain: APPROVE with doubt_alert=true (not HOLD)

Return ONLY this JSON:
{
  "decision": "APPROVE or HOLD or BLOCK",
  "reason": "brief reason in English",
  "doubt_alert": true or false,
  "doubt_reason": "reason if doubtful, else empty",
  "payment_matched": true or false,
  "payment_details": "which payment matched and when, else empty",
  "group_message": "professional message for the invoice group (in English)",
  "boss_message": "detailed alert for owners (in English)"
}`
        }]
    });

    const raw = response.content[0].text;
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('AI decision parse failed');
    return JSON.parse(match[0]);
}

function getRecentPaymentsForClient(clientName) {
    const key = clientName.trim().toLowerCase();
    const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
    const results = [];

    for (const [k, val] of Object.entries(paymentMemory)) {
        if (k === key || k.includes(key) || key.includes(k)) {
            if (!val.storedAt || val.storedAt >= sevenDaysAgo) {
                results.push(val);
            }
        }
    }
    return results;
}

// ─── Invoice Handler ───────────────────────────────────────
async function handleInvoice(message, media, caption = '', senderName = 'Sales Person') {
    try {
        const contentArray = [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: media.data } }
        ];
        if (priceListBase64) {
            contentArray.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: priceListBase64 } });
        }
        contentArray.push({
            type: 'text',
            text: `First doc is invoice. ${priceListBase64 ? 'Second doc is CNC price list — compare each item and use HIGHER of invoice-stated vs price-list discount.' : 'No price list.'}
Return ONLY JSON:
{
  "client_name": "exact name",
  "customer_id": "CNC-810 style or empty",
  "invoice_no": "invoice number",
  "date": "date",
  "total_before_discount": "number",
  "discount_amount": "number",
  "discount_percent": "number 2 decimals",
  "price_list_discount_percent": "number 2 decimals",
  "final_discount_percent": "higher of two 2 decimals",
  "net_amount": "number",
  "advance_balance": "number or 0",
  "outstanding_balance": "number or 0",
  "price_list_note": "note or empty",
  "cash_received_on_invoice": true or false,
  "cash_note": "any cash/payment note on invoice or empty"
}`
        });

        const response = await anthropic.messages.create({
            model: 'claude-sonnet-4-5',
            max_tokens: 1200,
            messages: [{ role: 'user', content: contentArray }]
        });

        const raw = response.content[0].text;
        const match = raw.match(/\{[\s\S]*\}/);
        if (!match) throw new Error('Parse failed');
        const inv = JSON.parse(match[0]);

        const discount    = parseFloat(inv.final_discount_percent) || 0;
        const invDiscount = parseFloat(inv.discount_percent) || 0;
        const plDiscount  = parseFloat(inv.price_list_discount_percent) || 0;
        const netAmt      = Number(inv.net_amount).toLocaleString();
        const cashSale    = isCashSale(inv.client_name);
        const alwaysOk    = isAlwaysApprove(inv.client_name);
        const autoLimit   = cashSale ? CASH_SALE_LIMIT : REGULAR_LIMIT;
        const ref         = generateRef();
        const custId      = inv.customer_id || '';
        const partyLine   = custId ? `${inv.client_name} (${custId})` : inv.client_name;
        const advance     = Number(inv.advance_balance) || 0;
        const outstanding = Number(inv.outstanding_balance) || 0;
        const plNote      = inv.price_list_note || '';

        // Record salesperson-client mapping
        recordSalesperson(inv.client_name, senderName, message.from, 'invoice', inv.invoice_no);
        const cashOnInvoice = inv.cash_received_on_invoice || false;
        const cashNote     = inv.cash_note || '';

        const erpLine = advance > 0
            ? `Yes — advance PKR ${advance.toLocaleString()}`
            : custId ? `${custId}  outstanding PKR ${outstanding.toLocaleString()}` : `No record`;

        const discountDetail = priceListBase64 && Math.abs(plDiscount - invDiscount) > 0.5
            ? `${discount}%  (Invoice: ${invDiscount}% | Price List: ${plDiscount}%)`
            : `${discount}%`;

        // Ledger check — local DB first, then Supabase
        let ledger = findInDB(inv.client_name);
        let supabaseLedger = null;
        try {
            supabaseLedger = await getClientFromSupabase(inv.client_name);
        } catch(e) {}

        // Use Supabase data if available (more accurate)
        if (supabaseLedger) {
            if (!ledger) ledger = {};
            ledger.outstandingAmount = supabaseLedger.outstanding_amount || 0;
            ledger.outstandingType   = supabaseLedger.outstanding_type   || 'Dr';
            ledger.riskLevel         = ledger.riskLevel || 'Medium';
            ledger.behaviorSummary   = ledger.behaviorSummary || 'From portal ledger';
        }

        const hasLedger = ledger !== null && (ledger.outstandingAmount || 0) > 0;
        const ledgerOutstanding = hasLedger ? (ledger.outstandingAmount||0) : 0;
        const ledgerType = ledger ? (ledger.outstandingType||'Dr') : 'Dr';

        // Store invoice in memory for approve/reject messages
        storeInvoice(inv.invoice_no, {
            clientName: inv.client_name,
            partyLine,
            netAmt,
            discountDetail,
            erpLine,
            ledgerOutstanding,
            ledgerType,
            riskLevel: hasLedger ? ledger.riskLevel : null,
            date: inv.date,
            plNote
        });

        // Send ledger alert if ledger client
        if (hasLedger) {
            const alertMsg = buildLedgerAlert(ledger, inv.invoice_no, inv.net_amount);
            for (const num of BOSS_NUMBERS) await client.sendMessage(num, alertMsg);
        }

        // ── ALWAYS APPROVE — No checks, no AI, direct approve ──
        if (alwaysOk) {
            const approveMsg =
                `✅ *APPROVED*  •  ${ref}
${'─'.repeat(35)}
` +
                `Invoice: ${inv.invoice_no}
Party:   ${partyLine}
` +
                `Amount:  PKR ${netAmt}  (disc ${discountDetail})
` +
                `ERP:     ${erpLine}
${'─'.repeat(35)}
` +
                `Pre-approved client — payment on delivery.
Dispatch after confirmation.`;

            await message.reply(approveMsg);

            for (const num of BOSS_NUMBERS) {
                await client.sendMessage(num,
                    `✅ *Auto-Approved — Pre-approved Client*

` +
                    `Invoice: ${inv.invoice_no} | Client: ${partyLine}
` +
                    `Amount: PKR ${netAmt} | Discount: ${discountDetail}`
                );
            }

            console.log(`✅ Always-approve: ${inv.invoice_no}`);
            return;  // Stop here — no further checks
        }

        // ── HARD BLOCK: 30%+ ──
        if (discount > HARD_BLOCK_LIMIT) {
            await message.reply(
                `🚫 *REJECTED — NOT APPROVABLE*  •  ${ref}
${'─'.repeat(35)}
` +
                `Invoice: ${inv.invoice_no}
Party:   ${partyLine}
` +
                `Amount:  PKR ${netAmt}  (disc ${discountDetail})
` +
                `${'─'.repeat(35)}
` +
                `Reason: Discount ${discount}% exceeds maximum ${HARD_BLOCK_LIMIT}%. Please revise.` +
                (plNote ? `
📋 ${plNote}` : '')
            );
            for (const num of BOSS_NUMBERS) {
                await client.sendMessage(num,
                    `🚫 *Hard Block*
Invoice: ${inv.invoice_no} | Client: ${partyLine}
` +
                    `Amount: PKR ${netAmt} | Discount: ${discountDetail}
` +
                    `Reason: Discount exceeds 30% limit`
                );
            }
            console.log(`🚫 Hard blocked: ${inv.invoice_no} — ${discount}%`);
            return;
        }

        // ── Analyze Sales Person Caption/Comment ──
        let salesComment = null;
        if (caption && caption.length > 0) {
            try {
                const commentResponse = await anthropic.messages.create({
                    model: 'claude-sonnet-4-5',
                    max_tokens: 500,
                    messages: [{
                        role: 'user',
                        content: `Analyze this sales person's comment on an invoice and extract key information.

Sales person comment: "${caption}"
Invoice amount: PKR ${netAmt}
Client: ${inv.client_name}

Extract:
1. Is there a payment commitment? (e.g., "payment in 3 weeks", "will pay next month")
2. How many days until promised payment? (convert weeks/months to days)
3. Is the sales person claiming payment already received?
4. Any other important notes?

Return ONLY valid JSON:
{
  "has_commitment": true or false,
  "commitment_text": "exact commitment if any",
  "days_until_payment": number or null,
  "claims_payment_received": true or false,
  "payment_claim_text": "what they said about payment",
  "other_notes": "any other important info",
  "summary": "one line summary of the comment"
}`
                    }]
                });

                const commentRaw = commentResponse.content[0].text;
                const commentMatch = commentRaw.match(/\{[\s\S]*\}/);
                if (commentMatch) {
                    salesComment = JSON.parse(commentMatch[0]);
                    console.log(`💬 Sales comment analyzed: ${salesComment.summary}`);

                    // Save commitment if found
                    if (salesComment.has_commitment && salesComment.days_until_payment) {
                        const dueDate = new Date();
                        dueDate.setDate(dueDate.getDate() + salesComment.days_until_payment);
                        saveCommitment(inv.invoice_no, {
                            clientName: inv.client_name,
                            invoiceAmount: netAmt,
                            salesPerson: senderName,
                            commitmentText: salesComment.commitment_text,
                            dueDate: dueDate.toISOString(),
                            dueDateStr: dueDate.toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' }),
                            rawComment: caption
                        });
                    }
                }
            } catch (err) {
                console.error('❌ Comment analysis error:', err.message);
            }
        }

        // ── Payment Sufficiency Check (merged) ──
        const paymentCheck = isPaymentSufficient(inv.client_name, inv.net_amount);

        // ── Pattern Learning Check ──
        const patternRec = getPatternRecommendation(discount, paymentCheck.sufficient, hasLedger, ledgerType);
        const patternHint = patternRec && patternRec.recommendation
            ? `\nHISTORICAL PATTERN: Based on ${patternRec.situations.length} similar past situations, owner has chosen ${patternRec.recommendation} ${Math.round((patternRec.approveCount / (patternRec.approveCount + patternRec.holdCount)) * 100)}% of the time. STRONGLY consider this pattern.`
            : '';

        // ── AI SMART DECISION ──
        const recentPayments = getRecentPaymentsForClient(inv.client_name);
        let aiDecision;

        // Try AI with 3 retries
        let aiAttempts = 0;
        while (aiAttempts < 3) {
            try {
                aiDecision = await makeSmartDecision(inv, discount, discountDetail, netAmt, ledger, recentPayments, salesComment);
                break;
            } catch (err) {
                aiAttempts++;
                console.error(`❌ AI attempt ${aiAttempts}/3 failed:`, err.message);
                if (aiAttempts < 3) await sleep(2000);
            }
        }

        // Smart fallback if all retries failed
        if (!aiDecision) {
            console.error('❌ All AI retries failed — smart fallback');
            const hasPayment = paymentCheck.count > 0;
            const hasCash = cashOnInvoice || (salesComment && salesComment.claims_payment_received);
            const payOk = paymentCheck.sufficient || hasCash;

            if (discount > HARD_BLOCK_LIMIT) {
                aiDecision = { decision: 'BLOCK', reason: `Discount ${discount}% exceeds ${HARD_BLOCK_LIMIT}% limit`, doubt_alert: false, doubt_reason: '', payment_details: '' };
            } else if (discount >= 25 && discount <= 30) {
                aiDecision = { decision: 'HOLD', reason: `Discount ${discount}% needs manual approval`, doubt_alert: false, doubt_reason: '', payment_details: '' };
            } else if (hasLedger && !hasPayment && !hasCash) {
                aiDecision = { decision: 'HOLD', reason: 'Ledger client — no payment received', doubt_alert: false, doubt_reason: '', payment_details: '' };
            } else if (payOk || discount === 0 || (!hasLedger && discount <= 25)) {
                aiDecision = { decision: 'APPROVE', reason: `Fallback: discount ${discount}%, ${payOk ? 'payment confirmed' : 'no ledger risk'}`, doubt_alert: true, doubt_reason: 'AI unavailable — verify if needed', payment_details: hasPayment ? `PKR ${paymentCheck.total.toLocaleString()}` : '' };
            } else {
                aiDecision = { decision: 'APPROVE', reason: 'Fallback approval — no major risk', doubt_alert: true, doubt_reason: 'AI unavailable — please verify', payment_details: '' };
            }
        }

        // Send group message
        let groupMsg = aiDecision.group_message;

        // Add standard footer based on decision
        if (aiDecision.decision === 'APPROVE') {
            groupMsg = `✅ *APPROVED*  •  ${ref}
${'─'.repeat(35)}
` +
                `Invoice: ${inv.invoice_no}
Party:   ${partyLine}
` +
                `Amount:  PKR ${netAmt}  (disc ${discountDetail})
` +
                `ERP:     ${erpLine}
${'─'.repeat(35)}
` +
                `${aiDecision.payment_details ? `Payment: ${aiDecision.payment_details}
` : ''}` +
                `Reason: ${aiDecision.reason}
` +
                `Dispatch after payment receipt.` +
                (plNote ? `
📋 ${plNote}` : '');
        } else if (aiDecision.decision === 'HOLD') {
            groupMsg = `⚠️ *ON HOLD — MANUAL REVIEW*  •  ${ref}
${'─'.repeat(35)}
` +
                `Invoice: ${inv.invoice_no}
Party:   ${inv.client_name}
` +
                `Amount:  PKR ${netAmt}  (disc ${discountDetail})
` +
                `ERP:     ${erpLine}
${'─'.repeat(35)}
` +
                `Hold reason: ${aiDecision.reason}` +
                (plNote ? `
📋 ${plNote}` : '');
        } else if (aiDecision.decision === 'BLOCK') {
            groupMsg = `🚫 *BLOCKED*  •  ${ref}
${'─'.repeat(35)}
` +
                `Invoice: ${inv.invoice_no}
Party:   ${partyLine}
` +
                `Amount:  PKR ${netAmt}  (disc ${discountDetail})
` +
                `${'─'.repeat(35)}
` +
                `Reason: ${aiDecision.reason}`;
        }

        await message.reply(groupMsg);

        // Boss message
        let bossMsg = `${aiDecision.decision === 'APPROVE' ? '✅' : aiDecision.decision === 'BLOCK' ? '🚫' : '⚠️'} *Invoice ${aiDecision.decision}*

` +
            `Ref: ${ref}
Invoice: ${inv.invoice_no} | Client: ${partyLine}
` +
            `Amount: PKR ${netAmt} | Discount: ${discountDetail}
` +
            `ERP: ${erpLine}
` +
            (hasLedger ? `Ledger: PKR ${ledgerOutstanding.toLocaleString()} ${ledgerType}
` : '') +
            (aiDecision.payment_details ? `Payment: ${aiDecision.payment_details}
` : '') +
            `Reason: ${aiDecision.reason}` +
            (plNote ? `
📋 ${plNote}` : '');

        if (aiDecision.decision !== 'APPROVE') {
            bossMsg += `

Reply:
✅ APPROVE ${inv.invoice_no}
🚫 NOT APPROVE ${inv.invoice_no}`;
        }

        for (const num of BOSS_NUMBERS) {
            await client.sendMessage(num, bossMsg);
        }

        // Doubt alert
        if (aiDecision.doubt_alert) {
            const doubtMsg = `⚠️ *DOUBT ALERT*

` +
                `Invoice: ${inv.invoice_no} | Client: ${partyLine}
` +
                `Amount: PKR ${netAmt}
` +
                `Decision: ${aiDecision.decision}
` +
                `Doubt reason: ${aiDecision.doubt_reason}

` +
                `Please verify manually.`;
            for (const num of BOSS_NUMBERS) {
                await client.sendMessage(num, doubtMsg);
            }
        }

        // Record decision for learning
        recordDecision(inv.invoice_no, {
            clientName: inv.client_name,
            botDecision: aiDecision.decision,
            discount,
            hadPayment: paymentCheck.count > 0,
            paymentTotal: paymentCheck.total,
            paymentSufficient: paymentCheck.sufficient,
            hadLedger: hasLedger,
            ledgerOutstanding,
            ledgerType,
            aiReason: aiDecision.reason,
            doubtAlert: aiDecision.doubt_alert
        });

        console.log(`${aiDecision.decision}: ${inv.invoice_no} — ${discount}% | Doubt: ${aiDecision.doubt_alert}`);

    } catch (err) {
        console.error('❌ Invoice error:', err.message);
        await message.reply('❌ Invoice process nahi ho saka.');
    }
}

// ─── Boss Reply Handler ────────────────────────────────────
async function handleBossReply(message) {
    try {
        const text = message.body.trim().toUpperCase();
        if (!text.startsWith('APPROVE ') && !text.startsWith('NOT APPROVE ')) return;

        const isApprove = text.startsWith('APPROVE ');
        const invoiceNo = message.body.trim().split(' ').slice(isApprove ? 1 : 2).join(' ');
        const ref = generateRef();

        // Get stored invoice details
        const inv = getInvoice(invoiceNo);

        const chats = await client.getChats();
        const invoiceGroup = chats.find(c => c.name === INVOICE_GROUP);
        if (!invoiceGroup) { await message.reply('❌ Invoice group nahi mila.'); return; }

        if (isApprove) {
            const approveMsg =
                `✅ *APPROVED*  •  ${ref}\n${'─'.repeat(35)}\n` +
                `Invoice: ${invoiceNo}\n` +
                (inv ? `Party:   ${inv.partyLine}\nAmount:  PKR ${inv.netAmt}  (disc ${inv.discountDetail})\nERP:     ${inv.erpLine}\n` : '') +
                (inv && inv.ledgerOutstanding > 0 ? `Ledger:  PKR ${inv.ledgerOutstanding.toLocaleString()} ${inv.ledgerType}\n` : '') +
                `${'─'.repeat(35)}\n` +
                `Approved by management.\nDispatch after payment receipt.` +
                (inv && inv.plNote ? `\n📋 ${inv.plNote}` : '');

            await invoiceGroup.sendMessage(approveMsg);
            await message.reply(`✅ Invoice *${invoiceNo}* approved. Group notify ho gaya.`);
            // Record correction if bot had previously held/blocked this
            const prevDecision = decisionsDB[invoiceNo];
            if (prevDecision && prevDecision.botDecision !== 'APPROVE') {
                recordCorrection(invoiceNo, 'APPROVE');
            }
            console.log(`✅ Boss approved: ${invoiceNo}`);

        } else {
            // NOT APPROVE
            const rejectMsg =
                `🚫 *NOT APPROVED*  •  ${ref}\n${'─'.repeat(35)}\n` +
                `Invoice: ${invoiceNo}\n` +
                (inv ? `Party:   ${inv.partyLine}\nAmount:  PKR ${inv.netAmt}  (disc ${inv.discountDetail})\nERP:     ${inv.erpLine}\n` : '') +
                (inv && inv.ledgerOutstanding > 0 ? `Ledger:  PKR ${inv.ledgerOutstanding.toLocaleString()} ${inv.ledgerType}\n` : '') +
                (inv && inv.riskLevel ? `Risk:    ${inv.riskLevel}\n` : '') +
                `${'─'.repeat(35)}\n` +
                `Reason: Not approved by management.\nPlease revise and resubmit.`;

            await invoiceGroup.sendMessage(rejectMsg);
            await message.reply(`🚫 Invoice *${invoiceNo}* not approved. Group notify ho gaya.`);
            // Record correction if bot had approved this
            const prevDecision2 = decisionsDB[invoiceNo];
            if (prevDecision2 && prevDecision2.botDecision === 'APPROVE') {
                recordCorrection(invoiceNo, 'NOT APPROVE');
            }
            console.log(`🚫 Boss rejected: ${invoiceNo}`);
        }

    } catch (err) {
        console.error('❌ Boss reply error:', err.message);
    }
}

// ─── Daily Ledger Reports ──────────────────────────────────
const REPORT_NUMBERS = [
    process.env.MUDDASIR_NUMBER + '@c.us',
    process.env.AWAIS_NUMBER   + '@c.us',
    process.env.BILAL_CTO_NUMBER + '@c.us'
];

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function fetchClientsFromSupabase() {
    if (!SUPABASE_URL || !SUPABASE_KEY) return [];
    try {
        const https = require('https');
        return new Promise(resolve => {
            const path = '/rest/v1/clients?outstanding_amount=gt.0&outstanding_type=eq.Dr&source=in.(cnc_ledger,cspl_ledger,cst_ledger)&select=id,name,phone,outstanding_amount,branch,salesperson&order=outstanding_amount.desc&limit=1000';
            const opts = { hostname: new URL(SUPABASE_URL).hostname, path, headers: { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY } };
            https.get(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(JSON.parse(d)||[])); }).on('error',()=>resolve([]));
        });
    } catch(e) { return []; }
}

function fmtPKR(n) {
    if(n>=10000000) return (n/10000000).toFixed(2)+' Cr';
    if(n>=100000)   return (n/100000).toFixed(2)+' L';
    return n.toLocaleString('en-PK');
}

async function sendDailyLedgerReports() {
    await loadBotSettings();
    if (!isEnabled('ledgers_send')) { console.log('⏸️ Ledger send disabled'); return; }
    console.log('📊 Daily report starting...');
    const clients = await fetchClientsFromSupabase();
    if (!clients.length) { console.log('No clients found'); return; }

    const today = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
    const totalOs = clients.reduce((s,c)=>s+(c.outstanding_amount||0), 0);

    // Branch-wise totals
    const branches = {};
    clients.forEach(c => {
        const b = c.branch || 'Other';
        if(!branches[b]) branches[b] = 0;
        branches[b] += (c.outstanding_amount||0);
    });

    let sent = 0, failed = 0;

    // 1. Send individual statement to each client with phone
    for (const c of clients) {
        if (!c.phone) continue;
        const phone = c.phone.replace(/[^0-9]/g,'');
        const waId = (phone.startsWith('0') ? '92'+phone.slice(1) : phone) + '@c.us';
        const msg = `*CNC Electric — Outstanding Balance*\n${'─'.repeat(30)}\n` +
            `Client: *${c.name}*\n` +
            `Branch: ${c.branch||'—'}\n` +
            `Date: ${today}\n${'─'.repeat(30)}\n` +
            `*Outstanding: PKR ${c.outstanding_amount.toLocaleString('en-PK')}*\n${'─'.repeat(30)}\n` +
            `Please clear the above amount at your earliest.\n\n_CNC Electric Pakistan_`;
        try {
            await client.sendMessage(waId, msg);
            sent++;
            await new Promise(r=>setTimeout(r,1500)); // 1.5s delay between messages
        } catch(e) {
            failed++;
            console.error(`Failed: ${c.name}`, e.message);
        }
    }

    // 2. Send summary report to bosses
    const topClients = clients.slice(0,10);
    const branchLines = Object.entries(branches).sort((a,b)=>b[1]-a[1]).map(([b,t])=>`  • ${b}: PKR ${fmtPKR(t)}`).join('\n');
    const topLines = topClients.map((c,i)=>`  ${i+1}. ${c.name} — PKR ${fmtPKR(c.outstanding_amount)}`).join('\n');

    const reportMsg = `📊 *Daily Outstanding Report*\n${today}\n${'─'.repeat(35)}\n` +
        `*Total Outstanding: PKR ${fmtPKR(totalOs)}*\n` +
        `Clients with balance: ${clients.length}\n` +
        `Messages sent: ${sent} ✅  Failed: ${failed}\n${'─'.repeat(35)}\n` +
        `*Branch Wise:*\n${branchLines}\n${'─'.repeat(35)}\n` +
        `*Top 10 Clients:*\n${topLines}\n${'─'.repeat(35)}\n` +
        `_Generated at 8:00 AM by CNC Bot_`;

    for (const num of REPORT_NUMBERS) {
        try {
            await client.sendMessage(num, reportMsg);
        } catch(e) {
            console.error('Report send failed:', num, e.message);
        }
    }
    console.log(`✅ Daily report done — Sent: ${sent}, Failed: ${failed}`);
}

function scheduleDailyReport() {
    const hour   = parseInt(process.env.DAILY_REPORT_HOUR   || '8');
    const minute = parseInt(process.env.DAILY_REPORT_MINUTE || '0');

    function msUntilNext() {
        const now = new Date();
        const next = new Date();
        next.setHours(hour, minute, 0, 0);
        if (next <= now) next.setDate(next.getDate() + 1);
        return next - now;
    }

    function schedule() {
        const ms = msUntilNext();
        const h = Math.floor(ms/3600000);
        const m = Math.floor((ms%3600000)/60000);
        console.log(`⏰ Daily report scheduled in ${h}h ${m}m`);
        setTimeout(async () => {
            await sendDailyLedgerReports();
            setInterval(sendDailyLedgerReports, 24 * 60 * 60 * 1000);
        }, ms);
    }
    schedule();
}

// ─── Start ─────────────────────────────────────────────────
async function start() {
    loadDB();
    loadPaymentsDB();
    loadCommitmentsDB();
    loadDecisionsDB();
    loadSalespersonDB();
    loadPriceList();
    await loadBotSettings();
    await loadAllLedgerPDFs();

    // Check commitments every 6 hours
    setInterval(async () => {
        try {
            await checkCommitments();
        } catch (err) {
            console.error('❌ Commitment check error:', err.message);
        }
    }, 6 * 60 * 60 * 1000);

    // Schedule daily ledger reports at 8 AM
    scheduleDailyReport();

    console.log('🚀 Starting CNC WhatsApp Bot...');
    client.initialize();
}

start();
