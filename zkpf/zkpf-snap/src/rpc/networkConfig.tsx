import type { NetworkConfig, NetworkType } from '../types';
import { getNetworkConfig, setNetworkConfig } from '../utils/state';
import { confirmNetworkSwitchDialog } from '../ui/dialogs';

/**
 * Ethereum chain IDs for different networks
 */
const CHAIN_IDS: Record<NetworkType, string> = {
  mainnet: '0x1',
  testnet: '0xaa36a7', // Sepolia
};

/**
 * Zcash network mapping
 */
const ZCASH_NETWORKS: Record<NetworkType, 'main' | 'test'> = {
  mainnet: 'main',
  testnet: 'test',
};

/**
 * Get the current network configuration
 */
export async function getCurrentNetwork(): Promise<NetworkConfig> {
  return await getNetworkConfig();
}

/**
 * Switch to a different network
 */
export async function switchNetwork(
  network: NetworkType,
): Promise<NetworkConfig> {
  // Confirm with user
  const confirmed = await confirmNetworkSwitchDialog(network);
  
  if (!confirmed) {
    throw new Error('User rejected network switch');
  }
  
  const config: NetworkConfig = {
    network,
    zcashNetwork: ZCASH_NETWORKS[network],
    ethereumChainId: CHAIN_IDS[network],
  };
  
  // Attempt to switch Ethereum network - this is optional and may fail
  // if the user hasn't added the chain. We continue regardless since
  // the snap's network config is separate from MetaMask's active chain.
  await ethereum
    .request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: config.ethereumChainId }],
    })
    .catch(() => {
      // Expected: chain may not be added to user's MetaMask
    });
  
  await setNetworkConfig(config);
  
  return config;
}

/**
 * Get the Zcash network for the current configuration
 */
export async function getZcashNetwork(): Promise<'main' | 'test'> {
  const config = await getNetworkConfig();
  return config.zcashNetwork;
}

/**
 * Get the Ethereum chain ID for the current configuration
 */
export async function getEthereumChainId(): Promise<string> {
  const config = await getNetworkConfig();
  return config.ethereumChainId;
}

/**
 * Check if currently on mainnet
 */
export async function isMainnet(): Promise<boolean> {
  const config = await getNetworkConfig();
  return config.network === 'mainnet';
}

