/* tslint:disable */
/* eslint-disable */
export function initVerifierArtifacts(params_bytes: Uint8Array, vk_bytes: Uint8Array): void;
export function initProverArtifacts(params_bytes: Uint8Array, pk_bytes: Uint8Array): void;
export function resetCachedArtifacts(): void;
export function generate_proof(attestation_json: string, params_bytes: Uint8Array, pk_bytes: Uint8Array): Uint8Array;
export function generateProofWithCache(attestation_json: string, params: ParamsWasm, pk: ProvingKeyWasm): Uint8Array;
export function generateProofBundle(attestation_json: string, params_bytes: Uint8Array, pk_bytes: Uint8Array): any;
export function generateProofBundleWithCache(attestation_json: string, params: ParamsWasm, pk: ProvingKeyWasm): any;
export function generateProofCached(attestation_json: string): Uint8Array;
export function generateProofBundleCached(attestation_json: string): any;
export function verify_proof(proof_bytes: Uint8Array, public_inputs_json: string, vk_bytes: Uint8Array, params_bytes: Uint8Array): boolean;
export function verifyProofWithCache(proof_bytes: Uint8Array, public_inputs: PublicInputsWasm, vk: VerifyingKeyWasm, params: ParamsWasm): boolean;
export function verifyProofBytes(proof_bytes: Uint8Array, public_inputs_bytes: Uint8Array, vk_bytes: Uint8Array, params_bytes: Uint8Array): boolean;
export function verifyProofWithCacheBytes(proof_bytes: Uint8Array, public_inputs_bytes: Uint8Array, vk: VerifyingKeyWasm, params: ParamsWasm): boolean;
export function verifyProofBundle(bundle: any, vk_bytes: Uint8Array, params_bytes: Uint8Array): boolean;
export function verifyProofBundleWithCache(bundle: any, vk: VerifyingKeyWasm, params: ParamsWasm): boolean;
export function verifyProofCachedJson(proof_bytes: Uint8Array, public_inputs_json: string): boolean;
export function verifyProofCachedBytes(proof_bytes: Uint8Array, public_inputs_bytes: Uint8Array): boolean;
export function verifyProofBundleCached(bundle: any): boolean;
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
  constructor(threshold_raw: bigint, required_currency_code: number, required_custodian_id: number, current_epoch: bigint, verifier_scope_id: bigint, policy_id: bigint, nullifier: Uint8Array, custodian_pubkey_hash: Uint8Array);
  static fromJson(json: string): PublicInputsWasm;
  static fromBytes(bytes: Uint8Array): PublicInputsWasm;
  toJson(): string;
  toBytes(): Uint8Array;
  nullifierBytes(): Uint8Array;
  custodianPubkeyHashBytes(): Uint8Array;
  readonly threshold_raw: bigint;
  readonly required_currency_code: number;
  readonly required_custodian_id: number;
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

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
  readonly memory: WebAssembly.Memory;
  readonly __wbg_verifyingkeywasm_free: (a: number, b: number) => void;
  readonly __wbg_paramswasm_free: (a: number, b: number) => void;
  readonly __wbg_provingkeywasm_free: (a: number, b: number) => void;
  readonly __wbg_publicinputswasm_free: (a: number, b: number) => void;
  readonly verifyingkeywasm_new: (a: number, b: number) => [number, number, number];
  readonly verifyingkeywasm_toBytes: (a: number) => [number, number];
  readonly paramswasm_new: (a: number, b: number) => [number, number, number];
  readonly paramswasm_toBytes: (a: number) => [number, number];
  readonly provingkeywasm_new: (a: number, b: number) => [number, number, number];
  readonly provingkeywasm_toBytes: (a: number) => [number, number];
  readonly publicinputswasm_new: (a: bigint, b: number, c: number, d: bigint, e: bigint, f: bigint, g: number, h: number, i: number, j: number) => [number, number, number];
  readonly publicinputswasm_fromJson: (a: number, b: number) => [number, number, number];
  readonly publicinputswasm_fromBytes: (a: number, b: number) => [number, number, number];
  readonly publicinputswasm_toJson: (a: number) => [number, number, number, number];
  readonly publicinputswasm_toBytes: (a: number) => [number, number, number, number];
  readonly publicinputswasm_threshold_raw: (a: number) => bigint;
  readonly publicinputswasm_required_currency_code: (a: number) => number;
  readonly publicinputswasm_required_custodian_id: (a: number) => number;
  readonly publicinputswasm_current_epoch: (a: number) => bigint;
  readonly publicinputswasm_verifier_scope_id: (a: number) => bigint;
  readonly publicinputswasm_policy_id: (a: number) => bigint;
  readonly publicinputswasm_nullifierBytes: (a: number) => [number, number];
  readonly publicinputswasm_custodianPubkeyHashBytes: (a: number) => [number, number];
  readonly initVerifierArtifacts: (a: number, b: number, c: number, d: number) => [number, number];
  readonly initProverArtifacts: (a: number, b: number, c: number, d: number) => [number, number];
  readonly resetCachedArtifacts: () => void;
  readonly generate_proof: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
  readonly generateProofWithCache: (a: number, b: number, c: number, d: number) => [number, number, number, number];
  readonly generateProofBundle: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly generateProofBundleWithCache: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly generateProofCached: (a: number, b: number) => [number, number, number, number];
  readonly generateProofBundleCached: (a: number, b: number) => [number, number, number];
  readonly verify_proof: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
  readonly verifyProofWithCache: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly verifyProofBytes: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
  readonly verifyProofWithCacheBytes: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
  readonly verifyProofBundle: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
  readonly verifyProofBundleWithCache: (a: any, b: number, c: number) => [number, number, number];
  readonly verifyProofCachedJson: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly verifyProofCachedBytes: (a: number, b: number, c: number, d: number) => [number, number, number];
  readonly verifyProofBundleCached: (a: any) => [number, number, number];
  readonly __wbindgen_malloc: (a: number, b: number) => number;
  readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
  readonly __wbindgen_exn_store: (a: number) => void;
  readonly __externref_table_alloc: () => number;
  readonly __wbindgen_externrefs: WebAssembly.Table;
  readonly __externref_table_dealloc: (a: number) => void;
  readonly __wbindgen_free: (a: number, b: number, c: number) => void;
  readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;
/**
* Instantiates the given `module`, which can either be bytes or
* a precompiled `WebAssembly.Module`.
*
* @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
*
* @returns {InitOutput}
*/
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
* If `module_or_path` is {RequestInfo} or {URL}, makes a request and
* for everything else, calls `WebAssembly.instantiate` directly.
*
* @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
*
* @returns {Promise<InitOutput>}
*/
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
