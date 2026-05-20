/* ═══════════════════════════════════════════════════════════════
   CNC Electric — AI Assistant Chat Widget
   Draggable floating chat with full portal data access
   ═══════════════════════════════════════════════════════════════ */

(function() {
  const SUPABASE_URL = 'https://knvaaxywlfpomlatpiua.supabase.co/rest/v1';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtudmFheHl3bGZwb21sYXRwaXVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NzkzMjI4NSwiZXhwIjoyMDkzNTA4Mjg1fQ.vsCZIT5ER1DVBPvRGt8Ai-cYtUD0rosyxNEBi5T2NCo';

  // ── CSS ──────────────────────────────────────────────────────
  const css = `
  #cnc-ai-btn {
    position:fixed; bottom:24px; right:24px; width:52px; height:52px;
    border-radius:50%; background:linear-gradient(135deg,#DC2626,#7C3AED);
    color:white; border:none; cursor:pointer; font-size:22px;
    box-shadow:0 4px 20px rgba(220,38,38,.4); z-index:9998;
    display:flex; align-items:center; justify-content:center;
    transition:transform .2s; user-select:none;
  }
  #cnc-ai-btn:hover { transform:scale(1.1); }
  #cnc-ai-panel {
    position:fixed; bottom:86px; right:24px; width:380px; height:520px;
    background:#fff; border-radius:16px; box-shadow:0 10px 40px rgba(0,0,0,.2);
    z-index:9999; display:flex; flex-direction:column; overflow:hidden;
    border:1px solid #e5e7eb; display:none;
  }
  #cnc-ai-panel.open { display:flex; }
  .ai-header {
    padding:14px 16px; background:linear-gradient(135deg,#DC2626,#7C3AED);
    color:white; display:flex; align-items:center; justify-content:space-between;
    cursor:move; user-select:none;
  }
  .ai-header-left { display:flex; align-items:center; gap:10px; }
  .ai-logo { width:32px; height:32px; border-radius:8px; background:rgba(255,255,255,.2); display:flex; align-items:center; justify-content:center; font-size:16px; }
  .ai-title { font-weight:700; font-size:14px; }
  .ai-subtitle { font-size:10px; opacity:.8; }
  .ai-close { background:none; border:none; color:white; font-size:18px; cursor:pointer; padding:0; opacity:.8; }
  .ai-close:hover { opacity:1; }
  .ai-messages { flex:1; overflow-y:auto; padding:14px; display:flex; flex-direction:column; gap:10px; }
  .ai-msg { max-width:88%; padding:10px 13px; border-radius:12px; font-size:13px; line-height:1.5; }
  .ai-msg.bot { background:#f3f4f6; color:#111; align-self:flex-start; border-bottom-left-radius:3px; }
  .ai-msg.user { background:linear-gradient(135deg,#DC2626,#7C3AED); color:white; align-self:flex-end; border-bottom-right-radius:3px; }
  .ai-msg.thinking { background:#f3f4f6; color:#888; font-style:italic; align-self:flex-start; }
  .ai-chips { display:flex; flex-wrap:wrap; gap:6px; padding:0 14px 10px; }
  .ai-chip { padding:5px 12px; border-radius:999px; border:1px solid #e5e7eb; background:#fff; font-size:11px; cursor:pointer; color:#374151; }
  .ai-chip:hover { background:#f3f4f6; border-color:#d1d5db; }
  .ai-input-row { display:flex; gap:8px; padding:12px; border-top:1px solid #f0f0f0; }
  .ai-input { flex:1; border:1.5px solid #e5e7eb; border-radius:10px; padding:9px 12px; font-size:13px; font-family:inherit; outline:none; }
  .ai-input:focus { border-color:#DC2626; }
  .ai-send { background:linear-gradient(135deg,#DC2626,#7C3AED); color:white; border:none; border-radius:10px; padding:9px 14px; cursor:pointer; font-size:14px; }
  .ai-send:disabled { opacity:.5; cursor:not-allowed; }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ── HTML ─────────────────────────────────────────────────────
  const html = `
  <button id="cnc-ai-btn" title="AI Assistant">🤖</button>
  <div id="cnc-ai-panel">
    <div class="ai-header" id="ai-drag-handle">
      <div class="ai-header-left">
        <div class="ai-logo">✨</div>
        <div>
          <div class="ai-title">CNC AI Assistant</div>
          <div class="ai-subtitle">Portal data access — Claude powered</div>
        </div>
      </div>
      <button class="ai-close" id="ai-close-btn">✕</button>
    </div>
    <div class="ai-messages" id="ai-messages">
      <div class="ai-msg bot">Assalam o Alaikum! 👋<br>Main CNC Electric ka AI assistant hoon.<br><br>🇵🇰 <b>Roman Urdu</b> ya <b>English</b> mein kuch bhi poochein!<br>Clients, payments, ledgers, bank alerts — sab available hai.</div>
    </div>
    <div class="ai-chips" id="ai-chips">
      <span class="ai-chip" onclick="aiAsk('Total outstanding kitna hai?')">💰 Total outstanding</span>
      <span class="ai-chip" onclick="aiAsk('Top 5 overdue clients kaun hain?')">⚠️ Top overdue</span>
      <span class="ai-chip" onclick="aiAsk('Aaj ki bank payments kya hain?')">🏦 Bank alerts</span>
      <span class="ai-chip" onclick="aiAsk('Branch wise outstanding summary do')">📊 CNC summary</span>
    </div>
    <div class="ai-input-row">
      <input class="ai-input" id="ai-input" placeholder="Kuch bhi poochein..." onkeydown="if(event.key==='Enter')aiSend()"/>
      <button class="ai-send" id="ai-send-btn" onclick="aiSend()">➤</button>
    </div>
  </div>`;

  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  document.body.appendChild(wrapper);

  // ── Toggle ───────────────────────────────────────────────────
  const btn = document.getElementById('cnc-ai-btn');
  const panel = document.getElementById('cnc-ai-panel');
  btn.addEventListener('click', () => {
    panel.classList.toggle('open');
    if (panel.classList.contains('open')) {
      document.getElementById('ai-input').focus();
    }
  });
  document.getElementById('ai-close-btn').addEventListener('click', () => panel.classList.remove('open'));

  // ── Drag ─────────────────────────────────────────────────────
  let isDragging=false, startX=0, startY=0, startRight=0, startBottom=0;
  const handle = document.getElementById('ai-drag-handle');
  handle.addEventListener('mousedown', e => {
    isDragging=true;
    startX=e.clientX; startY=e.clientY;
    const rect=panel.getBoundingClientRect();
    startRight=window.innerWidth-rect.right;
    startBottom=window.innerHeight-rect.bottom;
    e.preventDefault();
  });
  document.addEventListener('mousemove', e => {
    if (!isDragging) return;
    const dx=startX-e.clientX, dy=startY-e.clientY;
    panel.style.right=(startRight+dx)+'px';
    panel.style.bottom=(startBottom+dy)+'px';
    panel.style.left='auto'; panel.style.top='auto';
    // Also move button
    btn.style.right=panel.style.right;
    btn.style.bottom=(parseInt(panel.style.bottom)-62)+'px';
  });
  document.addEventListener('mouseup', () => isDragging=false);

  // ── Supabase fetch ───────────────────────────────────────────
  async function sbGet(path) {
    const r = await fetch(SUPABASE_URL+path, { headers:{'apikey':SUPABASE_KEY,'Authorization':'Bearer '+SUPABASE_KEY} });
    return r.json();
  }

  // ── Gather context ────────────────────────────────────────────
  async function getPortalContext() {
    try {
      const [clients, bankAlerts, paygate] = await Promise.all([
        sbGet('/ledgers?select=name,outstanding_amount,outstanding_type,branch,salesperson&outstanding_amount=gt.0&order=outstanding_amount.desc&limit=50'),
        sbGet('/bank_alerts?select=amount,bank_name,match_status,created_at&order=created_at.desc&limit=20'),
        sbGet('/paygate_entries?select=customer,amount,status,entity,created_at&order=created_at.desc&limit=20'),
      ]);

      const totalOs = Array.isArray(clients) ? clients.reduce((s,c)=>{
        return s + ((c.outstanding_type==='Dr'?1:-1)*(c.outstanding_amount||0));
      },0) : 0;

      const branches = {};
      if (Array.isArray(clients)) clients.forEach(c=>{
        const b=c.branch||'Other';
        if(!branches[b])branches[b]=0;
        branches[b]+=(c.outstanding_type==='Dr'?1:-1)*(c.outstanding_amount||0);
      });

      const top10 = Array.isArray(clients) ? clients.slice(0,10).map(c=>
        `${c.name}: PKR ${(c.outstanding_amount||0).toLocaleString()} ${c.outstanding_type||'Dr'} [${c.branch||'—'}]`
      ).join('\n') : '';

      const todayAlerts = Array.isArray(bankAlerts) ? bankAlerts.filter(a=>{
        const d=new Date(a.created_at);
        const today=new Date();
        return d.toDateString()===today.toDateString();
      }) : [];

      return `Portal Data (live):
=== OUTSTANDING SUMMARY ===
Total Net Outstanding: PKR ${totalOs.toLocaleString()}
By Branch:
${Object.entries(branches).map(([b,t])=>`  ${b}: PKR ${Math.round(t).toLocaleString()}`).join('\n')}

=== TOP 10 CLIENTS ===
${top10}

=== TODAY'S BANK ALERTS (${todayAlerts.length}) ===
${todayAlerts.map(a=>`  PKR ${(a.amount||0).toLocaleString()} via ${a.bank_name||'—'} [${a.match_status}]`).join('\n')||'No alerts today'}

=== RECENT PAYGATE ENTRIES ===
${Array.isArray(paygate)?paygate.slice(0,5).map(p=>`  ${p.customer}: PKR ${(p.amount||0).toLocaleString()} [${p.status}]`).join('\n'):'N/A'}`;
    } catch(e) {
      return 'Portal data fetch error: ' + e.message;
    }
  }

  // ── Chat ─────────────────────────────────────────────────────
  const messages = [{ role:'user', content:`You are the AI assistant for CNC Electric Pakistan's internal ERP portal.

LANGUAGE: Reply in the SAME language as the question.
- English question → English reply
- Roman Urdu question → Roman Urdu reply (e.g. "Aapka outstanding 7.9 Cr hai")

YOU CAN ANSWER ABOUT:
- Clients: outstanding, overdue, blacklisted, branch-wise (CNC/Cognitive Solutions/CS Traders)
- Payments: bank alerts, PayGate entries, verified/unmatched
- Ledgers: transaction history, aging, statements
- Invoices: approvals, decisions, discount checks
- Sales Reps: performance, client assignments
- Bank Verification: alerts, risk analysis, fraud detection
- Reports: daily/monthly summaries
- Bot Settings: which features are on/off
- Any portal data

Use PKR for amounts. Show large amounts as Lakh/Crore. Be concise but helpful.` }];
  messages.push({ role:'assistant', content:'Assalam o Alaikum! Main CNC Electric ka AI assistant hoon. Kuch bhi poochein — English ya Roman Urdu mein!' });

  function addMsg(text, type) {
    const div = document.createElement('div');
    div.className = `ai-msg ${type}`;
    div.innerHTML = text.replace(/\n/g,'<br>').replace(/\*\*(.*?)\*\*/g,'<b>$1</b>');
    document.getElementById('ai-messages').appendChild(div);
    document.getElementById('ai-messages').scrollTop = 9999;
    return div;
  }

  window.aiAsk = function(q) {
    document.getElementById('ai-input').value = q;
    aiSend();
  };

  window.aiSend = async function() {
    const input = document.getElementById('ai-input');
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    document.getElementById('ai-send-btn').disabled = true;
    document.getElementById('ai-chips').style.display = 'none';

    addMsg(q, 'user');
    const thinkEl = addMsg('Soch raha hoon...', 'thinking');

    try {
      const context = await getPortalContext();
      const claudeKey = JSON.parse(localStorage.getItem('cnc_ai_settings')||'{}').claudeKey || '';

      if (!claudeKey) {
        thinkEl.remove();
        addMsg('⚠️ Claude API key set nahi hai. **AI Integration** settings mein add karo.', 'bot');
        document.getElementById('ai-send-btn').disabled = false;
        return;
      }

      messages.push({ role:'user', content:`Context:\n${context}\n\nQuestion: ${q}` });

      const r = await fetch('/api/ai-chat', {
        method:'POST',
        headers:{ 'content-type':'application/json', 'x-claude-key':claudeKey },
        body: JSON.stringify({ model:'claude-haiku-4-5-20251001', max_tokens:800, messages: messages.slice(-6) })
      });
      const data = await r.json();
      const reply = data.content?.[0]?.text || data.error || 'Koi jawab nahi mila.';
      messages.push({ role:'assistant', content:reply });

      thinkEl.remove();
      addMsg(reply, 'bot');
    } catch(e) {
      thinkEl.remove();
      addMsg('Error: ' + e.message, 'bot');
    }
    document.getElementById('ai-send-btn').disabled = false;
  };

})();
