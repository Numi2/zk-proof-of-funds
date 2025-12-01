/**
 * Bound Identity Proof Types
 * 
 * This module defines the cryptographic bond between ZKPassport (identity)
 * and ZKPF (funds) proofs. The bond allows proving:
 * - "I am a person who meets identity requirements X" (without revealing who)
 * - "AND I control funds meeting threshold Y" (without revealing which wallet)
 * - "AND both statements are about the same person"
 * 
 * Use cases:
 * - Privacy-preserving KYC for DeFi (prove identity + funds without doxxing)
 * - Accredited investor verification for security token offerings
 * - Privacy-preserving credit scoring (prove identity + collateral)
 * - Shielded escrow where both parties prove identity-bound funds
 */

import type { ByteArray, ProofBundle } from './zkpf';
import type { ShareableProofBundle } from '../utils/shareable-proof';
import type { ZKPassportPolicyQuery } from './zkpassport';

/**
 * The core holder binding that cryptographically ties identity and funds.
 * 
 * Derived as: BLAKE3(
 *   POSEIDON(identity_commitment) ||
 *   POSEIDON(wallet_commitment) ||
 *   scope_id ||
 *   epoch
 * )
 */
export interface HolderBinding {
  /** The 32-byte binding commitment */
  binding: ByteArray;
  
  /** Nullifier to prevent double-use of this binding */
  nullifier: ByteArray;
  
  /** The scope this binding is valid for */
  scopeId: number;
  
  /** Epoch when binding was created */
  epoch: number;
}

/**
 * Identity component of the bound proof.
 * Contains the ZKPassport proof and disclosed attributes.
 */
export interface BoundIdentityComponent {
  /** The ZKPassport proof bundle */
  zkpassportProof: ShareableProofBundle;
  
  /** 
   * Commitment to the identity (H(passport_data))
   * This is used in the binding derivation without revealing identity
   */
  identityCommitment: ByteArray;
  
  /** 
   * Unique identifier from ZKPassport SDK
   * This is a privacy-preserving identifier derived from passport data
   */
  uniqueIdentifier?: string;
  
  /** Disclosed identity attributes (only what the user chose to reveal) */
  disclosures: {
    /** Age verification (if requested) */
    ageVerified?: {
      /** The minimum age verified (e.g., 18 means "at least 18") */
      minimumAge?: number;
      /** Maximum age if bounded */
      maximumAge?: number;
    };
    
    /** Nationality (if disclosed) */
    nationality?: string;
    
    /** Whether passport is not expired */
    passportValid?: boolean;
    
    /** Country of issuance (if disclosed) */
    issuingCountry?: string;
    
    /** Any custom disclosed fields */
    customFields?: Record<string, unknown>;
  };
  
  /** The policy query that was verified */
  verifiedQuery: ZKPassportPolicyQuery;
}

/**
 * Funds component of the bound proof.
 * Contains the ZKPF proof and balance attestation.
 */
export interface BoundFundsComponent {
  /** The ZKPF proof bundle */
  zkpfBundle: ProofBundle;
  
  /**
   * Commitment to the wallet/funds source
   * Derived from viewing key without revealing it
   */
  fundsCommitment: ByteArray;
  
  /** Policy details that were verified */
  verifiedPolicy: {
    policyId: number;
    
    /** Whether the threshold was met */
    thresholdMet: boolean;
    
    /** The threshold that was proven (in raw units) */
    thresholdRaw: number;
    
    /** Currency code */
    currencyCode: number;
    
    /** Human-readable currency */
    currency: string;
    
    /** The rail type (ZCASH_ORCHARD, CUSTODIAL, etc.) */
    rail: string;
    
    /** Verifier scope */
    scopeId: number;
  };
  
  /** 
   * For Zcash Orchard proofs, snapshot metadata 
   */
  snapshot?: {
    blockHeight: number;
    anchor?: ByteArray;
  };
}

/**
 * The complete Bound Identity Proof.
 * This is the shareable artifact that proves identity + funds are bound.
 */
export interface BoundIdentityProof {
  /** Version for forward compatibility */
  version: 1;
  
  /** Unique identifier for this bond */
  bondId: string;
  
  /** Timestamp when the bond was created */
  timestamp: number;
  
  /** The cryptographic binding between identity and funds */
  holderBinding: HolderBinding;
  
  /** Identity proof component */
  identity: BoundIdentityComponent;
  
  /** Funds proof component */
  funds: BoundFundsComponent;
  
  /**
   * Optional: Aggregated bond proof
   * 
   * This is a recursive SNARK that proves:
   * 1. The identity proof is valid
   * 2. The funds proof is valid
   * 3. Both are bound to the same holder
   * 
   * When present, verification is more efficient as only this
   * single proof needs to be verified instead of both components.
   */
  bondProof?: {
    /** The aggregated proof bytes */
    proof: ByteArray;
    /** Public inputs to the aggregated proof */
    publicInputs: ByteArray;
    /** Circuit version of the aggregator */
    circuitVersion: number;
    /** Proof system used (e.g., "groth16", "plonk", "kimchi") */
    proofSystem: string;
  };
  
  /** Metadata about the bond */
  metadata: {
    /** Human-readable purpose */
    purpose: string;
    
    /** Scope identifier for this bond */
    scope: string;
    
    /** When this bond expires (unix timestamp) */
    validUntil: number;
    
    /** Whether this was created in dev mode */
    devMode?: boolean;
    
    /** Optional note from the creator */
    note?: string;
    
    /** Domain where bond was created */
    domain?: string;
  };
}

/**
 * Policy for creating a bound identity proof.
 * Specifies what identity and funds requirements must be met.
 */
export interface BoundIdentityPolicy {
  /** Unique policy identifier */
  policyId: number;
  
  /** Human-readable label */
  label: string;
  
  /** Description of what this bond proves */
  description?: string;
  
  /** Purpose (shown to user) */
  purpose: string;
  
  /** Scope identifier */
  scope: string;
  
  /** How long the bond is valid (seconds) */
  validity: number;
  
  /** Identity requirements (ZKPassport query) */
  identityQuery: ZKPassportPolicyQuery;
  
  /** Funds requirements (ZKPF policy) */
  fundsPolicy: {
    /** Minimum balance threshold */
    thresholdRaw: number;
    
    /** Required currency code */
    currencyCode: number;
    
    /** Required rail type */
    railId: string;
    
    /** Verifier scope ID */
    scopeId: number;
  };
  
  /** Optional: specific custodian requirement */
  requiredCustodianId?: number;
  
  /** Whether dev mode proofs are accepted */
  devMode?: boolean;
  
  /** Use case tags */
  useCases?: string[];
}

/**
 * Result of bound identity verification
 */
export interface BoundIdentityVerificationResult {
  /** Whether the entire bond is valid */
  valid: boolean;
  
  /** Whether the identity component verified */
  identityVerified: boolean;
  
  /** Whether the funds component verified */
  fundsVerified: boolean;
  
  /** Whether the holder binding is valid */
  bindingVerified: boolean;
  
  /** Whether the bond has expired */
  expired: boolean;
  
  /** Error message if verification failed */
  error?: string;
  
  /** Detailed verification results */
  details: {
    /** Identity check results */
    identity: {
      queryResultsPassed: boolean;
      sdkVerified: boolean;
      disclosuresValid: boolean;
    };
    
    /** Funds check results */
    funds: {
      proofValid: boolean;
      thresholdMet: boolean;
      railMatched: boolean;
    };
    
    /** Binding check results */
    binding: {
      commitmentValid: boolean;
      nullifierUnused: boolean;
      scopeMatched: boolean;
      epochValid: boolean;
    };
  };
}

/**
 * Request to create a bound identity proof
 */
export interface CreateBoundIdentityRequest {
  /** The policy to use */
  policy: BoundIdentityPolicy;
  
  /** ZKPassport proof (from ZKPassport verification flow) */
  zkpassportProof: ShareableProofBundle;
  
  /** ZKPF proof bundle (from ZKPF proof builder) */
  zkpfBundle: ProofBundle;
  
  /** 
   * Holder secret seed 
   * Derived from: H(passport_unique_id || wallet_viewing_key)
   */
  holderSecretSeed: ByteArray;
  
  /** Optional note */
  note?: string;
}

/**
 * Response from bound identity creation
 */
export interface CreateBoundIdentityResponse {
  /** Whether creation succeeded */
  success: boolean;
  
  /** The created bound proof */
  boundProof?: BoundIdentityProof;
  
  /** Error if creation failed */
  error?: string;
  
  /** Warnings (non-fatal issues) */
  warnings?: string[];
}

// ============================================================================
// Utility types for the binding derivation
// ============================================================================

/**
 * Input for deriving the holder binding
 */
export interface HolderBindingInput {
  /** Identity commitment from ZKPassport */
  identityCommitment: ByteArray;
  
  /** Funds commitment from wallet */
  fundsCommitment: ByteArray;
  
  /** Scope ID for the binding */
  scopeId: number;
  
  /** Epoch for the binding */
  epoch: number;
  
  /** Optional: Custom binding data */
  customData?: ByteArray;
}

/**
 * Derivation parameters for the holder binding
 */
export interface HolderBindingParams {
  /** Hash function to use for binding */
  hashFunction: 'blake3' | 'poseidon' | 'keccak256';
  
  /** Domain separator for binding derivation */
  domainSeparator: string;
  
  /** Whether to include epoch in binding */
  epochBound: boolean;
  
  /** Nullifier derivation method */
  nullifierDerivation: 'counter' | 'scope' | 'epoch';
}

// ============================================================================
// Constants
// ============================================================================

/** Default binding parameters */
export const DEFAULT_BINDING_PARAMS: HolderBindingParams = {
  hashFunction: 'blake3',
  domainSeparator: 'zkpf:bound-identity:v1',
  epochBound: true,
  nullifierDerivation: 'scope',
};

/** Currency code for ZEC in custodial rail */
export const ZEC_CURRENCY_CODE = 5915971;

/** Currency code for ZEC in Orchard rail */
export const ZEC_ORCHARD_CURRENCY_CODE = 999001;

/** Standard scopes for bound identity proofs */
export const BOUND_IDENTITY_SCOPES = {
  /** KYC verification for DeFi access */
  DEFI_KYC: 'bound-identity:defi-kyc',
  
  /** Accredited investor verification */
  ACCREDITED_INVESTOR: 'bound-identity:accredited-investor',
  
  /** Privacy-preserving credit check */
  CREDIT_CHECK: 'bound-identity:credit-check',
  
  /** Escrow participant verification */
  ESCROW_PARTICIPANT: 'bound-identity:escrow-participant',
  
  /** General identity-bound funds proof */
  GENERAL: 'bound-identity:general',
} as const;

export type BoundIdentityScope = typeof BOUND_IDENTITY_SCOPES[keyof typeof BOUND_IDENTITY_SCOPES];

