/**
 * SwapKit Client
 * 
 * Integration layer for SwapKit SDK - provides cross-chain swap route discovery
 * and execution via THORChain, Maya Protocol, and other DEX aggregators.
 * 
 * SwapKit is the "TachyonWallet Coordinator v0" for cross-chain swaps at the
 * application layer, without requiring Zcash consensus changes.
 */

import type {
  SwapQuoteRequest,
  SwapQuoteResponse,
  SwapRoute,
  SwapProvider,
  SwapFees,
  SwapHop,
  ChainAsset,
  SwapServiceConfig,
} from './types';

// ═══════════════════════════════════════════════════════════════════════════════
// SWAPKIT API TYPES
// ═══════════════════════════════════════════════════════════════════════════════

interface SwapKitQuoteParams {
  sellAsset: string;       // Format: CHAIN.ASSET (e.g., "ETH.ETH", "BTC.BTC")
  buyAsset: string;        // Format: CHAIN.ASSET
  sellAmount: string;      // Amount as string
  senderAddress: string;
  recipientAddress: string;
  slippage?: string;       // Percentage as string (e.g., "0.5")
  affiliateAddress?: string;
  affiliateBasisPoints?: string;
}

interface SwapKitQuoteResponse {
  routes: SwapKitRoute[];
  error?: string;
}

interface SwapKitRoute {
  providers: string[];
  sellAsset: string;
  sellAmount: string;
  buyAsset: string;
  expectedBuyAmount: string;
  expectedBuyAmountMaxSlippage: string;
  fees: {
    affiliate: string;
    outbound: string;
    liquidity: string;
    total: string;
    slippage: string;
  };
  estimatedTime: number;  // seconds
  expiry: number;         // Unix timestamp
  memo?: string;
  inboundAddress?: string;
  path?: SwapKitHop[];
}

interface SwapKitHop {
  provider: string;
  sellAsset: string;
  buyAsset: string;
  sellAmount: string;
  buyAmount: string;
  pool?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ASSET CONVERSION
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Convert our ChainAsset to SwapKit's asset string format.
 * SwapKit uses "CHAIN.ASSET" format (e.g., "ETH.ETH", "ETH.USDC", "BTC.BTC").
 */
function toSwapKitAsset(chainAsset: ChainAsset): string {
  const chainMap: Record<string, string> = {
    zcash: 'ZEC',
    ethereum: 'ETH',
    arbitrum: 'ARB',
    optimism: 'OP',
    base: 'BASE',
    polygon: 'MATIC',
    solana: 'SOL',
    bitcoin: 'BTC',
    thorchain: 'THOR',
    maya: 'MAYA',
    near: 'NEAR',
  };

  const chain = chainMap[chainAsset.chain] || chainAsset.chain.toUpperCase();
  
  // For native assets, format is CHAIN.CHAIN (e.g., ETH.ETH)
  // For tokens, format is CHAIN.TOKEN or CHAIN.TOKEN-CONTRACT
  if (chainAsset.contractAddress) {
    return `${chain}.${chainAsset.asset}-${chainAsset.contractAddress}`;
  }
  
  // Native assets
  const nativeAssets: Record<string, string> = {
    ETH: 'ETH.ETH',
    BTC: 'BTC.BTC',
    SOL: 'SOL.SOL',
    ZEC: 'ZEC.ZEC',
    NEAR: 'NEAR.NEAR',
    RUNE: 'THOR.RUNE',
    CACAO: 'MAYA.CACAO',
  };
  
  if (nativeAssets[chainAsset.asset]) {
    return nativeAssets[chainAsset.asset];
  }
  
  return `${chain}.${chainAsset.asset}`;
}

/**
 * Convert SwapKit asset string to our ChainAsset format.
 */
function fromSwapKitAsset(swapKitAsset: string): ChainAsset {
  const parts = swapKitAsset.split('.');
  const chain = parts[0].toLowerCase() as ChainAsset['chain'];
  const assetParts = parts[1]?.split('-') || [parts[0]];
  const asset = assetParts[0] as ChainAsset['asset'];
  const contractAddress = assetParts[1];

  const chainMap: Record<string, ChainAsset['chain']> = {
    eth: 'ethereum',
    arb: 'arbitrum',
    op: 'optimism',
    base: 'base',
    matic: 'polygon',
    sol: 'solana',
    btc: 'bitcoin',
    zec: 'zcash',
    thor: 'thorchain',
    maya: 'maya',
    near: 'near',
  };

  return {
    chain: chainMap[chain] || chain,
    asset,
    contractAddress,
  };
}

/**
 * Convert SwapKit provider string to our SwapProvider type.
 */
function toSwapProvider(provider: string): SwapProvider {
  const providerMap: Record<string, SwapProvider> = {
    thorchain: 'thorchain',
    thorswap: 'thorchain',
    mayachain: 'maya',
    maya: 'maya',
    '1inch': '1inch',
    jupiter: 'jupiter',
    swapkit: 'swapkit',
  };
  
  return providerMap[provider.toLowerCase()] || 'swapkit';
}

// ═══════════════════════════════════════════════════════════════════════════════
// SWAPKIT CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Client for interacting with SwapKit API.
 * 
 * SwapKit provides cross-chain swap routing via:
 * - THORChain (native DEX for BTC, ETH, etc.)
 * - Maya Protocol (ZEC integration for Zcash)
 * - ChainFlip (additional liquidity sources)
 * 
 * Production endpoints:
 * - API: https://api.swapkit.dev (or https://api.thorswap.net)
 * - ZEC inbound requires Maya Protocol routing
 */
export class SwapKitClient {
  private baseUrl: string;
  private apiKey?: string;
  private config: SwapServiceConfig;

  constructor(config: SwapServiceConfig) {
    this.config = config;
    // Production SwapKit API endpoint
    this.baseUrl = config.swapKitApi?.baseUrl || 'https://api.swapkit.dev';
    this.apiKey = config.swapKitApi?.apiKey;
  }

  /**
   * Fetch a quote for a cross-chain swap.
   */
  async getQuote(request: SwapQuoteRequest): Promise<SwapQuoteResponse> {
    try {
      // Apply network separation delays if configured
      if (this.config.networkSeparation.randomDelays) {
        const { min, max } = this.config.networkSeparation.delayRangeMs || { min: 500, max: 3000 };
        const delay = Math.floor(Math.random() * (max - min) + min);
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      const params: SwapKitQuoteParams = {
        sellAsset: toSwapKitAsset(request.source),
        buyAsset: toSwapKitAsset(request.destination),
        sellAmount: request.amountIn.toString(),
        senderAddress: request.sourceAddress,
        recipientAddress: request.destinationAddress,
        slippage: ((request.slippageTolerance || this.config.defaultSlippage) * 100).toString(),
      };

      const queryString = new URLSearchParams(
        Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
      ).toString();

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };
      if (this.apiKey) {
        headers['x-api-key'] = this.apiKey;
      }

      const response = await fetch(`${this.baseUrl}/v1/quote?${queryString}`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`SwapKit quote failed: ${response.status} ${errorText}`);
      }

      const data: SwapKitQuoteResponse = await response.json();

      if (data.error) {
        throw new Error(`SwapKit error: ${data.error}`);
      }

      // Convert SwapKit routes to our format
      const routes = data.routes.map((route, index) => this.convertRoute(route, request, index));

      // Sort by expected output (descending)
      routes.sort((a, b) => {
        const diff = b.expectedAmountOut - a.expectedAmountOut;
        return diff > 0n ? 1 : diff < 0n ? -1 : 0;
      });

      return {
        routes,
        recommended: routes[0] || null,
        errors: [],
        quotedAt: Date.now(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        routes: [],
        recommended: null,
        errors: [{ provider: 'swapkit' as const, reason: errorMessage }],
        quotedAt: Date.now(),
      };
    }
  }

  /**
   * Get inbound addresses for supported chains (THORChain/Maya vault addresses).
   */
  async getInboundAddresses(): Promise<Map<string, string>> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/inbound_addresses`);
      if (!response.ok) {
        throw new Error(`Failed to fetch inbound addresses: ${response.status}`);
      }

      const data: Array<{ chain: string; address: string; halted: boolean }> = await response.json();
      
      const addresses = new Map<string, string>();
      for (const item of data) {
        if (!item.halted) {
          addresses.set(item.chain.toLowerCase(), item.address);
        }
      }
      
      return addresses;
    } catch (error) {
      console.error('Failed to fetch inbound addresses:', error);
      return new Map();
    }
  }

  /**
   * Get supported chains from SwapKit.
   */
  async getSupportedChains(): Promise<string[]> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/chains`);
      if (!response.ok) {
        return [];
      }
      const data: { chains: string[] } = await response.json();
      return data.chains || [];
    } catch {
      return [];
    }
  }

  /**
   * Convert SwapKit route to our internal format.
   */
  private convertRoute(
    route: SwapKitRoute,
    request: SwapQuoteRequest,
    index: number
  ): SwapRoute {
    const fees: SwapFees = {
      protocolFee: BigInt(Math.floor(parseFloat(route.fees.liquidity || '0') * 1e8)),
      networkFee: BigInt(Math.floor(parseFloat(route.fees.outbound || '0') * 1e8)),
      affiliateFee: BigInt(Math.floor(parseFloat(route.fees.affiliate || '0') * 1e8)),
      totalFee: BigInt(Math.floor(parseFloat(route.fees.total || '0') * 1e8)),
      feePercentage: parseFloat(route.fees.slippage || '0'),
    };

    const hops: SwapHop[] = (route.path || []).map((hop, hopIndex) => ({
      index: hopIndex,
      from: fromSwapKitAsset(hop.sellAsset),
      to: fromSwapKitAsset(hop.buyAsset),
      protocol: hop.provider,
      poolId: hop.pool,
      rate: parseFloat(hop.buyAmount) / parseFloat(hop.sellAmount),
    }));

    // Determine primary provider
    const primaryProvider = route.providers[0] || 'swapkit';

    return {
      routeId: `swapkit-${primaryProvider}-${index}-${Date.now()}`,
      provider: toSwapProvider(primaryProvider),
      source: request.source,
      destination: request.destination,
      amountIn: request.amountIn,
      expectedAmountOut: BigInt(Math.floor(parseFloat(route.expectedBuyAmount) * 1e8)),
      minimumAmountOut: BigInt(Math.floor(parseFloat(route.expectedBuyAmountMaxSlippage) * 1e8)),
      fees,
      estimatedTimeSeconds: route.estimatedTime || 600,
      hops,
      expiresAt: route.expiry || (Date.now() / 1000 + 300),
      metadata: {
        memo: route.memo,
        inboundAddress: route.inboundAddress,
        providers: route.providers,
      },
    };
  }
}

/**
 * Create a SwapKit client instance.
 */
export function createSwapKitClient(config: SwapServiceConfig): SwapKitClient {
  return new SwapKitClient(config);
}

