export type ByteArray = number[];

export interface VerifierPublicInputs {
  threshold_raw: number;
  required_currency_code: number;
  required_custodian_id: number;
  current_epoch: number;
  verifier_scope_id: number;
  policy_id: number;
  nullifier: ByteArray;
  custodian_pubkey_hash: ByteArray;
  /**
   * Optional snapshot metadata for non-custodial rails (e.g. Zcash Orchard).
   * Legacy custodial bundles omit these fields.
   */
  snapshot_block_height?: number;
  snapshot_anchor_orchard?: ByteArray;
  holder_binding?: ByteArray;
}

export interface ProofBundle {
  /**
   * Logical rail identifier for this bundle. When omitted or empty, the
   * backend treats the bundle as belonging to the legacy custodial rail.
   */
  rail_id?: string;
  circuit_version: number;
  proof: ByteArray;
  public_inputs: VerifierPublicInputs;
}

export interface ParamsResponse {
  circuit_version: number;
  manifest_version: number;
  params_hash: string;
  vk_hash: string;
  pk_hash: string;
  params: ByteArray;
  vk: ByteArray;
  pk: ByteArray;
}

export interface EpochResponse {
  current_epoch: number;
  max_drift_secs: number;
}

export interface PolicyDefinition {
  policy_id: number;
  verifier_scope_id: number;
  threshold_raw: number;
  required_currency_code: number;
  required_custodian_id: number;
}

export interface PoliciesResponse {
  policies: PolicyDefinition[];
}

export interface VerifyResponse {
  valid: boolean;
  circuit_version: number;
  error: string | null;
  error_code: string | null;
}

export interface VerifyRequest {
  circuit_version: number;
  proof: ByteArray;
  public_inputs: ByteArray;
  policy_id: number;
}

