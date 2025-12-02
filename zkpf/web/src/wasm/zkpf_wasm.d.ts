/* tslint:disable */
/* eslint-disable */

export class OrchardWasmArtifactsWasm {
  free(): void;
  [Symbol.dispose](): void;
  constructor(params_bytes: Uint8Array, vk_bytes: Uint8Array, pk_bytes: Uint8Array);
}

export class ParamsWasm {
  free(): void;
  [Symbol.dispose](): void;
  constructor(bytes: Uint8Array);
  toBytes(): Uint8Array;
}

export class ProvingKeyWasm {
  free(): void;
  [Symbol.dispose](): void;
  constructor(bytes: Uint8Array);
  toBytes(): Uint8Array;
}

export class PublicInputsWasm {
  free(): void;
  [Symbol.dispose](): void;
  constructor(threshold_raw: bigint, required_currency_code: number, current_epoch: bigint, verifier_scope_id: bigint, policy_id: bigint, nullifier: Uint8Array, custodian_pubkey_hash: Uint8Array);
  static fromJson(json: string): PublicInputsWasm;
  static fromBytes(bytes: Uint8Array): PublicInputsWasm;
  toJson(): string;
  toBytes(): Uint8Array;
  nullifierBytes(): Uint8Array;
  custodianPubkeyHashBytes(): Uint8Array;
  readonly threshold_raw: bigint;
  readonly required_currency_code: number;
  readonly current_epoch: bigint;
  readonly verifier_scope_id: bigint;
  readonly policy_id: bigint;
}

export class VerifyingKeyWasm {
  free(): void;
  [Symbol.dispose](): void;
  constructor(bytes: Uint8Array);
  toBytes(): Uint8Array;
}

export function computeAttestationMessageHash(attestation_json: string): Uint8Array;

export function computeCustodianPubkeyHash(pubkey_x: Uint8Array, pubkey_y: Uint8Array): Uint8Array;

export function computeNullifier(account_id_hash_bytes: Uint8Array, verifier_scope_id: bigint, policy_id: bigint, current_epoch: bigint): Uint8Array;

export function generateOrchardProofBundle(snapshot_json: string, fvk_encoded: string, holder_id: string, threshold_zats: bigint, orchard_meta_json: string, public_meta_json: string): any;

export function generateProofBundle(attestation_json: string, params_bytes: Uint8Array, pk_bytes: Uint8Array): any;

export function generateProofBundleCached(attestation_json: string): any;

export function generateProofBundleWithCache(attestation_json: string, params: ParamsWasm, pk: ProvingKeyWasm): any;

export function generateProofCached(attestation_json: string): Uint8Array;

export function generateProofWithCache(attestation_json: string, params: ParamsWasm, pk: ProvingKeyWasm): Uint8Array;

export function generate_proof(attestation_json: string, params_bytes: Uint8Array, pk_bytes: Uint8Array): Uint8Array;

export function hasOrchardArtifacts(): boolean;

export function initOrchardProverArtifacts(params_bytes: Uint8Array, vk_bytes: Uint8Array, pk_bytes: Uint8Array): void;

export function initProverArtifacts(params_bytes: Uint8Array, pk_bytes: Uint8Array): void;

export function initVerifierArtifacts(params_bytes: Uint8Array, vk_bytes: Uint8Array): void;

export function resetCachedArtifacts(): void;

export function verifyProofBundle(bundle: any, vk_bytes: Uint8Array, params_bytes: Uint8Array): boolean;

export function verifyProofBundleCached(bundle: any): boolean;

export function verifyProofBundleWithCache(bundle: any, vk: VerifyingKeyWasm, params: ParamsWasm): boolean;

export function verifyProofBytes(proof_bytes: Uint8Array, public_inputs_bytes: Uint8Array, vk_bytes: Uint8Array, params_bytes: Uint8Array): boolean;

export function verifyProofCachedBytes(proof_bytes: Uint8Array, public_inputs_bytes: Uint8Array): boolean;

export function verifyProofCachedJson(proof_bytes: Uint8Array, public_inputs_json: string): boolean;

export function verifyProofWithCache(proof_bytes: Uint8Array, public_inputs: PublicInputsWasm, vk: VerifyingKeyWasm, params: ParamsWasm): boolean;

export function verifyProofWithCacheBytes(proof_bytes: Uint8Array, public_inputs_bytes: Uint8Array, vk: VerifyingKeyWasm, params: ParamsWasm): boolean;

export function verify_proof(proof_bytes: Uint8Array, public_inputs_json: string, vk_bytes: Uint8Array, params_bytes: Uint8Array): boolean;

export function wasm_start(): void;
