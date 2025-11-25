import type { SnapState, ProofHistoryEntry, NetworkConfig } from '../types';
import type { Json } from '@metamask/snaps-sdk';

/**
 * Default network configuration
 */
const DEFAULT_NETWORK_CONFIG: NetworkConfig = {
  network: 'mainnet',
  zcashNetwork: 'main',
  ethereumChainId: '0x1',
};

/**
 * Default snap state
 */
const DEFAULT_STATE: SnapState = {
  selectedPolicyId: null,
  fundingSources: [],
  lastProofTimestamp: null,
  proofHistory: [],
  networkConfig: DEFAULT_NETWORK_CONFIG as unknown as Json,
  holderFingerprint: null,
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
  
  // Merge with defaults to handle any missing fields from older versions
  return {
    ...DEFAULT_STATE,
    ...(state as SnapState),
  };
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

/**
 * Get proof history from state
 */
export async function getProofHistory(): Promise<ProofHistoryEntry[]> {
  const state = await getSnapState();
  return (state.proofHistory as unknown as ProofHistoryEntry[]) || [];
}

/**
 * Add a proof to history
 */
export async function addProofToHistory(entry: ProofHistoryEntry): Promise<void> {
  const history = await getProofHistory();
  
  // Keep only last 50 proofs to manage storage
  const updatedHistory = [entry, ...history].slice(0, 50);
  
  await setSnapState({
    proofHistory: updatedHistory as unknown as Json[],
  });
}

/**
 * Clear proof history
 */
export async function clearProofHistory(): Promise<void> {
  await setSnapState({
    proofHistory: [],
  });
}

/**
 * Get network configuration
 */
export async function getNetworkConfig(): Promise<NetworkConfig> {
  const state = await getSnapState();
  return (state.networkConfig as unknown as NetworkConfig) || DEFAULT_NETWORK_CONFIG;
}

/**
 * Set network configuration
 */
export async function setNetworkConfig(config: NetworkConfig): Promise<void> {
  await setSnapState({
    networkConfig: config as unknown as Json,
  });
}

/**
 * Get holder fingerprint from state
 */
export async function getHolderFingerprint(): Promise<string | null> {
  const state = await getSnapState();
  return state.holderFingerprint;
}

/**
 * Set holder fingerprint
 */
export async function setHolderFingerprint(fingerprint: string): Promise<void> {
  await setSnapState({
    holderFingerprint: fingerprint,
  });
}

