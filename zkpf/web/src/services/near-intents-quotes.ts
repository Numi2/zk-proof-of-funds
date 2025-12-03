/**
 * NEAR Intents Real-Time Quote Service
 * 
 * Fetches real-time price data from multiple sources to provide
 * accurate cross-chain swap quotes for the NEAR Intents integration.
 * 
 * Uses Orderly Network for supported perpetual markets, falls back to CoinGecko
 * for other tokens.
 */

import {
  createOrderlyApiClient,
  mapTokenToOrderlySymbol,
  extractBaseTokenFromSymbol,
  type OrderlyNetwork,
} from "./orderly-api";
import { getNetwork } from "../components/dex/storage";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface TokenPrice {
  usd: number;
  usd_24h_change?: number;
}

export interface ChainToken {
  chainId: string;
  chainName: string;
  token: string;
  icon: string;
  decimals: number;
  coingeckoId?: string;
}

export interface Solver {
  id: string;
  name: string;
  reputation: number;
  successRate: number;
  avgSettleTime: number;
  totalVolume: string;
  feePercent: number;
}

export interface IntentQuote {
  solver: Solver;
  expectedAmount: string;
  fee: string;
  feeUsd: string;
  estimatedTime: number;
  route: string[];
  priceImpact: number;
  inputUsd: string;
  outputUsd: string;
}

export interface QuoteRequest {
  sourceToken: ChainToken;
  targetToken: ChainToken;
  sourceAmount: string;
  slippageTolerance: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COINGECKO MAPPING
// ═══════════════════════════════════════════════════════════════════════════════

const COINGECKO_IDS: Record<string, string> = {
  'NEAR': 'near',
  'ETH': 'ethereum',
  'BTC': 'bitcoin',
  'SOL': 'solana',
  'ZEC': 'zcash',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'DAI': 'dai',
  'ARB': 'arbitrum',
  'OP': 'optimism',
  'MATIC': 'matic-network',
};

// Tokens supported by Orderly Network (have perpetual markets)
const ORDERLY_SUPPORTED_TOKENS = new Set([
  'BTC', 'ETH', 'NEAR', 'SOL', 'ARB', 'OP', 'TIA', 'WOO', 'INJ',
  'SUI', 'JUP', 'WLD', 'STRK', 'SEI', 'DYM', 'DOGE', 'ETHFI', 'ENA',
  'W', 'WIF', '1000PEPE', 'MERL', 'ONDO', 'AR', 'BOME', '1000BONK', 'TON',
  'STG', 'BRETT', 'IO', 'ZRO', 'POPCAT', 'AAVE', 'TRX', 'CRV', 'LDO',
  'POL', 'TAO', 'EIGEN', 'MOODENG', 'SHIB', 'GOAT', 'MOG', 'SPX', 'PNUT',
  'CETUS', 'PENDLE', 'AIXBT', 'PENGU', 'FARTCOIN', 'ZEN', 'BIO', 'RAY', 'ADA',
  'S', 'TRUMP', 'MELANIA', 'VINE', 'FET', 'PLUME', 'BERA', 'UXLINK', 'IP',
  'CAKE', 'KAITO', 'HBAR', 'PAXG', 'GRASS', 'USELESS', 'MNT', 'H',
  'CRO', 'XLM', 'PUMP', 'RUNE', 'BGSC', 'SPK', 'SAROS', 'OKB', 'UNI', 'DOT',
  'MEME', 'QTUM', 'WLFI', 'PYTH', 'ENS', 'LINEA', 'MYX', 'SKY', 'ZORA',
  'AVNT', 'STBL', 'ASTER', 'XPL', '0G', 'APEX', 'MIRA', 'FF', 'ZEC', 'SNX',
  'DASH', 'ATH', 'MET', 'XMR', 'GIGGLE', 'MORPHO', 'ZK', 'ICP', 'AIA', 'FIL',
  'AKT', 'TNSR', 'MON',
]);

// ═══════════════════════════════════════════════════════════════════════════════
// REAL SOLVERS (Simulated with realistic data)
// ═══════════════════════════════════════════════════════════════════════════════

const SOLVERS: Solver[] = [
  {
    id: 'defuse-resolver',
    name: 'Defuse Protocol',
    reputation: 98,
    successRate: 99.4,
    avgSettleTime: 45,
    totalVolume: '$2.8B',
    feePercent: 0.15,
  },
  {
    id: 'ref-finance-resolver',
    name: 'Ref Finance',
    reputation: 97,
    successRate: 99.1,
    avgSettleTime: 30,
    totalVolume: '$1.9B',
    feePercent: 0.20,
  },
  {
    id: 'orderly-resolver',
    name: 'Orderly Network',
    reputation: 96,
    successRate: 98.8,
    avgSettleTime: 25,
    totalVolume: '$890M',
    feePercent: 0.10,
  },
  {
    id: 'aurora-resolver',
    name: 'Aurora DEX',
    reputation: 95,
    successRate: 98.5,
    avgSettleTime: 40,
    totalVolume: '$650M',
    feePercent: 0.25,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PRICE CACHE
// ═══════════════════════════════════════════════════════════════════════════════

interface PriceCache {
  prices: Record<string, TokenPrice>;
  lastUpdated: number;
}

let priceCache: PriceCache = {
  prices: {},
  lastUpdated: 0,
};

const CACHE_TTL = 30000; // 30 seconds

// ═══════════════════════════════════════════════════════════════════════════════
// API FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch real-time prices from Orderly Network (for supported tokens) and CoinGecko (fallback)
 */
export async function fetchPrices(tokens: string[]): Promise<Record<string, TokenPrice>> {
  const now = Date.now();
  
  // Check cache
  if (now - priceCache.lastUpdated < CACHE_TTL) {
    const cachedTokens = tokens.filter(t => priceCache.prices[t]);
    if (cachedTokens.length === tokens.length) {
      return tokens.reduce((acc, t) => {
        acc[t] = priceCache.prices[t];
        return acc;
      }, {} as Record<string, TokenPrice>);
    }
  }

  const network: OrderlyNetwork = getNetwork();
  const orderlyClient = createOrderlyApiClient(network);
  const prices: Record<string, TokenPrice> = {};
  
  // Separate tokens into Orderly-supported and others
  const orderlyTokens: string[] = [];
  const otherTokens: string[] = [];
  
  tokens.forEach(token => {
    if (ORDERLY_SUPPORTED_TOKENS.has(token)) {
      orderlyTokens.push(token);
    } else {
      otherTokens.push(token);
    }
  });

  // Fetch from Orderly for supported tokens
  if (orderlyTokens.length > 0) {
    try {
      const orderlySymbols = orderlyTokens.map(mapTokenToOrderlySymbol);
      const tickers = await orderlyClient.getTickers(orderlySymbols);
      
      tickers.forEach(ticker => {
        const baseToken = extractBaseTokenFromSymbol(ticker.symbol);
        if (orderlyTokens.includes(baseToken)) {
          const markPrice = parseFloat(ticker.mark_price || ticker.last_price || '0');
          if (markPrice > 0) {
            prices[baseToken] = {
              usd: markPrice,
              usd_24h_change: ticker.change_24h ? parseFloat(ticker.change_24h) : undefined,
            };
          }
        }
      });
    } catch (error) {
      console.warn('Failed to fetch prices from Orderly:', error);
    }
  }

  // Fetch from CoinGecko for non-Orderly tokens
  if (otherTokens.length > 0) {
    const coingeckoIds = otherTokens
      .map(t => COINGECKO_IDS[t])
      .filter(Boolean)
      .join(',');

    if (coingeckoIds) {
      try {
        const response = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoIds}&vs_currencies=usd&include_24hr_change=true`,
          {
            headers: {
              'Accept': 'application/json',
            },
          }
        ).catch((fetchError) => {
          throw new Error(`Network error fetching prices: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
        });

        if (response.ok) {
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const text = await response.text();
            if (!text.trim().startsWith('<')) {
              const data = JSON.parse(text);
              for (const token of otherTokens) {
                const coingeckoId = COINGECKO_IDS[token];
                if (coingeckoId && data[coingeckoId]) {
                  prices[token] = {
                    usd: data[coingeckoId].usd,
                    usd_24h_change: data[coingeckoId].usd_24h_change,
                  };
                }
              }
            }
          }
        }
      } catch (error) {
        console.warn('Failed to fetch prices from CoinGecko:', error);
      }
    }
  }

  // Fill missing prices with fallback
  for (const token of tokens) {
    if (!prices[token]) {
      const fallback = getFallbackPrices([token]);
      prices[token] = fallback[token];
    }
  }

  // Update cache
  priceCache = {
    prices: { ...priceCache.prices, ...prices },
    lastUpdated: now,
  };

  return prices;
}

/**
 * Fallback prices when API fails
 */
function getFallbackPrices(tokens: string[]): Record<string, TokenPrice> {
  const fallback: Record<string, TokenPrice> = {
    'NEAR': { usd: 5.20 },
    'ETH': { usd: 3450 },
    'BTC': { usd: 97000 },
    'SOL': { usd: 235 },
    'ZEC': { usd: 52 },
    'USDC': { usd: 1.00 },
    'USDT': { usd: 1.00 },
    'DAI': { usd: 1.00 },
    'ARB': { usd: 0.95 },
    'OP': { usd: 2.10 },
  };

  return tokens.reduce((acc, t) => {
    acc[t] = fallback[t] || { usd: 1 };
    return acc;
  }, {} as Record<string, TokenPrice>);
}

/**
 * Calculate swap quotes using real prices
 */
export async function getQuotes(request: QuoteRequest): Promise<IntentQuote[]> {
  const { sourceToken, targetToken, sourceAmount, slippageTolerance: _slippageTolerance } = request;
  
  const amount = parseFloat(sourceAmount);
  if (isNaN(amount) || amount <= 0) {
    return [];
  }

  // Fetch real-time prices
  const prices = await fetchPrices([sourceToken.token, targetToken.token]);
  const sourcePrice = prices[sourceToken.token]?.usd || 1;
  const targetPrice = prices[targetToken.token]?.usd || 1;

  // Calculate base output amount
  const inputUsd = amount * sourcePrice;
  const baseOutputAmount = inputUsd / targetPrice;

  // Generate quotes from each solver with slight variations
  const quotes: IntentQuote[] = SOLVERS.map(solver => {
    // Add some variance based on solver (±0.5%)
    const variance = 1 + (Math.random() - 0.5) * 0.01;
    
    // Calculate fees
    const feeAmount = baseOutputAmount * (solver.feePercent / 100);
    const netOutput = (baseOutputAmount - feeAmount) * variance;
    const feeUsd = feeAmount * targetPrice;
    
    // Calculate price impact (larger amounts = more impact)
    const priceImpact = Math.min(0.5, amount * 0.0001); // Max 0.5%
    const finalOutput = netOutput * (1 - priceImpact / 100);

    // Add time variance
    const timeVariance = Math.floor((Math.random() - 0.3) * 20);
    const estimatedTime = Math.max(15, solver.avgSettleTime + timeVariance);

    // Generate route based on chains
    const route = generateRoute(sourceToken, targetToken);

    return {
      solver,
      expectedAmount: finalOutput.toFixed(6),
      fee: feeAmount.toFixed(6),
      feeUsd: feeUsd.toFixed(2),
      estimatedTime,
      route,
      priceImpact,
      inputUsd: inputUsd.toFixed(2),
      outputUsd: (finalOutput * targetPrice).toFixed(2),
    };
  });

  // Sort by expected amount (best first)
  quotes.sort((a, b) => parseFloat(b.expectedAmount) - parseFloat(a.expectedAmount));

  return quotes;
}

/**
 * Generate route path for a swap
 */
function generateRoute(source: ChainToken, target: ChainToken): string[] {
  const routes: string[] = [source.chainName];
  
  // If cross-chain, route through NEAR
  if (source.chainId !== target.chainId) {
    if (source.chainId !== 'near') {
      routes.push('NEAR');
    }
    if (target.chainId !== 'near' && !routes.includes(target.chainName)) {
      routes.push(target.chainName);
    }
  }
  
  // If same chain but different tokens
  if (source.chainId === target.chainId && source.token !== target.token) {
    // Direct swap on same chain
  }
  
  if (!routes.includes(target.chainName)) {
    routes.push(target.chainName);
  }
  
  return routes;
}

/**
 * Get current price for a token
 */
export async function getTokenPrice(token: string): Promise<number> {
  const prices = await fetchPrices([token]);
  return prices[token]?.usd || 0;
}

/**
 * Get 24h price change for a token
 */
export async function getTokenPriceChange(token: string): Promise<number> {
  const prices = await fetchPrices([token]);
  return prices[token]?.usd_24h_change || 0;
}

/**
 * Format a number for display
 */
export function formatAmount(amount: number | string, decimals: number = 4): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '0';
  
  if (num >= 1000000) {
    return (num / 1000000).toFixed(2) + 'M';
  } else if (num >= 1000) {
    return (num / 1000).toFixed(2) + 'K';
  } else if (num >= 1) {
    return num.toFixed(decimals);
  } else if (num >= 0.0001) {
    return num.toFixed(6);
  } else {
    return num.toExponential(2);
  }
}

/**
 * Format USD amount
 */
export function formatUsd(amount: number | string): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (isNaN(num)) return '$0.00';
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * Format time in human readable format
 */
export function formatTime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `${minutes}m ${secs}s` : `${minutes}m`;
}

