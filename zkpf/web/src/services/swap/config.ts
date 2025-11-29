/**
 * Swap Service Configuration
 * 
 * Production configuration for NEAR Intents + SwapKit cross-chain ZEC rail.
 * 
 * Environment Variables:
 * - VITE_SWAPKIT_API_KEY: SwapKit API key for production rate limits
 * - VITE_SWAPKIT_API_URL: SwapKit API base URL (optional, defaults to production)
 * - VITE_NEAR_NETWORK: NEAR network (mainnet or testnet)
 * - VITE_NEAR_RPC_URL: NEAR RPC URL (optional, uses default for network)
 */

import type { SwapServiceConfig, SwapProvider, SwapChain } from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// ENVIRONMENT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get environment variable with fallback.
 */
function getEnv(key: string, fallback: string = ''): string {
  // Vite exposes env vars via import.meta.env
  if (typeof import.meta !== 'undefined' && import.meta.env) {
    return (import.meta.env as Record<string, string>)[key] || fallback;
  }
  // Node.js fallback
  if (typeof process !== 'undefined' && process.env) {
    return process.env[key] || fallback;
  }
  return fallback;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SWAPKIT CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SwapKit API Configuration
 * 
 * Production API: https://api.swapkit.dev (or https://api.thorswap.net)
 * 
 * Rate limits without API key: ~100 requests/minute
 * Rate limits with API key: ~1000 requests/minute
 * 
 * To get an API key: https://www.swapkit.dev/
 */
export const SWAPKIT_CONFIG = {
  /** Production SwapKit API endpoint */
  baseUrl: getEnv('VITE_SWAPKIT_API_URL', 'https://api.swapkit.dev'),
  
  /** API key for production rate limits (optional) */
  apiKey: getEnv('VITE_SWAPKIT_API_KEY', ''),
  
  /** Supported quote endpoints */
  endpoints: {
    quote: '/v1/quote',
    swap: '/v1/swap',
    track: '/v1/track',
    inboundAddresses: '/v1/inbound_addresses',
    chains: '/v1/chains',
  },
  
  /** Default slippage tolerance (0.5%) */
  defaultSlippage: 0.5,
  
  /** Quote validity period (ms) */
  quoteValidityMs: 60000, // 1 minute
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// NEAR INTENTS CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * NEAR Intents Configuration
 * 
 * NEAR Intents enable chain-abstracted swaps where users express intent
 * and resolvers compete to fill with best execution.
 * 
 * Primary Resolver: Defuse Protocol
 * - Mainnet contract: defuse.near
 * - Cross-chain swap resolution via THORChain/Maya liquidity
 * - ZEC integration via Maya Protocol
 */
export const NEAR_INTENTS_CONFIG = {
  /** Network: mainnet or testnet */
  networkId: getEnv('VITE_NEAR_NETWORK', 'mainnet') as 'mainnet' | 'testnet',
  
  /** NEAR RPC endpoints */
  rpcUrls: {
    mainnet: getEnv('VITE_NEAR_RPC_URL', 'https://rpc.mainnet.near.org'),
    testnet: 'https://rpc.testnet.near.org',
  },
  
  /** NEAR Indexer endpoints (for tracking intent status) */
  indexerUrls: {
    mainnet: 'https://api.fastnear.com',
    testnet: 'https://testnet-api.fastnear.com',
  },
  
  /** Known resolver contracts */
  resolvers: {
    /** Defuse Protocol - Primary intent resolver */
    defuse: {
      mainnet: 'defuse.near',
      testnet: 'defuse.testnet',
      description: 'Primary cross-chain swap resolver using THORChain/Maya liquidity',
    },
    /** Ref Finance - NEAR-native DEX */
    ref: {
      mainnet: 'v2.ref-finance.near',
      testnet: 'ref-finance-101.testnet',
      description: 'NEAR native DEX for NEAR token swaps',
    },
    /** Aurora - EVM chain resolver */
    aurora: {
      mainnet: 'aurora-intents.near',
      testnet: 'aurora-intents.testnet',
      description: 'EVM chain bridging via Aurora',
    },
  },
  
  /** Default resolver for ZEC swaps */
  defaultZecResolver: 'defuse',
  
  /** Intent configuration */
  intents: {
    /** Default deadline (10 minutes) */
    defaultDeadlineSeconds: 600,
    /** Minimum deadline (5 minutes) */
    minDeadlineSeconds: 300,
    /** Maximum deadline (1 hour) */
    maxDeadlineSeconds: 3600,
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// ZCASH CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Zcash-specific configuration for swap operations.
 */
export const ZCASH_SWAP_CONFIG = {
  /** Minimum ZEC amount for swaps (anti-dust) */
  minAmountZats: BigInt(100000), // 0.001 ZEC
  
  /** Maximum ZEC amount per swap (safety limit) */
  maxAmountZats: BigInt(100_000_000_000), // 1000 ZEC
  
  /** Confirmations required before auto-shielding */
  shieldConfirmations: 3,
  
  /** Privacy delay range for auto-shield (ms) */
  privacyDelayMs: {
    min: 10000,   // 10 seconds
    max: 300000,  // 5 minutes
  },
  
  /** Maya Protocol ZEC vault (for THORChain routing) */
  mayaVaults: {
    mainnet: 't1MayaProtocolZcashVaultMainnet', // Placeholder - get from Maya API
    testnet: 't1MayaProtocolZcashVaultTestnet',
  },
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORTED CHAINS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Chains supported for cross-chain swaps.
 */
export const SUPPORTED_SWAP_CHAINS: Record<string, {
  name: string;
  chainId: string;
  nativeAsset: string;
  enabled: boolean;
  swapKitId: string;
  nearIntentsId: string;
}> = {
  ethereum: {
    name: 'Ethereum',
    chainId: 'eip155:1',
    nativeAsset: 'ETH',
    enabled: true,
    swapKitId: 'ETH',
    nearIntentsId: 'eip155:1',
  },
  arbitrum: {
    name: 'Arbitrum',
    chainId: 'eip155:42161',
    nativeAsset: 'ETH',
    enabled: true,
    swapKitId: 'ARB',
    nearIntentsId: 'eip155:42161',
  },
  optimism: {
    name: 'Optimism',
    chainId: 'eip155:10',
    nativeAsset: 'ETH',
    enabled: true,
    swapKitId: 'OP',
    nearIntentsId: 'eip155:10',
  },
  base: {
    name: 'Base',
    chainId: 'eip155:8453',
    nativeAsset: 'ETH',
    enabled: true,
    swapKitId: 'BASE',
    nearIntentsId: 'eip155:8453',
  },
  polygon: {
    name: 'Polygon',
    chainId: 'eip155:137',
    nativeAsset: 'MATIC',
    enabled: true,
    swapKitId: 'MATIC',
    nearIntentsId: 'eip155:137',
  },
  solana: {
    name: 'Solana',
    chainId: 'solana:mainnet',
    nativeAsset: 'SOL',
    enabled: true,
    swapKitId: 'SOL',
    nearIntentsId: 'solana:mainnet',
  },
  bitcoin: {
    name: 'Bitcoin',
    chainId: 'bip122:000000000019d6689c085ae165831e93',
    nativeAsset: 'BTC',
    enabled: true,
    swapKitId: 'BTC',
    nearIntentsId: 'bip122:000000000019d6689c085ae165831e93',
  },
  zcash: {
    name: 'Zcash',
    chainId: 'zcash:mainnet',
    nativeAsset: 'ZEC',
    enabled: true,
    swapKitId: 'ZEC',
    nearIntentsId: 'zcash:mainnet',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD PRODUCTION CONFIG
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build production swap service configuration.
 */
export function buildProductionSwapConfig(): SwapServiceConfig {
  const nearNetwork = NEAR_INTENTS_CONFIG.networkId;
  
  return {
    defaultSlippage: SWAPKIT_CONFIG.defaultSlippage / 100, // Convert to decimal
    enabledProviders: ['thorchain', 'maya', 'near_intents', 'swapkit'] as SwapProvider[],
    enabledSourceChains: Object.keys(SUPPORTED_SWAP_CHAINS).filter(
      chain => SUPPORTED_SWAP_CHAINS[chain].enabled && chain !== 'zcash'
    ) as SwapChain[],
    enabledDestinationChains: Object.keys(SUPPORTED_SWAP_CHAINS).filter(
      chain => SUPPORTED_SWAP_CHAINS[chain].enabled && chain !== 'zcash'
    ) as SwapChain[],
    autoShield: {
      enabled: true,
      minAmountZats: ZCASH_SWAP_CONFIG.minAmountZats,
      confirmationsRequired: ZCASH_SWAP_CONFIG.shieldConfirmations,
      useFreshAddresses: true,
      privacyDelayMs: ZCASH_SWAP_CONFIG.privacyDelayMs,
    },
    networkSeparation: {
      separateEndpoints: true,
      randomDelays: true,
      delayRangeMs: { min: 500, max: 3000 },
    },
    quoteRefreshIntervalMs: 15000,
    maxQuoteAgeMs: SWAPKIT_CONFIG.quoteValidityMs,
    swapKitApi: {
      baseUrl: SWAPKIT_CONFIG.baseUrl,
      apiKey: SWAPKIT_CONFIG.apiKey || undefined,
    },
    nearIntents: {
      networkId: nearNetwork,
      resolverContract: NEAR_INTENTS_CONFIG.resolvers.defuse[nearNetwork],
      rpcUrl: NEAR_INTENTS_CONFIG.rpcUrls[nearNetwork],
    },
  };
}

/**
 * Get the current NEAR resolver contract address.
 */
export function getNearResolverContract(): string {
  const network = NEAR_INTENTS_CONFIG.networkId;
  return NEAR_INTENTS_CONFIG.resolvers.defuse[network];
}

/**
 * Get the current NEAR RPC URL.
 */
export function getNearRpcUrl(): string {
  const network = NEAR_INTENTS_CONFIG.networkId;
  return NEAR_INTENTS_CONFIG.rpcUrls[network];
}

/**
 * Get the current NEAR Indexer URL.
 */
export function getNearIndexerUrl(): string {
  const network = NEAR_INTENTS_CONFIG.networkId;
  return NEAR_INTENTS_CONFIG.indexerUrls[network];
}

/**
 * Check if we have a SwapKit API key configured.
 */
export function hasSwapKitApiKey(): boolean {
  return !!SWAPKIT_CONFIG.apiKey;
}

export default {
  SWAPKIT_CONFIG,
  NEAR_INTENTS_CONFIG,
  ZCASH_SWAP_CONFIG,
  SUPPORTED_SWAP_CHAINS,
  buildProductionSwapConfig,
  getNearResolverContract,
  getNearRpcUrl,
  getNearIndexerUrl,
  hasSwapKitApiKey,
};

