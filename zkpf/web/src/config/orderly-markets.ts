/**
 * Orderly Network Supported Markets Configuration
 * 
 * This file defines all supported perpetual futures markets on Orderly Network.
 * All perpetual futures contracts are denominated and settled in USDC.
 */

export interface OrderlyMarket {
  /** Full token name */
  tokenName: string;
  /** Token ticker symbol */
  tokenTicker: string;
  /** Orderly perpetual symbol (e.g., PERP_BTC_USDC) */
  tokenSymbol: string;
  /** Whether this market is enabled/active */
  enabled?: boolean;
}

/**
 * Supported Perpetual Futures Markets on Orderly Network (EVM)
 * All contracts are denominated and settled in USDC
 */
export const ORDERLY_SUPPORTED_MARKETS: OrderlyMarket[] = [
  {
    tokenName: "Bitcoin",
    tokenTicker: "BTC",
    tokenSymbol: "PERP_BTC_USDC",
    enabled: true,
  },
  {
    tokenName: "Ethereum",
    tokenTicker: "ETH",
    tokenSymbol: "PERP_ETH_USDC",
    enabled: true,
  },
  {
    tokenName: "Celestia",
    tokenTicker: "TIA",
    tokenSymbol: "PERP_TIA_USDC",
    enabled: true,
  },
  {
    tokenName: "Solana",
    tokenTicker: "SOL",
    tokenSymbol: "PERP_SOL_USDC",
    enabled: true,
  },
  {
    tokenName: "Woo",
    tokenTicker: "WOO",
    tokenSymbol: "PERP_WOO_USDC",
    enabled: true,
  },
  {
    tokenName: "Arbitrum",
    tokenTicker: "ARB",
    tokenSymbol: "PERP_ARB_USDC",
    enabled: true,
  },
  {
    tokenName: "Optimism",
    tokenTicker: "OP",
    tokenSymbol: "PERP_OP_USDC",
    enabled: true,
  },
  {
    tokenName: "Injective",
    tokenTicker: "INJ",
    tokenSymbol: "PERP_INJ_USDC",
    enabled: true,
  },
  {
    tokenName: "Sui",
    tokenTicker: "SUI",
    tokenSymbol: "PERP_SUI_USDC",
    enabled: true,
  },
  {
    tokenName: "Jupiter",
    tokenTicker: "JUP",
    tokenSymbol: "PERP_JUP_USDC",
    enabled: true,
  },
  {
    tokenName: "Worldcoin",
    tokenTicker: "WLD",
    tokenSymbol: "PERP_WLD_USDC",
    enabled: true,
  },
  {
    tokenName: "Starknet",
    tokenTicker: "STRK",
    tokenSymbol: "PERP_STRK_USDC",
    enabled: true,
  },
  {
    tokenName: "Zcash",
    tokenTicker: "ZEC",
    tokenSymbol: "PERP_ZEC_USDC",
    enabled: true,
    // Note: ZEC is only available on mainnet, not testnet
  },
];

/**
 * Get all enabled markets
 */
export function getEnabledMarkets(): OrderlyMarket[] {
  return ORDERLY_SUPPORTED_MARKETS.filter((market) => market.enabled !== false);
}

/**
 * Get market by ticker symbol
 */
export function getMarketByTicker(ticker: string): OrderlyMarket | undefined {
  return ORDERLY_SUPPORTED_MARKETS.find(
    (market) => market.tokenTicker === ticker.toUpperCase()
  );
}

/**
 * Get market by Orderly symbol
 */
export function getMarketBySymbol(symbol: string): OrderlyMarket | undefined {
  return ORDERLY_SUPPORTED_MARKETS.find(
    (market) => market.tokenSymbol === symbol
  );
}

/**
 * Get all Orderly symbols for enabled markets
 */
export function getEnabledSymbols(): string[] {
  return getEnabledMarkets().map((market) => market.tokenSymbol);
}

/**
 * Get all ticker symbols for enabled markets
 */
export function getEnabledTickers(): string[] {
  return getEnabledMarkets().map((market) => market.tokenTicker);
}

/**
 * Map token ticker to Orderly perpetual symbol
 */
export function mapTickerToOrderlySymbol(ticker: string): string | undefined {
  const market = getMarketByTicker(ticker);
  return market?.tokenSymbol;
}

