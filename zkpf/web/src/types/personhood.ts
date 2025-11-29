/**
 * Wallet-Bound Personhood Types
 * 
 * Type definitions for the personhood verification and wallet binding system.
 * NO PII (personally identifiable information) is ever handled or stored.
 */

// ============================================================================
// Brand Types (for type safety)
// ============================================================================

/** Personhood ID from ZKPassport (scope-specific unique identifier) */
export type PersonhoodId = string;

/** Wallet Binding ID (derived from UFVK/account_tag) */
export type WalletBindingId = string;

// ============================================================================
// Constants
// ============================================================================

/** ZKPassport scope for wallet binding */
export const WALLET_BINDING_SCOPE = 'zkpf-wallet-binding-v1';

/** ZKPassport verification timeout (5 minutes) */
export const ZKPASSPORT_TIMEOUT_MS = 5 * 60 * 1000;

/** Challenge validity window (10 minutes, must match backend) */
export const CHALLENGE_VALIDITY_MS = 10 * 60 * 1000;

/** Maximum wallets per personhood (must match backend) */
export const MAX_WALLETS_PER_PERSON = 3;

/** localStorage key for caching personhood status */
export const PERSONHOOD_CACHE_KEY = 'zkpf-personhood-cache';

// ============================================================================
// Challenge & Request Types
// ============================================================================

/**
 * Challenge for wallet binding.
 * 
 * This is signed by the wallet to prove control during personhood binding.
 * Field order is canonical - the backend must parse JSON with same order.
 */
export interface WalletBindingChallenge {
  /** Personhood ID from ZKPassport */
  personhood_id: PersonhoodId;
  /** Computed wallet binding ID */
  wallet_binding_id: WalletBindingId;
  /** Unix timestamp in milliseconds when challenge was created */
  issued_at: number;
  /** Protocol version (currently always 1) */
  version: 1;
}

/**
 * Request to bind a wallet to a personhood ID.
 */
export interface BindWalletRequest {
  /** The challenge object */
  challenge: WalletBindingChallenge;
  /** Canonical JSON string of the challenge (for signature verification) */
  challenge_json: string;
  /** Ed25519 signature over challenge_json (hex-encoded) */
  signature: string;
  /** Ed25519 public key (hex-encoded) */
  wallet_pubkey: string;
}

// ============================================================================
// Response Types
// ============================================================================

/**
 * Successful response from bind-wallet endpoint.
 */
export interface BindWalletResponse {
  status: 'ok';
  personhood_id: PersonhoodId;
  wallet_binding_id: WalletBindingId;
  active_bindings_count: number;
}

/**
 * Error response from bind-wallet endpoint.
 */
export interface BindWalletError {
  status: 'error';
  error_code: 
    | 'challenge_expired'
    | 'invalid_signature'
    | 'invalid_input'
    | 'too_many_wallet_bindings'
    | 'personhood_not_active'
    | 'internal_error';
  error: string;
}

/**
 * Response from status endpoint.
 */
export interface PersonhoodStatusResponse {
  /** Whether this wallet has verified personhood */
  personhood_verified: boolean;
  /** Personhood ID if verified, null otherwise */
  personhood_id: PersonhoodId | null;
  /** Number of wallets bound to this personhood, null if not verified */
  bindings_count_for_person: number | null;
}

// ============================================================================
// Flow State Types
// ============================================================================

/**
 * Current status of the personhood verification flow.
 */
export type PersonhoodFlowStatus =
  /** Initial state - not verified */
  | 'not_verified'
  /** Loading status from backend */
  | 'loading_status'
  /** Waiting for ZKPassport scan */
  | 'awaiting_passport'
  /** Passport verified, signing with wallet */
  | 'signing'
  /** Submitting to backend */
  | 'submitting'
  /** Successfully verified */
  | 'verified'
  /** Error occurred (see error property) */
  | 'error';

/**
 * Error types that can occur during the personhood flow.
 */
export type PersonhoodFlowError = 
  | { type: 'wallet_unavailable'; message: string }
  | { type: 'user_cancelled'; message: string }
  | { type: 'timeout'; message: string }
  | { type: 'sdk_error'; message: string }
  | { type: 'signing_failed'; message: string }
  | { type: 'network_error'; message: string }
  | { type: 'binding_failed'; message: string; code?: string };

/**
 * Result of a successful personhood verification.
 */
export interface PersonhoodVerificationResult {
  personhood_id: PersonhoodId;
  wallet_binding_id: WalletBindingId;
  active_bindings_count: number;
  verified_at: number;
}

/**
 * Full state for the usePersonhood hook.
 */
export interface PersonhoodState {
  /** Current flow status */
  status: PersonhoodFlowStatus;
  /** Wallet binding ID (computed from UFVK) */
  walletBindingId: WalletBindingId | null;
  /** Personhood ID (from ZKPassport, after verification) */
  personhoodId: PersonhoodId | null;
  /** Number of wallets bound to this personhood */
  bindingsCount: number | null;
  /** Current error, if any */
  error: PersonhoodFlowError | null;
  /** Verification result after successful binding */
  result: PersonhoodVerificationResult | null;
  /** ZKPassport URL for QR code display */
  zkPassportUrl: string | null;
}

// ============================================================================
// Wallet Interface
// ============================================================================

/**
 * Interface for the wallet core required for personhood binding.
 * 
 * This abstraction allows the personhood flow to work with different
 * wallet implementations.
 */
export interface WalletForBinding {
  /** Get the account tag or UFVK for wallet identification */
  getUfvkOrAccountTag(): Promise<string>;
  /** Sign a message and return hex-encoded signature */
  signMessage(message: string): Promise<string>;
  /** Get the hex-encoded public key */
  getPublicKey(): Promise<string>;
}
