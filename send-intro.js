// send-intro.js — Intro message trigger karo (main bot bhejega)
// Run: node send-intro.js
// NOTE: whatsapp-bot.js PM2 mein chalta rehna chahiye

const fs   = require('fs');
const path = require('path');

const TRIGGER_FILE = path.join(__dirname, 'pending-broadcast.json');

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

fs.writeFileSync(TRIGGER_FILE, JSON.stringify({
  template: 'intro_welcome',
  label: 'Intro / Welcome Message',
}), 'utf8');

console.log('✓ Trigger file likhi — main bot 30 seconds mein intro message bhejega.');
console.log('  (whatsapp-bot.js PM2 mein online hona chahiye)');
