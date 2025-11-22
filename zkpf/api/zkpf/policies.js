const { sendJson, handleCors } = require('./helpers');

const BACKEND_BASE =
  process.env.ZKPF_BACKEND_URL || process.env.ZKPF_BACKEND || 'http://localhost:3000';

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) {
    return;
  }
  try {
    const response = await fetch(`${BACKEND_BASE}/zkpf/policies`);
    const payload = await response.json();
    sendJson(res, response.status, payload);
  } catch (err) {
    sendJson(res, 500, {
      error: `Failed to proxy /zkpf/policies to backend: ${err.message || 'unknown error'}`,
    });
  }
};

