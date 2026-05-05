// fix_filenames.js
// Run this ONCE: node fix_filenames.js
// It matches PDF filenames to database entries and saves them

const fs = require('fs');
const path = require('path');

const DB_FILE     = path.join(__dirname, 'database', 'ledger_db.json');
const LEDGERS_DIR = path.join(__dirname, 'ledgers');

// Load database
const db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
const files = fs.readdirSync(LEDGERS_DIR).filter(f => f.endsWith('.pdf'));

console.log(`📒 Database entries: ${Object.keys(db).length}`);
console.log(`📂 PDF files: ${files.length}`);

let matched = 0;
let unmatched = 0;

// For each DB entry, try to find matching PDF filename
for (const [key, client] of Object.entries(db)) {
    if (client.filename) continue; // already has filename, skip

    const clientName = (client.name || key).toLowerCase().trim();

    // Try to match PDF filename to client name
    let bestMatch = null;
    let bestScore = 0;

    for (const file of files) {
        // Remove .pdf and clean up filename
        const filePart = file.replace('.pdf', '').toLowerCase().trim();

        // Direct match
        if (filePart === clientName) {
            bestMatch = file;
            bestScore = 100;
            break;
        }

        // Filename contains client name or vice versa
        if (filePart.includes(clientName) || clientName.includes(filePart)) {
            const score = 80;
            if (score > bestScore) { bestMatch = file; bestScore = score; }
        }

        // Word-by-word match
        const clientWords = clientName.split(/[\s_-]+/).filter(w => w.length > 2);
        const fileWords   = filePart.split(/[\s_-]+/).filter(w => w.length > 2);
        const common = clientWords.filter(w => fileWords.includes(w));
        if (common.length > 0) {
            const score = (common.length / Math.max(clientWords.length, fileWords.length)) * 70;
            if (score > bestScore) { bestMatch = file; bestScore = score; }
        }
    }

    if (bestMatch && bestScore >= 50) {
        db[key].filename = bestMatch;
        matched++;
    } else {
        // Use key-based filename as fallback
        // Try: replace spaces with underscores, add .pdf
        const guessFile = clientName.replace(/\s+/g, '_') + '.pdf';
        if (files.includes(guessFile)) {
            db[key].filename = guessFile;
            matched++;
        } else {
            unmatched++;
        }
    }
}

// Save updated database
fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8');

console.log(`\n✅ Done!`);
console.log(`✅ Matched: ${matched} entries`);
console.log(`⚠️  Unmatched: ${unmatched} entries (will reprocess on next restart)`);
console.log(`\n💾 Database saved.`);
console.log(`\nNow restart bot: pm2 restart cnc-bot`);
