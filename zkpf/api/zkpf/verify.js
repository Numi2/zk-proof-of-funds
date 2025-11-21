const { MOCK_POLICIES, makeVerifySuccess, makeVerifyFailure } = require('./mock-data');
const { sendJson, readJsonBody } = require('./helpers');

module.exports = async function handler(req, res) {
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

  if (!payload || typeof payload.policy_id !== 'number') {
    return sendJson(res, 400, { error: 'Expected numeric policy_id' });
  }

  const found = MOCK_POLICIES.some((policy) => policy.policy_id === payload.policy_id);
  if (!found) {
    return sendJson(res, 200, makeVerifyFailure(`policy_id ${payload.policy_id} not allowed`));
  }

  const simulateError = typeof payload.simulate_error === 'string';
  if (simulateError) {
    return sendJson(
      res,
      200,
      makeVerifyFailure('Simulated failure via request payload', 'SIMULATED_FAILURE'),
    );
  }

  return sendJson(res, 200, makeVerifySuccess());
};

