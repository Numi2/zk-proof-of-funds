/**
 * Core PCZT operations module.
 *
 * This module provides the main API for creating, proving, signing,
 * and finalizing PCZT transactions.
 */

import type {
  TransparentInput,
  PaymentRequest,
  SigHash,
  TransparentSignature,
  TransactionBytes,
  ExpectedChange,
  ProposeOptions,
  ProverProgress,
} from './types';
import { Network, PcztError, PcztErrorType, validateAddress } from './types';

// WASM module type (will be loaded dynamically)
interface WasmModule {
  WasmPczt: new () => WasmPczt;
  WasmTransparentInput: new (
    txid: string,
    vout: number,
    value: bigint,
    scriptPubKey: string
  ) => WasmTransparentInput;
  WasmPayment: new (address: string, amount: bigint) => WasmPayment;
  WasmPaymentRequest: new (payments: WasmPayment[]) => WasmPaymentRequest;
  propose_transaction: (
    inputs: WasmTransparentInput[],
    request: WasmPaymentRequest,
    network: number,
    feePerByte?: bigint
  ) => WasmPczt;
  prove_transaction: (pczt: WasmPczt) => WasmPczt;
  get_sighash: (pczt: WasmPczt, inputIndex: number) => WasmSigHash;
  append_signature: (
    pczt: WasmPczt,
    inputIndex: number,
    signatureHex: string,
    publicKeyHex: string
  ) => WasmPczt;
  verify_before_signing: (
    pczt: WasmPczt,
    request: WasmPaymentRequest,
    expectedChange: unknown
  ) => void;
  combine: (pczts: WasmPczt[]) => WasmPczt;
  finalize_and_extract: (pczt: WasmPczt) => WasmTransactionBytes;
  parse_pczt: (bytes: Uint8Array) => WasmPczt;
  serialize_pczt: (pczt: WasmPczt) => Uint8Array;
}

interface WasmPczt {
  serialize(): Uint8Array;
  to_json(): unknown;
  transparent_input_count(): number;
  transparent_output_count(): number;
  has_orchard(): boolean;
  orchard_action_count(): number;
}

interface WasmTransparentInput {
  value: bigint;
  txid: string;
  with_derivation(path: string, publicKey: string): WasmTransparentInput;
}

interface WasmPayment {
  address: string;
  amount: bigint;
}

interface WasmPaymentRequest {
  total_amount(): bigint;
}

interface WasmSigHash {
  hash(): Uint8Array;
  to_hex(): string;
  input_index: number;
}

interface WasmTransactionBytes {
  bytes(): Uint8Array;
  to_hex(): string;
  txid: string;
}

/**
 * Opaque PCZT type.
 *
 * This wraps the internal WASM PCZT and provides type safety.
 */
export class Pczt {
  private readonly inner: WasmPczt;
  
  /** @internal */
  constructor(inner: WasmPczt) {
    this.inner = inner;
  }

  /** Get the number of transparent inputs */
  get transparentInputCount(): number {
    return this.inner.transparent_input_count();
  }

  /** Get the number of transparent outputs */
  get transparentOutputCount(): number {
    return this.inner.transparent_output_count();
  }

  /** Check if the PCZT has an Orchard bundle */
  get hasOrchard(): boolean {
    return this.inner.has_orchard();
  }

  /** Get the number of Orchard actions */
  get orchardActionCount(): number {
    return this.inner.orchard_action_count();
  }

  /** Serialize the PCZT to bytes */
  serialize(): Uint8Array {
    return this.inner.serialize();
  }

  /** Get a JSON representation for debugging */
  toJSON(): unknown {
    return this.inner.to_json();
  }

  /** @internal Get the inner WASM object */
  _getInner(): WasmPczt {
    return this.inner;
  }
}

// WASM module singleton
let wasmModule: WasmModule | null = null;
let wasmLoadPromise: Promise<WasmModule> | null = null;

/**
 * Load the WASM module.
 *
 * This is called automatically by the API functions, but can be called
 * explicitly to preload the module.
 */
export async function loadWasm(): Promise<void> {
  await getWasmModule();
}

async function getWasmModule(): Promise<WasmModule> {
  if (wasmModule) {
    return wasmModule;
  }

  if (wasmLoadPromise) {
    return wasmLoadPromise;
  }

  wasmLoadPromise = (async () => {
    // WASM module not yet built - return mock for now
    // TODO: Build PCZT WASM module and update import path
    console.warn('[PCZT] WASM module not available, using mock implementation');
    throw new PcztError(
      PcztErrorType.NetworkError,
      'PCZT WASM module not yet built. Build with: cd zkpf-pczt-transparent && wasm-pack build'
    );
  })();

  return wasmLoadPromise;
}

function networkToWasm(network: Network): number {
  switch (network) {
    case Network.Mainnet:
      return 0;
    case Network.Testnet:
      return 1;
    case Network.Regtest:
      return 2;
  }
}

/**
 * Propose a transaction from transparent inputs to the specified outputs.
 *
 * This function implements the **Creator**, **Constructor**, and **IO Finalizer**
 * roles as defined in ZIP 374.
 *
 * @param inputs - The transparent UTXOs to spend as inputs
 * @param request - The payment request specifying the outputs
 * @param network - The network (mainnet, testnet, or regtest)
 * @param options - Optional configuration
 * @returns The partially constructed transaction ready for proving and signing
 *
 * @example
 * ```typescript
 * const inputs = [
 *   createTransparentInput(
 *     'abc123...',      // txid
 *     0,                // vout
 *     100000n,          // value in zatoshis
 *     '76a914...88ac',  // scriptPubKey
 *   ),
 * ];
 *
 * const request = createPaymentRequest([
 *   createPayment('u1...', 50000n), // Unified address with Orchard
 * ]);
 *
 * const pczt = await proposeTransaction(inputs, request, Network.Mainnet);
 * ```
 */
export async function proposeTransaction(
  inputs: TransparentInput[],
  request: PaymentRequest,
  network: Network,
  options?: ProposeOptions
): Promise<Pczt> {
  // Validate all addresses
  for (const payment of request.payments) {
    validateAddress(payment.address);
  }

  const wasm = await getWasmModule();

  // Convert inputs to WASM format
  const wasmInputs = inputs.map((input) => {
    let wasmInput = new wasm.WasmTransparentInput(
      input.txid,
      input.vout,
      input.value,
      input.scriptPubKey
    );

    if (input.derivationPath && input.publicKey) {
      wasmInput = wasmInput.with_derivation(input.derivationPath, input.publicKey);
    }

    return wasmInput;
  });

  // Convert payments to WASM format
  const wasmPayments = request.payments.map(
    (p) => new wasm.WasmPayment(p.address, p.amount)
  );
  const wasmRequest = new wasm.WasmPaymentRequest(wasmPayments);

  try {
    const wasmPczt = wasm.propose_transaction(
      wasmInputs,
      wasmRequest,
      networkToWasm(network),
      options?.feePerByte
    );

    return new Pczt(wasmPczt);
  } catch (error) {
    throw new PcztError(
      PcztErrorType.ProposalError,
      `Failed to propose transaction: ${error}`,
      error
    );
  }
}

/**
 * Add Orchard proofs to the PCZT.
 *
 * This function implements the **Prover** role as defined in ZIP 374.
 * The proving operation MUST be done in Rust/WASM as it requires
 * cryptographic operations that cannot be feasibly implemented in JavaScript.
 *
 * @param pczt - The PCZT that needs proofs added
 * @param onProgress - Optional callback for progress updates
 * @returns The PCZT with proofs added
 *
 * @remarks
 * Proof generation is computationally intensive and may take several seconds.
 * Consider running this in a Web Worker to avoid blocking the main thread.
 *
 * @example
 * ```typescript
 * const provenPczt = await proveTransaction(pczt, (progress) => {
 *   console.log(`Proving: ${progress.progress}%`);
 * });
 * ```
 */
export async function proveTransaction(
  pczt: Pczt,
  onProgress?: (progress: ProverProgress) => void
): Promise<Pczt> {
  const wasm = await getWasmModule();

  onProgress?.({
    phase: 'loading',
    progress: 0,
    estimatedRemainingMs: 5000,
  });

  try {
    onProgress?.({
      phase: 'proving',
      progress: 20,
      estimatedRemainingMs: 3000,
    });

    const provenPczt = wasm.prove_transaction(pczt._getInner());

    onProgress?.({
      phase: 'complete',
      progress: 100,
    });

    return new Pczt(provenPczt);
  } catch (error) {
    throw new PcztError(
      PcztErrorType.ProverError,
      `Failed to prove transaction: ${error}`,
      error
    );
  }
}

/**
 * Get the signature hash for a transparent input.
 *
 * This function computes the ZIP 244 signature hash for the specified
 * transparent input. The caller can then sign this hash using their
 * preferred signing infrastructure.
 *
 * @param pczt - The PCZT containing the transaction data
 * @param inputIndex - The index of the transparent input
 * @returns The sighash for signing
 *
 * @example
 * ```typescript
 * const sighash = await getSighash(pczt, 0);
 * const signature = await myHardwareWallet.sign(sighash.hash);
 * ```
 */
export async function getSighash(pczt: Pczt, inputIndex: number): Promise<SigHash> {
  const wasm = await getWasmModule();

  try {
    const wasmSighash = wasm.get_sighash(pczt._getInner(), inputIndex);

    return {
      hash: wasmSighash.hash(),
      inputIndex: wasmSighash.input_index,
      sighashType: 0x01, // SIGHASH_ALL
    };
  } catch (error) {
    throw new PcztError(
      PcztErrorType.SighashError,
      `Failed to get sighash for input ${inputIndex}: ${error}`,
      error
    );
  }
}

/**
 * Append a signature to the PCZT for a transparent input.
 *
 * @param pczt - The PCZT to add the signature to
 * @param inputIndex - The index of the transparent input
 * @param signature - The signature and public key
 * @returns The PCZT with the signature added
 *
 * @example
 * ```typescript
 * const signature = {
 *   signature: new Uint8Array([0x30, 0x44, ...]), // DER signature
 *   publicKey: new Uint8Array([0x03, ...]),       // Compressed pubkey
 * };
 *
 * const signedPczt = await appendSignature(pczt, 0, signature);
 * ```
 */
export async function appendSignature(
  pczt: Pczt,
  inputIndex: number,
  signature: TransparentSignature
): Promise<Pczt> {
  const wasm = await getWasmModule();

  const signatureHex = Array.from(signature.signature)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  const publicKeyHex = Array.from(signature.publicKey)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

  try {
    const signedPczt = wasm.append_signature(
      pczt._getInner(),
      inputIndex,
      signatureHex,
      publicKeyHex
    );

    return new Pczt(signedPczt);
  } catch (error) {
    throw new PcztError(
      PcztErrorType.SignatureError,
      `Failed to append signature for input ${inputIndex}: ${error}`,
      error
    );
  }
}

/**
 * Verify the PCZT contents before signing.
 *
 * This is important when the PCZT may have been modified by a third party.
 *
 * @param pczt - The PCZT to verify
 * @param request - The original payment request
 * @param expectedChange - The expected change outputs
 *
 * @example
 * ```typescript
 * await verifyBeforeSigning(pczt, originalRequest, {
 *   transparent: [{ value: 40000n, scriptPubKey: '...' }],
 *   shieldedValue: 0n,
 * });
 * ```
 */
export async function verifyBeforeSigning(
  pczt: Pczt,
  request: PaymentRequest,
  expectedChange: ExpectedChange
): Promise<void> {
  const wasm = await getWasmModule();

  const wasmPayments = request.payments.map(
    (p) => new wasm.WasmPayment(p.address, p.amount)
  );
  const wasmRequest = new wasm.WasmPaymentRequest(wasmPayments);

  try {
    wasm.verify_before_signing(pczt._getInner(), wasmRequest, expectedChange);
  } catch (error) {
    throw new PcztError(
      PcztErrorType.VerificationError,
      `PCZT verification failed: ${error}`,
      error
    );
  }
}

/**
 * Combine multiple PCZTs that represent the same transaction.
 *
 * @param pczts - Array of PCZTs to combine
 * @returns The combined PCZT
 */
export async function combine(pczts: Pczt[]): Promise<Pczt> {
  const wasm = await getWasmModule();

  try {
    const combinedPczt = wasm.combine(pczts.map((p) => p._getInner()));
    return new Pczt(combinedPczt);
  } catch (error) {
    throw new PcztError(
      PcztErrorType.CombineError,
      `Failed to combine PCZTs: ${error}`,
      error
    );
  }
}

/**
 * Finalize the PCZT and extract the transaction bytes.
 *
 * @param pczt - The fully signed and proven PCZT
 * @returns The raw transaction bytes and txid
 *
 * @example
 * ```typescript
 * const tx = await finalizeAndExtract(signedAndProvenPczt);
 * await broadcast(tx.bytes);
 * console.log('Transaction ID:', tx.txid);
 * ```
 */
export async function finalizeAndExtract(pczt: Pczt): Promise<TransactionBytes> {
  const wasm = await getWasmModule();

  try {
    const wasmTx = wasm.finalize_and_extract(pczt._getInner());

    return {
      bytes: wasmTx.bytes(),
      txid: wasmTx.txid,
    };
  } catch (error) {
    throw new PcztError(
      PcztErrorType.FinalizationError,
      `Failed to finalize transaction: ${error}`,
      error
    );
  }
}

/**
 * Parse a PCZT from its serialized byte representation.
 *
 * @param bytes - The serialized PCZT bytes
 * @returns The parsed PCZT
 */
export async function parsePczt(bytes: Uint8Array): Promise<Pczt> {
  const wasm = await getWasmModule();

  try {
    const wasmPczt = wasm.parse_pczt(bytes);
    return new Pczt(wasmPczt);
  } catch (error) {
    throw new PcztError(
      PcztErrorType.ParseError,
      `Failed to parse PCZT: ${error}`,
      error
    );
  }
}

/**
 * Serialize a PCZT to its byte representation.
 *
 * @param pczt - The PCZT to serialize
 * @returns The serialized bytes
 */
export function serializePczt(pczt: Pczt): Uint8Array {
  return pczt.serialize();
}

