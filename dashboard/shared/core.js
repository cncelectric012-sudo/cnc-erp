/* ═══════════════════════════════════════════════════════════════
   CNC ELECTRIC — Credit Decision Engine
   Core Library (shared across all pages)
   ═══════════════════════════════════════════════════════════════ */

// ── Today's date (used in age calculations) ──────────────────
const TODAY = new Date(2026, 3, 25);

// ── State (loaded from localStorage on each page) ────────────
let rows = [];
let customers = [];
let payments = [];
let approvals = [];
let policy = {
  creditDays: 45, freezeDays: 60, freezeRec: 75, relMul: 0.5,
  greenBase: 18, greenMax: 30,
  yellowBase: 12, yellowMax: 20,
  orangeBase: 7,  orangeMax: 15,
  redBase: 0,     redMax: 5,
  absoluteCap: 30
};
window.spDB = {};
window.clientDB = {};

// ── Storage Helpers ──────────────────────────────────────────
const STORE = {
  save(key, val) {
    try { localStorage.setItem('cnc_' + key, JSON.stringify(val)); }
    catch(e) { console.error('Storage save failed:', e); }
  },
  load(key, fallback) {
    try {
      const raw = localStorage.getItem('cnc_' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch(e) { return fallback; }
  },
  clear(key) { localStorage.removeItem('cnc_' + key); }
};

function loadAllState() {
  rows = STORE.load('rows', []);
  customers = STORE.load('customers', []);
  payments = STORE.load('payments', []);
  approvals = STORE.load('approvals', []);
  policy = Object.assign(policy, STORE.load('policy', {}));
  window.spDB = STORE.load('spDB', {});
  window.clientDB = STORE.load('clientDB', {});
}

function saveAllState() {
  STORE.save('rows', rows);
  STORE.save('customers', customers);
  STORE.save('payments', payments);
  STORE.save('approvals', approvals);
  STORE.save('policy', policy);
  STORE.save('spDB', window.spDB);
  STORE.save('clientDB', window.clientDB);
}

// ── Formatters ───────────────────────────────────────────────
const num = v => {
  const n = parseFloat(String(v || 0).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
};
const fmt = n => new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(Math.round(n || 0));
const fmtPct = n => (Math.round(n * 10) / 10) + '%';
const fmtK = n => {
  if (n >= 10000000) return (n / 10000000).toFixed(1) + ' Cr';
  if (n >= 100000)   return (n / 100000).toFixed(1) + ' L';
  if (n >= 1000)     return (n / 1000).toFixed(1) + ' K';
  return Math.round(n).toString();
};

function parseDate(s) {
  if (!s) return TODAY;
  const parts = String(s).split(/[\/\-]/);
  if (parts.length === 3) {
    if (parts[2].length === 4) return new Date(+parts[2], +parts[1] - 1, +parts[0]);
    return new Date(+parts[0], +parts[1] - 1, +parts[2]);
  }
  return new Date(s);
}

function ageDays(dateStr) {
  const d = parseDate(dateStr);
  return Math.max(0, Math.floor((TODAY - d) / 86400000));
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) + ' ' +
         d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(',').map(x => x.trim().toLowerCase());
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const obj = {};
    headers.forEach((h, i) => obj[h] = (vals[i] || '').trim());
    return obj;
  }).filter(r => r.customer || r.name);
}

function patternBadgeColor(p) {
  return p === 'Clean' ? 'green' :
         p === 'Installment' ? 'blue' :
         p === 'Rolling' ? 'orange' :
         p === 'Selective' ? 'red' : 'gray';
}

// ── Toast ────────────────────────────────────────────────────
function showToast(msg, icon = '✓') {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    t.id = 'toast';
    t.innerHTML = '<span id="toastIcon"></span><span id="toastMsg"></span>';
    document.body.appendChild(t);
  }
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('toastIcon').textContent = icon;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 3000);
}

// ── Sidebar Render ───────────────────────────────────────────
function renderSidebar(activePage) {
  const pendingApprovals = (approvals || []).filter(a => a.status === 'pending').length;
  const html = `
    <div class="sb-brand">
      <div class="sb-logo">C</div>
      <div>
        <div class="sb-brand-name">CNC Electric</div>
        <div class="sb-brand-sub">Credit Engine v2.0</div>
      </div>
    </div>

    <div class="sb-section">
      <div class="sb-section-label">Workspace</div>
      <a class="sb-item ${activePage==='upload'?'active':''}" href="upload.html">
        <span class="ico">📥</span>Load Data
      </a>
      <a class="sb-item ${activePage==='portfolio'?'active':''}" href="index.html">
        <span class="ico">📊</span>Portfolio
        <span class="badge-count">${customers.length || 0}</span>
      </a>
      <a class="sb-item ${activePage==='ledgers'?'active':''}" href="ledgers.html">
        <span class="ico">📒</span>Client Ledgers
      </a>
      <a class="sb-item ${activePage==='payments'?'active':''}" href="payments.html">
        <span class="ico">💳</span>Payments
        <span class="badge-count">${payments.length || 0}</span>
      </a>
      <a class="sb-item ${activePage==='approvals'?'active':''}" href="approvals.html">
        <span class="ico">✓</span>Approvals
        <span class="badge-count">${pendingApprovals}</span>
      </a>
    </div>

    <div class="sb-section">
      <div class="sb-section-label">Engine</div>
      <a class="sb-item ${activePage==='decision'?'active':''}" href="decision.html">
        <span class="ico">⚡</span>Invoice Decision
      </a>
      <a class="sb-item ${activePage==='policy'?'active':''}" href="policy.html">
        <span class="ico">⚙️</span>Policy Settings
      </a>
      <a class="sb-item ${activePage==='controls'?'active':''}" href="controls.html">
        <span class="ico">🎛️</span>Parameters
      </a>
    </div>

    <div class="sb-footer">
      <div class="sb-status">
        <div class="sb-status-dot"></div>
        <span>${customers.length ? 'Portfolio Active' : 'System Ready'}</span>
      </div>
    </div>
  `;
  const el = document.getElementById('sidebar');
  if (el) el.innerHTML = html;
}

// ── Init on every page load ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadAllState();
  const activePage = document.body.dataset.page || '';
  renderSidebar(activePage);

  // Close modals on Escape
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay, .image-overlay').forEach(m => m.classList.add('hidden'));
      document.body.style.overflow = '';
    }
  });
});

// ── Image Lightbox ───────────────────────────────────────────
function openImage(url) {
  if (!url) return;
  let overlay = document.getElementById('imageOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'imageOverlay';
    overlay.className = 'image-overlay hidden';
    overlay.innerHTML = `<button class="image-overlay-close" onclick="closeImage()">✕</button><img id="imageOverlayImg" src="" alt=""/>`;
    overlay.onclick = e => { if (e.target === overlay) closeImage(); };
    document.body.appendChild(overlay);
  }
  document.getElementById('imageOverlayImg').src = url;
  overlay.classList.remove('hidden');
}
function closeImage() {
  const el = document.getElementById('imageOverlay');
  if (el) el.classList.add('hidden');
}
