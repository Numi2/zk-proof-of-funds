/**
 * Orderly Market Data Hooks
 * 
 * React hooks for accessing Orderly Network market data throughout the app.
 * Provides real-time prices, funding rates, and market information.
 */

import { useEffect, useState, useRef } from "react";
import {
  createOrderlyApiClient,
  type OrderlyApiClient,
  type OrderlyNetwork,
  type OrderlyTicker,
  type OrderlyFundingRate,
  type OrderlyFundingRateHistory,
  mapTokenToOrderlySymbol,
} from "../services/orderly-api";
import {
  getOrderlyWebSocketClient,
  type OrderlyWebSocketClient,
  type OrderlyMarkPriceData,
  type OrderlyFundingRateData,
} from "../services/orderly-websocket";
import { getNetwork } from "../components/dex/storage";

// ═══════════════════════════════════════════════════════════════════════════════
// HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get the current network (mainnet/testnet) from storage
 */
function useOrderlyNetwork(): OrderlyNetwork {
  const [network, setNetwork] = useState<OrderlyNetwork>(() => getNetwork());
  
  useEffect(() => {
    const handleStorageChange = () => {
      setNetwork(getNetwork());
    };
    
    // Listen for storage changes
    window.addEventListener("storage", handleStorageChange);
    
    // Also check periodically (in case same-tab changes)
    const interval = setInterval(() => {
      const currentNetwork = getNetwork();
      if (currentNetwork !== network) {
        setNetwork(currentNetwork);
      }
    }, 1000);
    
    return () => {
      window.removeEventListener("storage", handleStorageChange);
      clearInterval(interval);
    };
  }, [network]);
  
  return network;
}

/**
 * Get real-time prices for multiple symbols
 */
export function useOrderlyPrices(symbols: string[]) {
  const network = useOrderlyNetwork();
  const [prices, setPrices] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const apiClientRef = useRef<OrderlyApiClient | null>(null);
  const wsClientRef = useRef<OrderlyWebSocketClient | null>(null);
  const subscriptionsRef = useRef<Map<string, () => void>>(new Map());

  useEffect(() => {
    apiClientRef.current = createOrderlyApiClient(network);
    wsClientRef.current = getOrderlyWebSocketClient(network);

    // Initial fetch
    const fetchPrices = async () => {
      try {
        setLoading(true);
        setError(null);
        const tickers = await apiClientRef.current!.getTickers(symbols);
        const priceMap: Record<string, string> = {};
        tickers.forEach((ticker) => {
          priceMap[ticker.symbol] = ticker.mark_price || ticker.last_price;
        });
        setPrices(priceMap);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch prices"));
        console.error("Failed to fetch Orderly prices:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchPrices();

    // Subscribe to real-time updates
    const wsClient = wsClientRef.current;
    wsClient.connect().then(() => {
      symbols.forEach((symbol) => {
        const handleUpdate = (data: OrderlyMarkPriceData) => {
          setPrices((prev) => ({
            ...prev,
            [symbol]: data.mark_price,
          }));
        };

        wsClient.subscribeMarkPrice(symbol, handleUpdate);
        subscriptionsRef.current.set(symbol, () => {
          wsClient.unsubscribeMarkPrice(symbol, handleUpdate);
        });
      });
    });

    // Cleanup
    return () => {
      subscriptionsRef.current.forEach((unsubscribe) => unsubscribe());
      subscriptionsRef.current.clear();
    };
  }, [network, symbols.join(",")]);

  return { prices, loading, error };
}

/**
 * Get real-time price for a single symbol
 */
export function useOrderlyPrice(symbol: string) {
  const { prices, loading, error } = useOrderlyPrices([symbol]);
  return {
    price: prices[symbol] || null,
    loading,
    error,
  };
}

/**
 * Get price for a token (maps token to Orderly symbol)
 */
export function useOrderlyTokenPrice(token: string) {
  const symbol = mapTokenToOrderlySymbol(token);
  return useOrderlyPrice(symbol);
}

/**
 * Get funding rate for a symbol
 */
export function useOrderlyFundingRate(symbol: string) {
  const network = useOrderlyNetwork();
  const [fundingRate, setFundingRate] = useState<OrderlyFundingRate | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const apiClientRef = useRef<OrderlyApiClient | null>(null);
  const wsClientRef = useRef<OrderlyWebSocketClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    apiClientRef.current = createOrderlyApiClient(network);
    wsClientRef.current = getOrderlyWebSocketClient(network);

    // Initial fetch
    const fetchFundingRate = async () => {
      try {
        setLoading(true);
        setError(null);
        const rate = await apiClientRef.current!.getFundingRate(symbol);
        setFundingRate(rate);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch funding rate"));
        console.error(`Failed to fetch funding rate for ${symbol}:`, err);
      } finally {
        setLoading(false);
      }
    };

    fetchFundingRate();

    // Subscribe to real-time updates
    const wsClient = wsClientRef.current;
    wsClient.connect().then(() => {
      const handleUpdate = (data: OrderlyFundingRateData) => {
        setFundingRate({
          symbol: data.symbol,
          funding_rate: data.funding_rate,
          funding_rate_timestamp: data.funding_rate_timestamp,
          next_funding_time: data.next_funding_time,
        });
      };

      wsClient.subscribeFundingRate(symbol, handleUpdate);
      unsubscribeRef.current = () => {
        wsClient.unsubscribeFundingRate(symbol, handleUpdate);
      };
    });

    // Cleanup
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
    };
  }, [network, symbol]);

  return { fundingRate, loading, error };
}

/**
 * Get funding rate history for a symbol
 */
export function useOrderlyFundingRateHistory(symbol: string, limit: number = 24) {
  const network = useOrderlyNetwork();
  const [history, setHistory] = useState<OrderlyFundingRateHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const apiClientRef = useRef<OrderlyApiClient | null>(null);

  useEffect(() => {
    apiClientRef.current = createOrderlyApiClient(network);

    const fetchHistory = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiClientRef.current!.getFundingRateHistory(symbol, limit);
        setHistory(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch funding rate history"));
        console.error(`Failed to fetch funding rate history for ${symbol}:`, err);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();

    // Refresh every 5 minutes
    const interval = setInterval(fetchHistory, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [network, symbol, limit]);

  return { history, loading, error };
}

/**
 * Get ticker data for a symbol
 */
export function useOrderlyTicker(symbol: string) {
  const network = useOrderlyNetwork();
  const [ticker, setTicker] = useState<OrderlyTicker | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const apiClientRef = useRef<OrderlyApiClient | null>(null);
  const wsClientRef = useRef<OrderlyWebSocketClient | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    apiClientRef.current = createOrderlyApiClient(network);
    wsClientRef.current = getOrderlyWebSocketClient(network);

    // Initial fetch
    const fetchTicker = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await apiClientRef.current!.getTicker(symbol);
        setTicker(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch ticker"));
        console.error(`Failed to fetch ticker for ${symbol}:`, err);
      } finally {
        setLoading(false);
      }
    };

    fetchTicker();

    // Subscribe to real-time updates
    const wsClient = wsClientRef.current;
    wsClient.connect().then(() => {
      const handleUpdate = (data: OrderlyMarkPriceData) => {
        // Update ticker with new mark price data
        setTicker((prev) => {
          if (!prev) return null;
          return {
            ...prev,
            mark_price: data.mark_price,
            index_price: data.index_price,
            funding_rate: data.funding_rate,
            next_funding_time: data.next_funding_time,
            countdown_hour: data.countdown_hour,
          };
        });
      };

      wsClient.subscribeTicker(symbol, handleUpdate);
      unsubscribeRef.current = () => {
        wsClient.unsubscribeTicker(symbol, handleUpdate);
      };
    });

    // Refresh every 30 seconds as fallback
    const interval = setInterval(fetchTicker, 30 * 1000);

    // Cleanup
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
      }
      clearInterval(interval);
    };
  }, [network, symbol]);

  return { ticker, loading, error };
}

/**
 * Get all market information (exchange info)
 */
export function useOrderlyMarketInfo() {
  const network = useOrderlyNetwork();
  const [symbols, setSymbols] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const apiClientRef = useRef<OrderlyApiClient | null>(null);

  useEffect(() => {
    apiClientRef.current = createOrderlyApiClient(network);

    const fetchInfo = async () => {
      try {
        setLoading(true);
        setError(null);
        const info = await apiClientRef.current!.getExchangeInfo();
        // API returns data.rows, not data.symbols
        const symbolsData = (info.data as any).rows || info.data.symbols || [];
        setSymbols(symbolsData);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Failed to fetch market info"));
        console.error("Failed to fetch Orderly market info:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchInfo();

    // Refresh every 5 minutes
    const interval = setInterval(fetchInfo, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [network]);

  return { symbols, loading, error };
}

/**
 * Get prices for multiple tokens (maps tokens to Orderly symbols)
 */
export function useOrderlyTokenPrices(tokens: string[]) {
  const symbols = tokens.map(mapTokenToOrderlySymbol);
  return useOrderlyPrices(symbols);
}

