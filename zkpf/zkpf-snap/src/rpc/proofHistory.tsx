import type { ProofHistoryEntry } from '../types';
import type { Json } from '@metamask/snaps-sdk';
import { 
  getProofHistory, 
  clearProofHistory as clearHistory,
  setSnapState,
} from '../utils/state';
import { proofHistoryDialog, confirmClearHistoryDialog } from '../ui/dialogs';

/**
 * Get the user's proof history
 */
export async function listProofHistory(): Promise<ProofHistoryEntry[]> {
  return await getProofHistory();
}

/**
 * Get a specific proof from history by bundle ID
 */
export async function getProofFromHistory(
  bundleId: string,
): Promise<ProofHistoryEntry | null> {
  const history = await getProofHistory();
  return history.find((entry) => entry.bundleId === bundleId) || null;
}

/**
 * Clear all proof history with user confirmation
 */
export async function clearProofHistoryWithConfirmation(): Promise<boolean> {
  const confirmed = await confirmClearHistoryDialog();
  
  if (!confirmed) {
    return false;
  }
  
  await clearHistory();
  return true;
}

/**
 * Show proof history in a dialog
 */
export async function showProofHistoryDialog(): Promise<void> {
  const history = await getProofHistory();
  await proofHistoryDialog(history);
}

/**
 * Mark a proof as verified in history
 */
export async function markProofVerified(
  bundleId: string,
  verified: boolean,
): Promise<boolean> {
  const history = await getProofHistory();
  const index = history.findIndex((entry) => entry.bundleId === bundleId);
  
  if (index === -1) {
    return false;
  }
  
  // Update the entry in place
  history[index] = {
    ...history[index],
    verified,
  };
  
  // Directly set the updated history to preserve original order
  // (using addProofToHistory in a loop would reverse the order since it prepends)
  await setSnapState({
    proofHistory: history as unknown as Json[],
  });
  
  return true;
}

