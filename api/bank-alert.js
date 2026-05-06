// ═══════════════════════════════════════════════════════════════
// CNC Electric — Bank Alert Webhook
// Receives bank emails from Google Apps Script
// Parses → Matches → Saves to Supabase
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

// ── SMS / Email Parser ────────────────────────────────────────
function parseAlert(text) {
  const t = String(text || '').replace(/\r\n/g, '\n');
  const result = {
    raw_text: t,
    bank_name: '', account_last4: '', account_no: '',
    amount: 0, sender: '', txn_id: '',
    alert_date: '', alert_time: '', transfer_type: ''
  };

  // Amount
  const amtPatterns = [
    /(?:PKR|Rs\.?)\s*([0-9,]+(?:\.[0-9]{2})?)/i,
    /([0-9,]+(?:\.[0-9]{2})?)\s*(?:PKR|Rs\.?)/i,
    /credited with (?:Rs\.?\s*)?([0-9,]+(?:\.[0-9]{2})?)/i,
    /amount[:\s]+(?:PKR\s*)?([0-9,]+(?:\.[0-9]{2})?)/i,
  ];
  for (const p of amtPatterns) {
    const m = t.match(p);
    if (m) { result.amount = parseFloat(m[1].replace(/,/g, '')); break; }
  }

  // Bank
  if (/BAHL|Bank Al.?Habib/i.test(t)) result.bank_name = 'Bank Al Habib';
  else if (/BAF\b|Bank Alfalah|ALFH/i.test(t)) result.bank_name = 'Bank Alfalah';
  else if (/MBL\b|Meezan/i.test(t)) result.bank_name = 'Meezan Bank';
  else if (/HBL|Habib Bank/i.test(t)) result.bank_name = 'HBL';
  else if (/UBL/i.test(t)) result.bank_name = 'UBL';
  else if (/MCB/i.test(t)) result.bank_name = 'MCB';
  else if (/JSBL?|JS Bank/i.test(t)) result.bank_name = 'JS Bank';

  // Account last 4
  const acc4 = t.match(/[*x]{2,4}([0-9]{4})/i) || t.match(/A\/C[^0-9]*([0-9]{4})/i);
  if (acc4) result.account_last4 = acc4[1];

  // Sender
  const senderPatterns = [
    /from ([A-Z][A-Z ]{3,40}?) (?:MBL|HBL|UBL|MCB|BAHL|BAF|Meezan|in your)/i,
    /received from ([A-Z][A-Z ]{3,40})/i,
    /from ([A-Za-z][A-Za-z ]{3,35}?) on /i,
    /Sender,\s*([A-Za-z ]+)/i,
  ];
  for (const p of senderPatterns) {
    const m = t.match(p);
    if (m && m[1].trim().length > 2) { result.sender = m[1].trim().replace(/\s+/g, ' '); break; }
  }

  // TXN ID
  const txn = t.match(/(?:Tx(?:n)? ?ID|TID)[:\s]+([A-Z0-9]+)/i) ||
    t.match(/RAAST Tx ID ([A-Z0-9]+)/i) ||
    t.match(/Ref[:\s#]+([A-Z0-9]{6,})/i);
  if (txn) result.txn_id = txn[1];

  // Date
  const months = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const datePatterns = [
    /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
    /(\d{1,2})-([A-Za-z]{3})-(\d{2,4})/,
  ];
  for (const p of datePatterns) {
    const m = t.match(p);
    if (m) {
      try {
        const parts = m[0].split(/[\/\-]/);
        let d = parseInt(parts[0]);
        let mo = months[parts[1].toLowerCase().slice(0,3)] || parseInt(parts[1]);
        let y = parseInt(parts[2]);
        if (y < 100) y += 2000;
        if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) {
          result.alert_date = `${y}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
          break;
        }
      } catch(e) {}
    }
  }

  // Time
  const timeM = t.match(/(\d{1,2}:\d{2}(?::\d{2})?)/);
  if (timeM) result.alert_time = timeM[1];

  // Transfer type
  if (/IBFT|Interbank/i.test(t)) result.transfer_type = 'IBFT';
  else if (/RAAST/i.test(t)) result.transfer_type = 'RAAST';
  else if (/Fund Transfer/i.test(t)) result.transfer_type = 'Fund Transfer';
  else if (/Accnt Transfer|Account Transfer/i.test(t)) result.transfer_type = 'Internal Transfer';
  else if (/Cash/i.test(t)) result.transfer_type = 'Cash Deposit';

  return result;
}

// ── Risk Analysis ─────────────────────────────────────────────
function analyzeRisk(parsed) {
  const flags = [];
  let score = 0;
  if (!parsed.txn_id) { flags.push('No TXN ID'); score += 20; }
  if (!parsed.sender) { flags.push('Sender unknown'); score += 15; }
  if (!parsed.alert_date) { flags.push('Date missing'); score += 15; }
  if (parsed.amount > 0 && parsed.amount % 1000 === 0 && parsed.amount > 100000) {
    flags.push('Round number large amount'); score += 10;
  }
  if (parsed.alert_date) {
    const day = new Date(parsed.alert_date).getDay();
    if (day === 0 || day === 6) { flags.push('Weekend payment'); score += 5; }
  }
  return { flags, score: Math.min(score, 100) };
}

// ── Main Handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-secret');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Secret check
  const secret = req.headers['x-secret'] || req.body?.secret;
  if (secret !== WEBHOOK_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { subject = '', from = '', body = '', date = '', source = 'email' } = req.body || {};

  if (!body && !subject) {
    return res.status(400).json({ error: 'body or subject required' });
  }

  // Combine subject + body for parsing
  const fullText = `${subject}\n${body}`.trim();

  // Parse
  const parsed = parseAlert(fullText);

  if (parsed.amount <= 0) {
    return res.status(200).json({
      success: false,
      message: 'No valid amount found — skipped',
      parsed
    });
  }

  // Risk
  const { flags, score } = analyzeRisk(parsed);

  // Find matching PayGate entry
  let matchedId = '';
  let matchStatus = 'unmatched';
  try {
    const pgResp = await fetch(
      `${SUPABASE_URL}/rest/v1/paygate_entries?select=id,customer,amount,payment_date,status&status=neq.rejected&order=created_at.desc&limit=200`,
      { headers: HDR }
    );
    const pgEntries = await pgResp.json();
    if (Array.isArray(pgEntries)) {
      const match = pgEntries.find(e => {
        const amtDiff = Math.abs((e.amount || 0) - parsed.amount);
        const amtMatch = amtDiff <= parsed.amount * 0.01;
        if (!amtMatch) return false;
        if (parsed.alert_date && e.payment_date) {
          const daysDiff = Math.abs(new Date(parsed.alert_date) - new Date(e.payment_date)) / 86400000;
          return daysDiff <= 2;
        }
        return true;
      });
      if (match) {
        matchedId = match.id;
        matchStatus = 'matched';
        // Auto-verify the PayGate entry
        await fetch(
          `${SUPABASE_URL}/rest/v1/paygate_entries?id=eq.${match.id}`,
          {
            method: 'PATCH',
            headers: HDR,
            body: JSON.stringify({
              status: 'verified',
              verified_by: 'Bank Email Auto-Match',
              verified_at: new Date().toISOString()
            })
          }
        );
      }
    }
  } catch(e) {
    console.error('PayGate match error:', e);
  }

  // Check duplicate (same TXN ID)
  if (parsed.txn_id) {
    const dupResp = await fetch(
      `${SUPABASE_URL}/rest/v1/bank_alerts?txn_id=eq.${parsed.txn_id}&select=id`,
      { headers: HDR }
    );
    const dups = await dupResp.json();
    if (Array.isArray(dups) && dups.length > 0) {
      return res.status(200).json({
        success: false,
        message: 'Duplicate TXN ID — already processed',
        txn_id: parsed.txn_id
      });
    }
    flags.push(''); // reset
  }

  // Save to Supabase
  const record = {
    id: 'ALT-' + Date.now(),
    raw_text: fullText.slice(0, 2000),
    bank_name: parsed.bank_name,
    account_no: parsed.account_no || '',
    account_last4: parsed.account_last4 || '',
    amount: parsed.amount,
    sender: parsed.sender || '',
    txn_id: parsed.txn_id || '',
    alert_date: parsed.alert_date || '',
    alert_time: parsed.alert_time || '',
    transfer_type: parsed.transfer_type || '',
    matched_paygate_id: matchedId,
    match_status: matchStatus,
    risk_flags: flags.filter(Boolean),
    risk_score: score,
    notes: `Auto-fetched via ${source} from ${from}`,
    created_at: new Date().toISOString()
  };

  const saveResp = await fetch(
    `${SUPABASE_URL}/rest/v1/bank_alerts`,
    { method: 'POST', headers: HDR, body: JSON.stringify(record) }
  );

  if (!saveResp.ok) {
    const err = await saveResp.text();
    return res.status(500).json({ error: 'Supabase save failed', details: err });
  }

  return res.status(200).json({
    success: true,
    alert_id: record.id,
    amount: parsed.amount,
    bank: parsed.bank_name,
    match_status: matchStatus,
    matched_paygate_id: matchedId || null,
    risk_score: score,
    risk_flags: flags.filter(Boolean)
  });
};
