import type { PolicyDefinition, FundingSource, ProofRequest, HolderBinding } from '../types';
import { proofSuccessDialog, errorDialog } from '../ui/dialogs';
import { policyDisplayName } from '../utils/policy';
import { getSnapState, setSnapState } from '../utils/state';
import { bindHolder } from './bindHolder';
import { getFundingSources } from './addFundingSource';

/**
 * Create a complete proof of funds request
 * This is the main flow that combines:
 * 1. Policy selection (already done)
 * 2. Funding sources (already collected)
 * 3. Holder binding (sign and generate holder_tag)
 */
export async function createProof(
  policy: PolicyDefinition,
  origin: string,
): Promise<ProofRequest> {
  // Get funding sources from state
  const fundingSources = await getFundingSources();
  
  if (fundingSources.length === 0) {
    throw new Error('No funding sources added. Please add at least one funding source.');
  }

  // Use a single timestamp for both the holder binding message and the
  // outer proof request so verifiers see a consistent creation time.
  const timestamp = Math.floor(Date.now() / 1000);
  
  // Bind the holder identity
  let holderBinding: HolderBinding;
  try {
    holderBinding = await bindHolder(policy, fundingSources, origin, timestamp);
  } catch (error) {
    await errorDialog(
      'Binding Failed',
      error instanceof Error ? error.message : 'Failed to bind holder identity',
    );
    throw error;
  }
  
  // Create the proof request
  const proofRequest: ProofRequest = {
    policy,
    fundingSources,
    holderBinding,
    timestamp,
  };
  
  // Update state with last proof timestamp
  await setSnapState({
    lastProofTimestamp: timestamp,
  });
  
  // Show success dialog
  await proofSuccessDialog(
    holderBinding.holderTag,
    policyDisplayName(policy),
  );
  
  return proofRequest;
}

/**
 * Get the current proof state (for UI display)
 */
export async function getProofState(): Promise<{
  selectedPolicyId: number | null;
  fundingSources: FundingSource[];
  lastProofTimestamp: number | null;
}> {
  const state = await getSnapState();
  
  return {
    selectedPolicyId: state.selectedPolicyId,
    fundingSources: state.fundingSources as unknown as FundingSource[] || [],
    lastProofTimestamp: state.lastProofTimestamp,
  };
}

/**
 * Reset the proof state (clear all selections)
 */
export async function resetProofState(): Promise<void> {
  await setSnapState({
    selectedPolicyId: null,
    fundingSources: [],
    lastProofTimestamp: null,
  });
}

