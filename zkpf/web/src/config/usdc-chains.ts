/**
 * USDC Chain Configuration
 * 
 * This file defines the supported chains for USDC holdings and on-ramp functionality.
 * Each chain includes contract addresses, RPC endpoints, and on-ramp provider support.
 */

export type OnRampProvider = 'coinbase' | 'transak' | 'moneygram';

export interface UsdcChainConfig {
  /** Chain ID (numeric for EVM, string for Starknet) */
  chainId: number | string;
  /** Human-readable chain name */
  name: string;
  /** USDC contract address on this chain */
  usdcAddress: string;
  /** RPC endpoint URL */
  rpcUrl: string;
  /** Block explorer base URL */
  explorerUrl: string;
  /** On-ramp providers that support this chain */
  onrampSupported: OnRampProvider[];
  /** Corresponding zkpf rail ID for proof-of-funds */
  zkpfRailId?: string;
  /** Whether this is a Layer 2 network */
  isL2: boolean;
  /** Native token symbol (for gas estimation) */
  nativeToken: string;
  /** Chain logo URL */
  logoUrl?: string;
}

/**
 * USDC contract addresses and chain configurations.
 * These are the official Circle-issued native USDC contracts.
 */
export const USDC_CHAINS: Record<string, UsdcChainConfig> = {
  ethereum: {
    chainId: 1,
    name: 'Ethereum',
    usdcAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
    rpcUrl: 'https://eth.llamarpc.com',
    explorerUrl: 'https://etherscan.io',
    onrampSupported: ['coinbase', 'transak', 'moneygram'],
    zkpfRailId: 'ONCHAIN_WALLET',
    isL2: false,
    nativeToken: 'ETH',
    logoUrl: '/icons/chains/ethereum.svg',
  },
  base: {
    chainId: 8453,
    name: 'Base',
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    rpcUrl: 'https://mainnet.base.org',
    explorerUrl: 'https://basescan.org',
    onrampSupported: ['coinbase', 'transak'],
    zkpfRailId: 'ONCHAIN_WALLET',
    isL2: true,
    nativeToken: 'ETH',
    logoUrl: '/icons/chains/base.svg',
  },
  arbitrum: {
    chainId: 42161,
    name: 'Arbitrum One',
    usdcAddress: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    explorerUrl: 'https://arbiscan.io',
    onrampSupported: ['coinbase', 'transak'],
    zkpfRailId: 'ONCHAIN_WALLET',
    isL2: true,
    nativeToken: 'ETH',
    logoUrl: '/icons/chains/arbitrum.svg',
  },
  optimism: {
    chainId: 10,
    name: 'Optimism',
    usdcAddress: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
    rpcUrl: 'https://mainnet.optimism.io',
    explorerUrl: 'https://optimistic.etherscan.io',
    onrampSupported: ['coinbase', 'transak'],
    zkpfRailId: 'ONCHAIN_WALLET',
    isL2: true,
    nativeToken: 'ETH',
    logoUrl: '/icons/chains/optimism.svg',
  },
  polygon: {
    chainId: 137,
    name: 'Polygon',
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    rpcUrl: 'https://polygon-rpc.com',
    explorerUrl: 'https://polygonscan.com',
    onrampSupported: ['coinbase', 'transak'],
    zkpfRailId: 'ONCHAIN_WALLET',
    isL2: true,
    nativeToken: 'MATIC',
    logoUrl: '/icons/chains/polygon.svg',
  },
  starknet: {
    chainId: 'SN_MAIN',
    name: 'Starknet',
    usdcAddress: '0x053c91253bc9682c04929ca02ed00b3e423f6710d2ee7e0d5ebb06f3ecf368a8',
    rpcUrl: 'https://starknet-mainnet.public.blastapi.io',
    explorerUrl: 'https://starkscan.co',
    onrampSupported: ['transak'],
    zkpfRailId: 'STARKNET_L2',
    isL2: true,
    nativeToken: 'ETH',
    logoUrl: '/icons/chains/starknet.svg',
  },
  avalanche: {
    chainId: 43114,
    name: 'Avalanche C-Chain',
    usdcAddress: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
    rpcUrl: 'https://api.avax.network/ext/bc/C/rpc',
    explorerUrl: 'https://snowtrace.io',
    onrampSupported: ['coinbase', 'transak'],
    zkpfRailId: 'ONCHAIN_WALLET',
    isL2: false,
    nativeToken: 'AVAX',
    logoUrl: '/icons/chains/avalanche.svg',
  },
};

/**
 * Testnet USDC configurations for development/testing.
 */
export const USDC_TESTNETS: Record<string, UsdcChainConfig> = {
  sepolia: {
    chainId: 11155111,
    name: 'Sepolia',
    usdcAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    rpcUrl: 'https://rpc.sepolia.org',
    explorerUrl: 'https://sepolia.etherscan.io',
    onrampSupported: ['transak'], // Coinbase doesn't support testnets
    zkpfRailId: 'ONCHAIN_WALLET',
    isL2: false,
    nativeToken: 'ETH',
  },
  baseSepolia: {
    chainId: 84532,
    name: 'Base Sepolia',
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    rpcUrl: 'https://sepolia.base.org',
    explorerUrl: 'https://sepolia.basescan.org',
    onrampSupported: [],
    zkpfRailId: 'ONCHAIN_WALLET',
    isL2: true,
    nativeToken: 'ETH',
  },
  starknetSepolia: {
    chainId: 'SN_SEPOLIA',
    name: 'Starknet Sepolia',
    usdcAddress: '0x053b40a647cedfca6ca84f542a0fe36736031905a9639a7f19a3c1e66bfd5080',
    rpcUrl: 'https://starknet-sepolia.public.blastapi.io',
    explorerUrl: 'https://sepolia.starkscan.co',
    onrampSupported: [],
    zkpfRailId: 'STARKNET_L2',
    isL2: true,
    nativeToken: 'ETH',
  },
};

/**
 * Get chain config by chain ID.
 */
export function getChainByChainId(chainId: number | string): UsdcChainConfig | undefined {
  return Object.values(USDC_CHAINS).find(c => c.chainId === chainId);
}

/**
 * Get chain config by key.
 */
export function getChainByKey(key: string): UsdcChainConfig | undefined {
  return USDC_CHAINS[key];
}

/**
 * Get all chains that support a specific on-ramp provider.
 */
export function getChainsByProvider(provider: OnRampProvider): UsdcChainConfig[] {
  return Object.values(USDC_CHAINS).filter(c => c.onrampSupported.includes(provider));
}

/**
 * Get the recommended chain for USDC (lowest fees, best UX).
 * Currently Base is recommended due to low fees and Coinbase native support.
 */
export function getRecommendedChain(): UsdcChainConfig {
  return USDC_CHAINS.base;
}

/**
 * Check if a chain supports the specified on-ramp provider.
 */
export function chainSupportsProvider(chainKey: string, provider: OnRampProvider): boolean {
  const chain = USDC_CHAINS[chainKey];
  return chain?.onrampSupported.includes(provider) ?? false;
}

/**
 * Get the best available provider for a chain.
 * Prefers Coinbase (zero fee) when available.
 */
export function getBestProviderForChain(chainKey: string): OnRampProvider | null {
  const chain = USDC_CHAINS[chainKey];
  if (!chain || chain.onrampSupported.length === 0) return null;
  
  // Prefer Coinbase for zero-fee USDC
  if (chain.onrampSupported.includes('coinbase')) return 'coinbase';
  if (chain.onrampSupported.includes('transak')) return 'transak';
  if (chain.onrampSupported.includes('moneygram')) return 'moneygram';
  
  return chain.onrampSupported[0];
}

/**
 * Format USDC amount from raw units (6 decimals) to display string.
 */
export function formatUsdc(amount: bigint | number, decimals: number = 2): string {
  const value = typeof amount === 'bigint' ? Number(amount) / 1e6 : amount / 1e6;
  return value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Parse USDC amount from display string to raw units (6 decimals).
 */
export function parseUsdc(displayAmount: string): bigint {
  const value = parseFloat(displayAmount.replace(/[,\s]/g, ''));
  return BigInt(Math.round(value * 1e6));
}

/**
 * Currency code for USDC in zkpf policy system.
 */
export const USDC_CURRENCY_CODE = 2001;

/**
 * USDC decimals (same across all chains).
 */
export const USDC_DECIMALS = 6;

