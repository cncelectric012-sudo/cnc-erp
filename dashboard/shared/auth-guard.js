/* ═══════════════════════════════════════════════════════════════
   Auth Guard — Supabase
   ═══════════════════════════════════════════════════════════════ */

(function() {
  const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_z46NMjGWepbZoD8uAvqBpg__J-wSALN';

  // Hide page until auth check completes
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
        <div>Verifying session...</div>
      </div>
      <style>@keyframes spin{to{transform:rotate(360deg)}}</style>
    `;
    document.body.appendChild(loader);
  });

  function reveal(user) {
    window.currentUser = user;
    document.getElementById('auth-guard-hide')?.remove();
    document.getElementById('auth-loader')?.remove();

    setTimeout(() => {
      const footer = document.querySelector('.sb-footer');
      if (footer && !footer.querySelector('.sb-user')) {
        const userBox = document.createElement('div');
        userBox.className = 'sb-user';
        userBox.style.cssText = 'padding:8px 10px;font-size:11px;color:var(--text-3);border-top:1px solid var(--border);margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:8px';
        userBox.innerHTML = `
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1">
            <div style="font-weight:600;color:var(--text-2)">Signed in</div>
            <div style="font-size:10px">${user.email}</div>
          </div>
          <button onclick="signOut()" style="background:none;border:1px solid var(--border);color:var(--text-3);padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit">Sign out</button>
        `;
        footer.appendChild(userBox);
      }
    }, 150);
  }

  function goLogin() {
    window.location.replace('login.html');
  }

  async function checkAuth() {
    try {
      const client = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
      window._supabase = client;

      // Timeout: if Supabase doesn't respond in 6s, go to login
      const timeout = setTimeout(goLogin, 6000);

      const { data: { session }, error } = await client.auth.getSession();
      clearTimeout(timeout);

      if (error || !session) {
        // Try refresh
        const { data: refreshed } = await client.auth.refreshSession();
        if (!refreshed?.session) { goLogin(); return; }
        reveal(refreshed.session.user);
      } else {
        reveal(session.user);
      }
    } catch(e) {
      console.error('Auth error:', e);
      goLogin();
    }
  }

  // Wait for Supabase SDK to be available
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
    if (window._supabase) {
      window._supabase.auth.signOut().then(() => goLogin());
    } else {
      goLogin();
    }
  };
})();
