const { MOCK_POLICIES } = require('./mock-data');
const { sendJson, readJsonBody, handleCors } = require('./helpers');

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

  if (!payload) {
    return sendJson(res, 400, { error: 'Request body is required' });
  }

  const { holder_id, snapshot_id, policy_id, bundle } = payload;

  if (typeof holder_id !== 'string' || !holder_id.trim()) {
    return sendJson(res, 400, { error: 'holder_id (non-empty string) is required' });
  }

  if (typeof snapshot_id !== 'string' || !snapshot_id.trim()) {
    return sendJson(res, 400, { error: 'snapshot_id (non-empty string) is required' });
  }

  if (typeof policy_id !== 'number') {
    return sendJson(res, 400, { error: 'Expected numeric policy_id' });
  }

  if (!bundle) {
    return sendJson(res, 400, { error: 'bundle payload is required' });
  }

  const found = MOCK_POLICIES.some((policy) => policy.policy_id === policy_id);

  if (!found) {
    return sendJson(res, 200, {
      valid: false,
      tx_hash: null,
      attestation_id: null,
      chain_id: null,
      holder_id,
      policy_id,
      snapshot_id,
      error: `policy_id ${policy_id} not allowed`,
      error_code: 'POLICY_NOT_FOUND',
    });
  }

  // Mock a successful attestation. This mirrors the shape of the Rust backend's
  // AttestResponse but does not actually submit anything on-chain.
  return sendJson(res, 200, {
    valid: true,
    tx_hash: '0xmock_tx_hash_deadbeef',
    attestation_id: 'mock-attestation-id',
    chain_id: 1337,
    holder_id,
    policy_id,
    snapshot_id,
    error: null,
    error_code: null,
  });
};


