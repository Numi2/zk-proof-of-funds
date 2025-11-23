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
  // For large artifacts (especially pk), callers may expose these as either
  // plain number arrays or Uint8Array views to avoid excessive JS heap usage.
  // Frontend callers may choose to omit these heavy blobs and fetch them
  // directly from artifact URLs on demand.
  params?: ByteArray | Uint8Array;
  vk?: ByteArray | Uint8Array;
  pk?: ByteArray | Uint8Array;
  artifact_urls?: {
    params: string;
    vk: string;
    pk: string;
  };
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
  category?: string | null;
  rail_id?: string | null;
  label?: string | null;
  options?: Record<string, unknown> | null;
}

export interface PoliciesResponse {
  policies: PolicyDefinition[];
}

export type PolicyCategory = 'FIAT' | 'ONCHAIN' | 'ZCASH_ORCHARD' | 'ZASHI';

export type ProviderSessionStatus = 'PENDING' | 'PROVING' | 'READY' | 'INVALID' | 'EXPIRED';

export interface ProviderSessionPolicyView {
  policy_id: number;
  verifier_scope_id: number;
  threshold_raw: number;
  required_currency_code: number;
  required_custodian_id: number;
  rail_id: string;
  label?: string | null;
}

export interface ZashiSessionStartResponse {
  session_id: string;
  policy: ProviderSessionPolicyView;
  expires_at: number;
  deep_link: string;
}

export interface ProviderSessionSnapshot {
  session_id: string;
  status: ProviderSessionStatus;
  policy: ProviderSessionPolicyView;
  bundle?: ProofBundle | null;
  error?: string | null;
  expires_at: number;
  updated_at: number;
}

export interface PolicyComposeRequest {
  category: PolicyCategory;
  rail_id: string;
  label: string;
  options?: unknown;
  threshold_raw: number;
  required_currency_code: number;
  required_custodian_id: number;
  verifier_scope_id: number;
}

export interface PolicyComposeResponse {
  policy: unknown;
  summary: string;
  created: boolean;
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

export interface Secp256k1Pubkey {
  x: ByteArray;
  y: ByteArray;
}

export interface EcdsaSignature {
  r: ByteArray;
  s: ByteArray;
}

export interface AttestationWitness {
  balance_raw: number;
  currency_code_int: number;
  custodian_id: number;
  attestation_id: number;
  issued_at: number;
  valid_until: number;
  account_id_hash: string;
  custodian_pubkey: Secp256k1Pubkey;
  signature: EcdsaSignature;
  message_hash: ByteArray;
}

export interface CircuitPublicInputs {
  threshold_raw: number;
  required_currency_code: number;
  required_custodian_id: number;
  current_epoch: number;
  verifier_scope_id: number;
  policy_id: number;
  nullifier: string;
  custodian_pubkey_hash: string;
}

export interface CircuitInput {
  attestation: AttestationWitness;
  public: CircuitPublicInputs;
}

export interface AttestRequest {
  holder_id: string;
  snapshot_id: string;
  policy_id: number;
  bundle: ProofBundle;
}

export interface AttestResponse {
  valid: boolean;
  tx_hash: string | null;
  attestation_id: string | null;
  chain_id: number | null;
  holder_id: string;
  policy_id: number;
  snapshot_id: string;
  error: string | null;
  error_code: string | null;
}

