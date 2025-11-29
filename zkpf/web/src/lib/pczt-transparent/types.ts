/**
 * Core types for the PCZT transparent-to-shielded library.
 */

/**
 * Network type for Zcash transactions.
 */
export const Network = {
  /** Zcash mainnet */
  Mainnet: 'mainnet',
  /** Zcash testnet */
  Testnet: 'testnet',
  /** Zcash regtest (for testing) */
  Regtest: 'regtest',
} as const;
export type Network = typeof Network[keyof typeof Network];

/**
 * A transparent UTXO input to be spent.
 *
 * This represents a TxIn (transaction input) along with the corresponding
 * PrevTxOut (previous transaction output being spent).
 */
export interface TransparentInput {
  /** The transaction ID of the UTXO being spent (32 bytes, big-endian hex) */
  txid: string;
  /** The output index within the transaction */
  vout: number;
  /** The value of the UTXO in zatoshis */
  value: bigint;
  /** The scriptPubKey of the UTXO (hex encoded) */
  scriptPubKey: string;
  /** Optional: The full previous transaction output script (for P2SH) */
  redeemScript?: string;
  /** BIP32 derivation path for the key that can spend this UTXO */
  derivationPath?: string;
  /** The compressed public key that can spend this UTXO (33 bytes, hex) */
  publicKey?: string;
}

/**
 * A transparent output for change or direct transparent sends.
 */
export interface TransparentOutput {
  /** The value in zatoshis */
  value: bigint;
  /** The scriptPubKey (hex encoded) */
  scriptPubKey: string;
  /** Optional: The destination address (for verification) */
  address?: string;
}

/**
 * The expected change outputs for verification.
 */
export interface ExpectedChange {
  /** Expected transparent change outputs */
  transparent: TransparentOutput[];
  /** Expected shielded change value (typically 0 for transparent-only senders) */
  shieldedValue: bigint;
}

/**
 * A single payment within a payment request.
 */
export interface Payment {
  /**
   * The recipient address.
   * Must be either:
   * - A unified address containing an Orchard receiver (starts with 'u1' or 'utest')
   * - A Zcash transparent address (starts with 't1' or 'tm')
   */
  address: string;
  /** The amount in zatoshis */
  amount: bigint;
  /** Optional memo (for shielded outputs only, max 512 bytes) */
  memo?: string;
  /** Optional label for the payment */
  label?: string;
  /** Optional message for the payment */
  message?: string;
}

/**
 * A ZIP 321 payment request.
 */
export interface PaymentRequest {
  /** The payments to make */
  payments: Payment[];
}

/**
 * The signature hash for a transparent input.
 */
export interface SigHash {
  /** The 32-byte sighash as Uint8Array */
  hash: Uint8Array;
  /** The input index this sighash is for */
  inputIndex: number;
  /** The sighash type used (typically SIGHASH_ALL = 0x01) */
  sighashType: number;
}

/**
 * A signature for a transparent input.
 */
export interface TransparentSignature {
  /** The DER-encoded signature (including sighash type byte) */
  signature: Uint8Array;
  /** The compressed public key (33 bytes) */
  publicKey: Uint8Array;
}

/**
 * The final transaction bytes ready for broadcast.
 */
export interface TransactionBytes {
  /** The raw transaction bytes */
  bytes: Uint8Array;
  /** The transaction ID */
  txid: string;
}

/**
 * Options for transaction proposal.
 */
export interface ProposeOptions {
  /** Fee rate in zatoshis per byte (optional, uses ZIP 317 default) */
  feePerByte?: bigint;
  /** Change address for transparent change (required if change expected) */
  changeAddress?: string;
  /** Lock time for the transaction */
  lockTime?: number;
  /** Expiry height for the transaction */
  expiryHeight?: number;
}

/**
 * Prover progress callback information.
 */
export interface ProverProgress {
  /** Current phase of proving */
  phase: 'loading' | 'preparing' | 'proving' | 'verifying' | 'complete';
  /** Progress percentage (0-100) */
  progress: number;
  /** Estimated time remaining in milliseconds */
  estimatedRemainingMs?: number;
}

/**
 * Error types that can occur during PCZT operations.
 */
export const PcztErrorType = {
  ProposalError: 'PROPOSAL_ERROR',
  ProverError: 'PROVER_ERROR',
  SignatureError: 'SIGNATURE_ERROR',
  SighashError: 'SIGHASH_ERROR',
  VerificationError: 'VERIFICATION_ERROR',
  CombineError: 'COMBINE_ERROR',
  FinalizationError: 'FINALIZATION_ERROR',
  ParseError: 'PARSE_ERROR',
  InvalidAddress: 'INVALID_ADDRESS',
  InsufficientFunds: 'INSUFFICIENT_FUNDS',
  NetworkError: 'NETWORK_ERROR',
} as const;
export type PcztErrorType = typeof PcztErrorType[keyof typeof PcztErrorType];

/**
 * Error thrown by PCZT operations.
 */
export class PcztError extends Error {
  public readonly type: PcztErrorType;
  public readonly details?: unknown;
  
  constructor(
    type: PcztErrorType,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.type = type;
    this.details = details;
    this.name = 'PcztError';
  }
}

/**
 * Helper to create a transparent input.
 */
export function createTransparentInput(
  txid: string,
  vout: number,
  value: bigint,
  scriptPubKey: string,
  derivationPath?: string,
  publicKey?: string
): TransparentInput {
  return {
    txid,
    vout,
    value,
    scriptPubKey,
    derivationPath,
    publicKey,
  };
}

/**
 * Helper to create a payment.
 */
export function createPayment(
  address: string,
  amount: bigint,
  memo?: string
): Payment {
  return {
    address,
    amount,
    memo,
  };
}

/**
 * Helper to create a payment request.
 */
export function createPaymentRequest(payments: Payment[]): PaymentRequest {
  return { payments };
}

/**
 * Convert zatoshis to ZEC for display.
 */
export function zatoshisToZec(zatoshis: bigint): number {
  return Number(zatoshis) / 100_000_000;
}

/**
 * Convert ZEC to zatoshis.
 */
export function zecToZatoshis(zec: number): bigint {
  return BigInt(Math.round(zec * 100_000_000));
}

/**
 * Check if an address is a transparent address.
 */
export function isTransparentAddress(address: string): boolean {
  return address.startsWith('t1') || address.startsWith('tm');
}

/**
 * Check if an address is a unified address with Orchard receiver.
 */
export function isOrchardAddress(address: string): boolean {
  return address.startsWith('u1') || address.startsWith('utest');
}

/**
 * Validate that an address is supported for this library.
 */
export function validateAddress(address: string): void {
  if (!isTransparentAddress(address) && !isOrchardAddress(address)) {
    throw new PcztError(
      PcztErrorType.InvalidAddress,
      `Address must be transparent (t1/tm) or unified with Orchard (u1/utest): ${address}`
    );
  }
}

