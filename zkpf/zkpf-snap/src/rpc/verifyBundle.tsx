import type { ProofBundle } from '../types';
import { verifyBundleDialog, verifyResultDialog } from '../ui/dialogs';
import { parseProofBundle } from './exportBundle';
import { computeHolderTag, hashFundingSources } from '../utils/crypto';
import { policyDisplayName, formatPolicyThreshold } from '../utils/policy';

/**
 * Verification result
 */
export interface VerificationResult {
  valid: boolean;
  bundleId: string;
  checks: {
    bundleFormat: boolean;
    holderTagValid: boolean;
    signaturePresent: boolean;
    policyPresent: boolean;
    fundingSourcesPresent: boolean;
    timestampValid: boolean;
  };
  details: {
    policyName: string;
    threshold: string;
    holderTag: string;
    timestamp: string;
    fundingSourceCount: number;
  };
  errors: string[];
}

/**
 * Verify a proof bundle
 */
export async function verifyProofBundle(
  bundleJson: string,
): Promise<VerificationResult> {
  const errors: string[] = [];
  
  // Initialize checks
  const checks = {
    bundleFormat: false,
    holderTagValid: false,
    signaturePresent: false,
    policyPresent: false,
    fundingSourcesPresent: false,
    timestampValid: false,
  };
  
  let bundle: ProofBundle;
  
  // Check 1: Parse bundle format
  try {
    bundle = parseProofBundle(bundleJson);
    checks.bundleFormat = true;
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Failed to parse bundle');
    return {
      valid: false,
      bundleId: 'unknown',
      checks,
      details: {
        policyName: 'Unknown',
        threshold: 'Unknown',
        holderTag: 'Unknown',
        timestamp: 'Unknown',
        fundingSourceCount: 0,
      },
      errors,
    };
  }
  
  const pr = bundle.proofRequest;
  
  // Check 2: Policy present and valid
  if (pr.policy && typeof pr.policy.policy_id === 'number') {
    checks.policyPresent = true;
  } else {
    errors.push('Policy definition is missing or invalid');
  }
  
  // Check 3: Funding sources present
  if (pr.fundingSources && pr.fundingSources.length > 0) {
    checks.fundingSourcesPresent = true;
  } else {
    errors.push('No funding sources in bundle');
  }
  
  // Check 4: Signature present
  if (pr.holderBinding?.signature) {
    checks.signaturePresent = true;
  } else {
    errors.push('Holder signature is missing');
  }
  
  // Check 5: Verify holder tag matches signature hash
  if (checks.signaturePresent && pr.holderBinding.holderTag) {
    const expectedTag = computeHolderTag(pr.holderBinding.signature);
    if (expectedTag === pr.holderBinding.holderTag) {
      checks.holderTagValid = true;
    } else {
      errors.push('Holder tag does not match signature');
    }
  }
  
  // Check 6: Timestamp is valid (not in future, not too old)
  if (pr.timestamp) {
    const now = Math.floor(Date.now() / 1000);
    const maxAge = 365 * 24 * 60 * 60; // 1 year
    
    if (pr.timestamp > now + 60) {
      errors.push('Timestamp is in the future');
    } else if (pr.timestamp < now - maxAge) {
      errors.push('Bundle is older than 1 year');
    } else {
      checks.timestampValid = true;
    }
  }
  
  // Compile result
  const valid = Object.values(checks).every(Boolean);
  
  const result: VerificationResult = {
    valid,
    bundleId: bundle.bundleId,
    checks,
    details: {
      policyName: checks.policyPresent ? policyDisplayName(pr.policy) : 'Unknown',
      threshold: checks.policyPresent ? formatPolicyThreshold(pr.policy) : 'Unknown',
      holderTag: pr.holderBinding?.holderTag || 'Unknown',
      timestamp: pr.timestamp
        ? new Date(pr.timestamp * 1000).toISOString()
        : 'Unknown',
      fundingSourceCount: pr.fundingSources?.length || 0,
    },
    errors,
  };
  
  // Show verification result dialog
  await verifyResultDialog(result);
  
  return result;
}

/**
 * Interactive bundle verification - prompt user for bundle JSON
 */
export async function verifyBundleInteractive(): Promise<VerificationResult | null> {
  const bundleJson = await verifyBundleDialog();
  
  if (!bundleJson) {
    return null;
  }
  
  return verifyProofBundle(bundleJson);
}

