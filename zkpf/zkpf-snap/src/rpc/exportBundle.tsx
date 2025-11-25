import type { ProofRequest, ProofBundle, ProofHistoryEntry } from '../types';
import { exportBundleDialog } from '../ui/dialogs';
import { policyDisplayName } from '../utils/policy';
import { bytesToHex } from '../utils/crypto';
import { addProofToHistory } from '../utils/state';
import { keccak_256 } from '@noble/hashes/sha3';

/**
 * Current bundle format version
 */
const BUNDLE_VERSION = '1.0.0';

/**
 * Generate a unique bundle ID from the proof request
 */
function generateBundleId(proofRequest: ProofRequest): string {
  const data = JSON.stringify({
    holderTag: proofRequest.holderBinding.holderTag,
    policyId: proofRequest.policy.policy_id,
    timestamp: proofRequest.timestamp,
  });
  const hash = keccak_256(new TextEncoder().encode(data));
  return `zkpf-${bytesToHex(hash).slice(0, 16)}`;
}

/**
 * Export a proof request as a shareable bundle
 */
export async function exportProofBundle(
  proofRequest: ProofRequest,
): Promise<ProofBundle> {
  const bundleId = generateBundleId(proofRequest);
  const createdAt = new Date(proofRequest.timestamp * 1000).toISOString();
  
  // Create the bundle
  const bundle: ProofBundle = {
    version: BUNDLE_VERSION,
    proofRequest,
    createdAt,
    bundleId,
  };
  
  // Show the export dialog with bundle JSON
  const bundleJson = JSON.stringify(bundle, null, 2);
  await exportBundleDialog(bundleJson, bundleId);
  
  // Add to proof history
  const historyEntry: ProofHistoryEntry = {
    bundleId,
    policyId: proofRequest.policy.policy_id,
    policyLabel: policyDisplayName(proofRequest.policy),
    holderTag: proofRequest.holderBinding.holderTag,
    timestamp: proofRequest.timestamp,
    threshold: proofRequest.policy.threshold_raw,
    currencyCode: proofRequest.policy.required_currency_code,
  };
  
  await addProofToHistory(historyEntry);
  
  return bundle;
}

/**
 * Parse a proof bundle from JSON
 */
export function parseProofBundle(bundleJson: string): ProofBundle {
  try {
    const bundle = JSON.parse(bundleJson) as ProofBundle;
    
    // Validate required fields
    if (!bundle.version || !bundle.proofRequest || !bundle.bundleId) {
      throw new Error('Invalid bundle format: missing required fields');
    }
    
    // Validate proof request structure
    const pr = bundle.proofRequest;
    if (!pr.policy || !pr.fundingSources || !pr.holderBinding || !pr.timestamp) {
      throw new Error('Invalid proof request structure');
    }
    
    return bundle;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('Invalid JSON format');
    }
    throw error;
  }
}

