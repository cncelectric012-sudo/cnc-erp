// whatsapp-bot.js — CNC ERP WhatsApp Daily Ledger Bot (Baileys version)
// Run: node whatsapp-bot.js

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const pino = require('pino');
const fs   = require('fs');

const SUPABASE_URL  = 'https://knvaaxywlfpomlatpiua.supabase.co/rest/v1';
const SUPABASE_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const SB_HEADERS    = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };
const AUTH_FOLDER   = path.join(__dirname, 'wa-auth');
const TRIGGER_FILE  = path.join(__dirname, 'pending-broadcast.json'); // send-intro writes here

const REPORT_NUMBERS = [
  { name: 'Muddasir Waheed Malik', jid: '923228064444@s.whatsapp.net' },
  { name: 'Malik Awais',           jid: '923004755563@s.whatsapp.net' },
  { name: 'Bilal Arif',            jid: '923020011194@s.whatsapp.net' },
];

// ── Phone number normalize (Pakistan format) ──────────────────
function normalizePhone(raw) {
  if (!raw) return null;
  let p = String(raw).replace(/\D/g, '');       // sirf digits
  if (p.startsWith('0092')) p = '92' + p.slice(4);
  else if (p.startsWith('92') && p.length === 12) { /* already correct */ }
  else if (p.startsWith('0') && p.length === 11)   p = '92' + p.slice(1);
  else if (p.length === 10)                         p = '92' + p;
  if (p.length !== 12 || !p.startsWith('92')) return null; // invalid
  return p;
}

// ── Supabase fetch ────────────────────────────────────────────
async function sbGet(urlPath) {
  const r = await fetch(`${SUPABASE_URL}${urlPath}`, { headers: SB_HEADERS });
  return r.json();
}

// ── Format currency ───────────────────────────────────────────
function fmt(n) {
  return 'PKR ' + Math.abs(n).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

function today() { return new Date().toISOString().slice(0, 10); }

// ── Build ledger message ──────────────────────────────────────
function buildLedgerMessage(client, txnsToday) {
  const name     = client.name || 'Customer';
  const outstanding = client.outstanding_amount || 0;
  const outType  = client.outstanding_type || 'Dr';
  const balLabel = outType === 'Dr' ? '(Baqaya/Debit)' : '(Credit)';

  let msg = `🏢 *Cognitive Solutions Accounts — Aapka Ledger*\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `👤 *${name}*\n`;
  msg += `📅 ${new Date().toLocaleDateString('en-PK')}\n\n`;
  msg += `💰 *Closing Balance:*\n`;
  msg += `   ${fmt(outstanding)} ${balLabel}\n\n`;

  if (txnsToday.length > 0) {
    msg += `📋 *Aaj Ki Activity (${today()}):*\n`;
    for (const t of txnsToday) {
      const icon = t.txn_type === 'Invoice' ? '📄'
                 : t.txn_type === 'Payment' ? '💰'
                 : t.txn_type === 'Return'  ? '↩️' : '📋';
      const amt = t.debit > 0 ? `+${fmt(t.debit)} Dr` : `-${fmt(t.credit)} Cr`;
      msg += `   ${icon} ${t.txn_type}: *${amt}*\n`;
      if (t.voucher_no) msg += `      Voucher: ${t.voucher_no}\n`;
    }
    msg += '\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `📞 Kisi bhi sawaal ke liye:\n`;
  msg += `   *0326-1111379* (WhatsApp/Call)\n`;
  msg += `🏪 Cognitive Solutions Pvt Limited`;
  return msg;
}

// ── Send report to 3 admins ───────────────────────────────────
async function sendReport(sock, label, sent, skipped, notWA, errors) {
  const now = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
  const report =
`📊 *CNC ERP — Message Report*
━━━━━━━━━━━━━━━━━━
📅 Date: ${now}
📋 Template: *${label}*
━━━━━━━━━━━━━━━━━━
✅ Bheje gaye:       *${sent}*
⏭️ Skip (no phone):  *${skipped}*
📵 WhatsApp nahi:    *${notWA}*
❌ Errors:           *${errors}*
━━━━━━━━━━━━━━━━━━
_Ye report automatically generate hui hai._`;

  for (const r of REPORT_NUMBERS) {
    try {
      await sock.sendMessage(r.jid, { text: report });
      console.log(`[Bot] Report ✓ ${r.name}`);
      await new Promise(res => setTimeout(res, 1500));
    } catch (e) {
      console.error(`[Bot] Report fail: ${r.name}`);
    }
  }
}

// ── Core: send message to all clients ────────────────────────
async function broadcastToAll(sock, getMsg, label) {
  const clients = await sbGet('/clients?record_source=eq.erp_live&status=eq.Active&select=id,name,phone,outstanding_amount,outstanding_type&limit=2000');
  if (!Array.isArray(clients)) { console.error('[Bot] Clients fetch fail'); return; }
  console.log(`[Bot] ${clients.length} clients — bhejne shuru (${label})...`);

  let sent = 0, skipped = 0, notWA = 0, errors = 0;

  for (const c of clients) {
    const phone = normalizePhone(c.phone);
    if (!phone) { skipped++; continue; }
    const jid = phone + '@s.whatsapp.net';

    // WhatsApp pe check karo
    try {
      const [exists] = await sock.onWhatsApp(jid);
      if (!exists?.exists) { notWA++; continue; }
    } catch (_) { /* check fail toh try karo */ }

    try {
      const msg = typeof getMsg === 'function' ? getMsg(c) : getMsg;
      await sock.sendMessage(jid, { text: msg });
      console.log(`[Bot] ✓ ${c.name} (${phone})`);
      sent++;
      // 4-7 seconds random delay — human-like behaviour, spam se bachao
      const delay = 4000 + Math.floor(Math.random() * 3000);
      await new Promise(r => setTimeout(r, delay));
    } catch (e) {
      console.error(`[Bot] ✗ ${c.name} — ${e.message}`);
      errors++;
    }
  }

  console.log(`[Bot] Done — ✓${sent} skip:${skipped} noWA:${notWA} err:${errors}`);
  await sendReport(sock, label, sent, skipped, notWA, errors);
}

// ── Daily 8 PM send ───────────────────────────────────────────
async function sendDailyMessages(sock) {
  const cfgArr = await sbGet('/whatsapp_config?id=eq.1');
  const cfg = Array.isArray(cfgArr) && cfgArr[0] ? cfgArr[0] : { active_template: 'ledger', custom_message: '' };

  let txnMap = {}, erpMap = {};
  if (cfg.active_template === 'ledger') {
    const todayTxns = await sbGet(`/erp_transactions?txn_date=eq.${today()}&select=erp_account_id,txn_type,debit,credit,voucher_no&limit=5000`);
    const allClients = await sbGet('/clients?record_source=eq.erp_live&select=id,erp_id&limit=2000');
    if (Array.isArray(todayTxns)) todayTxns.forEach(t => { if (!txnMap[t.erp_account_id]) txnMap[t.erp_account_id]=[]; txnMap[t.erp_account_id].push(t); });
    if (Array.isArray(allClients)) allClients.forEach(c => { erpMap[c.id] = c.erp_id; });
  }

  const getMsg = cfg.active_template === 'custom'
    ? (cfg.custom_message || 'Cognitive Solutions ki taraf se salaam!')
    : (c) => buildLedgerMessage(c, txnMap[erpMap[c.id]] || []);

  await broadcastToAll(sock, getMsg, cfg.active_template === 'custom' ? 'Custom Message' : 'Daily Ledger');
}

// ── Trigger file check (har 30 sec) ──────────────────────────
function watchTrigger(sock) {
  setInterval(async () => {
    if (!fs.existsSync(TRIGGER_FILE)) return;
    try {
      const data = JSON.parse(fs.readFileSync(TRIGGER_FILE, 'utf8'));
      fs.unlinkSync(TRIGGER_FILE); // file delete karo taake dobara na chale
      console.log(`[Bot] Trigger mila: ${data.label}`);
      await broadcastToAll(sock, data.message, data.label);
    } catch (e) {
      console.error('[Bot] Trigger file error:', e.message);
    }
  }, 30000);
}

// ── Schedule 8 PM ─────────────────────────────────────────────
function scheduleEightPM(sock) {
  function msUntil8PM() {
    const now = new Date(), next = new Date();
    next.setHours(20, 0, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    return next - now;
  }
  function scheduleNext() {
    const ms = msUntil8PM();
    console.log(`[Bot] Agli messages: ${Math.floor(ms/3600000)}h ${Math.floor((ms%3600000)/60000)}m baad (raat 8 baje)`);
    setTimeout(async () => { await sendDailyMessages(sock); scheduleNext(); }, ms);
  }
  scheduleNext();
}

// ── Start ─────────────────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const sock = makeWASocket({ auth: state, printQRInTerminal: false, logger: pino({ level: 'silent' }) });

  sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
    if (qr) { console.log('\n[Bot] QR scan karo (WhatsApp → Linked Devices → Link a Device)\n'); qrcode.generate(qr, { small: true }); }

    if (connection === 'open') {
      console.log('[Bot] ✓ WhatsApp connected! Messages send ho sakti hain.');
      scheduleEightPM(sock);
      watchTrigger(sock);
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const reconnect = code !== DisconnectReason.loggedOut;
      console.log(`[Bot] Connection band (code:${code}). Reconnect:${reconnect}`);
      if (reconnect) setTimeout(startBot, 5000);
      else console.log('[Bot] Logout. wa-auth delete karo aur dobara start karo.');
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

console.log('[Bot] CNC ERP WhatsApp Bot shuru ho raha hai...');
startBot().catch(console.error);
