// Temporary debug endpoint
module.exports = async function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const info = {
    method: req.method,
    query: req.query,
    body: req.body,
    headers_content_type: req.headers['content-type'],
    time: new Date().toISOString()
  };
  console.log('DEBUG:', JSON.stringify(info));
  return res.status(200).json({ received: info });
};
