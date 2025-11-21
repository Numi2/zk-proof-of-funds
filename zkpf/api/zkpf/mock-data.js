const MOCK_POLICY = {
  policy_id: 271828,
  verifier_scope_id: 31415,
  threshold_raw: 1_000_000,
  required_currency_code: 840,
  required_custodian_id: 42,
};

const MOCK_PUBLIC_INPUTS = {
  threshold_raw: MOCK_POLICY.threshold_raw,
  required_currency_code: MOCK_POLICY.required_currency_code,
  required_custodian_id: MOCK_POLICY.required_custodian_id,
  current_epoch: 1_700_000_000,
  verifier_scope_id: MOCK_POLICY.verifier_scope_id,
  policy_id: MOCK_POLICY.policy_id,
  nullifier: makeByteArray('mock-nullifier-seed', 32),
  custodian_pubkey_hash: makeByteArray('mock-custodian-hash', 32),
};

const MOCK_BUNDLE = {
  circuit_version: 3,
  proof: makeByteArray('mock-proof-payload', 48),
  public_inputs: MOCK_PUBLIC_INPUTS,
};

const MOCK_PARAMS_RESPONSE = {
  circuit_version: 3,
  manifest_version: 1,
  params_hash: 'mock-params-hash',
  vk_hash: 'mock-vk-hash',
  pk_hash: 'mock-pk-hash',
  params: makeByteArray('mock-params-bytes', 64),
  vk: makeByteArray('mock-vk-bytes', 48),
  pk: makeByteArray('mock-pk-bytes', 96),
};

const MOCK_EPOCH_RESPONSE = {
  current_epoch: MOCK_PUBLIC_INPUTS.current_epoch,
  max_drift_secs: 0,
};

const MOCK_POLICIES = [MOCK_POLICY];

function makeVerifySuccess() {
  return {
    valid: true,
    circuit_version: MOCK_BUNDLE.circuit_version,
    error: null,
    error_code: null,
  };
}

function makeVerifyFailure(message, code = 'POLICY_NOT_FOUND') {
  return {
    valid: false,
    circuit_version: MOCK_BUNDLE.circuit_version,
    error: message,
    error_code: code,
  };
}

function makeByteArray(seed, length) {
  const bytes = Array.from(Buffer.from(seed, 'utf8'));
  if (typeof length === 'number') {
    while (bytes.length < length) {
      bytes.push(bytes.length % 253);
    }
    return bytes.slice(0, length);
  }
  return bytes;
}

module.exports = {
  MOCK_POLICIES,
  MOCK_BUNDLE,
  MOCK_PARAMS_RESPONSE,
  MOCK_EPOCH_RESPONSE,
  makeVerifySuccess,
  makeVerifyFailure,
};

