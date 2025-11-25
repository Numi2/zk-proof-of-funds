import type { SnapState } from '../types';

/**
 * Default snap state
 */
const DEFAULT_STATE: SnapState = {
  selectedPolicyId: null,
  fundingSources: [],
  lastProofTimestamp: null,
};

/**
 * Get the current snap state
 */
export async function getSnapState(): Promise<SnapState> {
  const state = await snap.request({
    method: 'snap_manageState',
    params: { operation: 'get' },
  });
  
  if (!state) {
    return DEFAULT_STATE;
  }
  
  return state as SnapState;
}

/**
 * Update the snap state
 */
export async function setSnapState(newState: Partial<SnapState>): Promise<SnapState> {
  const currentState = await getSnapState();
  const updatedState: SnapState = {
    ...currentState,
    ...newState,
  };
  
  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'update',
      newState: updatedState,
    },
  });
  
  return updatedState;
}

/**
 * Clear the snap state
 */
export async function clearSnapState(): Promise<void> {
  await snap.request({
    method: 'snap_manageState',
    params: {
      operation: 'clear',
    },
  });
}

