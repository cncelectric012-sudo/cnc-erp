// mark_all_processed.js
// Run ONCE: node mark_all_processed.js
// Marks all existing database entries as processed so they never reprocess

const fs = require('fs');
const path = require('path');

const DB_FILE     = path.join(__dirname, 'database', 'ledger_db.json');
const LEDGERS_DIR = path.join(__dirname, 'ledgers');

const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const files = fs.readdirSync(LEDGERS_DIR).filter(f => f.endsWith('.pdf'));

console.log(`📒 Database entries: ${Object.keys(db).length}`);
console.log(`📂 PDF files: ${files.length}`);

// Mark every entry as processed with a generic processed flag
let marked = 0;
for (const key of Object.keys(db)) {
    if (!db[key].processed) {
        db[key].processed = true;
        marked++;
    }
}

// Also store full list of processed filenames separately
db['__processed_files__'] = {
    files: files,
    markedAt: new Date().toISOString()
};

fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');

console.log(`\n✅ Marked ${marked} entries as processed`);
console.log(`✅ Stored ${files.length} PDF filenames`);
console.log(`💾 Database saved`);
console.log(`\nNow restart: pm2 restart cnc-bot`);
