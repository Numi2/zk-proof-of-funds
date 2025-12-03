/**
 * Market Data Service Interface
 * 
 * Provides a unified interface for market data services to feed into the footprint chart
 */

export interface Trade {
  price: number;
  quantity: number;
  side: "BUY" | "SELL";
  timestamp: number;
  tradeId?: string;
}

export interface IMarketDataService {
  /**
   * Connect to trade stream
   */
  connectTrades(): void;

  /**
   * Disconnect from trade stream
   */
  disconnectTrades(): void;

  /**
   * Subscribe to trade updates
   * @returns Unsubscribe function
   */
  onTrade(handler: (trade: Trade) => void): () => void;

  /**
   * Get historical trades (optional)
   */
  getHistoricalTrades?(limit?: number): Promise<Trade[]>;
}

