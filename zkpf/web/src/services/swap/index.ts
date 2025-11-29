/**
 * Cross-Chain Swap Service
 * 
 * Unified exports for NEAR Intents + SwapKit integration.
 * Standardizes "Swap to/from shielded ZEC" flows across Zcash wallets.
 * 
 * Production Configuration:
 * - Set VITE_SWAPKIT_API_KEY for SwapKit API key
 * - Set VITE_NEAR_NETWORK for NEAR network (mainnet/testnet)
 * - See config.ts for all environment variables
 */

// Types
export type {
  SwapChain,
  SwapAsset,
  ChainAsset,
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapRoute,
  SwapProvider,
  SwapFees,
  SwapHop,
  SwapStatus,
  SwapExecuteRequest,
  SwapExecuteResponse,
  SwapTrackingData,
  SwapSession,
  AutoShieldConfig,
  AutoShieldResult,
  FreshAddress,
  FreshAddressRequest,
  NetworkSeparationConfig,
  SwapServiceConfig,
  SwapServiceEvent,
  SwapServiceEventHandler,
} from './types';

export { DEFAULT_SWAP_CONFIG } from './types';

// Configuration
export {
  SWAPKIT_CONFIG,
  NEAR_INTENTS_CONFIG,
  ZCASH_SWAP_CONFIG,
  SUPPORTED_SWAP_CHAINS,
  buildProductionSwapConfig,
  getNearResolverContract,
  getNearRpcUrl,
  getNearIndexerUrl,
  hasSwapKitApiKey,
} from './config';

// Clients
export { SwapKitClient, createSwapKitClient } from './swapkit-client';
export { NearIntentsClient, createNearIntentsClient } from './near-intents-client';

// Service
export { SwapService, createSwapService, getSwapService } from './swap-service';
export type { AddressGeneratorCallback } from './swap-service';

