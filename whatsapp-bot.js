// whatsapp-bot.js — CNC ERP WhatsApp Daily Ledger Bot
// Raat 8 baje sab clients ko ledger summary bhejta hai
// Run: node whatsapp-bot.js

const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const SB_HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };

// Chrome path — multiple locations try karta hai
const fs = require('fs');
const CHROME_PATHS = [
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Users\\SERVER\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Users\\Administrator\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe',
];
const CHROME_PATH = CHROME_PATHS.find(p => { try { return fs.existsSync(p); } catch(e) { return false; } });

// ── Supabase fetch ────────────────────────────────────────────
async function sbGet(path) {
  const r = await fetch(`${SUPABASE_URL}${path}`, { headers: SB_HEADERS });
  return r.json();
}

// ── Format currency ───────────────────────────────────────────
function fmt(n) {
  return 'PKR ' + Math.abs(n).toLocaleString('en-PK', { maximumFractionDigits: 0 });
}

// ── Get today's date string ───────────────────────────────────
function today() {
  return new Date().toISOString().slice(0, 10);
}

// ── Build message for one client ─────────────────────────────
function buildMessage(client, txnsToday) {
  const name = client.name || 'Customer';
  const outstanding = client.outstanding_amount || 0;
  const outType = client.outstanding_type || 'Dr';
  const balLabel = outType === 'Dr' ? '(Baqaya/Debit)' : '(Credit)';

  let msg = `🏢 *CNC Electric — Aapka Ledger*\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `👤 *${name}*\n`;
  msg += `📅 Tarikh: ${new Date().toLocaleDateString('ur-PK')}\n\n`;
  msg += `💰 *Closing Balance:*\n`;
  msg += `   ${fmt(outstanding)} ${balLabel}\n\n`;

  if (txnsToday.length > 0) {
    msg += `📋 *Aaj Ki Activity (${today()}):*\n`;
    for (const t of txnsToday) {
      const icon = t.txn_type === 'Invoice' ? '📄'
                 : t.txn_type === 'Payment' ? '💰'
                 : t.txn_type === 'Return'  ? '↩️'
                 : '📋';
      const amt = t.debit > 0
        ? `+${fmt(t.debit)} Dr`
        : `-${fmt(t.credit)} Cr`;
      msg += `   ${icon} ${t.txn_type}: *${amt}*\n`;
      if (t.voucher_no) msg += `      Voucher: ${t.voucher_no}\n`;
    }
    msg += '\n';
  }

  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `📞 Kisi bhi sawaal ke liye rabta karein:\n`;
  msg += `   *0326-1111379* (WhatsApp/Call)\n`;
  msg += `🏪 CNC Electric Pakistan`;

  return msg;
}

// ── Send daily messages to all clients ───────────────────────
async function sendDailyMessages(client) {
  console.log('[WhatsApp Bot] Daily message bhejne shuru...');

  // Sab clients fetch karo jinka phone number hai
  const clients = await sbGet('/clients?record_source=eq.erp_live&status=eq.Active&select=id,name,phone,outstanding_amount,outstanding_type&limit=2000');
  if (!Array.isArray(clients)) {
    console.error('[WhatsApp Bot] Clients fetch nahi hue:', clients);
    return;
  }

  // Aaj ki transactions fetch karo
  const todayTxns = await sbGet(`/erp_transactions?txn_date=eq.${today()}&select=erp_account_id,txn_type,debit,credit,voucher_no&limit=5000`);
  const txnMap = {};
  if (Array.isArray(todayTxns)) {
    for (const t of todayTxns) {
      if (!txnMap[t.erp_account_id]) txnMap[t.erp_account_id] = [];
      txnMap[t.erp_account_id].push(t);
    }
  }

  // Client ID → erp_id mapping ke liye
  const allClients = await sbGet('/clients?record_source=eq.erp_live&select=id,erp_id&limit=2000');
  const erpMap = {};
  if (Array.isArray(allClients)) allClients.forEach(c => { erpMap[c.id] = c.erp_id; });

  let sent = 0, skipped = 0, errors = 0;

  for (const c of clients) {
    if (!c.phone) { skipped++; continue; }

    // Phone number clean karo (Pakistan format)
    let phone = c.phone.replace(/\D/g, ''); // sirf digits
    if (phone.startsWith('0')) phone = '92' + phone.slice(1); // 0326 → 92326
    if (!phone.startsWith('92')) phone = '92' + phone;
    const chatId = phone + '@c.us';

    const erpId = erpMap[c.id] || '';
    const txnsToday = txnMap[erpId] || [];
    const msg = buildMessage(c, txnsToday);

    try {
      await client.sendMessage(chatId, msg);
      console.log(`[WhatsApp Bot] ✓ Bheja: ${c.name} (${phone})`);
      sent++;
      // Har message ke baad thodi delay (rate limiting)
      await new Promise(r => setTimeout(r, 2000));
    } catch (e) {
      console.error(`[WhatsApp Bot] ✗ Failed: ${c.name} — ${e.message}`);
      errors++;
    }
  }

  console.log(`[WhatsApp Bot] ✓ Done — Bheje: ${sent} | Skip (no phone): ${skipped} | Errors: ${errors}`);
}

// ── Schedule at 8 PM daily ────────────────────────────────────
function scheduleEightPM(waClient) {
  function msUntil8PM() {
    const now = new Date();
    const next = new Date();
    next.setHours(20, 0, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1); // kal ka 8 PM
    return next - now;
  }

  function scheduleNext() {
    const ms = msUntil8PM();
    const hrs = Math.floor(ms / 3600000);
    const mins = Math.floor((ms % 3600000) / 60000);
    console.log(`[WhatsApp Bot] Agli messages: ${hrs}h ${mins}m baad (raat 8 baje)`);
    setTimeout(async () => {
      await sendDailyMessages(waClient);
      scheduleNext(); // Kal ke liye dobara schedule
    }, ms);
  }

  scheduleNext();
}

// ── WhatsApp Client Setup ─────────────────────────────────────
const waClient = new Client({
  authStrategy: new LocalAuth({ clientId: 'cnc-erp' }),
  puppeteer: {
    executablePath: CHROME_PATH || undefined,
    headless: false, // Chrome window khulega — AnyDesk se QR scan karo
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  },
});

waClient.on('qr', (qr) => {
  console.log('\n[WhatsApp Bot] QR Code scan karo apne WhatsApp se:');
  console.log('   (WhatsApp > Settings > Linked Devices > Link a Device)\n');
  qrcode.generate(qr, { small: true });
});

waClient.on('authenticated', () => {
  console.log('[WhatsApp Bot] ✓ WhatsApp authenticated!');
});

waClient.on('ready', () => {
  console.log('[WhatsApp Bot] ✓ WhatsApp ready hai! Messages send ho sakti hain.');
  scheduleEightPM(waClient);

  // Test ke liye: abhi bhi bhej sakte ho (comment hatao)
  // sendDailyMessages(waClient);
});

waClient.on('disconnected', (reason) => {
  console.log('[WhatsApp Bot] WhatsApp disconnect hua:', reason);
  console.log('[WhatsApp Bot] Dobara start karo: node whatsapp-bot.js');
  process.exit(1);
});

waClient.on('auth_failure', (msg) => {
  console.error('[WhatsApp Bot] Auth fail:', msg);
});

console.log('[WhatsApp Bot] Shuru ho raha hai...');
console.log('[WhatsApp Bot] QR code aane ka intezaar karo...\n');
waClient.initialize();
