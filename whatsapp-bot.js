// whatsapp-bot.js — CNC ERP WhatsApp Bot (Meta Cloud API)
// Koi QR nahi, koi session nahi — pure HTTP API
// Number: +92 321 6749443

const path = require('path');
const fs   = require('fs');

// ── Supabase ──────────────────────────────────────────────────
const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const SB_HEADERS   = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

// ── Meta WhatsApp API ─────────────────────────────────────────
const WA_PHONE_ID = '1021427097723618';
const WA_TOKEN    = 'EAALEpXHMbzIBSKfMlpd9dIkAayHlOWhNGyt5Fz7Tq13ykZCvzLjfPoY64KXkKHy1hDkdsGX0ovOaQUgYFKT1JZA3vgV3T0Es58lZBO7yFPuA3AuLi8ZCKRY3ivYFrISNuqNqyzZBNlnbZCHmLQ6qbkHrZBJivBwiAfOCfcZBgpwwgzdCyVeRs6DaGiLKR2KUt8JJPgZDZD';
const WA_URL      = `https://graph.facebook.com/v20.0/${WA_PHONE_ID}/messages`;
const WA_HEADERS  = { 'Authorization': `Bearer ${WA_TOKEN}`, 'Content-Type': 'application/json' };

const TRIGGER_FILE = path.join(__dirname, 'pending-broadcast.json');

const REPORT_NUMBERS = [
  { name: 'Muddasir Waheed Malik', phone: '923228064444' },
  { name: 'Malik Awais',           phone: '923004755563' },
  { name: 'Bilal Arif',            phone: '923020011194' },
];

// ── Phone normalize (Pakistan) ────────────────────────────────
function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, '');
  if (p.startsWith('0092'))                         p = '92' + p.slice(4);
  else if (p.startsWith('92') && p.length === 12)   {}
  else if (p.startsWith('0') && p.length === 11)    p = '92' + p.slice(1);
  else if (p.length === 10)                         p = '92' + p;
  if (p.length !== 12 || !p.startsWith('92')) return null;
  return p;
}

// ── Supabase GET ──────────────────────────────────────────────
async function sbGet(urlPath) {
  const r = await fetch(`${SUPABASE_URL}${urlPath}`, { headers: SB_HEADERS });
  return r.json();
}

// ── Helpers ───────────────────────────────────────────────────
function fmt(n) { return 'PKR ' + Math.abs(n).toLocaleString('en-PK', { maximumFractionDigits: 0 }); }
function today() { return new Date().toISOString().slice(0, 10); }

// ── Meta API: Template message bhejo ─────────────────────────
async function sendTemplate(phone, templateName, bodyParams) {
  const tmpl = { name: templateName, language: { code: 'en' } };
  if (bodyParams && bodyParams.length > 0) {
    tmpl.components = [{ type: 'body', parameters: bodyParams.map(t => ({ type: 'text', text: String(t) })) }];
  }
  const res = await fetch(WA_URL, {
    method: 'POST',
    headers: WA_HEADERS,
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'template', template: tmpl })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || JSON.stringify(data));
  return data;
}

// ── Admin report ──────────────────────────────────────────────
async function sendReport(label, sent, skipped, notWA, errors) {
  const now = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
  for (const r of REPORT_NUMBERS) {
    try {
      await sendTemplate(r.phone, 'admin_report', [now, label, String(sent), String(skipped), String(errors)]);
      console.log(`[Bot] Report ✓ ${r.name}`);
      await new Promise(res => setTimeout(res, 2000));
    } catch (e) {
      console.error(`[Bot] Report fail: ${r.name} — ${e.message}`);
    }
  }
}

// ── Broadcast to all clients ──────────────────────────────────
async function broadcastToAll(getParams, templateName, label) {
  const clients = await sbGet('/clients?record_source=eq.erp_live&status=eq.Active&select=id,name,phone,outstanding_amount,outstanding_type&limit=2000');
  if (!Array.isArray(clients)) { console.error('[Bot] Clients fetch fail'); return; }
  console.log(`[Bot] ${clients.length} clients — bhejne shuru (${label})...`);

  let sent = 0, skipped = 0, notWA = 0, errors = 0;

  for (const c of clients) {
    const phone = normalizePhone(c.phone);
    if (!phone) { skipped++; continue; }

    try {
      const params = typeof getParams === 'function' ? getParams(c) : getParams;
      await sendTemplate(phone, templateName, params);
      console.log(`[Bot] ✓ ${c.name} (${phone})`);
      sent++;
      // 1-2 sec delay — Meta API khud rate limit handle karta hai
      await new Promise(r => setTimeout(r, 1000 + Math.floor(Math.random() * 1000)));
    } catch (e) {
      const msg = e.message || '';
      if (msg.includes('131026') || msg.includes('not a valid WhatsApp')) {
        notWA++;
      } else {
        console.error(`[Bot] ✗ ${c.name} — ${msg}`);
        errors++;
      }
    }
  }

  console.log(`[Bot] Done — ✓${sent} skip:${skipped} noWA:${notWA} err:${errors}`);
  await sendReport(label, sent, skipped, notWA, errors);
}

// ── Daily 8 PM send ───────────────────────────────────────────
async function sendDailyMessages() {
  const cfgArr = await sbGet('/whatsapp_config?id=eq.1');
  const cfg = Array.isArray(cfgArr) && cfgArr[0] ? cfgArr[0] : { active_template: 'ledger' };

  if (cfg.active_template === 'custom') {
    const msg = cfg.custom_message || 'Cognitive Solutions ki taraf se salaam!';
    await broadcastToAll([msg], 'custom_announcement', 'Custom Message');
  } else {
    let txnMap = {}, erpMap = {};
    const todayTxns = await sbGet(`/erp_transactions?txn_date=eq.${today()}&select=erp_account_id,txn_type,debit,credit&limit=5000`);
    const allClients = await sbGet('/clients?record_source=eq.erp_live&select=id,erp_id&limit=2000');
    if (Array.isArray(todayTxns)) todayTxns.forEach(t => { if (!txnMap[t.erp_account_id]) txnMap[t.erp_account_id]=[]; txnMap[t.erp_account_id].push(t); });
    if (Array.isArray(allClients)) allClients.forEach(c => { erpMap[c.id] = c.erp_id; });

    await broadcastToAll((c) => {
      const name    = c.name || 'Customer';
      const bal     = fmt(c.outstanding_amount || 0);
      const balType = (c.outstanding_type || 'Dr') === 'Dr' ? 'Baqaya (Debit)' : 'Credit';
      return [name, bal, balType];
    }, 'daily_ledger', 'Daily Ledger');
  }
}

// ── Trigger file watcher (har 30 sec) ────────────────────────
function watchTrigger() {
  setInterval(async () => {
    if (!fs.existsSync(TRIGGER_FILE)) return;
    try {
      const data = JSON.parse(fs.readFileSync(TRIGGER_FILE, 'utf8'));
      fs.unlinkSync(TRIGGER_FILE);
      console.log(`[Bot] Trigger mila: ${data.label}`);
      if (data.template) {
        await broadcastToAll([], data.template, data.label);
      } else {
        await broadcastToAll([data.message], 'custom_announcement', data.label);
      }
    } catch (e) {
      console.error('[Bot] Trigger error:', e.message);
    }
  }, 30000);
}

// ── Schedule 8 PM ─────────────────────────────────────────────
function scheduleEightPM() {
  function msUntil8PM() {
    const now = new Date(), next = new Date();
    next.setHours(20, 0, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    return next - now;
  }
  function scheduleNext() {
    const ms = msUntil8PM();
    console.log(`[Bot] Agli messages: ${Math.floor(ms/3600000)}h ${Math.floor((ms%3600000)/60000)}m baad`);
    setTimeout(async () => { await sendDailyMessages(); scheduleNext(); }, ms);
  }
  scheduleNext();
}

// ── Start ─────────────────────────────────────────────────────
console.log('[Bot] CNC ERP WhatsApp Bot (Meta Cloud API) shuru...');
console.log('[Bot] Number: +92 321 6749443 | Koi QR scan nahi chahiye!');
scheduleEightPM();
watchTrigger();
console.log('[Bot] Ready!');
