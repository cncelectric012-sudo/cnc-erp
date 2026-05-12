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

// ── Risk Analysis ─────────────────────────────────────────────
function analyzeRisk(parsed, existingAlerts = []) {
  const flags = [];
  let score = 0;

  // Basic missing info
  if (!parsed.txn_id)    { flags.push('No TXN ID');         score += 20; }
  if (!parsed.sender)    { flags.push('Sender unknown');     score += 15; }
  if (!parsed.alert_date){ flags.push('Date missing');       score += 15; }
  if (!parsed.bank_name) { flags.push('Bank undetected');    score += 10; }

  // Debit alert
  if (parsed.direction === 'debit') {
    flags.push('Debit transaction'); score += 30;
  }

  // Round large amount (possible fake)
  if (parsed.amount > 0 && parsed.amount % 10000 === 0 && parsed.amount > 100000) {
    flags.push('Suspiciously round amount'); score += 15;
  }

  // Very large amount
  if (parsed.amount > 1000000) { flags.push('Amount > 1 million'); score += 10; }

  // Weekend
  if (parsed.alert_date) {
    const day = new Date(parsed.alert_date).getDay();
    if (day === 0 || day === 6) { flags.push('Weekend payment'); score += 5; }
  }

  // Duplicate amount same day (from existing alerts)
  const dupsToday = existingAlerts.filter(a => {
    if (!a.alert_date || !parsed.alert_date) return false;
    return a.alert_date === parsed.alert_date && Math.abs(a.amount - parsed.amount) < 1;
  });
  if (dupsToday.length > 0) { flags.push('Duplicate amount same day'); score += 35; }

  // No PayGate match will increase risk (handled after matching)
  return { flags, score: Math.min(score, 100) };
}

// ── Duplicate check ───────────────────────────────────────────
async function isDuplicate(parsed) {
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
    notes: `Auto-fetched via ${source} from ${from}`,
    created_at: new Date().toISOString()
  };

  const r = await fetch(`${SUPABASE_URL}/rest/v1/bank_alerts`, {
    method: 'POST', headers: HDR, body: JSON.stringify(record)
  });
  return { ok: r.ok, id: record.id };
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

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Secret check
  const secret = req.headers['x-secret'] || req.body?.secret;
  if (secret !== WEBHOOK_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  // Extract text from various iOS Shortcuts formats
  const rawBody = req.body || {};
  let bodyText = '';
  if (typeof rawBody === 'string')                          bodyText = rawBody;
  else if (typeof rawBody.body === 'string')                bodyText = rawBody.body;
  else if (typeof rawBody.body === 'object' && rawBody.body)
    bodyText = rawBody.body.messageText || rawBody.body.body || rawBody.body.text || rawBody.body.content || JSON.stringify(rawBody.body);
  else if (rawBody.messageText) bodyText = rawBody.messageText;
  else if (rawBody.text)        bodyText = rawBody.text;

  const subject = rawBody.subject || '';
  const from    = rawBody.from || '';
  const source  = rawBody.source || 'iphone';
  const fullText = `${subject}\n${bodyText}`.trim();

  if (!fullText) {
    return res.status(400).json({ error: 'Empty body', received: JSON.stringify(rawBody).slice(0, 200) });
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

    // Risk analysis
    const { flags, score } = analyzeRisk(parsed, existingAlerts);

    // No PayGate match for unmatched = higher risk
    let matchedId = '';
    let matchStatus = 'unmatched';
    if (parsed.direction === 'credit') {
      const match = await findPayGateMatch(parsed);
      if (match) {
        matchedId = match.id;
        matchStatus = 'matched';
        // Auto-verify PayGate entry
        await fetch(`${SUPABASE_URL}/rest/v1/paygate_entries?id=eq.${match.id}`, {
          method: 'PATCH', headers: HDR,
          body: JSON.stringify({ status: 'verified', verified_by: 'Bank Auto-Match', verified_at: new Date().toISOString() })
        });
      } else {
        flags.push('No PayGate submission found');
        // Add 20 risk for unmatched credit > 10000
        if (parsed.amount > 10000) { flags.push('Large unmatched credit'); }
      }
    }

    const finalScore = Math.min(score + (matchStatus === 'unmatched' && parsed.amount > 10000 ? 15 : 0), 100);
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
