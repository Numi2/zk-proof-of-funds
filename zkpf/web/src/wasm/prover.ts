// The bundler target auto-initializes WASM when the module is imported
import {
  computeAttestationMessageHash,
  computeCustodianPubkeyHash,
  computeNullifier,
  generateProofBundleCached,
  initProverArtifacts,
  resetCachedArtifacts,
  initOrchardProverArtifacts,
  hasOrchardArtifacts,
  generateOrchardProofBundle,
} from './zkpf_wasm.js';
import type { ProofBundle, OrchardProofInput } from '../types/zkpf';
import { parseProofBundle } from '../utils/parse';

interface ProverArtifacts {
  params: Uint8Array;
  pk: Uint8Array;
  key: string;
}

interface OrchardProverArtifacts {
  params: Uint8Array;
  vk: Uint8Array;
  pk: Uint8Array;
  key: string;
}

let cachedArtifactsKey: string | null = null;
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

export async function prepareOrchardProverArtifacts(artifacts: OrchardProverArtifacts) {
  await ensureWasmLoaded();
  if (cachedOrchardArtifactsKey === artifacts.key) {
    return;
  }
  try {
    initOrchardProverArtifacts(artifacts.params, artifacts.vk, artifacts.pk);
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
        'Failed to initialize zkpf WASM Orchard prover artifacts.',
        'This usually means the params/verifying key/proving key bytes returned by the backend',
        'do not match the zkpf_wasm build or are corrupted.',
        `Underlying error: ${message}`,
      ].join(' '),
    );
  }
  cachedOrchardArtifactsKey = artifacts.key;
}

export async function generateOrchardBundle(input: OrchardProofInput): Promise<ProofBundle> {
  await ensureWasmLoaded();
  
  // Check if artifacts are initialized
  if (!hasOrchardArtifacts()) {
    throw new Error('Orchard prover artifacts not initialized. Call prepareOrchardProverArtifacts first.');
  }
  
  // Serialize inputs to JSON
  const snapshotJson = JSON.stringify({
    height: input.snapshot.height,
    anchor: input.snapshot.anchor,
    notes: input.snapshot.notes.map(note => ({
      value_zats: note.value_zats,
      commitment: note.commitment,
      merkle_path: {
        siblings: note.merkle_path.siblings,
        position: note.merkle_path.position,
      },
    })),
  });
  
  const orchardMetaJson = JSON.stringify({
    chain_id: input.orchard_meta.chain_id,
    pool_id: input.orchard_meta.pool_id,
    block_height: input.orchard_meta.block_height,
    anchor_orchard: input.orchard_meta.anchor_orchard,
    holder_binding: input.orchard_meta.holder_binding,
  });
  
  const publicMetaJson = JSON.stringify({
    policy_id: input.public_meta.policy_id,
    verifier_scope_id: input.public_meta.verifier_scope_id,
    current_epoch: input.public_meta.current_epoch,
    required_currency_code: input.public_meta.required_currency_code,
  });
  
  let raw;
  try {
    const thresholdZats = BigInt(input.threshold_zats);
    raw = generateOrchardProofBundle(
      snapshotJson,
      input.fvk_encoded,
      input.holder_id,
      thresholdZats,
      orchardMetaJson,
      publicMetaJson,
    );
  } catch (err) {
    const message =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'unknown error';
    
    if (message.includes('unreachable') || message.includes('Unreachable')) {
      throw new Error(
        [
          'WASM Orchard proof generation failed with an internal error.',
          'This can happen if: (1) the prover artifacts (params/vk/pk) are corrupted or truncated,',
          '(2) the Orchard snapshot data is invalid, or (3) the browser ran out of memory.',
          'Try refreshing the page to re-download artifacts. If the problem persists,',
          'check that your Orchard snapshot data is properly formatted.',
          `Technical details: ${message}`,
        ].join(' '),
      );
    }
    throw err;
  }
  
  const normalized = normalizeForJson(raw);
  return parseProofBundle(JSON.stringify(normalized));
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
