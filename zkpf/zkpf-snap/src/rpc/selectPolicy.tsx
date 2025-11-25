import type { PolicyDefinition } from '../types';
import { confirmPolicyDialog } from '../ui/dialogs';
import { setSnapState } from '../utils/state';

/**
 * Handle policy selection
 * Shows confirmation dialog and stores selection in snap state
 */
export async function selectPolicy(
  policy: PolicyDefinition,
  origin: string,
): Promise<{ success: boolean; policyId: number }> {
  // Show confirmation dialog
  const confirmed = await confirmPolicyDialog(policy);
  
  if (!confirmed) {
    throw new Error('User rejected policy selection');
  }
  
  // Store selected policy in state
  await setSnapState({
    selectedPolicyId: policy.policy_id,
  });
  
  return {
    success: true,
    policyId: policy.policy_id,
  };
}

