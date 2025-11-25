const { handleCors, readJsonBody, sendJson } = require('./helpers');

const BACKEND_BASE =
  process.env.ZKPF_BACKEND_URL || process.env.ZKPF_BACKEND || 'http://localhost:3000';

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  let payload;
  try {
    payload = await readJsonBody(req);
  } catch (err) {
    return sendJson(res, 400, { error: `Invalid JSON body: ${err.message}` });
  }

  try {
    const response = await fetch(`${BACKEND_BASE}/zkpf/prove-bundle`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload ?? {}),
    });
    const body = await response.json();
    return sendJson(res, response.status, body);
  } catch (err) {
    return sendJson(res, 500, {
      error: `Failed to proxy /zkpf/prove-bundle to backend: ${err.message || 'unknown error'}`,
    });
  }
};


