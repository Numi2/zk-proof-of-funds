/**
 * Orderly Network WebSocket Client
 * 
 * Provides real-time streaming data from Orderly Network via WebSocket:
 * - Mark prices
 * - Trade streams
 * - Orderbook updates
 * - Funding rate updates
 */

export type OrderlyNetwork = "testnet" | "mainnet";

// WebSocket Base URLs
const WS_BASE_URLS = {
  mainnet: "wss://ws-evm.orderly.org/ws/stream",
  testnet: "wss://testnet-ws-evm.orderly.org/ws/stream",
} as const;

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface OrderlyWebSocketMessage {
  topic: string;
  ts: number;
  data: any;
}

export interface OrderlyMarkPriceData {
  symbol: string;
  mark_price: string;
  index_price: string;
  funding_rate: string;
  next_funding_time: number;
  countdown_hour: number;
}

export interface OrderlyTradeData {
  symbol: string;
  price: string;
  quantity: string;
  side: "BUY" | "SELL";
  timestamp: number;
  trade_id: string;
}

export interface OrderlyOrderbookData {
  symbol: string;
  bids: Array<[string, string]>;
  asks: Array<[string, string]>;
  timestamp: number;
}

export interface OrderlyFundingRateData {
  symbol: string;
  funding_rate: string;
  funding_rate_timestamp: number;
  next_funding_time: number;
}

export type WebSocketEventType =
  | "mark_price"
  | "trade"
  | "orderbook"
  | "funding_rate"
  | "ticker";

export type WebSocketEventHandler<T = any> = (data: T) => void;

// ═══════════════════════════════════════════════════════════════════════════════
// WEBSOCKET CLIENT
// ═══════════════════════════════════════════════════════════════════════════════

export class OrderlyWebSocketClient {
  private ws: WebSocket | null = null;
  private url: string;
  public readonly network: OrderlyNetwork;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;
  private reconnectDelay = 1000;
  private isManualClose = false;
  private subscriptions = new Map<string, Set<WebSocketEventHandler>>();
  private pendingSubscriptions: Array<{ topic: string; event: string }> = [];

  constructor(network: OrderlyNetwork = "testnet") {
    this.network = network;
    this.url = WS_BASE_URLS[network];
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        resolve();
        return;
      }

      this.isManualClose = false;
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        console.log(`[OrderlyWS] Connected to ${this.network}`);
        this.reconnectAttempts = 0;
        
        // Resubscribe to all pending subscriptions
        this.pendingSubscriptions.forEach(({ topic }) => {
          this.subscribe(topic);
        });
        this.pendingSubscriptions = [];
        
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const message: OrderlyWebSocketMessage = JSON.parse(event.data);
          this.handleMessage(message);
        } catch (error) {
          console.error("[OrderlyWS] Failed to parse message:", error);
        }
      };

      this.ws.onerror = (error) => {
        console.error("[OrderlyWS] WebSocket error:", error);
        reject(error);
      };

      this.ws.onclose = () => {
        console.log(`[OrderlyWS] Disconnected from ${this.network}`);
        if (!this.isManualClose && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
          console.log(`[OrderlyWS] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
          setTimeout(() => this.connect(), delay);
        }
      };
    });
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.isManualClose = true;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /**
   * Subscribe to a topic
   */
  subscribe(topic: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      // Queue subscription for when connection is ready
      this.pendingSubscriptions.push({ topic, event: "subscribe" });
      this.connect().then(() => {
        this.subscribe(topic);
      });
      return;
    }

    const message = {
      id: Date.now().toString(),
      topic,
      event: "subscribe",
    };

    this.ws.send(JSON.stringify(message));
    console.log(`[OrderlyWS] Subscribed to: ${topic}`);
  }

  /**
   * Unsubscribe from a topic
   */
  unsubscribe(topic: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message = {
      id: Date.now().toString(),
      topic,
      event: "unsubscribe",
    };

    this.ws.send(JSON.stringify(message));
    this.subscriptions.delete(topic);
    console.log(`[OrderlyWS] Unsubscribed from: ${topic}`);
  }

  /**
   * Subscribe to mark price updates for a symbol
   */
  subscribeMarkPrice(symbol: string, handler: WebSocketEventHandler<OrderlyMarkPriceData>): void {
    const topic = `markprice.${symbol}`;
    this.addHandler(topic, handler);
    this.subscribe(topic);
  }

  /**
   * Unsubscribe from mark price updates
   */
  unsubscribeMarkPrice(symbol: string, handler: WebSocketEventHandler<OrderlyMarkPriceData>): void {
    const topic = `markprice.${symbol}`;
    this.removeHandler(topic, handler);
    if (!this.hasHandlers(topic)) {
      this.unsubscribe(topic);
    }
  }

  /**
   * Subscribe to trade updates for a symbol
   */
  subscribeTrades(symbol: string, handler: WebSocketEventHandler<OrderlyTradeData>): void {
    const topic = `trade.${symbol}`;
    this.addHandler(topic, handler);
    this.subscribe(topic);
  }

  /**
   * Unsubscribe from trade updates
   */
  unsubscribeTrades(symbol: string, handler: WebSocketEventHandler<OrderlyTradeData>): void {
    const topic = `trade.${symbol}`;
    this.removeHandler(topic, handler);
    if (!this.hasHandlers(topic)) {
      this.unsubscribe(topic);
    }
  }

  /**
   * Subscribe to orderbook updates for a symbol
   */
  subscribeOrderbook(
    symbol: string,
    handler: WebSocketEventHandler<OrderlyOrderbookData>
  ): void {
    const topic = `orderbook.${symbol}`;
    this.addHandler(topic, handler);
    this.subscribe(topic);
  }

  /**
   * Unsubscribe from orderbook updates
   */
  unsubscribeOrderbook(
    symbol: string,
    handler: WebSocketEventHandler<OrderlyOrderbookData>
  ): void {
    const topic = `orderbook.${symbol}`;
    this.removeHandler(topic, handler);
    if (!this.hasHandlers(topic)) {
      this.unsubscribe(topic);
    }
  }

  /**
   * Subscribe to funding rate updates for a symbol
   */
  subscribeFundingRate(
    symbol: string,
    handler: WebSocketEventHandler<OrderlyFundingRateData>
  ): void {
    const topic = `funding_rate.${symbol}`;
    this.addHandler(topic, handler);
    this.subscribe(topic);
  }

  /**
   * Unsubscribe from funding rate updates
   */
  unsubscribeFundingRate(
    symbol: string,
    handler: WebSocketEventHandler<OrderlyFundingRateData>
  ): void {
    const topic = `funding_rate.${symbol}`;
    this.removeHandler(topic, handler);
    if (!this.hasHandlers(topic)) {
      this.unsubscribe(topic);
    }
  }

  /**
   * Subscribe to ticker updates for a symbol
   */
  subscribeTicker(symbol: string, handler: WebSocketEventHandler<OrderlyMarkPriceData>): void {
    const topic = `ticker.${symbol}`;
    this.addHandler(topic, handler);
    this.subscribe(topic);
  }

  /**
   * Unsubscribe from ticker updates
   */
  unsubscribeTicker(symbol: string, handler: WebSocketEventHandler<OrderlyMarkPriceData>): void {
    const topic = `ticker.${symbol}`;
    this.removeHandler(topic, handler);
    if (!this.hasHandlers(topic)) {
      this.unsubscribe(topic);
    }
  }

  /**
   * Handle incoming WebSocket messages
   */
  private handleMessage(message: OrderlyWebSocketMessage): void {
    const { topic, data } = message;

    // Extract symbol from topic (e.g., "markprice.PERP_ETH_USDC" -> "PERP_ETH_USDC")
    const handlers = this.subscriptions.get(topic);
    if (handlers) {
      handlers.forEach((handler) => {
        try {
          handler(data);
        } catch (error) {
          console.error(`[OrderlyWS] Error in handler for ${topic}:`, error);
        }
      });
    }
  }

  /**
   * Add an event handler for a topic
   */
  private addHandler(topic: string, handler: WebSocketEventHandler): void {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic)!.add(handler);
  }

  /**
   * Remove an event handler for a topic
   */
  private removeHandler(topic: string, handler: WebSocketEventHandler): void {
    const handlers = this.subscriptions.get(topic);
    if (handlers) {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.subscriptions.delete(topic);
      }
    }
  }

  /**
   * Check if there are any handlers for a topic
   */
  private hasHandlers(topic: string): boolean {
    return (this.subscriptions.get(topic)?.size || 0) > 0;
  }

  /**
   * Get connection state
   */
  getState(): "connecting" | "open" | "closing" | "closed" {
    if (!this.ws) return "closed";
    switch (this.ws.readyState) {
      case WebSocket.CONNECTING:
        return "connecting";
      case WebSocket.OPEN:
        return "open";
      case WebSocket.CLOSING:
        return "closing";
      default:
        return "closed";
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════════

let wsClientInstance: OrderlyWebSocketClient | null = null;

/**
 * Get or create the singleton WebSocket client instance
 */
export function getOrderlyWebSocketClient(
  network: OrderlyNetwork = "testnet"
): OrderlyWebSocketClient {
  if (!wsClientInstance || wsClientInstance.network !== network) {
    if (wsClientInstance) {
      wsClientInstance.disconnect();
    }
    wsClientInstance = new OrderlyWebSocketClient(network);
  }
  return wsClientInstance;
}

/**
 * Create a new WebSocket client instance
 */
export function createOrderlyWebSocketClient(
  network: OrderlyNetwork = "testnet"
): OrderlyWebSocketClient {
  return new OrderlyWebSocketClient(network);
}

