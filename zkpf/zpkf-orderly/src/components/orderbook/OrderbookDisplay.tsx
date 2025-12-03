/**
 * High-Performance Orderbook Component
 * 
 * Real-time orderbook display for Orderly's Central Limit Order Book (CLOB)
 * Optimized for performance with virtualization and efficient rendering
 */

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { Box, Flex, Text } from "@orderly.network/ui";
import { useOrderbookStream } from "@orderly.network/hooks";
import type { API } from "@orderly.network/types";

interface OrderbookDisplayProps {
  symbol: string;
  level?: number; // Number of price levels to display
  compact?: boolean;
  onPriceClick?: (price: number, side: "buy" | "sell") => void;
}

interface OrderbookLevel {
  price: number;
  size: number;
  total: number;
  percentage: number;
}

export function OrderbookDisplay({
  symbol,
  level = 20,
  compact = false,
  onPriceClick,
}: OrderbookDisplayProps) {
  const [bids, setBids] = useState<API.OrderBookItem[]>([]);
  const [asks, setAsks] = useState<API.OrderBookItem[]>([]);
  const [spread, setSpread] = useState<number>(0);
  const [spreadPercentage, setSpreadPercentage] = useState<number>(0);
  
  // Use Orderly's orderbook stream hook
  const orderbookData = useOrderbookStream(symbol, level);

  // Process orderbook data
  useEffect(() => {
    if (orderbookData && orderbookData.asks && orderbookData.bids) {
      const newAsks = Array.isArray(orderbookData.asks) ? orderbookData.asks : [];
      const newBids = Array.isArray(orderbookData.bids) ? orderbookData.bids : [];
      
      setAsks(newAsks.slice(0, level));
      setBids(newBids.slice(0, level));

      // Calculate spread
      if (newAsks.length > 0 && newBids.length > 0) {
        const bestAsk = newAsks[0]?.price || 0;
        const bestBid = newBids[0]?.price || 0;
        const calculatedSpread = bestAsk - bestBid;
        setSpread(calculatedSpread);
        setSpreadPercentage(bestBid > 0 ? (calculatedSpread / bestBid) * 100 : 0);
      }
    }
  }, [orderbookData, level]);

  // Process bids with cumulative totals
  const processedBids = useMemo(() => {
    let cumulative = 0;
    const maxTotal = bids.reduce((sum, bid) => sum + (bid.size || 0), 0);

    return bids.map((bid) => {
      cumulative += bid.size || 0;
      return {
        price: bid.price || 0,
        size: bid.size || 0,
        total: cumulative,
        percentage: maxTotal > 0 ? (cumulative / maxTotal) * 100 : 0,
      };
    });
  }, [bids]);

  // Process asks with cumulative totals
  const processedAsks = useMemo(() => {
    let cumulative = 0;
    const maxTotal = asks.reduce((sum, ask) => sum + (ask.size || 0), 0);

    return asks.map((ask) => {
      cumulative += ask.size || 0;
      return {
        price: ask.price || 0,
        size: ask.size || 0,
        total: cumulative,
        percentage: maxTotal > 0 ? (cumulative / maxTotal) * 100 : 0,
      };
    }).reverse(); // Reverse for display (highest ask at bottom)
  }, [asks]);

  const handlePriceClick = useCallback((price: number, side: "buy" | "sell") => {
    if (onPriceClick) {
      onPriceClick(price, side);
    }
  }, [onPriceClick]);

  if (compact) {
    return <OrderbookCompact 
      bids={processedBids.slice(0, 5)}
      asks={processedAsks.slice(-5)}
      spread={spread}
      spreadPercentage={spreadPercentage}
      onPriceClick={handlePriceClick}
    />;
  }

  return (
    <Box p={4} r="lg" intensity={900} className="shadow-md">
      {/* Header */}
      <Flex justify="between" itemsalign="center" className="mb-4">
        <div>
          <Text size="lg" weight="semibold">Order Book</Text>
          <Text size="xs" className="text-base-contrast-54">{symbol}</Text>
        </div>
        <div className="text-right">
          <Text size="xs" className="text-base-contrast-54">Spread</Text>
          <Text size="sm" weight="semibold" className="text-base-contrast-80">
            {spread.toFixed(2)} ({spreadPercentage.toFixed(3)}%)
          </Text>
        </div>
      </Flex>

      {/* Column Headers */}
      <div className="grid grid-cols-3 gap-2 mb-2 pb-2 border-b border-base-700">
        <Text size="xs" className="text-base-contrast-54 text-left">Price (USD)</Text>
        <Text size="xs" className="text-base-contrast-54 text-right">Size</Text>
        <Text size="xs" className="text-base-contrast-54 text-right">Total</Text>
      </div>

      {/* Asks (Sells) - Red */}
      <div className="mb-2">
        {processedAsks.map((ask, index) => (
          <OrderbookRow
            key={`ask-${index}`}
            level={ask}
            side="sell"
            onClick={() => handlePriceClick(ask.price, "sell")}
          />
        ))}
      </div>

      {/* Spread Indicator */}
      <div className="my-3 py-2 bg-base-800 rounded text-center">
        <Text size="xl" weight="bold" className="text-base-contrast">
          {processedBids[0]?.price?.toFixed(2) || "---"}
        </Text>
        <Text size="xs" className="text-base-contrast-54">
          Mid Price
        </Text>
      </div>

      {/* Bids (Buys) - Green */}
      <div>
        {processedBids.map((bid, index) => (
          <OrderbookRow
            key={`bid-${index}`}
            level={bid}
            side="buy"
            onClick={() => handlePriceClick(bid.price, "buy")}
          />
        ))}
      </div>
    </Box>
  );
}

interface OrderbookRowProps {
  level: OrderbookLevel;
  side: "buy" | "sell";
  onClick: () => void;
}

function OrderbookRow({ level, side, onClick }: OrderbookRowProps) {
  const bgColor = side === "buy" ? "bg-green-500" : "bg-red-500";
  const textColor = side === "buy" ? "text-green-500" : "text-red-500";

  return (
    <div
      className="relative cursor-pointer hover:bg-base-700 transition-colors group"
      onClick={onClick}
    >
      {/* Background bar */}
      <div
        className={`absolute right-0 top-0 bottom-0 ${bgColor} opacity-10 transition-all`}
        style={{ width: `${level.percentage}%` }}
      />

      {/* Content */}
      <div className="relative grid grid-cols-3 gap-2 py-1 px-2">
        <Text size="sm" weight="semibold" className={textColor}>
          {level.price.toFixed(2)}
        </Text>
        <Text size="sm" className="text-right text-base-contrast-80">
          {level.size.toFixed(4)}
        </Text>
        <Text size="sm" className="text-right text-base-contrast-54">
          {level.total.toFixed(4)}
        </Text>
      </div>
    </div>
  );
}

interface OrderbookCompactProps {
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
  spread: number;
  spreadPercentage: number;
  onPriceClick?: (price: number, side: "buy" | "sell") => void;
}

function OrderbookCompact({
  bids,
  asks,
  spread,
  spreadPercentage,
  onPriceClick,
}: OrderbookCompactProps) {
  return (
    <Box p={3} r="md" intensity={800}>
      <Text size="xs" weight="semibold" className="text-base-contrast-80 mb-2">
        ORDER BOOK
      </Text>

      {/* Best Ask */}
      <div className="mb-1">
        <Flex justify="between">
          <Text size="sm" className="text-red-500">
            {asks[asks.length - 1]?.price.toFixed(2) || "---"}
          </Text>
          <Text size="xs" className="text-base-contrast-54">
            {asks[asks.length - 1]?.size.toFixed(2) || "---"}
          </Text>
        </Flex>
      </div>

      {/* Spread */}
      <div className="my-2 py-1 bg-base-700 rounded text-center">
        <Text size="xs" className="text-base-contrast-54">
          Spread: {spread.toFixed(2)} ({spreadPercentage.toFixed(3)}%)
        </Text>
      </div>

      {/* Best Bid */}
      <div>
        <Flex justify="between">
          <Text size="sm" className="text-green-500">
            {bids[0]?.price.toFixed(2) || "---"}
          </Text>
          <Text size="xs" className="text-base-contrast-54">
            {bids[0]?.size.toFixed(2) || "---"}
          </Text>
        </Flex>
      </div>
    </Box>
  );
}

/**
 * Orderbook with depth chart visualization
 */
export function OrderbookWithDepth({ symbol, level = 20 }: { symbol: string; level?: number }) {
  const [view, setView] = useState<"book" | "depth">("book");

  return (
    <Box p={4} r="lg" intensity={900}>
      {/* View Toggle */}
      <Flex justify="between" itemsalign="center" className="mb-4">
        <Text size="lg" weight="semibold">Order Book</Text>
        <div className="flex gap-2">
          <button
            onClick={() => setView("book")}
            className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
              view === "book"
                ? "bg-primary-500 text-white"
                : "bg-base-700 text-base-contrast-54 hover:bg-base-600"
            }`}
          >
            Book
          </button>
          <button
            onClick={() => setView("depth")}
            className={`px-3 py-1 rounded text-xs font-semibold transition-all ${
              view === "depth"
                ? "bg-primary-500 text-white"
                : "bg-base-700 text-base-contrast-54 hover:bg-base-600"
            }`}
          >
            Depth
          </button>
        </div>
      </Flex>

      {view === "book" ? (
        <OrderbookDisplay symbol={symbol} level={level} />
      ) : (
        <Box p={4} className="text-center text-base-contrast-54">
          <Text>Depth chart visualization coming soon</Text>
        </Box>
      )}
    </Box>
  );
}

