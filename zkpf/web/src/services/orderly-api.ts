/**
 * Orderly Network REST API Client
 * 
 * Provides access to Orderly Network's public REST API endpoints for market data,
 * prices, funding rates, and exchange information.
 */

export type OrderlyNetwork = "testnet" | "mainnet";

// API Base URLs
const API_BASE_URLS = {
  mainnet: "https://api-evm.orderly.org",
  testnet: "https://testnet-api-evm.orderly.org",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface OrderlySymbol {
  symbol: string;
  quote_min: number;
  quote_max: number;
  quote_tick: number;
  base_min: number;
  base_max: number;
  base_tick: number;
  min_notional: number;
  price_range: number;
  price_scope: number;
  std_liquidation_fee: number;
  liquidator_fee: number;
  claim_insurance_fund: number;
  funding_period: number;
  cap_funding: number;
  floor_funding: number;
  interest_rate: number;
  created_time: number;
  updated_time: number;
}

export interface OrderlyExchangeInfo {
  success: boolean;
  data: {
    exchange_name?: string;
    timezone?: string;
    server_time?: number;
    rate_limits?: Array<{
      rate_limit_type: string;
      interval: string;
      interval_num: number;
      limit: number;
    }>;
    // Note: API returns 'rows', not 'symbols'
    rows?: OrderlySymbol[];
    symbols?: OrderlySymbol[];
  };
}

export interface OrderlyMarketTrade {
  symbol: string;
  price: string;
  quantity: string;
  side: "BUY" | "SELL";
  timestamp: number;
  trade_id: string;
}

export interface OrderlyMarketTradesResponse {
  success: boolean;
  data: {
    rows: OrderlyMarketTrade[];
  };
}

export interface OrderlyFundingRate {
  symbol: string;
  funding_rate: string;
  funding_rate_timestamp: number;
  next_funding_time: number;
  predicted_rate?: string;
}

export interface OrderlyFundingRateResponse {
  success: boolean;
  data: OrderlyFundingRate;
}

export interface OrderlyFundingRateHistory {
  symbol: string;
  funding_rate: string;
  funding_rate_timestamp: number;
}

export interface OrderlyFundingRateHistoryResponse {
  success: boolean;
  data: {
    rows: OrderlyFundingRateHistory[];
  };
}

export interface OrderlyTicker {
  symbol: string;
  best_bid: string;
  best_ask: string;
  last_price: string;
  mark_price: string;
  index_price: string;
  open_interest: string;
  open_interest_value: string;
  funding_rate: string;
  next_funding_time: number;
  countdown_hour: number;
  predicted_rate?: string;
  volume_24h: string;
  high_24h: string;
  low_24h: string;
  open_24h: string;
  change_24h: string;
}

export interface OrderlyTickerResponse {
  success: boolean;
  data: OrderlyTicker[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// API CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

export class OrderlyApiClient {
  private baseUrl: string;

  constructor(network: OrderlyNetwork = "testnet") {
    this.baseUrl = API_BASE_URLS[network];
  }

  /**
   * Get exchange information including all available symbols
   */
  async getExchangeInfo(): Promise<OrderlyExchangeInfo> {
    const response = await fetch(`${this.baseUrl}/v1/public/info`);
    if (!response.ok) {
      throw new Error(`Failed to fetch exchange info: ${response.statusText}`);
    }
    return response.json();
  }

  /**
   * Get symbol details for a specific perpetual futures contract
   */
  async getSymbolInfo(symbol: string): Promise<OrderlySymbol | null> {
    try {
      const info = await this.getExchangeInfo();
      // API returns data.rows, not data.symbols
      const symbols = (info.data as any).rows || info.data.symbols || [];
      return symbols.find((s: OrderlySymbol) => s.symbol === symbol) || null;
    } catch (error) {
      console.error(`Failed to get symbol info for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get recent market trades for a symbol
   */
  async getMarketTrades(
    symbol: string,
    limit: number = 50
  ): Promise<OrderlyMarketTrade[]> {
    const response = await fetch(
      `${this.baseUrl}/v1/public/market_trades?symbol=${symbol}&limit=${limit}`
    );
    if (!response.ok) {
      throw new Error(`Failed to fetch market trades: ${response.statusText}`);
    }
    const data: OrderlyMarketTradesResponse = await response.json();
    return data.data?.rows || [];
  }

  /**
   * Get current funding rate for a symbol
   */
  async getFundingRate(symbol: string): Promise<OrderlyFundingRate | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v1/public/funding_rate/${symbol}`
      );
      if (!response.ok) {
        throw new Error(`Failed to fetch funding rate: ${response.statusText}`);
      }
      const data: OrderlyFundingRateResponse = await response.json();
      return data.data || null;
    } catch (error) {
      console.error(`Failed to get funding rate for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Get funding rate history for a symbol
   */
  async getFundingRateHistory(
    symbol: string,
    limit: number = 24
  ): Promise<OrderlyFundingRateHistory[]> {
    try {
      const response = await fetch(
        `${this.baseUrl}/v1/public/funding_rate_history/${symbol}?limit=${limit}`
      );
      if (!response.ok) {
        throw new Error(
          `Failed to fetch funding rate history: ${response.statusText}`
        );
      }
      const data: OrderlyFundingRateHistoryResponse = await response.json();
      return data.data?.rows || [];
    } catch (error) {
      console.error(`Failed to get funding rate history for ${symbol}:`, error);
      return [];
    }
  }

  /**
   * Get ticker data for one or more symbols
   */
  async getTickers(symbols?: string[]): Promise<OrderlyTicker[]> {
    try {
      let url = `${this.baseUrl}/v1/public/market_tickers`;
      if (symbols && symbols.length > 0) {
        url += `?symbol=${symbols.join(",")}`;
      }
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch tickers: ${response.statusText}`);
      }
      const data: OrderlyTickerResponse = await response.json();
      return data.data || [];
    } catch (error) {
      console.error("Failed to get tickers:", error);
      return [];
    }
  }

  /**
   * Get ticker data for a single symbol
   */
  async getTicker(symbol: string): Promise<OrderlyTicker | null> {
    const tickers = await this.getTickers([symbol]);
    return tickers.find((t) => t.symbol === symbol) || null;
  }

  /**
   * Get mark price for a symbol (used for calculating PnL)
   */
  async getMarkPrice(symbol: string): Promise<string | null> {
    const ticker = await this.getTicker(symbol);
    return ticker?.mark_price || null;
  }

  /**
   * Get last price for a symbol
   */
  async getLastPrice(symbol: string): Promise<string | null> {
    const ticker = await this.getTicker(symbol);
    return ticker?.last_price || null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a new Orderly API client instance
 */
export function createOrderlyApiClient(
  network: OrderlyNetwork = "testnet"
): OrderlyApiClient {
  return new OrderlyApiClient(network);
}

import { mapTickerToOrderlySymbol } from "../config/orderly-markets";

/**
 * Map token symbols to Orderly perpetual symbols
 * Example: "NEAR" -> "PERP_NEAR_USDC"
 */
export function mapTokenToOrderlySymbol(token: string): string {
  // Try to get from supported markets config first
  const symbol = mapTickerToOrderlySymbol(token);
  if (symbol) {
    return symbol;
  }
  
  // Fallback for tokens not in the official list
  const mapping: Record<string, string> = {
    NEAR: "PERP_NEAR_USDC",
    USDC: "PERP_USDC_USDC", // Not a real symbol, but for consistency
    USDT: "PERP_USDT_USDC", // Not a real symbol
  };
  return mapping[token] || `PERP_${token}_USDC`;
}

/**
 * Extract base token from Orderly symbol
 * Example: "PERP_NEAR_USDC" -> "NEAR"
 */
export function extractBaseTokenFromSymbol(symbol: string): string {
  if (symbol.startsWith("PERP_") && symbol.endsWith("_USDC")) {
    return symbol.slice(5, -5);
  }
  return symbol;
}
