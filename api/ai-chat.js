// Proxy endpoint for Claude API (browser can't call Anthropic directly due to CORS)
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-claude-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const claudeKey = req.headers['x-claude-key'] || req.body?.claude_key;
  if (!claudeKey) return res.status(400).json({ error: 'Claude API key required' });

  const { messages, model = 'claude-haiku-4-5-20251001', max_tokens = 800 } = req.body || {};
  if (!messages) return res.status(400).json({ error: 'messages required' });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': claudeKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json'
      },
      body: JSON.stringify({ model, max_tokens, messages })
    });
    const data = await r.json();
    return res.status(r.status).json(data);
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
};
