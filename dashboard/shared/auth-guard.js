/* ═══════════════════════════════════════════════════════════════
   Auth Guard — Supabase + Role-Based Access Control
   ═══════════════════════════════════════════════════════════════ */

(function() {
  const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_z46NMjGWepbZoD8uAvqBpg__J-wSALN';
  const API = SUPABASE_URL + '/rest/v1';

  // Page → required permission mapping
  const PAGE_PERMS = {
    'index.html':           'dashboard.view',
    'upload.html':          'dashboard.view',
    'clients.html':         'clients.view',
    'ledgers.html':         'ledgers.view',
    'payments.html':        'payments.view',
    'approvals.html':       'approvals.view',
    'decision.html':        'dashboard.view',
    'policy.html':          'dashboard.view',
    'controls.html':        'dashboard.view',
    'paygate.html':         'paygate.view',
    'bank.html':            'payments.view',
    'users.html':           'users.view',
    'cnc_data_manager.html':'dashboard.view',
    'ai.html':              'users.manage',
  };

  // Priority order for first-page redirect after login
  const HOME_ORDER = [
    {page:'index.html',    perm:'dashboard.view'},
    {page:'paygate.html',  perm:'paygate.view'},
    {page:'clients.html',  perm:'clients.view'},
    {page:'ledgers.html',  perm:'ledgers.view'},
    {page:'payments.html', perm:'payments.view'},
    {page:'approvals.html',perm:'approvals.view'},
    {page:'users.html',    perm:'users.view'},
  ];

  // Hide page until auth + perms loaded
  const style = document.createElement('style');
  style.id = 'auth-guard-hide';
  style.textContent = 'body{visibility:hidden!important}';
  document.head.appendChild(style);

  // Loading spinner
  document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('auth-loader')) return;
    const loader = document.createElement('div');
    loader.id = 'auth-loader';
    loader.style.cssText = `
      position:fixed;inset:0;display:grid;place-items:center;
      background:#F9FAFB;z-index:9999;visibility:visible;
      font-family:Inter,sans-serif;color:#6B7280;font-size:13px;
    `;
    loader.innerHTML = `
      <div style="text-align:center">
        <div style="width:32px;height:32px;border:3px solid #E5E7EB;border-top-color:#DC2626;border-radius:50%;margin:0 auto 12px;animation:spin 0.8s linear infinite"></div>
        <div>Loading...</div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(loader);
  });

  function goLogin() { window.location.replace('login.html'); }

  function goNoAccess(perm) {
    const page = window.location.pathname.split('/').pop() || 'index.html';
    window.location.replace(`login.html?noaccess=1&page=${encodeURIComponent(page)}`);
  }

  async function fetchPerms(email) {
    try {
      const hdrs = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY };
      // Find user in app_users by email
      const ur = await fetch(`${API}/app_users?email=eq.${encodeURIComponent(email)}&active=eq.true&select=id,name,role_id,username`, { headers: hdrs });
      const users = await ur.json();

      if (!users || !users.length) {
        // Not in app_users → give full access (owner/admin account)
        return { role: 'super_admin', perms: null, appUser: null };
      }

      const appUser = users[0];
      const pr = await fetch(`${API}/role_permissions?role_id=eq.${appUser.role_id}&select=permission`, { headers: hdrs });
      const permRows = await pr.json();
      const perms = (permRows || []).map(p => p.permission);

      return { role: appUser.role_id, perms, appUser };
    } catch(e) {
      return { role: 'super_admin', perms: null, appUser: null };
    }
  }

  function hasPerm(perm) {
    if (!window.userPerms) return true; // null = super_admin (full access)
    return window.userPerms.includes(perm);
  }

  async function reveal(user) {
    window.currentUser = user;

    // Load permissions
    const { role, perms, appUser } = await fetchPerms(user.email);
    window.userRole  = role;
    window.userPerms = perms; // null = full access
    window.appUser   = appUser;

    // Check if current page is allowed
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const requiredPerm = PAGE_PERMS[page];
    if (requiredPerm && !hasPerm(requiredPerm)) {
      goNoAccess(requiredPerm);
      return;
    }

    // Show page
    document.getElementById('auth-guard-hide')?.remove();
    document.getElementById('auth-loader')?.remove();

    // Signal that auth + perms are fully ready
    window.authReady = true;

    // Re-render sidebar now that perms are loaded
    setTimeout(() => {
      if (typeof renderSidebar === 'function') {
        const activePage = document.body.dataset.page || '';
        renderSidebar(activePage);
      }
      addUserBox(appUser?.name || user.email.split('@')[0], role);
      // Load AI chat widget
      if (!document.getElementById('cnc-ai-btn')) {
        const s = document.createElement('script');
        s.src = 'shared/ai-chat.js';
        document.head.appendChild(s);
      }
    }, 100);
  }

  function addUserBox(displayName, role) {
    const footer = document.querySelector('.sb-footer');
    if (!footer || footer.querySelector('.sb-user')) return;
    const roleName = role ? role.replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase()) : '';
    const userBox = document.createElement('div');
    userBox.className = 'sb-user';
    userBox.style.cssText = 'padding:8px 10px;font-size:11px;color:var(--text-3);border-top:1px solid var(--border);margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:8px';
    userBox.innerHTML = `
      <div style="overflow:hidden;flex:1;min-width:0">
        <div style="font-weight:600;color:var(--text-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${displayName}</div>
        <div style="font-size:10px;color:var(--text-3)">${roleName}</div>
      </div>
      <button onclick="signOut()" style="background:none;border:1px solid var(--border);color:var(--text-3);padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit;white-space:nowrap">Sign out</button>
    `;
    footer.appendChild(userBox);
  }

  async function checkAuth() {
    try {
      window.hasPerm = (p) => !window.userPerms || window.userPerms.includes(p);

      // ── Check app_users local session first ──────────────────
      try {
        const appSess = JSON.parse(localStorage.getItem('cnc_app_session') || 'null');
        if (appSess?.id && appSess?.role_id) {
          // Session expires after 12 hours
          if (Date.now() - (appSess.ts || 0) < 12 * 60 * 60 * 1000) {
            await revealAppUser(appSess);
            return;
          } else {
            localStorage.removeItem('cnc_app_session');
          }
        }
      } catch(e) {}

      // ── Fall back to Supabase Auth ───────────────────────────
      const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      window._supabase = client;

      const timeout = setTimeout(goLogin, 8000);
      const { data: { session }, error } = await client.auth.getSession();
      clearTimeout(timeout);

      if (error || !session) {
        const { data: refreshed } = await client.auth.refreshSession();
        if (!refreshed?.session) { goLogin(); return; }
        await reveal(refreshed.session.user);
      } else {
        await reveal(session.user);
      }
    } catch(e) {
      console.error('Auth error:', e);
      goLogin();
    }
  }

  async function revealAppUser(appSess) {
    // Build a user-like object for reveal
    const fakeUser = { email: appSess.email || appSess.username, id: appSess.id };
    window.currentUser = fakeUser;
    window.userRole    = appSess.role_id;
    window.appUser     = appSess;

    // Load permissions for this role
    try {
      const hdrs = { 'apikey': SUPABASE_KEY, 'Authorization': 'Bearer ' + SUPABASE_KEY };
      const pr = await fetch(`${API}/role_permissions?role_id=eq.${appSess.role_id}&select=permission`, { headers: hdrs });
      const rows = await pr.json();
      window.userPerms = (rows || []).map(r => r.permission);
    } catch(e) {
      window.userPerms = null; // full access on error
    }

    // Check page permission
    const page = window.location.pathname.split('/').pop() || 'index.html';
    const requiredPerm = PAGE_PERMS[page];
    if (requiredPerm && window.userPerms && !window.userPerms.includes(requiredPerm)) {
      goNoAccess(requiredPerm);
      return;
    }

    // Reveal page
    document.getElementById('auth-guard-hide')?.remove();
    document.getElementById('auth-loader')?.remove();

    // Signal that auth + perms are fully ready
    window.authReady = true;

    // Re-render sidebar + user box
    setTimeout(() => {
      if (typeof renderSidebar === 'function') {
        renderSidebar(document.body.dataset.page || '');
      }
      addUserBox(appSess.name || appSess.username, appSess.role_id);
      // Load AI chat widget
      if (!document.getElementById('cnc-ai-btn')) {
        const s = document.createElement('script');
        s.src = 'shared/ai-chat.js';
        document.head.appendChild(s);
      }
    }, 100);
  }

  function waitForSupabase(attempts) {
    if (typeof supabase !== 'undefined') {
      checkAuth();
    } else if (attempts > 0) {
      setTimeout(() => waitForSupabase(attempts - 1), 200);
    } else {
      goLogin();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => waitForSupabase(15));
  } else {
    waitForSupabase(15);
  }

  window.signOut = function() {
    localStorage.removeItem('cnc_app_session');
    if (window._supabase) {
      window._supabase.auth.signOut().then(() => goLogin());
    } else {
      goLogin();
    }
  };
})();
