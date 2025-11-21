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
  initProverArtifacts(artifacts.params, artifacts.pk);
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

