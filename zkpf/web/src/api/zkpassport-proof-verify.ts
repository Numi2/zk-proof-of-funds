// Programmatic ZKPassport Proof Verification API
// Use these utilities to verify shared proofs programmatically

import { ZKPassport } from '@zkpassport/sdk';
import type { ShareableProofBundle, ProofVerificationSummary } from '../utils/shareable-proof';
import {
  decodeShareableProof,
  generateProofSummary,
  isProofExpired,
} from '../utils/shareable-proof';

/**
 * Result of programmatic proof verification
 */
export interface ProofVerificationResult {
  /** Whether the proof is valid */
  valid: boolean;
  /** Whether SDK verification succeeded */
  sdkVerified: boolean;
  /** Whether the proof has expired */
  expired: boolean;
  /** Summary of verification checks */
  summary: ProofVerificationSummary;
  /** The decoded proof bundle */
  bundle: ShareableProofBundle;
  /** Error message if verification failed */
  error?: string;
}

/**
 * Options for proof verification
 */
export interface VerifyProofOptions {
  /** Skip SDK verification and only do local checks */
  skipSdkVerification?: boolean;
  /** Custom ZKPassport domain */
  domain?: string;
  /** Whether to allow expired proofs (still verifies, but marks as expired) */
  allowExpired?: boolean;
}

/**
 * Verify a proof from an encoded string (from URL or direct encoding)
 * 
 * @example
 * ```typescript
 * import { verifyEncodedProof } from './api/zkpassport-proof-verify';
 * 
 * const result = await verifyEncodedProof(encodedProofString);
 * if (result.valid && !result.expired) {
 *   console.log('Proof is valid!');
 *   console.log('Verified checks:', result.summary.checks);
 * }
 * ```
 */
export async function verifyEncodedProof(
  encoded: string,
  options: VerifyProofOptions = {}
): Promise<ProofVerificationResult> {
  try {
    const bundle = decodeShareableProof(encoded);
    return verifyProofBundle(bundle, options);
  } catch (error) {
    throw new Error(`Failed to decode proof: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Verify a proof from a URL containing the proof parameter
 * 
 * @example
 * ```typescript
 * import { verifyProofFromUrl } from './api/zkpassport-proof-verify';
 * 
 * const result = await verifyProofFromUrl('https://example.com/verify?proof=...');
 * ```
 */
export async function verifyProofFromUrl(
  url: string,
  options: VerifyProofOptions = {}
): Promise<ProofVerificationResult> {
  try {
    const urlObj = new URL(url);
    const proofParam = urlObj.searchParams.get('proof');
    
    if (!proofParam) {
      throw new Error('No proof parameter found in URL');
    }
    
    return verifyEncodedProof(proofParam, options);
  } catch (error) {
    if (error instanceof Error && error.message.includes('proof parameter')) {
      throw error;
    }
    throw new Error(`Invalid URL: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Verify a proof bundle directly
 * 
 * @example
 * ```typescript
 * import { verifyProofBundle } from './api/zkpassport-proof-verify';
 * 
 * const bundle: ShareableProofBundle = JSON.parse(proofJson);
 * const result = await verifyProofBundle(bundle);
 * ```
 */
export async function verifyProofBundle(
  bundle: ShareableProofBundle,
  options: VerifyProofOptions = {}
): Promise<ProofVerificationResult> {
  const { skipSdkVerification = false, domain = 'zkpf.dev', allowExpired = false } = options;
  
  // Check expiry
  const expired = isProofExpired(bundle);
  if (expired && !allowExpired) {
    const summary = generateProofSummary(bundle);
    return {
      valid: false,
      sdkVerified: false,
      expired: true,
      summary,
      bundle,
      error: 'Proof has expired',
    };
  }
  
  // Generate summary
  const summary = generateProofSummary(bundle);
  const allChecksPassed = summary.checks.every(c => c.passed);
  const hasProofs = bundle.proofs.length > 0;
  
  // SDK verification
  let sdkVerified = false;
  let sdkError: string | undefined;
  
  if (!skipSdkVerification && hasProofs) {
    try {
      const zkPassport = new ZKPassport(domain);
      const result = await zkPassport.verify({
        proofs: bundle.proofs,
        queryResult: bundle.queryResult,
        scope: bundle.policy.scope,
        devMode: bundle.policy.devMode,
        validity: bundle.policy.validity,
      });
      sdkVerified = result.verified === true;
    } catch (error) {
      sdkError = error instanceof Error ? error.message : 'SDK verification failed';
      console.warn('SDK verification failed:', sdkError);
    }
  }
  
  // Determine validity
  // In dev mode, allow local-only verification; otherwise require SDK verification
  const acceptLocalOnly = bundle.policy.devMode === true;
  const isValid = allChecksPassed && hasProofs && (sdkVerified || acceptLocalOnly);
  
  return {
    valid: isValid,
    sdkVerified,
    expired,
    summary,
    bundle,
    error: !isValid ? (sdkError || 'Verification checks failed') : undefined,
  };
}

/**
 * Quick check if a proof string or URL is potentially valid (basic format check)
 * Does not perform cryptographic verification
 * 
 * @example
 * ```typescript
 * import { isValidProofFormat } from './api/zkpassport-proof-verify';
 * 
 * if (isValidProofFormat(userInput)) {
 *   // Proceed with full verification
 * }
 * ```
 */
export function isValidProofFormat(input: string): boolean {
  try {
    // Try as URL first
    try {
      const url = new URL(input);
      const proof = url.searchParams.get('proof');
      if (proof) {
        decodeShareableProof(proof);
        return true;
      }
    } catch {
      // Not a URL, try as direct encoding
    }
    
    // Try as direct encoded string
    decodeShareableProof(input);
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract proof bundle from various input formats
 * Handles URLs, encoded strings, and JSON
 * 
 * @example
 * ```typescript
 * import { extractProofBundle } from './api/zkpassport-proof-verify';
 * 
 * const bundle = extractProofBundle(userInput);
 * if (bundle) {
 *   // Use the bundle
 * }
 * ```
 */
export function extractProofBundle(input: string): ShareableProofBundle | null {
  // Try as URL
  try {
    const url = new URL(input);
    const proof = url.searchParams.get('proof');
    if (proof) {
      return decodeShareableProof(proof);
    }
  } catch {
    // Not a URL
  }
  
  // Try as JSON
  try {
    const parsed = JSON.parse(input);
    if (parsed.version && parsed.proofId && parsed.proofs && parsed.queryResult) {
      return parsed as ShareableProofBundle;
    }
  } catch {
    // Not JSON
  }
  
  // Try as encoded string
  try {
    return decodeShareableProof(input);
  } catch {
    // Not valid encoding
  }
  
  return null;
}

// Re-export useful types and utilities
export type { ShareableProofBundle, ProofVerificationSummary };
export { 
  createShareableProof,
  createShareableUrl,
  encodeShareableProof,
  decodeShareableProof,
  generateProofSummary,
  isProofExpired,
} from '../utils/shareable-proof';

