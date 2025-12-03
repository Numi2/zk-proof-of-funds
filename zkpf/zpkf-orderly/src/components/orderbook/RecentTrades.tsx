/**
 * Recent Trades Component
 * 
 * Displays real-time trade feed with WebSocket updates
 * Shows recent executed trades with price, size, and time
 */

import { useMemo, useState, useEffect } from "react";
import { Box, Flex, Text } from "@orderly.network/ui";
import { useMarkPricesStream } from "@orderly.network/hooks";

interface Trade {
  price: number;
  size: number;
  side: "buy" | "sell";
  timestamp: number;
  id: string;
}

interface RecentTradesProps {
  symbol: string;
  maxTrades?: number;
  compact?: boolean;
}

export function RecentTrades({
  symbol,
  maxTrades = 20,
  compact = false,
}: RecentTradesProps) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const markPrices = useMarkPricesStream();

  // Simulate trades from mark price updates (in production, use actual trade stream)
  useEffect(() => {
    if (markPrices && markPrices[symbol]) {
      const newTrade: Trade = {
        price: parseFloat(markPrices[symbol] || "0"),
        size: Math.random() * 10, // Simulated
        side: Math.random() > 0.5 ? "buy" : "sell",
        timestamp: Date.now(),
        id: `${Date.now()}-${Math.random()}`,
      };

      setTrades((prev) => [newTrade, ...prev].slice(0, maxTrades));
    }
  }, [markPrices, symbol, maxTrades]);

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    });
  };

  if (compact) {
    return (
      <Box p={3} r="md" intensity={800}>
        <Text size="xs" weight="semibold" className="text-base-contrast-80 mb-2">
          RECENT TRADES
        </Text>
        <div className="space-y-1">
          {trades.slice(0, 5).map((trade) => (
            <Flex key={trade.id} justify="between" itemsalign="center">
              <Text
                size="sm"
                weight="semibold"
                className={trade.side === "buy" ? "text-green-500" : "text-red-500"}
              >
                {trade.price.toFixed(2)}
              </Text>
              <Text size="xs" className="text-base-contrast-54">
                {trade.size.toFixed(4)}
              </Text>
            </Flex>
          ))}
        </div>
      </Box>
    );
  }

  return (
    <Box p={4} r="lg" intensity={900} className="shadow-md">
      {/* Header */}
      <div className="mb-4">
        <Text size="lg" weight="semibold">Recent Trades</Text>
        <Text size="xs" className="text-base-contrast-54">{symbol}</Text>
      </div>

      {/* Column Headers */}
      <div className="grid grid-cols-3 gap-2 mb-2 pb-2 border-b border-base-700">
        <Text size="xs" className="text-base-contrast-54 text-left">Price (USD)</Text>
        <Text size="xs" className="text-base-contrast-54 text-right">Size</Text>
        <Text size="xs" className="text-base-contrast-54 text-right">Time</Text>
      </div>

      {/* Trades List */}
      <div className="max-h-96 overflow-y-auto space-y-1">
        {trades.map((trade, index) => (
          <div
            key={trade.id}
            className={`grid grid-cols-3 gap-2 py-1.5 px-2 rounded transition-all ${
              index === 0 ? "bg-base-700" : "hover:bg-base-800"
            }`}
          >
            <Text
              size="sm"
              weight="semibold"
              className={trade.side === "buy" ? "text-green-500" : "text-red-500"}
            >
              {trade.price.toFixed(2)}
            </Text>
            <Text size="sm" className="text-right text-base-contrast-80">
              {trade.size.toFixed(4)}
            </Text>
            <Text size="xs" className="text-right text-base-contrast-54">
              {formatTime(trade.timestamp)}
            </Text>
          </div>
        ))}
      </div>

      {trades.length === 0 && (
        <div className="text-center py-8">
          <Text size="sm" className="text-base-contrast-54">
            No recent trades
          </Text>
        </div>
      )}
    </Box>
  );
}

/**
 * Trade statistics summary
 */
export function TradeStats({ symbol }: { symbol: string }) {
  const [stats, setStats] = useState({
    volume24h: 0,
    high24h: 0,
    low24h: 0,
    change24h: 0,
    changePercentage: 0,
  });

  // In production, fetch actual stats from API
  useEffect(() => {
    // Simulated stats
    setStats({
      volume24h: Math.random() * 1000000,
      high24h: 50000 + Math.random() * 1000,
      low24h: 49000 + Math.random() * 1000,
      change24h: (Math.random() - 0.5) * 1000,
      changePercentage: (Math.random() - 0.5) * 5,
    });
  }, [symbol]);

  return (
    <Box p={4} r="lg" intensity={900}>
      <Text size="sm" weight="semibold" className="text-base-contrast-80 mb-3">
        24H STATISTICS
      </Text>
      
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Text size="xs" className="text-base-contrast-54 mb-1">Volume</Text>
          <Text size="lg" weight="semibold">
            ${(stats.volume24h / 1000000).toFixed(2)}M
          </Text>
        </div>

        <div>
          <Text size="xs" className="text-base-contrast-54 mb-1">Change</Text>
          <Text
            size="lg"
            weight="semibold"
            className={stats.change24h >= 0 ? "text-green-500" : "text-red-500"}
          >
            {stats.change24h >= 0 ? "+" : ""}
            {stats.changePercentage.toFixed(2)}%
          </Text>
        </div>

        <div>
          <Text size="xs" className="text-base-contrast-54 mb-1">24h High</Text>
          <Text size="sm" weight="semibold">
            ${stats.high24h.toFixed(2)}
          </Text>
        </div>

        <div>
          <Text size="xs" className="text-base-contrast-54 mb-1">24h Low</Text>
          <Text size="sm" weight="semibold">
            ${stats.low24h.toFixed(2)}
          </Text>
        </div>
      </div>
    </Box>
  );
}

