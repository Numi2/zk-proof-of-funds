/**
 * Cross-Chain Swap Service Types
 * 
 * Types for NEAR Intents + SwapKit integration for swapping to/from shielded ZEC.
 * This implements "TachyonWallet Coordinator v0" - standardizing cross-chain swaps
 * at the application layer without requiring Zcash consensus changes.
 * 
 * Design Philosophy (Tachyon Patterns at App Layer):
 * 
 * 1. EXPLICIT SECRET ROUTING
 *    - All swap metadata (quotes, tx hashes, routing paths) kept only in wallet
 *    - Never publish swap intents or routes on-chain
 *    - Local session storage for swap progress tracking
 * 
 * 2. NOTE HYGIENE
 *    - Always auto-shield incoming deposits to newly derived Orchard addresses
 *    - Never reuse t-addrs for deposits (fresh address per swap)
 *    - Full balance shielding to avoid linkable change
 * 
 * 3. NETWORK SEPARATION
 *    - Separate RPC endpoints for swap queries vs Zcash node
 *    - Optional Tor/proxy support for NEAR Intents calls
 *    - Random delays between requests to prevent timing correlation
 * 
 * References:
 * - SwapKit SDK: https://docs.swapkit.dev
 * - NEAR Intents: https://docs.near.org/intents
 * - Zashi NEAR Integration: Built into Zashi wallet for private swaps
 */

// ═══════════════════════════════════════════════════════════════════════════════
// SUPPORTED CHAINS & ASSETS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Chains supported for cross-chain swaps via SwapKit/NEAR Intents.
 */
export type SwapChain =
  | 'zcash'       // Destination for inbound, source for outbound
  | 'ethereum'
  | 'arbitrum'
  | 'optimism'
  | 'base'
  | 'polygon'
  | 'solana'
  | 'bitcoin'
  | 'near'
  | 'thorchain'
  | 'maya';

/**
 * Assets available for swaps.
 */
export type SwapAsset =
  | 'ZEC'
  | 'ETH'
  | 'BTC'
  | 'SOL'
  | 'USDC'
  | 'USDT'
  | 'DAI'
  | 'NEAR'
  | 'RUNE'
  | 'CACAO'
  | 'ARB'
  | 'OP';

/**
 * Chain + asset pair for swap operations.
 */
export interface ChainAsset {
  chain: SwapChain;
  asset: SwapAsset;
  contractAddress?: string; // For ERC-20 tokens
}

// ═══════════════════════════════════════════════════════════════════════════════
// SWAP QUOTE & ROUTE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Quote request for discovering swap routes.
 */
export interface SwapQuoteRequest {
  /** Source chain + asset */
  source: ChainAsset;
  /** Destination chain + asset */
  destination: ChainAsset;
  /** Amount in smallest unit (e.g., satoshis, wei, zatoshis) */
  amountIn: bigint;
  /** Wallet address on source chain */
  sourceAddress: string;
  /** Wallet address on destination chain */
  destinationAddress: string;
  /** Max slippage tolerance (e.g., 0.005 = 0.5%) */
  slippageTolerance?: number;
  /** Preferred routing providers */
  preferredProviders?: SwapProvider[];
}

/**
 * Providers for swap routing.
 */
export type SwapProvider =
  | 'thorchain'    // THORChain native
  | 'maya'         // Maya Protocol
  | 'near_intents' // NEAR Intents (chain abstraction)
  | 'swapkit'      // SwapKit aggregator
  | '1inch'        // 1inch DEX aggregator
  | 'jupiter';     // Solana Jupiter

/**
 * A discovered swap route.
 */
export interface SwapRoute {
  /** Unique route identifier */
  routeId: string;
  /** Provider offering this route */
  provider: SwapProvider;
  /** Source chain + asset */
  source: ChainAsset;
  /** Destination chain + asset */
  destination: ChainAsset;
  /** Input amount (smallest unit) */
  amountIn: bigint;
  /** Expected output amount (smallest unit) */
  expectedAmountOut: bigint;
  /** Minimum output with slippage */
  minimumAmountOut: bigint;
  /** Fee breakdown */
  fees: SwapFees;
  /** Estimated time in seconds */
  estimatedTimeSeconds: number;
  /** Route hops (for multi-hop swaps) */
  hops: SwapHop[];
  /** Route expiry timestamp */
  expiresAt: number;
  /** Additional route metadata */
  metadata: Record<string, unknown>;
}

/**
 * Individual hop in a multi-hop swap.
 */
export interface SwapHop {
  /** Hop index (0-based) */
  index: number;
  /** Source for this hop */
  from: ChainAsset;
  /** Destination for this hop */
  to: ChainAsset;
  /** Protocol/pool used */
  protocol: string;
  /** Pool address or identifier */
  poolId?: string;
  /** Expected rate */
  rate: number;
}

/**
 * Fee breakdown for a swap.
 */
export interface SwapFees {
  /** Protocol fee (in source asset) */
  protocolFee: bigint;
  /** Network/gas fee (in source asset) */
  networkFee: bigint;
  /** Affiliate fee if any */
  affiliateFee: bigint;
  /** Total fees */
  totalFee: bigint;
  /** Fee percentage (0-100) */
  feePercentage: number;
}

/**
 * Quote response containing all available routes.
 */
export interface SwapQuoteResponse {
  /** All discovered routes, sorted by best value */
  routes: SwapRoute[];
  /** Recommended (best) route */
  recommended: SwapRoute | null;
  /** Routes that failed to quote and why */
  errors: {
    provider: SwapProvider;
    reason: string;
  }[];
  /** Timestamp when quote was fetched */
  quotedAt: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SWAP EXECUTION TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Status of a swap transaction.
 */
export type SwapStatus =
  | 'idle'                    // Not started
  | 'awaiting_deposit'        // Deposit address generated, awaiting user deposit
  | 'deposit_detected'        // Deposit seen in mempool
  | 'deposit_confirmed'       // Deposit confirmed on source chain
  | 'swap_in_progress'        // Swap executing on intermediate chains
  | 'output_pending'          // Output transaction pending
  | 'output_confirmed'        // Output confirmed on destination chain
  | 'auto_shielding'          // (Zcash only) Auto-shielding to Orchard
  | 'completed'               // Swap complete, funds in shielded pool
  | 'failed'                  // Swap failed
  | 'refunded';               // Swap failed, funds refunded

/**
 * Request to execute a swap.
 */
export interface SwapExecuteRequest {
  /** Route to execute */
  route: SwapRoute;
  /** User's source address (for outbound) */
  sourceAddress?: string;
  /** Fresh transparent ZEC address (for inbound swaps) */
  zcashTransparentAddress: string;
  /** Orchard address for auto-shielding (for inbound swaps) */
  zcashOrchardAddress: string;
  /** Whether to auto-shield on arrival */
  autoShield: boolean;
  /** User signature/authorization */
  authorization?: string;
}

/**
 * Response from initiating a swap.
 */
export interface SwapExecuteResponse {
  /** Unique swap identifier */
  swapId: string;
  /** Deposit address on source chain (for inbound swaps) */
  depositAddress?: string;
  /** Memo to include with deposit (if required) */
  depositMemo?: string;
  /** Amount to deposit */
  depositAmount: bigint;
  /** Current swap status */
  status: SwapStatus;
  /** Expected output amount */
  expectedOutput: bigint;
  /** Estimated completion time */
  estimatedCompletionAt: number;
  /** Provider-specific tracking data */
  trackingData: SwapTrackingData;
}

/**
 * Tracking data for monitoring swap progress.
 */
export interface SwapTrackingData {
  /** Provider handling the swap */
  provider: SwapProvider;
  /** Provider's internal swap ID */
  providerSwapId: string;
  /** Source chain transaction hash */
  sourceTxHash?: string;
  /** Destination chain transaction hash */
  destinationTxHash?: string;
  /** Zcash shield transaction hash (for inbound) */
  shieldTxHash?: string;
  /** THORChain/Maya inbound address */
  inboundAddress?: string;
  /** NEAR Intent ID */
  nearIntentId?: string;
  /** Tracking URL */
  trackingUrl?: string;
}

/**
 * Full swap session with all metadata.
 */
export interface SwapSession {
  /** Unique session ID (local) */
  sessionId: string;
  /** Direction: inbound (→ ZEC) or outbound (ZEC →) */
  direction: 'inbound' | 'outbound';
  /** Source chain + asset */
  source: ChainAsset;
  /** Destination chain + asset */
  destination: ChainAsset;
  /** Input amount */
  amountIn: bigint;
  /** Expected output */
  expectedAmountOut: bigint;
  /** Actual output (after completion) */
  actualAmountOut?: bigint;
  /** Current status */
  status: SwapStatus;
  /** Selected route */
  route: SwapRoute;
  /** Tracking data */
  tracking: SwapTrackingData;
  /** Timestamps */
  timestamps: {
    created: number;
    depositDetected?: number;
    depositConfirmed?: number;
    swapStarted?: number;
    outputPending?: number;
    outputConfirmed?: number;
    shieldingStarted?: number;
    completed?: number;
    failed?: number;
  };
  /** Error if failed */
  error?: string;
  /** Fresh t-addr used for this swap (never reuse) */
  freshTransparentAddress?: string;
  /** Fresh Orchard address for shielding */
  freshOrchardAddress?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTO-SHIELD TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for auto-shielding incoming deposits.
 */
export interface AutoShieldConfig {
  /** Enable auto-shielding */
  enabled: boolean;
  /** Minimum amount to auto-shield (zatoshis) */
  minAmountZats: bigint;
  /** Maximum amount per shield transaction (zatoshis) */
  maxAmountZats?: bigint;
  /** Wait for N confirmations before shielding */
  confirmationsRequired: number;
  /** Auto-shield to a fresh Orchard address each time */
  useFreshAddresses: boolean;
  /** Privacy delay (random delay to prevent timing correlation) */
  privacyDelayMs?: {
    min: number;
    max: number;
  };
}

/**
 * Result of an auto-shield operation.
 */
export interface AutoShieldResult {
  /** Source transparent address */
  fromTransparent: string;
  /** Destination Orchard address */
  toOrchard: string;
  /** Amount shielded (zatoshis) */
  amountZats: bigint;
  /** Shield transaction hash */
  txHash: string;
  /** Block height when confirmed */
  blockHeight?: number;
  /** Status */
  status: 'pending' | 'confirmed' | 'failed';
  /** Error if failed */
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PRIVACY HYGIENE TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Address generation request for privacy-preserving swaps.
 */
export interface FreshAddressRequest {
  /** Type of address needed */
  type: 'transparent' | 'orchard' | 'unified';
  /** Purpose (for internal tracking only) */
  purpose: 'swap_deposit' | 'swap_change' | 'shield_destination';
  /** Associated swap session ID (for local tracking) */
  swapSessionId?: string;
}

/**
 * Generated fresh address with metadata.
 */
export interface FreshAddress {
  /** The address string */
  address: string;
  /** Type of address */
  type: 'transparent' | 'orchard' | 'unified';
  /** Account index used for derivation */
  accountIndex: number;
  /** Diversifier index (for privacy) */
  diversifierIndex: bigint;
  /** Whether this address has been used */
  used: boolean;
  /** Created timestamp */
  createdAt: number;
}

/**
 * Network separation configuration.
 * Keep swap RPC calls separate from Zcash node RPC to prevent correlation.
 */
export interface NetworkSeparationConfig {
  /** Use separate RPC endpoints for swap queries */
  separateEndpoints: boolean;
  /** Proxy for NEAR Intents calls */
  nearIntentsProxy?: string;
  /** Proxy for SwapKit calls */
  swapKitProxy?: string;
  /** Proxy for Zcash lightwalletd */
  zcashLwdProxy?: string;
  /** Add random delays between requests */
  randomDelays: boolean;
  /** Delay range in milliseconds */
  delayRangeMs?: { min: number; max: number };
}

// ═══════════════════════════════════════════════════════════════════════════════
// SERVICE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Configuration for the swap service.
 */
export interface SwapServiceConfig {
  /** Default slippage tolerance */
  defaultSlippage: number;
  /** Enabled swap providers */
  enabledProviders: SwapProvider[];
  /** Enabled source chains (for outbound swaps) */
  enabledSourceChains: SwapChain[];
  /** Enabled destination chains (for inbound swaps) */
  enabledDestinationChains: SwapChain[];
  /** Auto-shield configuration */
  autoShield: AutoShieldConfig;
  /** Network separation config */
  networkSeparation: NetworkSeparationConfig;
  /** Quote refresh interval (ms) */
  quoteRefreshIntervalMs: number;
  /** Maximum age for cached quotes (ms) */
  maxQuoteAgeMs: number;
  /** SwapKit API configuration */
  swapKitApi?: {
    baseUrl: string;
    apiKey?: string;
  };
  /** NEAR Intents configuration */
  nearIntents?: {
    networkId: 'mainnet' | 'testnet';
    resolverContract: string;
    rpcUrl?: string;
  };
}

/**
 * Default swap service configuration.
 */
export const DEFAULT_SWAP_CONFIG: SwapServiceConfig = {
  defaultSlippage: 0.005, // 0.5%
  enabledProviders: ['thorchain', 'maya', 'near_intents', 'swapkit'],
  enabledSourceChains: ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'solana', 'bitcoin'],
  enabledDestinationChains: ['ethereum', 'arbitrum', 'optimism', 'base', 'polygon', 'solana'],
  autoShield: {
    enabled: true,
    minAmountZats: BigInt(100000), // 0.001 ZEC
    confirmationsRequired: 3,
    useFreshAddresses: true,
    privacyDelayMs: {
      min: 10000,   // 10 seconds
      max: 300000,  // 5 minutes
    },
  },
  networkSeparation: {
    separateEndpoints: true,
    randomDelays: true,
    delayRangeMs: { min: 500, max: 3000 },
  },
  quoteRefreshIntervalMs: 15000, // 15 seconds
  maxQuoteAgeMs: 60000, // 1 minute
  swapKitApi: {
    baseUrl: 'https://api.swapkit.dev',
  },
  nearIntents: {
    networkId: 'mainnet',
    resolverContract: 'intents.near',
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// EVENTS & CALLBACKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Events emitted by the swap service.
 */
export type SwapServiceEvent =
  | { type: 'QUOTE_FETCHED'; quotes: SwapQuoteResponse }
  | { type: 'SWAP_INITIATED'; session: SwapSession }
  | { type: 'SWAP_STATUS_UPDATED'; session: SwapSession }
  | { type: 'DEPOSIT_DETECTED'; session: SwapSession; txHash: string }
  | { type: 'DEPOSIT_CONFIRMED'; session: SwapSession; txHash: string }
  | { type: 'OUTPUT_PENDING'; session: SwapSession; txHash: string }
  | { type: 'OUTPUT_CONFIRMED'; session: SwapSession; txHash: string }
  | { type: 'AUTO_SHIELDING_STARTED'; session: SwapSession }
  | { type: 'AUTO_SHIELD_COMPLETE'; session: SwapSession; result: AutoShieldResult }
  | { type: 'SWAP_COMPLETED'; session: SwapSession }
  | { type: 'SWAP_FAILED'; session: SwapSession; error: string }
  | { type: 'ERROR'; error: string; context?: string };

/**
 * Callback for swap service events.
 */
export type SwapServiceEventHandler = (event: SwapServiceEvent) => void;

