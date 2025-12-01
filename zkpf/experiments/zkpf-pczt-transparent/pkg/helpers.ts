/**
 * Helper functions for @zkpf/pczt-transparent
 *
 * These provide higher-level APIs for common use cases:
 * - signAllInputs: Sign all transparent inputs with an external signer
 * - proveInWorker: Run proof generation in a Web Worker
 */

import type {
  WasmPczt,
  WasmTransparentInput,
  ExternalSigner,
  ProverProgress,
} from './zkpf_pczt_transparent';

import {
  getSighash,
  appendSignature,
  parsePczt,
  serializePczt,
  proveTransaction,
} from './zkpf_pczt_transparent';

// ═══════════════════════════════════════════════════════════════════════════════
// SIGN ALL INPUTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Input with derivation path for signing.
 */
interface InputWithPath {
  /** BIP32 derivation path */
  derivationPath: string;
}

/**
 * Sign all transparent inputs in a PCZT using an external signer.
 *
 * This is the main integration point for hardware wallets (Ledger, Trezor, etc.).
 *
 * @param pczt - PCZT with proofs already added
 * @param inputs - Array of inputs with their derivation paths
 * @param signer - External signer implementation (e.g., Ledger, Trezor)
 * @returns Fully signed PCZT
 *
 * @example
 * ```typescript
 * const ledgerSigner: ExternalSigner = {
 *   async sign(hash, path) {
 *     return await ledger.signHash(hash, path);
 *   },
 *   async getPublicKey(path) {
 *     return await ledger.getPublicKey(path);
 *   },
 * };
 *
 * const signedPczt = await signAllInputs(provenPczt, inputs, ledgerSigner);
 * const tx = await finalizeAndExtract(signedPczt);
 * ```
 */
export async function signAllInputs(
  pczt: WasmPczt,
  inputs: InputWithPath[],
  signer: ExternalSigner
): Promise<WasmPczt> {
  let signedPczt = pczt;

  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];

    if (!input.derivationPath) {
      throw new Error(`Input ${i} is missing derivationPath`);
    }

    // Get sighash for this input
    const sighash = getSighash(signedPczt, i);

    // Get public key from signer
    const publicKey = await signer.getPublicKey(input.derivationPath);

    // Sign the hash
    const signature = await signer.sign(sighash.hash(), input.derivationPath);

    // Convert to hex
    const signatureHex = arrayToHex(signature);
    const publicKeyHex = arrayToHex(publicKey);

    // Append signature
    signedPczt = appendSignature(signedPczt, i, signatureHex, publicKeyHex);
  }

  return signedPczt;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROVE IN WORKER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Web Worker script for proof generation.
 *
 * This is embedded as a blob URL to avoid separate file bundling.
 */
const WORKER_SCRIPT = `
  // Import the WASM module
  importScripts('zkpf_pczt_transparent.js');

  const { proveTransaction, parsePczt, serializePczt, init } = wasm_bindgen;

  let initialized = false;

  async function ensureInitialized() {
    if (!initialized) {
      await init();
      initialized = true;
    }
  }

  self.onmessage = async (event) => {
    const { type, pcztBytes, id } = event.data;

    if (type === 'prove') {
      try {
        await ensureInitialized();

        // Report loading
        self.postMessage({ type: 'progress', id, progress: { phase: 'loading_key', progress: 0 } });

        // Parse PCZT
        const pczt = parsePczt(new Uint8Array(pcztBytes));

        // Report proving
        self.postMessage({ type: 'progress', id, progress: { phase: 'proving', progress: 20 } });

        // Generate proofs
        const provenPczt = proveTransaction(pczt);

        // Report verifying
        self.postMessage({ type: 'progress', id, progress: { phase: 'verifying', progress: 90 } });

        // Serialize result
        const resultBytes = serializePczt(provenPczt);

        // Report complete
        self.postMessage({ type: 'progress', id, progress: { phase: 'complete', progress: 100 } });

        // Send result
        self.postMessage({ type: 'result', id, bytes: Array.from(resultBytes) });

      } catch (error) {
        self.postMessage({ type: 'error', id, error: error.message || String(error) });
      }
    }
  };
`;

/**
 * Run proof generation in a Web Worker.
 *
 * This prevents the main thread from blocking during the computationally
 * intensive proving process (which can take 30-60 seconds).
 *
 * @param pcztBytes - Serialized PCZT
 * @param onProgress - Optional progress callback
 * @returns Serialized proven PCZT
 *
 * @example
 * ```typescript
 * const pcztBytes = serializePczt(pczt);
 *
 * const provenBytes = await proveInWorker(pcztBytes, (progress) => {
 *   updateProgressBar(progress.progress);
 *   console.log(`Phase: ${progress.phase}, Progress: ${progress.progress}%`);
 * });
 *
 * const provenPczt = parsePczt(provenBytes);
 * ```
 */
export async function proveInWorker(
  pcztBytes: Uint8Array,
  onProgress?: (progress: ProverProgress) => void
): Promise<Uint8Array> {
  // Check for Web Worker support
  if (typeof Worker === 'undefined') {
    // Fallback to synchronous proving if Workers not available
    console.warn('Web Workers not available, falling back to main thread proving');
    const pczt = parsePczt(pcztBytes);
    const proven = proveTransaction(pczt);
    return serializePczt(proven);
  }

  return new Promise((resolve, reject) => {
    // Create worker from inline script
    const blob = new Blob([WORKER_SCRIPT], { type: 'application/javascript' });
    const workerUrl = URL.createObjectURL(blob);
    const worker = new Worker(workerUrl);

    const id = Math.random().toString(36).slice(2);

    worker.onmessage = (event) => {
      const { type, id: msgId, progress, bytes, error } = event.data;

      if (msgId !== id) return;

      switch (type) {
        case 'progress':
          onProgress?.(progress);
          break;

        case 'result':
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          resolve(new Uint8Array(bytes));
          break;

        case 'error':
          worker.terminate();
          URL.revokeObjectURL(workerUrl);
          reject(new Error(error));
          break;
      }
    };

    worker.onerror = (error) => {
      worker.terminate();
      URL.revokeObjectURL(workerUrl);
      reject(new Error(`Worker error: ${error.message}`));
    };

    // Start proving
    worker.postMessage({
      type: 'prove',
      id,
      pcztBytes: Array.from(pcztBytes),
    });
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert Uint8Array to hex string.
 */
function arrayToHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to Uint8Array.
 */
export function hexToArray(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error('Hex string must have even length');
  }
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

/**
 * Compute the P2PKH scriptPubKey for an address.
 *
 * @param address - Zcash transparent address (t1... or tm...)
 * @returns Hex-encoded scriptPubKey
 */
export function addressToScriptPubKey(address: string): string {
  // P2PKH: OP_DUP OP_HASH160 <20-byte hash> OP_EQUALVERIFY OP_CHECKSIG
  // Encoded: 76a914{hash}88ac

  // In production, this would properly decode the address
  // For now, we throw if called without proper implementation
  throw new Error(
    'addressToScriptPubKey requires proper address decoding. ' +
    'Use zcash_primitives or similar library to decode addresses.'
  );
}

/**
 * Estimate transaction fee using ZIP 317 rules.
 *
 * @param transparentInputs - Number of transparent inputs
 * @param transparentOutputs - Number of transparent outputs
 * @param orchardActions - Number of Orchard actions
 * @returns Estimated fee in zatoshis
 */
export function estimateFee(
  transparentInputs: number,
  transparentOutputs: number,
  orchardActions: number
): bigint {
  // ZIP 317 constants
  const BASE_FEE = BigInt(10000); // 0.0001 ZEC
  const MARGINAL_FEE = BigInt(5000); // 0.00005 ZEC
  const GRACE_ACTIONS = 2;

  // Logical actions = max of inputs and outputs
  const logicalActions = Math.max(
    transparentInputs,
    transparentOutputs + orchardActions * 2
  );

  // Fee = base + marginal * max(0, actions - grace)
  const extraActions = Math.max(0, logicalActions - GRACE_ACTIONS);
  return BASE_FEE + MARGINAL_FEE * BigInt(extraActions);
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES RE-EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

export type { ExternalSigner, ProverProgress } from './zkpf_pczt_transparent';

