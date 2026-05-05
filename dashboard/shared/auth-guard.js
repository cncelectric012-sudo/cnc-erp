/* ═══════════════════════════════════════════════════════════════
   Auth Guard
   Loaded BEFORE core.js on every page (except login.html).
   Checks if user is logged in. If not → redirect to login.html.
   ═══════════════════════════════════════════════════════════════ */

(function() {
  // Initialize Firebase
  if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG) {
    console.error('[auth-guard] Firebase SDK or config missing — page cannot authenticate');
    return;
  }

  if (!firebase.apps.length) {
    firebase.initializeApp(window.FIREBASE_CONFIG);
  }

  // Hide page content until auth check completes (prevents flash of dashboard)
  const style = document.createElement('style');
  style.id = 'auth-guard-hide';
  style.textContent = 'body{visibility:hidden!important}';
  document.head.appendChild(style);

  // Add a small loading indicator
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

  // Check auth state
  firebase.auth().onAuthStateChanged(user => {
    if (!user) {
      // Not logged in → go to login page
      window.location.replace('login.html');
      return;
    }

    // Logged in — expose user info globally
    window.currentUser = user;

    // Reveal page
    const hideStyle = document.getElementById('auth-guard-hide');
    if (hideStyle) hideStyle.remove();
    const loader = document.getElementById('auth-loader');
    if (loader) loader.remove();

    // Inject "Sign Out" into sidebar footer once core.js renders it
    setTimeout(() => {
      const footer = document.querySelector('.sb-footer');
      if (footer && !footer.querySelector('.sb-user')) {
        const userBox = document.createElement('div');
        userBox.className = 'sb-user';
        userBox.style.cssText = 'padding:8px 10px;font-size:11px;color:var(--text-3);border-top:1px solid var(--border);margin-top:8px;display:flex;align-items:center;justify-content:space-between;gap:8px';
        userBox.innerHTML = `
          <div style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1" title="${user.email}">
            <div style="font-weight:600;color:var(--text-2)">Signed in</div>
            <div style="font-size:10px">${user.email}</div>
          </div>
          <button onclick="signOut()" style="background:none;border:1px solid var(--border);color:var(--text-3);padding:4px 8px;border-radius:4px;cursor:pointer;font-size:11px;font-family:inherit">Sign out</button>
        `;
        footer.appendChild(userBox);
      }
    }, 100);
  });

  // Global sign-out function
  window.signOut = function() {
    firebase.auth().signOut().then(() => {
      window.location.replace('login.html');
    });
  };
})();
