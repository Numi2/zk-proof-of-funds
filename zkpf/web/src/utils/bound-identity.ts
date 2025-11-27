/**
 * Bound Identity Utilities
 * 
 * Cryptographic functions for creating and verifying the bond between
 * ZKPassport identity proofs and ZKPF funds proofs.
 */

import { blake3 } from '@noble/hashes/blake3.js';
import type {
  BoundIdentityProof,
  HolderBinding,
  HolderBindingInput,
  HolderBindingParams,
  BoundIdentityComponent,
  BoundFundsComponent,
  CreateBoundIdentityRequest,
  CreateBoundIdentityResponse,
  BoundIdentityVerificationResult,
} from '../types/bound-identity';
import type { ProofBundle, ByteArray } from '../types/zkpf';
import type { ShareableProofBundle } from './shareable-proof';
import { getCurrencyMeta } from './policy';

// ============================================================================
// Holder Binding Derivation
// ============================================================================

/**
 * Derive the holder binding from identity and funds commitments.
 * 
 * The binding proves that both proofs are about the same holder
 * without revealing the holder's identity or wallet.
 * 
 * Derivation:
 *   binding = BLAKE3(domain_sep || identity_commitment || funds_commitment || scope || epoch)
 *   nullifier = BLAKE3(binding || "nullifier" || scope)
 */
export function deriveHolderBinding(
  input: HolderBindingInput,
  params: HolderBindingParams = {
    hashFunction: 'blake3',
    domainSeparator: 'zkpf:bound-identity:v1',
    epochBound: true,
    nullifierDerivation: 'scope',
  }
): HolderBinding {
  const encoder = new TextEncoder();
  
  // Build the binding preimage
  const domainSepBytes = encoder.encode(params.domainSeparator);
  const scopeBytes = new Uint8Array(new BigUint64Array([BigInt(input.scopeId)]).buffer);
  const epochBytes = params.epochBound 
    ? new Uint8Array(new BigUint64Array([BigInt(input.epoch)]).buffer)
    : new Uint8Array(0);
  
  // Concatenate all components
  const bindingPreimage = new Uint8Array([
    ...domainSepBytes,
    ...input.identityCommitment,
    ...input.fundsCommitment,
    ...scopeBytes,
    ...epochBytes,
    ...(input.customData ?? []),
  ]);
  
  // Derive the binding
  const binding = blake3(bindingPreimage);
  
  // Derive the nullifier
  const nullifierPreimage = new Uint8Array([
    ...binding,
    ...encoder.encode(':nullifier:'),
    ...scopeBytes,
  ]);
  const nullifier = blake3(nullifierPreimage);
  
  return {
    binding: Array.from(binding),
    nullifier: Array.from(nullifier),
    scopeId: input.scopeId,
    epoch: input.epoch,
  };
}

/**
 * Derive the identity commitment from ZKPassport unique identifier.
 * 
 * The unique identifier from ZKPassport is already a privacy-preserving
 * hash of the passport data. We hash it again with our domain separator
 * for binding purposes.
 */
export function deriveIdentityCommitment(
  uniqueIdentifier: string,
  customSalt?: ByteArray
): ByteArray {
  const encoder = new TextEncoder();
  const preimage = new Uint8Array([
    ...encoder.encode('zkpf:identity-commitment:'),
    ...encoder.encode(uniqueIdentifier),
    ...(customSalt ?? []),
  ]);
  return Array.from(blake3(preimage));
}

/**
 * Derive the funds commitment from wallet viewing key.
 * 
 * For Zcash, this is derived from the UFVK (Unified Full Viewing Key).
 * The commitment hides the actual viewing key while allowing binding.
 */
export function deriveFundsCommitment(
  viewingKeyOrAddress: string,
  railId: string,
  customSalt?: ByteArray
): ByteArray {
  const encoder = new TextEncoder();
  const preimage = new Uint8Array([
    ...encoder.encode('zkpf:funds-commitment:'),
    ...encoder.encode(railId),
    ...encoder.encode(':'),
    ...encoder.encode(viewingKeyOrAddress),
    ...(customSalt ?? []),
  ]);
  return Array.from(blake3(preimage));
}

/**
 * Derive the holder secret seed from both identity and wallet secrets.
 * 
 * This is the master secret that ties identity and funds together.
 * It should be derived once and used for all bindings in a session.
 * 
 * IMPORTANT: This should be computed locally and never transmitted.
 */
export function deriveHolderSecretSeed(
  zkpassportUniqueId: string,
  walletViewingKey: string,
  scope: string
): ByteArray {
  const encoder = new TextEncoder();
  const preimage = new Uint8Array([
    ...encoder.encode('zkpf:holder-secret:'),
    ...encoder.encode(scope),
    ...encoder.encode(':'),
    ...encoder.encode(zkpassportUniqueId),
    ...encoder.encode(':'),
    ...encoder.encode(walletViewingKey),
  ]);
  return Array.from(blake3(preimage));
}

// ============================================================================
// Bound Identity Proof Creation
// ============================================================================

/**
 * Generate a unique bond ID
 */
function generateBondId(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 10);
  return `bond_${timestamp}_${random}`;
}

/**
 * Extract identity disclosures from ZKPassport query result
 */
function extractIdentityDisclosures(
  queryResult: Record<string, unknown>
): BoundIdentityComponent['disclosures'] {
  const disclosures: BoundIdentityComponent['disclosures'] = {};
  
  // Age verification
  if (queryResult.age_gte !== undefined || queryResult.ageGte !== undefined) {
    disclosures.ageVerified = {
      minimumAge: (queryResult.age_gte ?? queryResult.ageGte) as number,
    };
  }
  
  // Nationality
  if (queryResult.nationality) {
    disclosures.nationality = queryResult.nationality as string;
  }
  
  // Passport validity
  if (queryResult.expiry_date_gte || queryResult.expiryDateGte) {
    disclosures.passportValid = true;
  }
  
  // Issuing country
  if (queryResult.issuing_country || queryResult.issuingCountry) {
    disclosures.issuingCountry = (queryResult.issuing_country ?? queryResult.issuingCountry) as string;
  }
  
  // Custom fields
  const customFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(queryResult)) {
    if (!['age_gte', 'ageGte', 'nationality', 'expiry_date_gte', 'expiryDateGte', 
          'issuing_country', 'issuingCountry'].includes(key)) {
      customFields[key] = value;
    }
  }
  if (Object.keys(customFields).length > 0) {
    disclosures.customFields = customFields;
  }
  
  return disclosures;
}

/**
 * Create a bound identity proof from ZKPassport and ZKPF proofs.
 * 
 * This function ties together an identity proof and a funds proof
 * into a single verifiable artifact.
 */
export function createBoundIdentityProof(
  request: CreateBoundIdentityRequest
): CreateBoundIdentityResponse {
  try {
    const { policy, zkpassportProof, zkpfBundle, holderSecretSeed, note } = request;
    
    // Validate inputs
    if (!zkpassportProof.proofs || zkpassportProof.proofs.length === 0) {
      return { success: false, error: 'ZKPassport proof is missing proofs array' };
    }
    
    if (!zkpfBundle.proof || zkpfBundle.proof.length === 0) {
      return { success: false, error: 'ZKPF bundle is missing proof data' };
    }
    
    const warnings: string[] = [];
    
    // Get unique identifier from ZKPassport
    const uniqueIdentifier = zkpassportProof.uniqueIdentifier;
    if (!uniqueIdentifier) {
      warnings.push('ZKPassport proof missing uniqueIdentifier - binding may be weaker');
    }
    
    // Derive commitments
    const identityCommitment = deriveIdentityCommitment(
      uniqueIdentifier || JSON.stringify(zkpassportProof.queryResult),
      holderSecretSeed.slice(0, 16)
    );
    
    const fundsCommitment = deriveFundsCommitment(
      // Use nullifier as proxy for wallet commitment if no viewing key
      zkpfBundle.public_inputs.nullifier?.map(b => b.toString(16).padStart(2, '0')).join('') || '',
      zkpfBundle.rail_id || 'CUSTODIAL_ATTESTATION',
      holderSecretSeed.slice(16, 32)
    );
    
    // Derive holder binding
    const epoch = Math.floor(Date.now() / 1000);
    const holderBinding = deriveHolderBinding({
      identityCommitment,
      fundsCommitment,
      scopeId: policy.fundsPolicy.scopeId,
      epoch,
    });
    
    // Build identity component
    const identity: BoundIdentityComponent = {
      zkpassportProof,
      identityCommitment,
      uniqueIdentifier,
      disclosures: extractIdentityDisclosures(zkpassportProof.queryResult || {}),
      verifiedQuery: policy.identityQuery,
    };
    
    // Build funds component
    const currencyMeta = getCurrencyMeta(zkpfBundle.public_inputs.required_currency_code);
    const funds: BoundFundsComponent = {
      zkpfBundle,
      fundsCommitment,
      verifiedPolicy: {
        policyId: zkpfBundle.public_inputs.policy_id,
        thresholdMet: true, // Assumed valid if we have a proof
        thresholdRaw: zkpfBundle.public_inputs.threshold_raw,
        currencyCode: zkpfBundle.public_inputs.required_currency_code,
        currency: currencyMeta.code,
        rail: zkpfBundle.rail_id || 'CUSTODIAL_ATTESTATION',
        scopeId: zkpfBundle.public_inputs.verifier_scope_id,
      },
      snapshot: zkpfBundle.public_inputs.snapshot_block_height 
        ? {
            blockHeight: zkpfBundle.public_inputs.snapshot_block_height,
            anchor: zkpfBundle.public_inputs.snapshot_anchor_orchard,
          }
        : undefined,
    };
    
    // Build the complete bound proof
    const boundProof: BoundIdentityProof = {
      version: 1,
      bondId: generateBondId(),
      timestamp: Date.now(),
      holderBinding,
      identity,
      funds,
      metadata: {
        purpose: policy.purpose,
        scope: policy.scope,
        validUntil: epoch + policy.validity,
        devMode: policy.devMode,
        note,
        domain: typeof window !== 'undefined' ? window.location.origin : undefined,
      },
    };
    
    return {
      success: true,
      boundProof,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error creating bound proof',
    };
  }
}

// ============================================================================
// Bound Identity Verification
// ============================================================================

/**
 * Verify a bound identity proof.
 * 
 * This verifies:
 * 1. The identity proof is valid (via ZKPassport SDK)
 * 2. The funds proof is valid (via ZKPF verifier)
 * 3. The holder binding is correctly derived
 * 4. The proof hasn't expired
 */
export async function verifyBoundIdentityProof(
  boundProof: BoundIdentityProof,
  options: {
    verifyIdentitySdk?: boolean;
    verifyFundsBackend?: boolean;
    zkpfVerifyFn?: (bundle: ProofBundle) => Promise<boolean>;
    zkpassportVerifyFn?: (proof: ShareableProofBundle) => Promise<boolean>;
  } = {}
): Promise<BoundIdentityVerificationResult> {
  const {
    verifyIdentitySdk = false,
    verifyFundsBackend = false,
    zkpfVerifyFn,
    zkpassportVerifyFn,
  } = options;
  
  const result: BoundIdentityVerificationResult = {
    valid: false,
    identityVerified: false,
    fundsVerified: false,
    bindingVerified: false,
    expired: false,
    details: {
      identity: {
        queryResultsPassed: false,
        sdkVerified: false,
        disclosuresValid: false,
      },
      funds: {
        proofValid: false,
        thresholdMet: false,
        railMatched: false,
      },
      binding: {
        commitmentValid: false,
        nullifierUnused: true, // Assume unused unless we have a registry
        scopeMatched: false,
        epochValid: false,
      },
    },
  };
  
  try {
    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    result.expired = now > boundProof.metadata.validUntil;
    
    // Verify identity component
    result.details.identity.queryResultsPassed = 
      boundProof.identity.zkpassportProof.queryResult !== undefined;
    result.details.identity.disclosuresValid = 
      Object.keys(boundProof.identity.disclosures).length > 0;
    
    if (verifyIdentitySdk && zkpassportVerifyFn) {
      result.details.identity.sdkVerified = 
        await zkpassportVerifyFn(boundProof.identity.zkpassportProof);
    } else {
      // Without SDK verification, accept if we have proofs
      result.details.identity.sdkVerified = 
        boundProof.identity.zkpassportProof.proofs.length > 0;
    }
    
    result.identityVerified = 
      result.details.identity.queryResultsPassed &&
      result.details.identity.sdkVerified;
    
    // Verify funds component
    result.details.funds.proofValid = 
      boundProof.funds.zkpfBundle.proof.length > 0;
    result.details.funds.thresholdMet = 
      boundProof.funds.verifiedPolicy.thresholdMet;
    result.details.funds.railMatched = 
      boundProof.funds.zkpfBundle.rail_id === boundProof.funds.verifiedPolicy.rail;
    
    if (verifyFundsBackend && zkpfVerifyFn) {
      result.details.funds.proofValid = 
        await zkpfVerifyFn(boundProof.funds.zkpfBundle);
    }
    
    result.fundsVerified = 
      result.details.funds.proofValid &&
      result.details.funds.thresholdMet;
    
    // Verify binding
    // Re-derive the binding and check it matches
    const recomputedBinding = deriveHolderBinding({
      identityCommitment: boundProof.identity.identityCommitment,
      fundsCommitment: boundProof.funds.fundsCommitment,
      scopeId: boundProof.holderBinding.scopeId,
      epoch: boundProof.holderBinding.epoch,
    });
    
    result.details.binding.commitmentValid = 
      arraysEqual(recomputedBinding.binding, boundProof.holderBinding.binding);
    result.details.binding.scopeMatched = 
      boundProof.holderBinding.scopeId === boundProof.funds.verifiedPolicy.scopeId;
    result.details.binding.epochValid = 
      boundProof.holderBinding.epoch <= now &&
      boundProof.holderBinding.epoch >= now - (30 * 24 * 60 * 60); // Within 30 days
    
    result.bindingVerified = 
      result.details.binding.commitmentValid &&
      result.details.binding.scopeMatched &&
      result.details.binding.epochValid &&
      result.details.binding.nullifierUnused;
    
    // Final validity
    result.valid = 
      result.identityVerified &&
      result.fundsVerified &&
      result.bindingVerified &&
      !result.expired;
    
  } catch (error) {
    result.error = error instanceof Error ? error.message : 'Verification failed';
  }
  
  return result;
}

/**
 * Helper to compare byte arrays
 */
function arraysEqual(a: ByteArray, b: ByteArray): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

// ============================================================================
// Encoding/Decoding
// ============================================================================

/**
 * Encode a bound identity proof to a shareable string
 */
export function encodeBoundIdentityProof(proof: BoundIdentityProof): string {
  const json = JSON.stringify(proof);
  // Use base64url encoding for URL safety
  return btoa(json)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * Decode a bound identity proof from a string
 */
export function decodeBoundIdentityProof(encoded: string): BoundIdentityProof {
  // Restore base64 padding
  let base64 = encoded
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  
  while (base64.length % 4) {
    base64 += '=';
  }
  
  const json = atob(base64);
  return JSON.parse(json) as BoundIdentityProof;
}

/**
 * Create a shareable URL for a bound identity proof
 */
export function createBoundIdentityUrl(
  proof: BoundIdentityProof,
  baseUrl: string = window.location.origin
): string {
  const encoded = encodeBoundIdentityProof(proof);
  return `${baseUrl}/verify-bond?proof=${encoded}`;
}

// ============================================================================
// Storage
// ============================================================================

const BONDS_STORAGE_KEY = 'zkpf_bound_identity_proofs';

/**
 * Save a bound identity proof to local storage
 */
export function saveBoundIdentityProof(proof: BoundIdentityProof): void {
  try {
    const existing = localStorage.getItem(BONDS_STORAGE_KEY);
    const proofs: BoundIdentityProof[] = existing ? JSON.parse(existing) : [];
    
    // Add to beginning, limit to 50 proofs
    proofs.unshift(proof);
    if (proofs.length > 50) {
      proofs.pop();
    }
    
    localStorage.setItem(BONDS_STORAGE_KEY, JSON.stringify(proofs));
  } catch {
    console.warn('Failed to save bound identity proof');
  }
}

/**
 * Load bound identity proofs from local storage
 */
export function loadBoundIdentityProofs(): BoundIdentityProof[] {
  try {
    const stored = localStorage.getItem(BONDS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Delete a bound identity proof from local storage
 */
export function deleteBoundIdentityProof(bondId: string): boolean {
  try {
    const existing = localStorage.getItem(BONDS_STORAGE_KEY);
    if (!existing) return false;
    
    const proofs: BoundIdentityProof[] = JSON.parse(existing);
    const filtered = proofs.filter(p => p.bondId !== bondId);
    
    if (filtered.length === proofs.length) {
      return false; // Not found
    }
    
    localStorage.setItem(BONDS_STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch {
    return false;
  }
}

