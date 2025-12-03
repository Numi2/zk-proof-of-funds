/**
 * Orderly Market Data Service Implementation
 * 
 * Implements IMarketDataService using Orderly Network WebSocket and API
 */

import type { IMarketDataService, Trade } from "./market-data";
import {
  getOrderlyWebSocketClient,
  type OrderlyWebSocketClient,
  type OrderlyTradeData,
} from "../services/orderly-websocket";
import {
  createOrderlyApiClient,
  type OrderlyApiClient,
  type OrderlyMarketTrade,
} from "../services/orderly-api";
import { getNetwork } from "../components/dex/storage";

export class OrderlyMarketDataService implements IMarketDataService {
  private symbol: string;
  private wsClient: OrderlyWebSocketClient;
  private apiClient: OrderlyApiClient;
  private tradeHandlers: Set<(trade: Trade) => void> = new Set();
  private unsubscribeWs: (() => void) | null = null;

  constructor(symbol: string) {
    this.symbol = symbol;
    const network = getNetwork();
    this.wsClient = getOrderlyWebSocketClient(network);
    this.apiClient = createOrderlyApiClient(network);
  }

  connectTrades(): void {
    if (this.unsubscribeWs) {
      // Already connected
      return;
    }

    this.wsClient.connect().then(() => {
      const handleTrade = (data: OrderlyTradeData) => {
        // Orderly timestamps might be in seconds or milliseconds
        let timestamp = data.timestamp || Date.now();
        if (timestamp < 1000000000000) {
          timestamp = timestamp * 1000; // Convert seconds to milliseconds
        }
        const trade: Trade = {
          price: parseFloat(data.price),
          quantity: parseFloat(data.quantity),
          side: data.side,
          timestamp,
          tradeId: data.trade_id,
        };

        // Notify all handlers
        this.tradeHandlers.forEach((handler) => {
          try {
            handler(trade);
          } catch (error) {
            console.error("[OrderlyMarketData] Error in trade handler:", error);
          }
        });
      };

      this.wsClient.subscribeTrades(this.symbol, handleTrade);
      this.unsubscribeWs = () => {
        this.wsClient.unsubscribeTrades(this.symbol, handleTrade);
        this.unsubscribeWs = null;
      };
    });
  }

  disconnectTrades(): void {
    if (this.unsubscribeWs) {
      this.unsubscribeWs();
      this.unsubscribeWs = null;
    }
  }

  onTrade(handler: (trade: Trade) => void): () => void {
    this.tradeHandlers.add(handler);

    // Auto-connect if not already connected
    if (!this.unsubscribeWs) {
      this.connectTrades();
    }

    // Return unsubscribe function
    return () => {
      this.tradeHandlers.delete(handler);
      // If no more handlers, disconnect
      if (this.tradeHandlers.size === 0) {
        this.disconnectTrades();
      }
    };
  }

  async getHistoricalTrades(limit: number = 100): Promise<Trade[]> {
    try {
      const trades = await this.apiClient.getMarketTrades(this.symbol, limit);
      return trades.map((t: OrderlyMarketTrade) => {
        // Orderly timestamps might be in seconds or milliseconds
        // If timestamp is less than a reasonable ms value (year 2001), assume seconds
        let timestamp = t.timestamp;
        if (timestamp && timestamp < 1000000000000) {
          timestamp = timestamp * 1000; // Convert seconds to milliseconds
        }
        return {
          price: parseFloat(t.price),
          quantity: parseFloat(t.quantity),
          side: t.side,
          timestamp: timestamp || Date.now(),
          tradeId: t.trade_id,
        };
      });
    } catch (error) {
      console.error("[OrderlyMarketData] Failed to fetch historical trades:", error);
      return [];
    }
  }
}

