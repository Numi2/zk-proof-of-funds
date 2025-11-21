import wasmInit, {
  generateProofBundleCached,
  initProverArtifacts,
  resetCachedArtifacts,
} from './zkpf_wasm.js';
import type { ProofBundle } from '../types/zkpf';
import { parseProofBundle } from '../utils/parse';

interface ProverArtifacts {
  params: Uint8Array;
  pk: Uint8Array;
  key: string;
}

let wasmReady: Promise<void> | null = null;
let cachedArtifactsKey: string | null = null;

async function ensureWasmLoaded() {
  if (!wasmReady) {
    wasmReady = wasmInit()
      .then(() => undefined)
      .catch((err) => {
        wasmReady = null;
        throw err;
      });
  }
  return wasmReady;
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
  const raw = generateProofBundleCached(attestationJson);
  const normalized = normalizeForJson(raw);
  return parseProofBundle(JSON.stringify(normalized));
}

export function resetProverArtifactsCache() {
  cachedArtifactsKey = null;
  resetCachedArtifacts();
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

