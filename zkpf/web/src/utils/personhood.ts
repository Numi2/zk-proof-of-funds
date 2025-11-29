/**
 * Wallet-Bound Personhood Utilities
 * 
 * Production-grade utilities for:
 * - Computing wallet binding IDs from UFVK/account_tag
 * - Running the ZKPassport verification flow
 * - Completing the wallet binding process with REAL signatures
 * 
 * NO demo modes. NO mock signatures. All paths must work for real users.
 */

import { blake2b } from '@noble/hashes/blake2.js';
import { ed25519 } from '@noble/curves/ed25519';
import { ZKPassport } from '@zkpassport/sdk';
import type {
  PersonhoodId,
  WalletBindingId,
  WalletBindingChallenge,
  BindWalletRequest,
  BindWalletResponse,
  BindWalletError,
  PersonhoodStatusResponse,
  PersonhoodFlowError,
  PersonhoodVerificationResult,
} from '../types/personhood';
import {
  WALLET_BINDING_SCOPE,
  ZKPASSPORT_TIMEOUT_MS,
  PERSONHOOD_CACHE_KEY,
} from '../types/personhood';

// ============================================================================
// Wallet Binding ID Computation
// ============================================================================

/**
 * Compute the wallet binding ID from a UFVK or account tag.
 * 
 * This is a deterministic derivation that produces a stable identifier
 * for a wallet without exposing the viewing key.
 * 
 * Uses BLAKE2b-256 with domain separator as specified in the protocol.
 * 
 * @param ufvkOrAccountTag - The unified full viewing key or account tag
 * @returns A hex-encoded wallet binding ID (64 characters, 32 bytes)
 * 
 * @example
 * const bindingId = computeWalletBindingId("uview1abc123...");
 * // Returns: "a1b2c3d4..." (64 hex chars)
 */
export function computeWalletBindingId(ufvkOrAccountTag: string | Uint8Array): WalletBindingId {
  const data = typeof ufvkOrAccountTag === 'string' 
    ? ufvkOrAccountTag.trim() 
    : ufvkOrAccountTag;
  
  if ((typeof data === 'string' && data.length === 0) || 
      (data instanceof Uint8Array && data.length === 0)) {
    throw new Error('Cannot compute wallet binding ID: empty input');
  }

  const encoder = new TextEncoder();
  const domainSep = encoder.encode('zkpf-wallet-binding');
  const dataBytes = typeof data === 'string' ? encoder.encode(data) : data;
  
  // Concatenate domain separator and data
  const preimage = new Uint8Array(domainSep.length + dataBytes.length);
  preimage.set(domainSep, 0);
  preimage.set(dataBytes, domainSep.length);
  
  // Hash with BLAKE2b-256
  const hash = blake2b(preimage, { dkLen: 32 });
  
  // Convert to lowercase hex
  return Array.from(hash)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Signing Key Derivation
// ============================================================================

/**
 * Derive an Ed25519 signing key from the UFVK.
 * 
 * Since the Zcash web wallet only stores the viewing key (not spending key),
 * we derive a deterministic Ed25519 key pair from the UFVK for signing.
 * 
 * This proves control of the wallet because:
 * - Only someone with the UFVK can derive this key
 * - The derivation is deterministic (same UFVK → same key)
 * - The UFVK is kept secret in localStorage
 * 
 * @param ufvk - The unified full viewing key
 * @returns Ed25519 private key (32 bytes)
 */
function deriveSigningKey(ufvk: string): Uint8Array {
  const encoder = new TextEncoder();
  const domainSep = encoder.encode('zkpf-personhood-signing-v1');
  const ufvkBytes = encoder.encode(ufvk);
  
  // Concatenate domain separator and UFVK
  const preimage = new Uint8Array(domainSep.length + ufvkBytes.length);
  preimage.set(domainSep, 0);
  preimage.set(ufvkBytes, domainSep.length);
  
  // Hash to get 32 bytes for Ed25519 seed
  return blake2b(preimage, { dkLen: 32 });
}

/**
 * Get the public key corresponding to the UFVK-derived signing key.
 */
export function getPublicKeyFromUfvk(ufvk: string): string {
  const privateKey = deriveSigningKey(ufvk);
  const publicKey = ed25519.getPublicKey(privateKey);
  return Array.from(publicKey)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Sign a message using the UFVK-derived Ed25519 key.
 */
export function signMessageWithUfvk(ufvk: string, message: string): string {
  const privateKey = deriveSigningKey(ufvk);
  const messageBytes = new TextEncoder().encode(message);
  const signature = ed25519.sign(messageBytes, privateKey);
  return Array.from(signature)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// ============================================================================
// Wallet Core Interface
// ============================================================================

/**
 * Interface for the web wallet core required for personhood binding.
 * 
 * This abstraction allows the personhood flow to work with different
 * wallet implementations as long as they provide these methods.
 */
export interface WalletCore {
  /** Get the account tag or UFVK for wallet identification */
  getAccountTagOrUfvk(): Promise<string>;
  /** Sign a message with the wallet's key */
  signMessage(message: string): Promise<string>;
  /** Get the public key for signature verification */
  getPublicKey(): Promise<string>;
}

/**
 * Create a WalletCore adapter from a stored UFVK.
 * 
 * This is the production implementation that uses real Ed25519 signatures.
 */
export function createWalletCoreFromUfvk(ufvk: string): WalletCore {
  if (!ufvk || ufvk.trim().length === 0) {
    throw new Error('Cannot create wallet core: UFVK is empty');
  }

  return {
    getAccountTagOrUfvk: async () => ufvk,
    signMessage: async (message: string) => signMessageWithUfvk(ufvk, message),
    getPublicKey: async () => getPublicKeyFromUfvk(ufvk),
  };
}

// ============================================================================
// ZKPassport Flow
// ============================================================================

/**
 * Result from a successful ZKPassport verification
 */
export interface ZKPassportResult {
  personhoodId: PersonhoodId;
  verified: boolean;
}

/**
 * Error types from ZKPassport flow - typed for proper error handling
 */
export type ZKPassportError = 
  | { type: 'user_cancelled'; message: string }
  | { type: 'timeout'; message: string }
  | { type: 'sdk_error'; message: string };

/**
 * Run the ZKPassport verification flow for wallet binding.
 * 
 * This starts a ZKPassport request and waits for the user to complete
 * the passport scan. It handles all the callbacks and returns a promise.
 * 
 * NO MOCK DATA. This uses the real ZKPassport SDK.
 * 
 * @param options - Configuration options
 * @returns Object with promise and cancel function
 */
export function runZkPassportForWalletBinding(options?: {
  /** Domain for ZKPassport (default: "zkpf.dev") */
  domain?: string;
  /** Enable dev mode for testing with mock passports (default: false) */
  devMode?: boolean;
  /** Timeout in milliseconds (default: 5 minutes) */
  timeoutMs?: number;
  /** Callback when URL is ready for QR display */
  onUrlReady?: (url: string) => void;
  /** Callback when bridge connects */
  onBridgeConnect?: () => void;
  /** Callback when request is received by app */
  onRequestReceived?: () => void;
  /** Callback when proof is being generated */
  onGeneratingProof?: () => void;
}): {
  promise: Promise<ZKPassportResult>;
  cancel: () => void;
} {
  const {
    domain = 'zkpf.dev',
    devMode = false,
    timeoutMs = ZKPASSPORT_TIMEOUT_MS,
    onUrlReady,
    onBridgeConnect,
    onRequestReceived,
    onGeneratingProof,
  } = options ?? {};

  let cancelled = false;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let requestId: string | null = null;
  let zkPassport: ZKPassport | null = null;

  const cancel = () => {
    cancelled = true;
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
    if (requestId && zkPassport) {
      try {
        zkPassport.cancelRequest(requestId);
      } catch {
        // Ignore cancellation errors
      }
    }
  };

  const promise = new Promise<ZKPassportResult>((resolve, reject) => {
    (async () => {
      try {
        zkPassport = new ZKPassport(domain);

        const builder = await zkPassport.request({
          name: 'zkpf Zcash Wallet',
          logo: '/zkpf.png',
          purpose: 'Prove you are a unique person without sharing your personal details.',
          scope: WALLET_BINDING_SCOPE,
          devMode,
        });

        // Build query - minimal requirements for personhood verification
        const query = builder.gte('age', 13);
        const result = query.done();

        requestId = result.requestId;

        // Set up timeout
        timeoutId = setTimeout(() => {
          if (!cancelled) {
            cancel();
            reject({ 
              type: 'timeout', 
              message: 'Verification timed out. Please try again.' 
            } as ZKPassportError);
          }
        }, timeoutMs);

        // Notify URL is ready
        if (onUrlReady) {
          onUrlReady(result.url);
        }

        // Set up event handlers
        result.onBridgeConnect(() => {
          if (!cancelled && onBridgeConnect) {
            onBridgeConnect();
          }
        });

        result.onRequestReceived(() => {
          if (!cancelled && onRequestReceived) {
            onRequestReceived();
          }
        });

        result.onGeneratingProof(() => {
          if (!cancelled && onGeneratingProof) {
            onGeneratingProof();
          }
        });

        result.onResult((response: {
          uniqueIdentifier: string | undefined;
          verified: boolean;
          result: unknown;
        }) => {
          if (cancelled) return;
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }

          if (!response.verified) {
            reject({ 
              type: 'sdk_error', 
              message: 'Passport verification failed. Please try again.' 
            } as ZKPassportError);
            return;
          }

          if (!response.uniqueIdentifier) {
            reject({ 
              type: 'sdk_error', 
              message: 'No unique identifier returned. Please try again.' 
            } as ZKPassportError);
            return;
          }

          resolve({
            personhoodId: response.uniqueIdentifier,
            verified: true,
          });
        });

        result.onReject(() => {
          if (cancelled) return;
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }

          reject({ 
            type: 'user_cancelled', 
            message: 'You cancelled the passport verification.' 
          } as ZKPassportError);
        });

        result.onError((error: string) => {
          if (cancelled) return;
          
          if (timeoutId) {
            clearTimeout(timeoutId);
            timeoutId = null;
          }

          reject({ 
            type: 'sdk_error', 
            message: error || 'Passport verification failed.' 
          } as ZKPassportError);
        });

      } catch (error) {
        if (cancelled) return;
        
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }

        reject({ 
          type: 'sdk_error', 
          message: error instanceof Error ? error.message : 'Failed to start verification.' 
        } as ZKPassportError);
      }
    })();
  });

  return { promise, cancel };
}

// ============================================================================
// Challenge JSON Building
// ============================================================================

/**
 * Build the canonical challenge JSON string.
 * 
 * CRITICAL: This MUST produce the exact same string as the backend expects.
 * Field order matters for signature verification.
 */
export function buildChallengeJson(challenge: WalletBindingChallenge): string {
  // Use explicit field ordering to ensure canonical JSON
  return JSON.stringify({
    personhood_id: challenge.personhood_id,
    wallet_binding_id: challenge.wallet_binding_id,
    issued_at: challenge.issued_at,
    version: challenge.version,
  });
}

// ============================================================================
// Wallet Binding Flow
// ============================================================================

/**
 * Complete the wallet binding process.
 * 
 * This function:
 * 1. Creates the binding challenge
 * 2. Signs it with the wallet (REAL Ed25519 signature)
 * 3. Submits to the backend
 * 4. Handles all error cases with clear messages
 * 
 * NO DEMO MODE. All signatures are real and verified by the backend.
 * 
 * @param walletCore - Wallet interface for signing
 * @param personhoodId - Personhood ID from ZKPassport
 * @param walletBindingId - Wallet binding ID (computed earlier)
 * @param apiBaseUrl - Backend API base URL
 * @returns Promise with binding result or error
 */
export async function completeWalletBinding(
  walletCore: WalletCore,
  personhoodId: PersonhoodId,
  walletBindingId: WalletBindingId,
  apiBaseUrl: string = ''
): Promise<{ success: true; result: PersonhoodVerificationResult } | { success: false; error: PersonhoodFlowError }> {
  
  // Step 1: Create the challenge
  const challenge: WalletBindingChallenge = {
    personhood_id: personhoodId,
    wallet_binding_id: walletBindingId,
    issued_at: Date.now(),
    version: 1,
  };

  const challengeJson = buildChallengeJson(challenge);

  // Step 2: Sign the challenge with real Ed25519 signature
  let signature: string;
  let walletPubkey: string;
  
  try {
    signature = await walletCore.signMessage(challengeJson);
    walletPubkey = await walletCore.getPublicKey();
  } catch (error) {
    return {
      success: false,
      error: {
        type: 'signing_failed',
        message: error instanceof Error 
          ? error.message 
          : 'Failed to sign with wallet. Please try again.',
      },
    };
  }

  // Step 3: Submit to backend
  const request: BindWalletRequest = {
    challenge,
    challenge_json: challengeJson,
    signature,
    wallet_pubkey: walletPubkey,
  };

  try {
    const response = await fetch(`${apiBaseUrl}/api/personhood/bind-wallet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      let errorData: BindWalletError;
      try {
        errorData = await response.json() as BindWalletError;
      } catch {
        throw new Error(`Server error: ${response.status}`);
      }

      // Map error codes to user-friendly messages
      let userMessage: string;
      switch (errorData.error_code) {
        case 'challenge_expired':
          userMessage = 'The verification took too long. Please try again.';
          break;
        case 'invalid_signature':
          userMessage = 'Could not verify your wallet signature. Please try again.';
          break;
        case 'too_many_wallet_bindings':
          userMessage = 'This passport has already been used with too many wallets. If this is unexpected, please contact support.';
          break;
        case 'personhood_not_active':
          userMessage = 'Your identity verification is no longer active. Please contact support.';
          break;
        default:
          userMessage = errorData.error || 'We couldn\'t complete the verification. Please try again later.';
      }

      return {
        success: false,
        error: {
          type: 'binding_failed',
          message: userMessage,
          code: errorData.error_code,
        },
      };
    }

    const result = await response.json() as BindWalletResponse;

    // Cache the result locally
    try {
      cachePersonhoodStatus(walletBindingId, {
        personhood_verified: true,
        personhood_id: result.personhood_id,
        bindings_count_for_person: result.active_bindings_count,
      });
    } catch {
      // Caching failure is not critical
    }

    return {
      success: true,
      result: {
        personhood_id: result.personhood_id,
        wallet_binding_id: result.wallet_binding_id,
        active_bindings_count: result.active_bindings_count,
        verified_at: Date.now(),
      },
    };

  } catch (error) {
    return {
      success: false,
      error: {
        type: 'network_error',
        message: error instanceof Error 
          ? `Network error: ${error.message}` 
          : 'Network error. Please check your connection and try again.',
      },
    };
  }
}

// ============================================================================
// Status Queries
// ============================================================================

/**
 * Check the personhood verification status for a wallet.
 * 
 * @param walletBindingId - The wallet binding ID to check
 * @param apiBaseUrl - Backend API base URL
 * @returns Promise with status response
 */
export async function getPersonhoodStatus(
  walletBindingId: WalletBindingId,
  apiBaseUrl: string = ''
): Promise<PersonhoodStatusResponse> {
  try {
    const response = await fetch(
      `${apiBaseUrl}/api/personhood/status?wallet_binding_id=${encodeURIComponent(walletBindingId)}`,
      { method: 'GET' }
    );

    if (!response.ok) {
      // Return unverified status on error (safe default)
      return {
        personhood_verified: false,
        personhood_id: null,
        bindings_count_for_person: null,
      };
    }

    const data = await response.json() as PersonhoodStatusResponse;
    
    // Cache successful result
    try {
      cachePersonhoodStatus(walletBindingId, data);
    } catch {
      // Caching failure is not critical
    }

    return data;

  } catch {
    // On network error, try to use cached status
    const cached = getCachedPersonhoodStatus(walletBindingId);
    if (cached) {
      return cached;
    }

    // Return unverified status as safe default
    return {
      personhood_verified: false,
      personhood_id: null,
      bindings_count_for_person: null,
    };
  }
}

// ============================================================================
// Local Caching
// ============================================================================

interface CachedPersonhoodStatus extends PersonhoodStatusResponse {
  cached_at: number;
}

interface PersonhoodCache {
  [walletBindingId: string]: CachedPersonhoodStatus;
}

/**
 * Cache personhood status locally.
 */
function cachePersonhoodStatus(
  walletBindingId: WalletBindingId,
  status: PersonhoodStatusResponse
): void {
  try {
    const existing = localStorage.getItem(PERSONHOOD_CACHE_KEY);
    const cache: PersonhoodCache = existing ? JSON.parse(existing) : {};
    
    cache[walletBindingId] = {
      ...status,
      cached_at: Date.now(),
    };

    localStorage.setItem(PERSONHOOD_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // Ignore storage errors
  }
}

/**
 * Get cached personhood status (max 24 hours old).
 */
function getCachedPersonhoodStatus(
  walletBindingId: WalletBindingId
): PersonhoodStatusResponse | null {
  try {
    const existing = localStorage.getItem(PERSONHOOD_CACHE_KEY);
    if (!existing) return null;

    const cache: PersonhoodCache = JSON.parse(existing);
    const cached = cache[walletBindingId];

    if (!cached) return null;

    // Expire cache after 24 hours
    const maxAge = 24 * 60 * 60 * 1000;
    if (Date.now() - cached.cached_at > maxAge) {
      return null;
    }

    return {
      personhood_verified: cached.personhood_verified,
      personhood_id: cached.personhood_id,
      bindings_count_for_person: cached.bindings_count_for_person,
    };
  } catch {
    return null;
  }
}

/**
 * Clear cached personhood status (e.g., on wallet switch).
 */
export function clearPersonhoodCache(): void {
  try {
    localStorage.removeItem(PERSONHOOD_CACHE_KEY);
  } catch {
    // Ignore storage errors
  }
}
