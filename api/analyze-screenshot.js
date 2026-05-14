// ═══════════════════════════════════════════════════════════════
// CNC Electric — Screenshot Analysis via Claude Vision
// Reads payment receipt → extracts amount, bank, sender, date
// ═══════════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const HDR = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY };

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-claude-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claudeKey = req.headers['x-claude-key'] || req.body?.claude_key;
  if (!claudeKey) return res.status(400).json({ error: 'Claude API key required. Set it in AI Integration settings.' });

  const { image_base64, image_type = 'image/jpeg', customer_name = '', submitted_amount = 0 } = req.body || {};
  if (!image_base64) return res.status(400).json({ error: 'image_base64 required' });

  try {
    // ── Call Claude Vision API ─────────────────────────────────
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 400,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: image_type, data: image_base64 }
            },
            {
              type: 'text',
              text: `Extract payment details from this bank receipt/screenshot. Return ONLY valid JSON, no explanation:
{
  "amount": <number or 0>,
  "bank": "<bank name or empty>",
  "sender": "<sender name or empty>",
  "account_last4": "<last 4 digits of account or empty>",
  "date": "<YYYY-MM-DD or empty>",
  "txn_id": "<transaction ID or empty>",
  "transfer_type": "<IBFT/RAAST/Fund Transfer/Cash/other or empty>",
  "confidence": "<high/medium/low>"
}`
            }
          ]
        }]
      })
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return res.status(200).json({ success: false, error: 'Claude API error: ' + err.slice(0, 200) });
    }

    const claudeData = await claudeRes.json();
    const textContent = claudeData.content?.[0]?.text || '{}';

    // Parse JSON from Claude response
    let extracted = {};
    try {
      const jsonMatch = textContent.match(/\{[\s\S]*\}/);
      extracted = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch(e) {
      return res.status(200).json({ success: false, error: 'Could not parse Claude response', raw: textContent });
    }

    // ── Search bank_alerts for match ──────────────────────────
    let bankMatch = null;
    let matchScore = 0;
    const amt = extracted.amount || submitted_amount;

    if (amt > 0) {
      try {
        // Search by amount (±2%) and optional date/account
        const tolerance = amt * 0.02;
        const minAmt = Math.floor(amt - tolerance);
        const maxAmt = Math.ceil(amt + tolerance);

        let query = `/bank_alerts?amount=gte.${minAmt}&amount=lte.${maxAmt}&match_status=neq.verified&order=created_at.desc&limit=20`;
        if (extracted.alert_date) query += `&alert_date=eq.${extracted.alert_date}`;

        const r = await fetch(`${SUPABASE_URL}/rest/v1${query}`, { headers: HDR });
        const alerts = await r.json();

        if (Array.isArray(alerts) && alerts.length > 0) {
          // Find best match
          for (const alert of alerts) {
            let score = 0;
            const amtDiff = Math.abs((alert.amount || 0) - amt) / amt;
            if (amtDiff < 0.01) score += 40; // exact amount
            else if (amtDiff < 0.02) score += 25;

            if (extracted.account_last4 && alert.account_last4 === extracted.account_last4) score += 30;
            if (extracted.txn_id && alert.txn_id === extracted.txn_id) score += 50;
            if (extracted.bank && alert.bank_name && alert.bank_name.toLowerCase().includes(extracted.bank.toLowerCase())) score += 10;
            if (extracted.date && alert.alert_date === extracted.date) score += 20;
            if (extracted.sender && alert.sender && alert.sender.toLowerCase().includes(extracted.sender.toLowerCase().split(' ')[0])) score += 15;

            if (score > matchScore) {
              matchScore = score;
              bankMatch = alert;
            }
          }
        }
      } catch(e) {
        console.error('Bank alert search error:', e);
      }
    }

    // ── Determine verification decision ───────────────────────
    let decision = 'manual_review';
    let decisionReason = [];

    if (bankMatch && matchScore >= 50) {
      // Amount match + at least one other field
      const amtMatch = Math.abs((bankMatch.amount||0) - amt) / Math.max(amt, 1);
      if (amtMatch < 0.02) {
        decision = 'auto_approve';
        decisionReason.push('✅ Amount matches bank SMS');
      }
      if (extracted.txn_id && bankMatch.txn_id === extracted.txn_id) {
        decision = 'auto_approve';
        decisionReason.push('✅ Transaction ID matches');
      }
      if (extracted.account_last4 && bankMatch.account_last4 === extracted.account_last4) {
        decisionReason.push('✅ Account number matches');
      }
    } else if (bankMatch) {
      decision = 'partial_match';
      decisionReason.push('⚠️ Partial match — manual review needed');
    } else {
      decisionReason.push('❓ No matching bank SMS found');
    }

    // Check amount vs submitted
    if (submitted_amount > 0 && extracted.amount > 0) {
      const diff = Math.abs(submitted_amount - extracted.amount);
      const pct = diff / submitted_amount * 100;
      if (diff === 0) {
        decisionReason.push('✅ Screenshot amount matches submitted amount');
      } else if (pct < 2) {
        decisionReason.push(`⚠️ Minor amount difference: ${diff.toLocaleString()} PKR`);
      } else {
        decision = 'manual_review';
        decisionReason.push(`❌ Amount mismatch: screenshot shows ${extracted.amount?.toLocaleString()}, submitted ${submitted_amount?.toLocaleString()}`);
      }
    }

    return res.status(200).json({
      success: true,
      extracted,
      bank_match: bankMatch ? {
        id: bankMatch.id,
        amount: bankMatch.amount,
        bank_name: bankMatch.bank_name,
        sender: bankMatch.sender,
        alert_date: bankMatch.alert_date,
        txn_id: bankMatch.txn_id,
        match_score: matchScore
      } : null,
      decision,
      decision_reasons: decisionReason,
      auto_approve: decision === 'auto_approve'
    });

  } catch(err) {
    return res.status(200).json({ success: false, error: err.message });
  }
};
