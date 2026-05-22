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
  const can = (p) => !window.userPerms || window.userPerms.includes(p);

  const item = (page, ico, label, perm) => {
    if (perm && !can(perm)) return '';
    const hasQuery = page.includes('?');
    const basePage = page.split('?')[0];
    const href = hasQuery ? basePage + '.html?' + page.split('?')[1] : page + '.html';
    const isActive = !hasQuery && activePage === basePage;
    return `<a class="sb-item ${isActive?'active':''}" href="${href}"><span class="ico">${ico}</span>${label}</a>`;
  };

  // Build groups — only show if at least one item visible
  const groups = [
    {
      id:'g1', ico:'🔐', label:'Users & Roles',
      perm:'users.view',
      items:[
        item('users','👥','Users & Permissions','users.view'),
      ]
    },
    {
      id:'g2', ico:'👤', label:'Clients & Ledgers',
      perm:'clients.view',
      items:[
        item('new-client','➕','New Client','clients.view'),
        item('clients','📋','All Clients','clients.view'),
        item('ledgers','📒','Client Ledgers','ledgers.view'),
        item('ledger-import','📥','Import','clients.view'),
        item('ledger-export','📤','Export','clients.view'),
      ]
    },
    {
      id:'g4', ico:'✅', label:'Invoice Approval',
      perm:'approvals.view',
      items:[
        item('approvals','⏳','Pending Approvals','approvals.view'),
        item('approvals','📋','Approval History','approvals.view'),
      ]
    },
    {
      id:'g5', ico:'⚡', label:'Decision Engine',
      perm:'dashboard.view',
      items:[
        item('decision','⚡','Invoice Decision','dashboard.view'),
        item('policy','⚙️','Policy Settings','dashboard.view'),
        item('controls','🎛️','Parameters','dashboard.view'),
        item('bot-controls','🤖','Bot Controls','dashboard.view'),
      ]
    },
    {
      id:'g6', ico:'💰', label:'PayGate',
      perm:'paygate.view',
      items:[
        item('paygate','💰','Submit & Review','paygate.view'),
        item('bank','🏦','Bank Verification','payments.view'),
      ]
    },
    {
      id:'g7', ico:'💳', label:'Payments',
      perm:'payments.view',
      items:[
        item('paygate','📊','Payment Reports','paygate.view'),
        item('bank','🔍','Bank Alerts','payments.view'),
      ]
    },
    {
      id:'g8', ico:'🤖', label:'AI Integration',
      perm:'users.manage',
      items:[
        item('ai','🤖','AI Settings','users.manage'),
        item('ai','💬','WhatsApp Bot','users.manage'),
      ]
    },
  ];

  // Determine which group is open (based on active page)
  const pageToGroup = {
    users:'g1',
    clients:'g2', 'new-client':'g2', ledgers:'g2', 'ledger-import':'g2', 'ledger-export':'g2',
    approvals:'g4',
    decision:'g5', policy:'g5', controls:'g5', 'bot-controls':'g5',
    paygate:'g6', bank:'g6',
    payments:'g7',
    ai:'g8'
  };
  const openGroup = pageToGroup[activePage] || '';

  const groupsHtml = groups.map(g => {
    if (g.perm && !can(g.perm)) return '';
    const validItems = g.items.filter(Boolean).join('');
    if (!validItems) return '';
    const isOpen = openGroup === g.id;
    return `
    <div class="sb-group">
      <div class="sb-group-header ${isOpen?'open':''}" onclick="toggleSbGroup('${g.id}',this)">
        <span class="sb-gico">${g.ico}</span>
        <span>${g.label}</span>
        <span class="sb-arrow">›</span>
      </div>
      <div class="sb-sub ${isOpen?'open':''}" id="${g.id}">
        ${validItems}
      </div>
    </div>`;
  }).filter(Boolean).join('');

  const html = `
    <div class="sb-brand">
      <div class="sb-logo">C</div>
      <div>
        <div class="sb-brand-name">CNC Electric</div>
        <div class="sb-brand-sub">ERP v2.0</div>
      </div>
    </div>
    <div style="padding:8px 12px;overflow-y:auto;flex:1">
      ${groupsHtml}
    </div>
    <div class="sb-footer">
      <div class="sb-status">
        <div class="sb-status-dot"></div>
        <span>System Ready</span>
      </div>
    </div>
  `;
  const el = document.getElementById('sidebar');
  if (el) el.innerHTML = html;
}

function toggleSbGroup(id, headerEl) {
  const sub = document.getElementById(id);
  if (!sub) return;
  const isOpen = sub.classList.contains('open');
  // Close all
  document.querySelectorAll('.sb-sub').forEach(s => s.classList.remove('open'));
  document.querySelectorAll('.sb-group-header').forEach(h => h.classList.remove('open'));
  // Open clicked (if was closed)
  if (!isOpen) {
    sub.classList.add('open');
    headerEl.classList.add('open');
  }
}

// ── Init on every page load ──────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  loadAllState();
  const activePage = document.body.dataset.page || '';
  renderSidebar(activePage);
  setupMobileNav();

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      document.querySelectorAll('.modal-overlay, .image-overlay').forEach(m => m.classList.add('hidden'));
      document.body.style.overflow = '';
      closeMobileNav();
    }
  });
});

// ── Mobile Nav ───────────────────────────────────────────────
function setupMobileNav() {
  // Overlay
  let overlay = document.getElementById('sidebarOverlay');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'sidebarOverlay';
    overlay.className = 'sidebar-overlay';
    overlay.onclick = closeMobileNav;
    document.body.appendChild(overlay);
  }
  // Hamburger in topbar
  const topbar = document.querySelector('.topbar');
  if (topbar && !topbar.querySelector('.hamburger')) {
    const btn = document.createElement('button');
    btn.className = 'hamburger';
    btn.setAttribute('aria-label', 'Menu');
    btn.innerHTML = '<span></span><span></span><span></span>';
    btn.onclick = toggleMobileNav;
    topbar.insertBefore(btn, topbar.firstChild);
  }
}

function toggleMobileNav() {
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  if (!sidebar) return;
  const open = sidebar.classList.toggle('open');
  overlay.classList.toggle('open', open);
}

function closeMobileNav() {
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarOverlay')?.classList.remove('open');
}

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
