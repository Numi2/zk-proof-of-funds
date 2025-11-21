const { MOCK_BUNDLE } = require('./mock-data');
const { handleCors, readJsonBody, sendJson } = require('./helpers');

module.exports = async function handler(req, res) {
  if (handleCors(req, res)) {
    return;
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  try {
    const payload = await readJsonBody(req);
    if (!payload) {
      return sendJson(res, 400, { error: 'Invalid JSON body' });
    }
  } catch (err) {
    return sendJson(res, 400, { error: `Invalid JSON body: ${err.message}` });
  }

  return sendJson(res, 200, MOCK_BUNDLE);
};

