// send-intro.js — Ek baar sab clients ko intro message bhejo
// Run: node send-intro.js

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode-terminal');
const path = require('path');
const pino = require('pino');

const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co/rest/v1';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';
const SB_HEADERS = { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` };
const AUTH_FOLDER = path.join(__dirname, 'wa-auth');

const REPORT_NUMBERS = [
  { name: 'Muddasir Waheed Malik', jid: '923228064444@s.whatsapp.net' },
  { name: 'Malik Awais',           jid: '923004755563@s.whatsapp.net' },
  { name: 'Bilal Arif',            jid: '923020011194@s.whatsapp.net' },
];

const INTRO_MESSAGE = `Assalam-o-Alaikum,

Yeh Cognitive Solutions ka official Accounts Number hai. Ab se aapka account ledger isi number se bheja jayega taake aap apna balance aasani se track kar sakein.

Kisi bhi discrepancy ya issue (payment, invoice, account) ki surat mein seedha is number par message karein. Hamari team fori response de gi.

Shukriya
Accounts Department
Cognitive Solutions Pvt Limited

——————————

السلام علیکم،

یہ کوگنیٹو سولوشنز کا آفیشل اکاؤنٹس نمبر ہے۔ اب سے آپ کا اکاؤنٹ لیجر اسی نمبر سے بھیجا جائے گا تاکہ آپ اپنا بیلنس آسانی سے ٹریک کر سکیں۔

کسی بھی فرق یا مسئلے (ادائیگی، انوائس، اکاؤنٹ) کی صورت میں براہ راست اس نمبر پر پیغام کریں۔ ہماری ٹیم فوری جواب دے گی۔

شکریہ
اکاؤنٹس ڈیپارٹمنٹ
کوگنیٹو سولوشنز پرائیویٹ لمیٹڈ`;

async function sendAll(sock) {
  console.log('[Intro] Clients fetch kar raha hai...');
  const r = await fetch(`${SUPABASE_URL}/clients?record_source=eq.erp_live&status=eq.Active&select=name,phone&limit=2000`, { headers: SB_HEADERS });
  const clients = await r.json();

  if (!Array.isArray(clients)) { console.error('[Intro] Clients fetch fail'); process.exit(1); }
  console.log(`[Intro] ${clients.length} clients mile — message bhejne shuru...`);

  let sent = 0, skipped = 0, errors = 0;

  for (const c of clients) {
    if (!c.phone) { skipped++; continue; }

    let phone = c.phone.replace(/\D/g, '');
    if (phone.startsWith('0')) phone = '92' + phone.slice(1);
    if (!phone.startsWith('92')) phone = '92' + phone;
    const jid = phone + '@s.whatsapp.net';

    try {
      await sock.sendMessage(jid, { text: INTRO_MESSAGE });
      console.log(`[Intro] ✓ ${c.name} (${phone})`);
      sent++;
      await new Promise(res => setTimeout(res, 2000));
    } catch (e) {
      console.error(`[Intro] ✗ ${c.name} — ${e.message}`);
      errors++;
    }
  }

  console.log(`\n[Intro] ✓ Done — Bheje:${sent} | Skip:${skipped} | Errors:${errors}`);

  // Report bhejo
  const now = new Date().toLocaleString('en-PK', { timeZone: 'Asia/Karachi' });
  const report = `📊 *Intro Message Report*
━━━━━━━━━━━━━━━━━━
📅 Date: ${now}
📋 Template: *Intro / Welcome Message*
━━━━━━━━━━━━━━━━━━
✅ Bheje gaye:  *${sent}*
⏭️ Skip (no phone): *${skipped}*
❌ Errors:      *${errors}*
📦 Total clients: *${sent + skipped + errors}*
━━━━━━━━━━━━━━━━━━
_Ye report automatically generate hui hai._`;

  for (const rep of REPORT_NUMBERS) {
    try {
      await sock.sendMessage(rep.jid, { text: report });
      console.log(`[Intro] Report bheja: ${rep.name}`);
      await new Promise(res => setTimeout(res, 1500));
    } catch (e) {
      console.error(`[Intro] Report fail: ${rep.name}`);
    }
  }

  console.log('[Intro] Sab ho gaya. Script band ho rahi hai...');
  await new Promise(res => setTimeout(res, 3000));
  process.exit(0);
}

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: pino({ level: 'silent' }),
  });

  sock.ev.on('connection.update', async ({ connection, qr }) => {
    if (qr) {
      console.log('\n[Intro] QR scan karo:');
      qrcode.generate(qr, { small: true });
    }
    if (connection === 'open') {
      console.log('[Intro] ✓ Connected!');
      await sendAll(sock);
    }
    if (connection === 'close') {
      console.log('[Intro] Disconnected. Dobara chal raha hai...');
      setTimeout(start, 3000);
    }
  });

  sock.ev.on('creds.update', saveCreds);
}

console.log('[Intro] Shuru ho raha hai...');
start().catch(console.error);
