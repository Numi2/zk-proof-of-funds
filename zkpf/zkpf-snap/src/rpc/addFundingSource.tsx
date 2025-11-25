import type { FundingSource, EthereumFundingSource, ZcashFundingSource } from '../types';
import { 
  reviewFundingSourcesDialog, 
  inputUfvkDialog,
  inputSnapshotHeightDialog,
  inputBalanceZatsDialog,
} from '../ui/dialogs';
import { getSnapState, setSnapState } from '../utils/state';

/**
 * Get the connected Ethereum account from MetaMask
 */
export async function getConnectedEthereumAccount(): Promise<EthereumFundingSource> {
  // Use the ethereum provider to get the connected account
  const accounts = await ethereum.request({
    method: 'eth_requestAccounts',
  }) as string[];
  
  if (!accounts || accounts.length === 0) {
    throw new Error('No Ethereum accounts connected');
  }
  
  const chainId = await ethereum.request({
    method: 'eth_chainId',
  }) as string;
  
  return {
    type: 'ethereum',
    address: accounts[0],
    chainId,
  };
}

/**
 * Collect Zcash funding source via dialogs
 */
export async function collectZcashSource(): Promise<ZcashFundingSource | null> {
  // Get UFVK from user
  const ufvk = await inputUfvkDialog();
  if (!ufvk) {
    return null;
  }
  
  // Get snapshot height
  const snapshotHeight = await inputSnapshotHeightDialog();
  if (!snapshotHeight) {
    return null;
  }
  
  // Get balance
  const balanceZats = await inputBalanceZatsDialog();
  if (!balanceZats) {
    return null;
  }
  
  // Determine network from UFVK prefix
  const network: 'main' | 'test' = ufvk.startsWith('uviewtest') ? 'test' : 'main';
  
  return {
    type: 'zcash',
    ufvk,
    network,
    snapshotHeight,
    balanceZats,
  };
}

/**
 * Add a funding source to the proof request
 */
export async function addFundingSource(
  source: FundingSource,
  _origin: string,
): Promise<{ success: boolean; sources: FundingSource[] }> {
  const state = await getSnapState();
  
  // Parse existing sources from state
  const existingSources: FundingSource[] = state.fundingSources as unknown as FundingSource[] || [];
  
  // Check for duplicates
  const isDuplicate = existingSources.some((existing) => {
    if (source.type === 'ethereum' && existing.type === 'ethereum') {
      return existing.address.toLowerCase() === source.address.toLowerCase();
    }
    if (source.type === 'zcash' && existing.type === 'zcash') {
      return existing.ufvk === source.ufvk;
    }
    return false;
  });
  
  if (isDuplicate) {
    throw new Error('This funding source has already been added');
  }
  
  // Add the new source
  const updatedSources = [...existingSources, source];
  
  // Review all sources
  const confirmed = await reviewFundingSourcesDialog(updatedSources);
  if (!confirmed) {
    throw new Error('User rejected funding source addition');
  }
  
  // Store updated sources
  await setSnapState({
    fundingSources: updatedSources as unknown as import("@metamask/snaps-sdk").Json[],
  });
  
  return {
    success: true,
    sources: updatedSources,
  };
}

/**
 * Clear all funding sources
 */
export async function clearFundingSources(): Promise<void> {
  await setSnapState({
    fundingSources: [],
  });
}

/**
 * Get current funding sources from state
 */
export async function getFundingSources(): Promise<FundingSource[]> {
  const state = await getSnapState();
  return state.fundingSources as unknown as FundingSource[] || [];
}

