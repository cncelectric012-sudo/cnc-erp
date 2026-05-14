// ═══════════════════════════════════════════════════════════════
// CNC Electric — Bank Alert Webhook v2
// Features: multi-SMS split, deduplication, debit detection,
//           enhanced risk analysis, client-bank tracking
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const WEBHOOK_SECRET = 'cnc-bank-secret-2026';
const HDR = {
  'apikey': SUPABASE_KEY,
  'Authorization': 'Bearer ' + SUPABASE_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=minimal'
};

// ── Split combined SMS (1. ... 2. ... 3. ...) ─────────────────
function splitMessages(text) {
  // Split by numbered entries like "1. ", "2. " at start of line
  const parts = text.split(/(?:^|\n)\s*\d+\.\s+/m).filter(p => p.trim().length > 20);
  if (parts.length > 1) return parts;
  return [text]; // single message
}

// ── Parse single SMS/email ────────────────────────────────────
function parseAlert(text) {
  const t = String(text || '').replace(/\r\n/g, '\n').trim();
  const result = {
    raw_text: t,
    bank_name: '', account_last4: '', account_no: '',
    amount: 0, sender: '', txn_id: '',
    alert_date: '', alert_time: '', transfer_type: '',
    direction: 'credit' // credit or debit
  };

  if (!t) return result;

  // ── Direction (credit vs debit) ───────────────────────────
  if (/debited|deducted|withdrawn|debit|charged|sent from|transferred from/i.test(t)) {
    result.direction = 'debit';
  }

  // ── Amount ────────────────────────────────────────────────
  const amtPatterns = [
    /(?:PKR|Rs\.?)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    /([0-9,]+(?:\.[0-9]{2})?)\s*(?:PKR|Rs\.?)/i,
    /(?:credited|debited|received|sent)\s+(?:with\s+)?(?:Rs\.?\s*)?([0-9,]+(?:\.[0-9]{2})?)/i,
  ];
  for (const p of amtPatterns) {
    const m = t.match(p);
    if (m) { result.amount = parseFloat(m[1].replace(/,/g, '')); break; }
  }

  // ── Bank ──────────────────────────────────────────────────
  if (/BAHL|Bank Al.?Habib/i.test(t))         result.bank_name = 'Bank Al Habib';
  else if (/BAF\b|Bank Alfalah|ALFH/i.test(t)) result.bank_name = 'Bank Alfalah';
  else if (/MBL\b|Meezan/i.test(t))            result.bank_name = 'Meezan Bank';
  else if (/HBL|Habib Bank/i.test(t))          result.bank_name = 'HBL';
  else if (/UBL/i.test(t))                     result.bank_name = 'UBL';
  else if (/MCB/i.test(t))                     result.bank_name = 'MCB';
  else if (/JSBL?|JS Bank/i.test(t))           result.bank_name = 'JS Bank';
  else if (/NBP/i.test(t))                     result.bank_name = 'NBP';
  else if (/Faysal/i.test(t))                  result.bank_name = 'Faysal Bank';

  // ── Account last 4 ───────────────────────────────────────
  const acc4 = t.match(/[*x]{2,4}([0-9]{4})/i) || t.match(/A\/C[^0-9]*([0-9]{4})/i) || t.match(/account[^0-9]*([0-9]{4})/i);
  if (acc4) result.account_last4 = acc4[1];

  // ── Sender ────────────────────────────────────────────────
  const senderPatterns = [
    /from ([A-Z][A-Z &.]{3,40}?) (?:MBL|HBL|UBL|MCB|BAHL|BAF|Meezan|in your)/i,
    /received from ([A-Z][A-Z &.]{3,40})/i,
    /from ([A-Za-z][A-Za-z &.]{3,35}?) on /i,
    /Sender,\s*([A-Za-z ]+)/i,
    /from ([A-Z][A-Z &.]{3,40}?) MPBL/i,
  ];
  for (const p of senderPatterns) {
    const m = t.match(p);
    if (m && m[1].trim().length > 2) { result.sender = m[1].trim().replace(/\s+/g, ' '); break; }
  }

  // ── TXN ID ────────────────────────────────────────────────
  const txn = t.match(/(?:Tx(?:n)? ?ID|TID)[:\s]+([A-Z0-9]+)/i) ||
    t.match(/RAAST Tx ID ([A-Z0-9]+)/i) ||
    t.match(/Tx ID ([A-Z0-9]{8,})/i) ||
    t.match(/Ref[:\s#]+([A-Z0-9]{6,})/i);
  if (txn) result.txn_id = txn[1];

  // ── Date ──────────────────────────────────────────────────
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/,
    /on (\d{1,2}[\/\-][A-Za-z0-9]+[\/\-]\d{2,4})/i,
  ];
  for (const p of datePatterns) {
    const m = t.match(p);
    if (m) {
      try {
        const raw = m[1] || m[0];
        const parts = raw.split(/[\/\-]/);
        if (parts.length >= 3) {
          let d = parseInt(parts[0]);
          let mo = months[parts[1].toLowerCase().slice(0,3)] || parseInt(parts[1]);
          let y = parseInt(parts[2]);
          if (y < 100) y += 2000;
          if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y >= 2020) {
            result.alert_date = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
            break;
          }
        }
      } catch(e) {}
    }
  }

  // ── Time ──────────────────────────────────────────────────
  const timeM = t.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (timeM) result.alert_time = timeM[1];

  // ── Transfer type ─────────────────────────────────────────
  if (/IBFT|Interbank/i.test(t))              result.transfer_type = 'IBFT';
  else if (/RAAST/i.test(t))                  result.transfer_type = 'RAAST';
  else if (/Fund Transfer/i.test(t))          result.transfer_type = 'Fund Transfer';
  else if (/Accnt Transfer|Account Transfer/i.test(t)) result.transfer_type = 'Internal Transfer';
  else if (/Cash/i.test(t))                   result.transfer_type = 'Cash Deposit';

  return result;
}

// ── Pakistani Public Holidays (approximate) ───────────────────
const PK_HOLIDAYS = [
  '02-05','03-23','05-01','07-05','08-14','11-09','12-25', // fixed
];

// ── International Risk Analysis Engine ───────────────────────
function analyzeRisk(parsed, existingAlerts = []) {
  const flags = [];
  const details = [];
  let score = 0;

  const amt = Math.abs(parsed.amount || 0);
  const now = new Date();

  // ── CATEGORY 1: Data Integrity ───────────────────────────
  if (!parsed.txn_id)    { flags.push('No Transaction ID');     score += 20; }
  if (!parsed.sender)    { flags.push('Sender unidentified');   score += 15; }
  if (!parsed.alert_date){ flags.push('Payment date missing');  score += 15; }
  if (!parsed.bank_name) { flags.push('Bank undetected');       score += 10; }
  if (!parsed.account_last4){ flags.push('Account number missing'); score += 5; }

  // ── CATEGORY 2: Transaction Type ─────────────────────────
  if (parsed.direction === 'debit') {
    flags.push('DEBIT — money left account'); score += 40;
  }
  if (parsed.transfer_type === 'Cash Deposit') {
    flags.push('Cash deposit — unverifiable source'); score += 20;
  }

  // ── CATEGORY 3: Amount Analysis ──────────────────────────
  // Very large
  if (amt > 5000000)      { flags.push('Extremely large: >50 Lakh');   score += 25; }
  else if (amt > 1000000) { flags.push('Very large: >10 Lakh');        score += 15; }
  else if (amt > 500000)  { flags.push('Large amount: >5 Lakh');       score += 8; }

  // Threshold avoidance (just below round millions — structuring indicator)
  const thresholds = [100000, 500000, 1000000, 5000000];
  for (const t of thresholds) {
    if (amt > t * 0.95 && amt < t && amt > t * 0.90) {
      flags.push(`Threshold avoidance: just below ${(t/1000).toFixed(0)}K`); score += 30; break;
    }
  }

  // Round number suspicion
  if (amt > 50000 && amt % 10000 === 0) {
    flags.push('Suspiciously round amount'); score += 10;
  }

  // ── CATEGORY 4: Time Analysis ─────────────────────────────
  if (parsed.alert_date) {
    const d = new Date(parsed.alert_date);
    const dow = d.getDay();
    const mmdd = `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;

    if (dow === 0) { flags.push('Sunday transaction'); score += 10; }
    else if (dow === 6) { flags.push('Saturday transaction'); score += 5; }

    if (PK_HOLIDAYS.includes(mmdd)) {
      flags.push('Public holiday transaction'); score += 15;
    }
  }

  // After banking hours (before 8am or after 9pm)
  if (parsed.alert_time) {
    const hr = parseInt(parsed.alert_time.split(':')[0]);
    if (hr < 8 || hr >= 21) {
      flags.push(`Unusual hour: ${parsed.alert_time} (outside 8am-9pm)`); score += 10;
    }
  }

  // ── CATEGORY 5: Velocity & Pattern ───────────────────────
  // Same account multiple payments in 1 hour
  if (parsed.account_last4) {
    const recentSameAcc = existingAlerts.filter(a =>
      a.account_last4 === parsed.account_last4 &&
      a.created_at && (now - new Date(a.created_at)) < 3600000
    );
    if (recentSameAcc.length >= 3) {
      flags.push(`High velocity: ${recentSameAcc.length} txns from same account in 1hr`); score += 35;
    } else if (recentSameAcc.length >= 2) {
      flags.push('Multiple transactions same account, 1hr'); score += 15;
    }
  }

  // Same amount appeared today already (potential duplicate)
  const sameAmtToday = existingAlerts.filter(a =>
    a.alert_date === parsed.alert_date && Math.abs((a.amount||0) - amt) < 1
  );
  if (sameAmtToday.length > 0) {
    flags.push(`Duplicate amount (${sameAmtToday.length}x same day)`); score += 35;
  }

  // Small payment splitting (smurfing — multiple <50K payments)
  if (amt > 0 && amt < 50000) {
    const recentSmall = existingAlerts.filter(a =>
      a.created_at && (now - new Date(a.created_at)) < 3600000 &&
      Math.abs(a.amount||0) < 50000
    );
    if (recentSmall.length >= 3) {
      flags.push('Potential smurfing: multiple small payments'); score += 40;
    }
  }

  // ── CATEGORY 6: Sender Analysis ──────────────────────────
  // Third-party payment indicator (sender looks like a person not business)
  if (parsed.sender) {
    const s = parsed.sender.toUpperCase();
    // Very short sender name (initials only)
    if (s.length < 5) { flags.push('Very short sender name'); score += 10; }
    // Sender is a person name (no company keywords)
    const bizKeywords = ['PVT','LTD','TRADERS','ENTERPRISE','COMPANY','CORP','INC','INDUSTRIES','WORKS'];
    const isBiz = bizKeywords.some(k => s.includes(k));
    if (!isBiz && parsed.amount > 100000) {
      flags.push('Individual sender (not company) for large amount'); score += 10;
    }
  }

  // ── CATEGORY 7: Sender History ────────────────────────────
  // Check 1: First time sender (never seen before)
  if (parsed.sender && existingAlerts.length > 0) {
    const senderNorm = parsed.sender.toLowerCase().replace(/\s+/g,'');
    const seenBefore = existingAlerts.some(a => {
      const s = (a.sender||'').toLowerCase().replace(/\s+/g,'');
      return s.length > 3 && (s === senderNorm || s.includes(senderNorm) || senderNorm.includes(s));
    });
    if (!seenBefore) { flags.push('First-time sender — never seen before'); score += 15; }
  }

  // Check 2: Sender using unusual bank (different from their history)
  if (parsed.sender && parsed.bank_name && existingAlerts.length > 0) {
    const senderNorm = parsed.sender.toLowerCase().replace(/\s+/g,'');
    const senderHistory = existingAlerts.filter(a => {
      const s = (a.sender||'').toLowerCase().replace(/\s+/g,'');
      return s.length > 3 && (s === senderNorm || s.includes(senderNorm));
    });
    if (senderHistory.length >= 2) {
      const usualBanks = senderHistory.map(a => a.bank_name).filter(Boolean);
      const commonBank = usualBanks.sort((a,b) =>
        usualBanks.filter(v=>v===b).length - usualBanks.filter(v=>v===a).length)[0];
      if (commonBank && commonBank !== parsed.bank_name) {
        flags.push(`Unusual bank: usually pays via ${commonBank}, now via ${parsed.bank_name}`);
        score += 20;
      }
    }
  }

  return { flags, score: Math.min(score, 100) };
}

// ── Adjust risk after PayGate match ───────────────────────────
function adjustRiskForMatch(flags, score, parsed, matchedEntry) {
  const bankAmt = Math.abs(parsed.amount);

  if (!matchedEntry) {
    // No PayGate submission AND no pending invoice = payment before invoice
    if (parsed.direction === 'credit' && bankAmt > 10000) {
      flags.push('⚠️ Payment before invoice — no pending submission found'); score += 25;
    }
    return { flags, score: Math.min(score, 100) };
  }

  // Match found — remove amount-explainable flags
  const removeIfMatched = ['Suspiciously round amount', 'Threshold avoidance', 'Individual sender'];
  const cleanedFlags = flags.filter(f => !removeIfMatched.some(r => f.includes(r)));
  let s = score;
  if (flags.length !== cleanedFlags.length) s = Math.max(0, s - 20); // deduct for removed flags

  // Amount mismatch
  const invoiceAmt = matchedEntry.amount || 0;
  const diff = Math.abs(invoiceAmt - bankAmt);
  const pct = invoiceAmt > 0 ? (diff / invoiceAmt) * 100 : 0;

  if (diff === 0) {
    cleanedFlags.unshift('✅ Exact match with invoice');
    s = Math.max(0, s - 20); // reward for exact match
  } else if (pct <= 1) {
    cleanedFlags.push(`Minor discrepancy: PKR ${diff.toLocaleString()} (${pct.toFixed(1)}%)`);
    s += 5;
  } else if (pct <= 5) {
    cleanedFlags.push(`Amount mismatch: invoice PKR ${invoiceAmt.toLocaleString()} vs bank PKR ${bankAmt.toLocaleString()} (${pct.toFixed(1)}%)`);
    s += 15;
  } else if (pct > 5) {
    cleanedFlags.push(`⚠️ Large mismatch: invoice PKR ${invoiceAmt.toLocaleString()} vs bank PKR ${bankAmt.toLocaleString()} (${pct.toFixed(1)}%)`);
    s += 35;
  }

  return { flags: cleanedFlags, score: Math.min(s, 100) };
}

// ── Text hash ─────────────────────────────────────────────────
function simpleHash(str) {
  let h = 0;
  for (let i = 0; i < Math.min(str.length, 200); i++) {
    h = ((h << 5) - h) + str.charCodeAt(i); h |= 0;
  }
  return Math.abs(h).toString(36);
}

// ── Duplicate check ───────────────────────────────────────────
async function isDuplicate(parsed) {
  // Check 0: same raw text hash within 60 seconds (catches iOS dual-automation race)
  if (parsed.raw_text && parsed.raw_text.length > 10) {
    const hash = simpleHash(parsed.raw_text);
    const since = new Date(Date.now() - 60000).toISOString();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bank_alerts?notes=like.*hash:${hash}*&created_at=gte.${since}&select=id`,
      { headers: HDR }
    );
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) return { isDup: true, reason: 'duplicate_text_hash' };
    // Store hash in notes for future checks
    parsed._hash = hash;
  }

  // Check 1: same TXN ID
  if (parsed.txn_id) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bank_alerts?txn_id=eq.${parsed.txn_id}&select=id`, { headers: HDR });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) return { isDup: true, reason: 'duplicate_txn' };
  }

  // Check 2: same amount + same account + within 10 minutes
  if (parsed.amount > 0) {
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const q = `amount=eq.${parsed.amount}&created_at=gte.${tenMinsAgo}&select=id,account_last4`;
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bank_alerts?${q}`, { headers: HDR });
    const rows = await r.json();
    if (Array.isArray(rows) && rows.length > 0) {
      const sameAcc = parsed.account_last4 ?
        rows.some(x => x.account_last4 === parsed.account_last4) :
        true; // no account info → assume duplicate if same amount in 10 mins
      if (sameAcc) return { isDup: true, reason: 'duplicate_amount_time' };
    }
  }

  return { isDup: false };
}

// ── Save one alert ────────────────────────────────────────────
async function saveAlert(parsed, flags, score, matchedId, matchStatus, source, from) {
  const hash = parsed._hash || simpleHash(parsed.raw_text || '');
  const record = {
    id: 'ALT-' + Date.now() + '-' + Math.random().toString(36).slice(2, 5),
    raw_text: parsed.raw_text.slice(0, 2000),
    bank_name: parsed.bank_name,
    account_no: parsed.account_no || '',
    account_last4: parsed.account_last4 || '',
    amount: parsed.direction === 'debit' ? -Math.abs(parsed.amount) : parsed.amount,
    sender: parsed.sender || '',
    txn_id: parsed.txn_id || '',
    alert_date: parsed.alert_date || '',
    alert_time: parsed.alert_time || '',
    transfer_type: parsed.transfer_type || '',
    matched_paygate_id: matchedId,
    match_status: matchStatus,
    risk_flags: flags,
    risk_score: score,
    text_hash: hash,
    notes: `Auto-fetched via ${source} from ${from}`,
    created_at: new Date().toISOString()
  };

  try {
    const saveHDR = { ...HDR, 'Prefer': 'return=minimal' };
    const r = await fetch(`${SUPABASE_URL}/rest/v1/bank_alerts`, {
      method: 'POST', headers: saveHDR, body: JSON.stringify(record)
    });
    if (r.status === 201 || r.status === 200) return { ok: true, id: record.id };
    // Unique constraint violation = duplicate, that's ok
    if (r.status === 409) return { ok: true, id: record.id, dup: true };
    const err = await r.text();
    // If duplicate key error, treat as ok
    if (err.includes('duplicate') || err.includes('unique')) return { ok: true, id: record.id, dup: true };
    return { ok: false, id: record.id, err };
  } catch(e) {
    return { ok: false, id: record.id, err: e.message };
  }
}

// ── PayGate match ─────────────────────────────────────────────
async function findPayGateMatch(parsed) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/paygate_entries?select=id,customer,amount,payment_date,status&status=neq.rejected&order=created_at.desc&limit=300`,
      { headers: HDR }
    );
    const entries = await r.json();
    if (!Array.isArray(entries)) return null;

    return entries.find(e => {
      const amtDiff = Math.abs((e.amount || 0) - parsed.amount);
      if (amtDiff > parsed.amount * 0.02) return false; // >2% diff = no match
      if (parsed.alert_date && e.payment_date) {
        const diff = Math.abs(new Date(parsed.alert_date) - new Date(e.payment_date)) / 86400000;
        return diff <= 3;
      }
      return true;
    });
  } catch(e) { return null; }
}

// ── Update client ledger when payment received ────────────────
async function updateClientLedger(customerName, paymentAmount, paymentDate, bankName, txnId) {
  if (!customerName || !paymentAmount) return;

  try {
    // Find client by name (fuzzy match)
    const searchName = customerName.trim().toLowerCase();
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/clients?select=id,name,outstanding_amount,total_paid,transactions&order=name.asc&limit=500`,
      { headers: HDR }
    );
    const clients = await r.json();
    if (!Array.isArray(clients)) return;

    // Find best match
    const client = clients.find(c => {
      const cn = (c.name || '').toLowerCase();
      return cn === searchName || cn.includes(searchName) || searchName.includes(cn);
    });

    if (!client) return; // client not found in ledger

    const currentOs = parseFloat(client.outstanding_amount) || 0;
    const currentPaid = parseFloat(client.total_paid) || 0;
    const newOs = Math.max(0, currentOs - paymentAmount);
    const newPaid = currentPaid + paymentAmount;

    // Add payment to transactions JSONB
    const transactions = Array.isArray(client.transactions) ? client.transactions : [];
    const newTxn = {
      date: paymentDate || new Date().toISOString().slice(0, 10),
      type: 'Payment',
      voucher: txnId || `BANK-${Date.now()}`,
      amount: paymentAmount,
      description: `Bank payment via ${bankName || 'bank'} — Auto-matched`,
      source: 'bank_auto'
    };

    await fetch(
      `${SUPABASE_URL}/rest/v1/clients?id=eq.${client.id}`,
      {
        method: 'PATCH',
        headers: HDR,
        body: JSON.stringify({
          outstanding_amount: newOs,
          total_paid: newPaid,
          transactions: [...transactions, newTxn],
          last_updated: new Date().toISOString()
        })
      }
    );

    return { clientId: client.id, clientName: client.name, oldOs: currentOs, newOs, paymentAmount };
  } catch(e) {
    console.error('Ledger update error:', e);
    return null;
  }
}

// ── Get existing alerts for risk context ──────────────────────
async function getRecentAlerts() {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/bank_alerts?select=id,amount,alert_date,account_last4&order=created_at.desc&limit=100`,
      { headers: HDR }
    );
    return await r.json();
  } catch(e) { return []; }
}

// ── Main Handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-secret');
    return res.status(200).end();
  }

  // Allow GET (for iOS Shortcuts URL parameter approach) and POST
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Secret check — from header, body, or query param
  const secret = req.headers['x-secret'] || req.body?.secret || req.query?.secret;
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  let bodyText = '';
  let subject = '';
  let from = '';
  let source = 'iphone';

  if (req.method === 'GET') {
    // iOS GET request — message in URL query param
    bodyText = req.query?.body || req.query?.msg || req.query?.text || '';
    source = req.query?.source || 'iphone_get';
  } else {
    // POST request — various body formats
    const rawBody = req.body || {};
    if (typeof rawBody === 'string') {
      bodyText = rawBody;
    } else if (typeof rawBody.body === 'string' && rawBody.body) {
      bodyText = rawBody.body;
    } else if (typeof rawBody.body === 'object' && rawBody.body) {
      bodyText = rawBody.body.messageText || rawBody.body.body || rawBody.body.text || rawBody.body.content || JSON.stringify(rawBody.body);
    } else if (rawBody.messageText) {
      bodyText = rawBody.messageText;
    } else if (rawBody.text) {
      bodyText = rawBody.text;
    } else {
      // iOS Shortcuts bug: concatenates field name + value as key
      // e.g. {"bodyPkr 5000 is credited": "", "secret": "..."}
      // Find key starting with "body" and extract text after "body"
      const keys = Object.keys(rawBody);
      const bodyKey = keys.find(k => k.startsWith('body') && k.length > 4);
      if (bodyKey) {
        bodyText = bodyKey.slice(4).trim(); // remove "body" prefix
      }
    }
    subject = rawBody.subject || '';
    from    = rawBody.from || '';
    source  = rawBody.source || 'iphone';
  }

  const fullText = `${subject}\n${bodyText}`.trim();

  if (!fullText) {
    // Save debug record to see what iOS actually sends
    const debugRaw = JSON.stringify({ method: req.method, query: req.query, body: req.body, headers: { ct: req.headers['content-type'] } });
    await fetch(`${SUPABASE_URL}/rest/v1/bank_alerts`, {
      method: 'POST', headers: HDR,
      body: JSON.stringify({
        id: 'DBG-' + Date.now(),
        raw_text: debugRaw.slice(0, 2000),
        amount: 0, match_status: 'unmatched',
        risk_flags: ['DEBUG - empty body'],
        risk_score: 0, notes: 'DEBUG: empty body from iOS',
        created_at: new Date().toISOString()
      })
    });
    return res.status(200).json({ success: false, debug: debugRaw.slice(0, 500) });
  }

  // Split combined SMS (1. msg1 2. msg2 3. msg3)
  const messages = splitMessages(fullText);
  const existingAlerts = await getRecentAlerts();
  const results = [];

  for (const msgText of messages) {
    const parsed = parseAlert(msgText);

    // Skip if no amount
    if (!parsed.amount || parsed.amount === 0) {
      results.push({ skipped: true, reason: 'no_amount', text: msgText.slice(0, 50) });
      continue;
    }

    // Debit: save as alert but mark as risk
    const { isDup, reason } = await isDuplicate(parsed);
    if (isDup) {
      results.push({ skipped: true, reason, amount: parsed.amount });
      continue;
    }

    // Initial risk analysis
    let { flags, score } = analyzeRisk(parsed, existingAlerts);

    // PayGate/Invoice matching
    let matchedId = '';
    let matchStatus = 'unmatched';
    let matchedEntry = null;

    if (parsed.direction === 'credit') {
      matchedEntry = await findPayGateMatch(parsed);
      if (matchedEntry) {
        matchedId = matchedEntry.id;
        matchStatus = 'matched';

        // Verify PayGate entry
        await fetch(`${SUPABASE_URL}/rest/v1/paygate_entries?id=eq.${matchedEntry.id}`, {
          method: 'PATCH', headers: HDR,
          body: JSON.stringify({ status: 'verified', verified_by: 'Bank Auto-Match', verified_at: new Date().toISOString() })
        });

        // ── Update client ledger (reduce outstanding) ──────────
        await updateClientLedger(
          matchedEntry.customer,
          Math.abs(parsed.amount),
          parsed.alert_date,
          parsed.bank_name,
          parsed.txn_id
        );
      }
    }

    // Adjust risk based on invoice match (removes false positives, adds mismatch flags)
    const adjusted = adjustRiskForMatch(flags, score, parsed, matchedEntry);
    flags = adjusted.flags;
    const finalScore = adjusted.score;
    const { ok, id } = await saveAlert(parsed, flags, finalScore, matchedId, matchStatus, source, from);

    results.push({
      ok, id,
      amount: parsed.amount,
      bank: parsed.bank_name,
      direction: parsed.direction,
      match_status: matchStatus,
      risk_score: finalScore
    });

    // Small delay between multiple saves
    if (messages.length > 1) await new Promise(r => setTimeout(r, 100));
  }

  const saved = results.filter(r => r.ok);
  return res.status(200).json({
    success: saved.length > 0,
    processed: messages.length,
    saved: saved.length,
    skipped: results.filter(r => r.skipped).length,
    results
  });
};
