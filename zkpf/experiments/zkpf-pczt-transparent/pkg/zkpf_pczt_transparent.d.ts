/**
 * @zkpf/pczt-transparent
 *
 * PCZT (Partially Constructed Zcash Transaction) library for transparent-only
 * wallets that want to send to shielded (Orchard) recipients.
 *
 * Based on ZIP 374: https://zips.z.cash/zip-0374
 *
 * ## Quick Start
 *
 * ```typescript
 * import {
 *   proposeTransaction,
 *   proveTransaction,
 *   getSighash,
 *   appendSignature,
 *   finalizeAndExtract,
 *   WasmTransparentInput,
 *   WasmPayment,
 *   WasmPaymentRequest,
 *   WasmNetwork,
 * } from '@zkpf/pczt-transparent';
 *
 * // 1. Create inputs and payment request
 * const input = new WasmTransparentInput('txid...', 0, 100000n, '76a914...88ac');
 * const payment = new WasmPayment('u1...', 50000n);
 * const request = new WasmPaymentRequest([payment]);
 *
 * // 2. Propose transaction
 * const pczt = await proposeTransaction([input], request, WasmNetwork.Mainnet);
 *
 * // 3. Add Orchard proofs (MUST be done in WASM)
 * const provenPczt = await proveTransaction(pczt);
 *
 * // 4. Sign transparent inputs
 * const sighash = await getSighash(provenPczt, 0);
 * const signature = await myHardwareWallet.sign(sighash.hash());
 * const signedPczt = await appendSignature(provenPczt, 0, signature, publicKey);
 *
 * // 5. Finalize and broadcast
 * const tx = await finalizeAndExtract(signedPczt);
 * console.log('Transaction ID:', tx.txid);
 * ```
 */

/* tslint:disable */
/* eslint-disable */

// ═══════════════════════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Initialize the WASM module. Called automatically on first use.
 */
export function init(): void;

/**
 * Initialize the WASM module from a custom URL or ArrayBuffer.
 * Useful for custom bundler configurations or offline use.
 */
export function initSync(module: BufferSource): void;

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Zcash network type.
 */
export enum WasmNetwork {
  Mainnet = 0,
  Testnet = 1,
  Regtest = 2,
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSPARENT INPUT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A transparent UTXO input to be spent.
 *
 * Represents a TxIn (transaction input) along with the corresponding
 * PrevTxOut (previous transaction output being spent).
 *
 * @example
 * ```typescript
 * const input = new WasmTransparentInput(
 *   'abc123...',           // txid (32 bytes hex, big-endian)
 *   0,                     // vout (output index)
 *   100000n,               // value in zatoshis
 *   '76a914...88ac',       // scriptPubKey (P2PKH example)
 * );
 *
 * // Add derivation info for signing
 * const inputWithPath = input.with_derivation(
 *   "m/44'/133'/0'/0/0",   // BIP32 derivation path
 *   '03abc...',            // compressed public key (33 bytes hex)
 * );
 * ```
 */
export class WasmTransparentInput {
  /**
   * Create a new transparent input.
   *
   * @param txid - Transaction ID of the UTXO (32 bytes, big-endian hex)
   * @param vout - Output index within the transaction
   * @param value - Value of the UTXO in zatoshis
   * @param scriptPubkey - The scriptPubKey of the UTXO (hex encoded)
   */
  constructor(txid: string, vout: number, value: bigint, scriptPubkey: string);

  /**
   * Add BIP32 derivation path and public key for signing.
   *
   * @param path - BIP32 derivation path (e.g., "m/44'/133'/0'/0/0")
   * @param publicKey - Compressed public key (33 bytes hex)
   * @returns A new input with derivation info attached
   */
  with_derivation(path: string, publicKey: string): WasmTransparentInput;

  /** Get the UTXO value in zatoshis. */
  readonly value: bigint;

  /** Get the transaction ID. */
  readonly txid: string;

  /** Free the underlying memory. */
  free(): void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A single payment within a payment request.
 *
 * @example
 * ```typescript
 * // Payment without memo (transparent or shielded)
 * const payment = new WasmPayment('u1...', 50000n);
 *
 * // Payment with memo (shielded only, max 512 bytes)
 * const paymentWithMemo = WasmPayment.with_memo('u1...', 50000n, 'Thanks for coffee!');
 * ```
 */
export class WasmPayment {
  /**
   * Create a new payment without a memo.
   *
   * @param address - Recipient address (unified or transparent)
   * @param amount - Amount in zatoshis
   */
  constructor(address: string, amount: bigint);

  /**
   * Create a new payment with a memo.
   *
   * @param address - Recipient address (must be shielded-capable)
   * @param amount - Amount in zatoshis
   * @param memo - Memo text (max 512 bytes)
   */
  static with_memo(address: string, amount: bigint, memo: string): WasmPayment;

  /** Get the recipient address. */
  readonly address: string;

  /** Get the payment amount in zatoshis. */
  readonly amount: bigint;

  /** Free the underlying memory. */
  free(): void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAYMENT REQUEST
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A payment request containing one or more payments.
 *
 * @example
 * ```typescript
 * const payments = [
 *   new WasmPayment('u1recipient1...', 50000n),
 *   WasmPayment.with_memo('u1recipient2...', 30000n, 'Payment 2'),
 * ];
 * const request = new WasmPaymentRequest(payments);
 * console.log('Total:', request.total_amount()); // 80000n
 * ```
 */
export class WasmPaymentRequest {
  /**
   * Create a new payment request from a list of payments.
   *
   * @param payments - Array of payments to include
   */
  constructor(payments: WasmPayment[]);

  /**
   * Calculate the total amount of all payments.
   *
   * @returns Total in zatoshis
   */
  total_amount(): bigint;

  /** Free the underlying memory. */
  free(): void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PCZT (Partially Constructed Zcash Transaction)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A Partially Constructed Zcash Transaction.
 *
 * PCZTs allow separation of transaction construction, proving, signing,
 * and finalization - enabling hardware wallet support and multi-party workflows.
 *
 * @example
 * ```typescript
 * // Create PCZT
 * const pczt = await proposeTransaction(inputs, request, WasmNetwork.Mainnet);
 *
 * // Serialize for transport (e.g., to hardware wallet coordinator)
 * const bytes = pczt.serialize();
 *
 * // Parse from bytes
 * const restored = WasmPczt.parse(bytes);
 *
 * // Inspect PCZT
 * console.log('Transparent inputs:', pczt.transparent_input_count());
 * console.log('Has Orchard bundle:', pczt.has_orchard());
 * console.log('Debug info:', pczt.to_json());
 * ```
 */
export class WasmPczt {
  /**
   * Serialize the PCZT to bytes for transport or storage.
   *
   * @returns Serialized PCZT bytes
   */
  serialize(): Uint8Array;

  /**
   * Parse a PCZT from serialized bytes.
   *
   * @param bytes - Serialized PCZT
   * @returns Parsed PCZT
   * @throws If parsing fails
   */
  static parse(bytes: Uint8Array): WasmPczt;

  /**
   * Get a JSON representation of the PCZT for debugging.
   *
   * @returns Debug info object
   */
  to_json(): PcztDebugInfo;

  /** Get the number of transparent inputs. */
  transparent_input_count(): number;

  /** Get the number of transparent outputs. */
  transparent_output_count(): number;

  /** Check if the PCZT has an Orchard bundle. */
  has_orchard(): boolean;

  /** Get the number of Orchard actions. */
  orchard_action_count(): number;

  /** Free the underlying memory. */
  free(): void;
}

/**
 * Debug information about a PCZT.
 */
export interface PcztDebugInfo {
  transparent_inputs: number;
  transparent_outputs: number;
  orchard_actions: number;
  has_proofs: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIGHASH
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * A signature hash for a transparent input.
 *
 * This is the hash that needs to be signed by the spending key.
 * Implements ZIP 244 signature hashing.
 *
 * @example
 * ```typescript
 * const sighash = await getSighash(pczt, 0);
 *
 * // Get the 32-byte hash
 * const hashBytes = sighash.hash();
 *
 * // Get as hex string
 * const hashHex = sighash.to_hex();
 *
 * // Sign with your signing infrastructure
 * const signature = await myHardwareWallet.signHash(hashBytes);
 * ```
 */
export class WasmSigHash {
  /**
   * Get the 32-byte signature hash.
   *
   * @returns 32-byte Uint8Array
   */
  hash(): Uint8Array;

  /**
   * Get the sighash as a hex string.
   *
   * @returns 64-character hex string
   */
  to_hex(): string;

  /** Get the input index this sighash is for. */
  readonly input_index: number;

  /** Free the underlying memory. */
  free(): void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// TRANSACTION BYTES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Final transaction bytes ready for broadcast.
 *
 * @example
 * ```typescript
 * const tx = await finalizeAndExtract(signedPczt);
 *
 * // Get raw bytes for broadcast
 * const rawBytes = tx.bytes();
 *
 * // Get hex string for RPC
 * const hexTx = tx.to_hex();
 *
 * // Get transaction ID
 * console.log('Transaction ID:', tx.txid);
 *
 * // Broadcast via lightwalletd or full node
 * await sendRawTransaction(hexTx);
 * ```
 */
export class WasmTransactionBytes {
  /**
   * Get the raw transaction bytes.
   *
   * @returns Transaction bytes
   */
  bytes(): Uint8Array;

  /**
   * Get the transaction as a hex string.
   *
   * @returns Hex-encoded transaction
   */
  to_hex(): string;

  /** Get the transaction ID (txid). */
  readonly txid: string;

  /** Free the underlying memory. */
  free(): void;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Propose a transaction from transparent inputs to specified outputs.
 *
 * Implements the **Creator**, **Constructor**, and **IO Finalizer** roles
 * as defined in ZIP 374.
 *
 * @param inputs - Transparent UTXOs to spend
 * @param request - Payment request specifying outputs
 * @param network - Network (Mainnet, Testnet, or Regtest)
 * @param feePerByte - Optional custom fee rate (uses ZIP 317 default if not provided)
 * @returns PCZT ready for proving and signing
 * @throws If proposal fails (insufficient funds, invalid inputs, etc.)
 *
 * @example
 * ```typescript
 * const input = new WasmTransparentInput(txid, 0, 100000n, scriptPubKey);
 * const payment = new WasmPayment('u1...', 50000n);
 * const request = new WasmPaymentRequest([payment]);
 *
 * const pczt = await proposeTransaction([input], request, WasmNetwork.Mainnet);
 * ```
 */
export function proposeTransaction(
  inputs: WasmTransparentInput[],
  request: WasmPaymentRequest,
  network: WasmNetwork,
  feePerByte?: bigint,
): WasmPczt;

/**
 * Add Orchard proofs to the PCZT.
 *
 * Implements the **Prover** role as defined in ZIP 374.
 *
 * **IMPORTANT**: This function MUST be implemented using the Rust WASM module.
 * Proving cannot be feasibly implemented in JavaScript due to computational
 * requirements.
 *
 * @param pczt - PCZT that needs proofs added
 * @returns PCZT with Orchard proofs
 * @throws If proof generation fails
 *
 * @example
 * ```typescript
 * // Proving takes several seconds - consider running in a Web Worker
 * const provenPczt = await proveTransaction(pczt);
 *
 * console.log('Proofs added:', provenPczt.has_orchard());
 * ```
 */
export function proveTransaction(pczt: WasmPczt): WasmPczt;

/**
 * Get the signature hash for a transparent input.
 *
 * The caller signs this hash using their preferred signing infrastructure
 * (hardware wallet, HSM, software key) and applies the signature using
 * `appendSignature`.
 *
 * Implements ZIP 244 signature hashing.
 *
 * @param pczt - The PCZT containing transaction data
 * @param inputIndex - Index of the transparent input (0-based)
 * @returns Signature hash for the input
 * @throws If sighash cannot be computed
 *
 * @example
 * ```typescript
 * const sighash = await getSighash(pczt, 0);
 *
 * // Sign with Ledger
 * const signature = await ledger.signHash(sighash.hash(), derivationPath);
 *
 * // Or sign with software key
 * const signature = secp256k1.sign(sighash.hash(), privateKey);
 * ```
 */
export function getSighash(pczt: WasmPczt, inputIndex: number): WasmSigHash;

/**
 * Get all signature hashes for a PCZT at once.
 *
 * Convenience function that returns sighashes for all transparent inputs.
 *
 * @param pczt - The PCZT
 * @returns Array of signature hashes
 *
 * @example
 * ```typescript
 * const sighashes = await getAllSighashes(pczt);
 *
 * for (const sighash of sighashes) {
 *   console.log(`Input ${sighash.input_index}: ${sighash.to_hex()}`);
 * }
 * ```
 */
export function getAllSighashes(pczt: WasmPczt): WasmSigHash[];

/**
 * Append a signature to the PCZT for a transparent input.
 *
 * The signature is verified before being applied. Returns a new PCZT
 * with the signature included.
 *
 * @param pczt - The PCZT to add the signature to
 * @param inputIndex - Index of the transparent input (0-based)
 * @param signatureHex - DER-encoded signature (hex)
 * @param publicKeyHex - Compressed public key (33 bytes, hex)
 * @returns PCZT with signature applied
 * @throws If signature is invalid or verification fails
 *
 * @example
 * ```typescript
 * const signedPczt = await appendSignature(
 *   pczt,
 *   0,
 *   '3044022...', // DER signature
 *   '03abc...',   // Compressed public key
 * );
 * ```
 */
export function appendSignature(
  pczt: WasmPczt,
  inputIndex: number,
  signatureHex: string,
  publicKeyHex: string,
): WasmPczt;

/**
 * Verify a PCZT before signing.
 *
 * Call this if the PCZT came from an untrusted source to verify it
 * matches the expected payment request and change outputs.
 *
 * @param pczt - The PCZT to verify
 * @param request - Original payment request
 * @param expectedChange - Expected change outputs for verification
 * @throws If verification fails
 *
 * @example
 * ```typescript
 * // Before signing a PCZT from an external source
 * verifyBeforeSigning(pczt, originalRequest, { transparent: [], shielded_value: 0n });
 * ```
 */
export function verifyBeforeSigning(
  pczt: WasmPczt,
  request: WasmPaymentRequest,
  expectedChange: ExpectedChange,
): void;

/**
 * Combine multiple PCZTs of the same transaction.
 *
 * Used when signing or proving is done by separate processes and
 * the results need to be merged.
 *
 * @param pczts - Array of PCZTs to combine
 * @returns Combined PCZT
 * @throws If PCZTs cannot be combined (different transactions, etc.)
 *
 * @example
 * ```typescript
 * // Combine after parallel signing by multiple parties
 * const combined = combine([signedByAlice, signedByBob]);
 * ```
 */
export function combine(pczts: WasmPczt[]): WasmPczt;

/**
 * Finalize and extract the transaction.
 *
 * Implements the **Spend Finalizer** and **Transaction Extractor** roles.
 *
 * @param pczt - Fully signed and proven PCZT
 * @returns Final transaction bytes ready for broadcast
 * @throws If finalization fails (missing signatures, proofs, etc.)
 *
 * @example
 * ```typescript
 * const tx = await finalizeAndExtract(signedPczt);
 *
 * // Broadcast to network
 * const result = await lightwalletd.sendTransaction(tx.bytes());
 * console.log('Broadcast success, txid:', tx.txid);
 * ```
 */
export function finalizeAndExtract(pczt: WasmPczt): WasmTransactionBytes;

/**
 * Parse a PCZT from bytes.
 *
 * @param bytes - Serialized PCZT
 * @returns Parsed PCZT
 * @throws If parsing fails
 */
export function parsePczt(bytes: Uint8Array): WasmPczt;

/**
 * Serialize a PCZT to bytes.
 *
 * @param pczt - PCZT to serialize
 * @returns Serialized bytes
 */
export function serializePczt(pczt: WasmPczt): Uint8Array;

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Expected change outputs for verification.
 */
export interface ExpectedChange {
  /** Expected transparent change outputs */
  transparent: TransparentOutput[];
  /** Expected shielded change value (zatoshis) */
  shielded_value: bigint;
}

/**
 * Transparent output specification.
 */
export interface TransparentOutput {
  /** Value in zatoshis */
  value: bigint;
  /** scriptPubKey (hex) */
  script_pubkey: string;
  /** Optional address for verification */
  address?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HARDWARE WALLET INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * External signer interface for hardware wallet integration.
 *
 * Implement this interface to integrate with Ledger, Trezor, or other
 * hardware signing devices.
 *
 * @example
 * ```typescript
 * const ledgerSigner: ExternalSigner = {
 *   async sign(hash: Uint8Array, derivationPath: string): Promise<Uint8Array> {
 *     return await ledger.signHash(hash, derivationPath);
 *   },
 *   async getPublicKey(derivationPath: string): Promise<Uint8Array> {
 *     return await ledger.getPublicKey(derivationPath);
 *   },
 * };
 *
 * // Sign all inputs
 * const signedPczt = await signAllInputs(pczt, inputs, ledgerSigner);
 * ```
 */
export interface ExternalSigner {
  /**
   * Sign a hash using the key at the given derivation path.
   *
   * @param hash - 32-byte hash to sign
   * @param derivationPath - BIP32 path (e.g., "m/44'/133'/0'/0/0")
   * @returns DER-encoded signature
   */
  sign(hash: Uint8Array, derivationPath: string): Promise<Uint8Array>;

  /**
   * Get the public key at the given derivation path.
   *
   * @param derivationPath - BIP32 path
   * @returns Compressed public key (33 bytes)
   */
  getPublicKey(derivationPath: string): Promise<Uint8Array>;
}

/**
 * Sign all transparent inputs using an external signer.
 *
 * @param pczt - PCZT with proofs added
 * @param inputs - Original inputs with derivation paths
 * @param signer - External signer implementation
 * @returns Fully signed PCZT
 *
 * @example
 * ```typescript
 * const signedPczt = await signAllInputs(provenPczt, inputs, ledgerSigner);
 * const tx = await finalizeAndExtract(signedPczt);
 * ```
 */
export function signAllInputs(
  pczt: WasmPczt,
  inputs: WasmTransparentInput[],
  signer: ExternalSigner,
): Promise<WasmPczt>;

// ═══════════════════════════════════════════════════════════════════════════════
// WEB WORKER SUPPORT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Proving progress callback.
 */
export interface ProverProgress {
  /** Current phase */
  phase: 'loading_key' | 'preparing_witness' | 'proving' | 'verifying' | 'complete';
  /** Progress percentage (0-100) */
  progress: number;
  /** Estimated time remaining (milliseconds) */
  estimated_remaining_ms?: number;
}

/**
 * Run proving in a Web Worker.
 *
 * For non-blocking proof generation in web applications.
 *
 * @param pcztBytes - Serialized PCZT
 * @param onProgress - Progress callback
 * @returns Serialized proven PCZT
 *
 * @example
 * ```typescript
 * const pcztBytes = serializePczt(pczt);
 *
 * const provenBytes = await proveInWorker(pcztBytes, (progress) => {
 *   updateProgressBar(progress.progress);
 *   console.log(`${progress.phase}: ${progress.progress}%`);
 * });
 *
 * const provenPczt = parsePczt(provenBytes);
 * ```
 */
export function proveInWorker(
  pcztBytes: Uint8Array,
  onProgress?: (progress: ProverProgress) => void,
): Promise<Uint8Array>;

