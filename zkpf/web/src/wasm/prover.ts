// The bundler target auto-initializes WASM when the module is imported
import {
  computeAttestationMessageHash,
  computeCustodianPubkeyHash,
  computeNullifier,
  generateProofBundleCached,
  generateOrchardProofBundleCached,
  initProverArtifacts,
  initOrchardProverArtifacts,
  resetCachedArtifacts,
} from './zkpf_wasm.js';
import type { ProofBundle } from '../types/zkpf';
import { parseProofBundle } from '../utils/parse';

export interface ProverArtifacts {
  params: Uint8Array;
  pk: Uint8Array;
  key: string;
}

/**
 * Orchard artifacts include break_points which are REQUIRED for proof generation.
 * 
 * Without break_points, the prover will panic with "break points not set".
 * Break points are computed during keygen and must be loaded from the
 * `break_points.json` artifact file.
 */
export interface OrchardProverArtifacts {
  params: Uint8Array;
  pk: Uint8Array;
  /** Break points from keygen - REQUIRED for proof generation */
  breakPoints: Uint8Array;
  key: string;
}

// Custodial (k=14) artifacts cache
let cachedArtifactsKey: string | null = null;

// Orchard (k=19) artifacts cache - separate from custodial
let cachedOrchardArtifactsKey: string | null = null;

// WASM is auto-initialized by the bundler, no async init needed
async function ensureWasmLoaded(): Promise<void> {
  // The wasm-pack bundler target auto-initializes when the module is imported.
  // This function exists for API compatibility but does nothing.
  return Promise.resolve();
}

export async function prepareProverArtifacts(artifacts: ProverArtifacts) {
  await ensureWasmLoaded();
  if (cachedArtifactsKey === artifacts.key) {
    return;
  }
  resetCachedArtifacts();
  try {
    initProverArtifacts(artifacts.params, artifacts.pk);
  } catch (err) {
    // Surface a more helpful error than the raw WebAssembly "unreachable" trap that
    // browsers report when deserialization inside `initProverArtifacts` fails.
    cachedArtifactsKey = null;
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'unknown WASM initialization error';
    throw new Error(
      [
        'Failed to initialize zkpf WASM prover artifacts.',
        'This usually means the params/proving key bytes returned by /zkpf/params',
        'do not match the zkpf_wasm build or are corrupted.',
        `Underlying error: ${message}`,
      ].join(' '),
    );
  }
  cachedArtifactsKey = artifacts.key;
}

export async function generateBundle(attestationJson: string): Promise<ProofBundle> {
  await ensureWasmLoaded();
  
  // Debug: Log the JSON being passed to WASM
  console.log('[ZKPF Debug] Attestation JSON length:', attestationJson.length);
  console.log('[ZKPF Debug] Attestation JSON (first 500 chars):', attestationJson.slice(0, 500));
  
  // Validate JSON is parseable before passing to WASM
  try {
    const parsed = JSON.parse(attestationJson);
    console.log('[ZKPF Debug] JSON parsed successfully. Keys:', Object.keys(parsed));
    if (parsed.attestation) {
      console.log('[ZKPF Debug] attestation keys:', Object.keys(parsed.attestation));
      console.log('[ZKPF Debug] account_id_hash:', parsed.attestation.account_id_hash);
      console.log('[ZKPF Debug] message_hash length:', parsed.attestation.message_hash?.length);
    }
    if (parsed.public) {
      console.log('[ZKPF Debug] public keys:', Object.keys(parsed.public));
      console.log('[ZKPF Debug] nullifier:', parsed.public.nullifier);
      console.log('[ZKPF Debug] custodian_pubkey_hash:', parsed.public.custodian_pubkey_hash);
    }
  } catch (parseErr) {
    console.error('[ZKPF Debug] JSON parse failed:', parseErr);
    throw new Error(`Invalid attestation JSON: ${parseErr instanceof Error ? parseErr.message : 'parse error'}`);
  }
  
  // Check if artifacts are initialized
  if (!cachedArtifactsKey) {
    console.error('[ZKPF Debug] Prover artifacts not initialized! Call prepareProverArtifacts first.');
    throw new Error('Prover artifacts not initialized. Call prepareProverArtifacts first.');
  }
  console.log('[ZKPF Debug] Prover artifacts key:', cachedArtifactsKey);
  
  let raw;
  try {
    console.log('[ZKPF Debug] Calling generateProofBundleCached...');
    raw = generateProofBundleCached(attestationJson);
    console.log('[ZKPF Debug] generateProofBundleCached returned successfully');
  } catch (err) {
    // Surface a more helpful error than the raw WebAssembly "unreachable" trap
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'unknown error';
    
    // Check for common WebAssembly errors
    if (message.includes('unreachable') || message.includes('Unreachable')) {
      throw new Error(
        [
          'WASM proof generation failed with an internal error.',
          'This can happen if: (1) the prover artifacts (params/pk) are corrupted or truncated,',
          '(2) the attestation JSON format is invalid, or (3) the browser ran out of memory.',
          'Try refreshing the page to re-download artifacts. If the problem persists,',
          'check that your attestation JSON is properly formatted.',
          `Technical details: ${message}`,
        ].join(' '),
      );
    }
    throw err;
  }
  const normalized = normalizeForJson(raw);
  return parseProofBundle(JSON.stringify(normalized));
}

export function resetProverArtifactsCache() {
  cachedArtifactsKey = null;
  cachedOrchardArtifactsKey = null;
  resetCachedArtifacts();
}

// === Orchard Prover Functions ===
// Separate from custodial prover - uses k=19 artifacts with V2_ORCHARD layout (10 public inputs)

/**
 * Initialize the Orchard prover with artifacts including break points.
 * 
 * @param artifacts - The Orchard prover artifacts containing params, pk, and break_points
 * 
 * IMPORTANT: The break_points are REQUIRED for proof generation. Without them, the prover
 * will panic with "break points not set". Break points are computed during keygen and must
 * be loaded from the `break_points.json` artifact file.
 */
export async function prepareOrchardProverArtifacts(artifacts: OrchardProverArtifacts) {
  await ensureWasmLoaded();
  if (cachedOrchardArtifactsKey === artifacts.key) {
    console.log('[ZKPF Orchard] Orchard artifacts already cached with key:', artifacts.key);
    return;
  }
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[ZKPF Orchard] Initializing Orchard prover artifacts');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[ZKPF Orchard] params size:', artifacts.params.length, 'bytes');
  console.log('[ZKPF Orchard] pk size:', artifacts.pk.length, 'bytes');
  console.log('[ZKPF Orchard] break_points size:', artifacts.breakPoints.length, 'bytes');
  console.log('[ZKPF Orchard] *** ARTIFACT_KEY=' + artifacts.key + ' ***');
  
  try {
    // Pass break_points to WASM - these are REQUIRED for proof generation
    initOrchardProverArtifacts(artifacts.params, artifacts.pk, artifacts.breakPoints);
  } catch (err) {
    cachedOrchardArtifactsKey = null;
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'unknown WASM initialization error';
    throw new Error(
      [
        'Failed to initialize Orchard WASM prover artifacts.',
        'This usually means the Orchard params/proving key/break_points (k=19) are corrupted or mismatched.',
        `Underlying error: ${message}`,
      ].join(' '),
    );
  }
  cachedOrchardArtifactsKey = artifacts.key;
  console.log('[ZKPF Orchard] ✓ Orchard prover artifacts initialized successfully');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
}

export interface OrchardPublicInputs {
  threshold_raw: number;
  required_currency_code: number;
  current_epoch: number;
  verifier_scope_id: number;
  policy_id: number;
  nullifier: number[];
  custodian_pubkey_hash: number[];
  snapshot_block_height: number;
  snapshot_anchor_orchard: number[];
  holder_binding: number[];
}

export async function generateOrchardBundle(
  publicInputs: OrchardPublicInputs,
  noteValues: number[],
): Promise<ProofBundle> {
  await ensureWasmLoaded();
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('[ZKPF Orchard] generateOrchardBundle called');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  // Log V2_ORCHARD public input fields
  console.log('[ZKPF Orchard] V2_ORCHARD Public Input Fields (10 columns):');
  console.log('[ZKPF Orchard]   col[0] threshold_raw:', publicInputs.threshold_raw);
  console.log('[ZKPF Orchard]   col[1] required_currency_code:', publicInputs.required_currency_code);
  console.log('[ZKPF Orchard]   col[2] current_epoch:', publicInputs.current_epoch);
  console.log('[ZKPF Orchard]   col[3] verifier_scope_id:', publicInputs.verifier_scope_id);
  console.log('[ZKPF Orchard]   col[4] policy_id:', publicInputs.policy_id);
  console.log('[ZKPF Orchard]   col[5] nullifier:', publicInputs.nullifier.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('') + '...');
  console.log('[ZKPF Orchard]   col[6] custodian_pubkey_hash:', publicInputs.custodian_pubkey_hash.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('') + '...');
  console.log('[ZKPF Orchard]   col[7] snapshot_block_height:', publicInputs.snapshot_block_height);
  console.log('[ZKPF Orchard]   col[8] snapshot_anchor_orchard:', publicInputs.snapshot_anchor_orchard.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('') + '...');
  console.log('[ZKPF Orchard]   col[9] holder_binding:', publicInputs.holder_binding.slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('') + '...');
  console.log('[ZKPF Orchard] note_values:', noteValues);
  
  // Check if Orchard artifacts are initialized
  if (!cachedOrchardArtifactsKey) {
    console.error('[ZKPF Orchard] ❌ Orchard prover artifacts not initialized! Call prepareOrchardProverArtifacts first.');
    throw new Error('Orchard prover artifacts not initialized. Call prepareOrchardProverArtifacts first.');
  }
  console.log('[ZKPF Orchard] *** Using ARTIFACT_KEY=' + cachedOrchardArtifactsKey + ' ***');
  
  const publicInputsJson = JSON.stringify(publicInputs);
  const noteValuesJson = JSON.stringify(noteValues);
  
  let raw;
  try {
    console.log('[ZKPF Orchard] Calling generateOrchardProofBundleCached...');
    raw = generateOrchardProofBundleCached(publicInputsJson, noteValuesJson);
    console.log('[ZKPF Orchard] ✓ generateOrchardProofBundleCached returned successfully');
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'unknown error';
    
    console.error('[ZKPF Orchard] ❌ Proof generation failed:', message);
    
    if (message.includes('unreachable') || message.includes('Unreachable')) {
      throw new Error(
        [
          'Orchard WASM proof generation failed with an internal error.',
          'This can happen if: (1) the Orchard prover artifacts (k=19) are corrupted,',
          '(2) the public inputs format is invalid, or (3) the browser ran out of memory.',
          `Technical details: ${message}`,
        ].join(' '),
      );
    }
    throw err;
  }
  
  const normalized = normalizeForJson(raw);
  const bundle = parseProofBundle(JSON.stringify(normalized));
  
  // Ensure rail_id is set to ZCASH_ORCHARD
  bundle.rail_id = 'ZCASH_ORCHARD';
  
  console.log('[ZKPF Orchard] ✓ Orchard proof bundle generated, proof length:', bundle.proof.length, 'bytes');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  
  return bundle;
}

export function isOrchardArtifactsInitialized(): boolean {
  return cachedOrchardArtifactsKey !== null;
}

export function getOrchardArtifactsKey(): string | null {
  return cachedOrchardArtifactsKey;
}

export async function wasmComputeAttestationMessageHash(attestationJson: string): Promise<Uint8Array> {
  await ensureWasmLoaded();
  return computeAttestationMessageHash(attestationJson);
}

export async function wasmComputeNullifier(
  accountIdHash: Uint8Array,
  verifierScopeId: bigint,
  policyId: bigint,
  currentEpoch: bigint,
): Promise<Uint8Array> {
  await ensureWasmLoaded();
  return computeNullifier(accountIdHash, verifierScopeId, policyId, currentEpoch);
}

export async function wasmComputeCustodianPubkeyHash(
  pubkeyX: Uint8Array,
  pubkeyY: Uint8Array,
): Promise<Uint8Array> {
  await ensureWasmLoaded();
  return computeCustodianPubkeyHash(pubkeyX, pubkeyY);
}

function normalizeForJson(value: unknown): unknown {
  if (value instanceof Uint8Array) {
    return Array.from(value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeForJson(item));
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, child]) => [
      key,
      normalizeForJson(child),
    ]);
    return Object.fromEntries(entries);
  }
  return value;
}

