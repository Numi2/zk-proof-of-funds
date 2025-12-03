/**
 * Max Quantity Display Component
 * 
 * Shows maximum tradable quantity for buy/sell orders
 * Perfect for order entry interfaces
 */

import { useMemo } from "react";
import { Box, Flex, Text, Tooltip } from "@orderly.network/ui";
import type { OrderSide } from "@orderly.network/types";
import { useMaxQty } from "../../hooks/usePerpCalculations";

interface MaxQtyDisplayProps {
  symbol: string;
  side: OrderSide;
  compact?: boolean;
  onMaxClick?: (maxQty: number) => void;
}

export function MaxQtyDisplay({ symbol, side, compact = false, onMaxClick }: MaxQtyDisplayProps) {
  const { maxQty, isLoading, canTrade } = useMaxQty(symbol, side);

  const sideColor = useMemo(() => {
    return side === "BUY" ? "text-green-500" : "text-red-500";
  }, [side]);

  if (isLoading) {
    return (
      <div className="h-6 bg-base-700 rounded animate-pulse" style={{ width: compact ? "80px" : "120px" }} />
    );
  }

  if (compact) {
    return (
      <Tooltip content={`Maximum ${side === "BUY" ? "buy" : "sell"} quantity available`}>
        <Flex
          align="center"
          gap={1}
          className={`cursor-pointer hover:opacity-80 transition-opacity ${onMaxClick ? "" : "cursor-default"}`}
          onClick={() => onMaxClick && onMaxClick(maxQty)}
        >
          <Text size="xs" className="text-base-contrast-54">
            Max:
          </Text>
          <Text size="sm" weight="semibold" className={canTrade ? sideColor : "text-base-contrast-36"}>
            {maxQty.toFixed(4)}
          </Text>
        </Flex>
      </Tooltip>
    );
  }

  return (
    <Box p={3} r="md" intensity={800}>
      <Flex justify="between" align="center">
        <div>
          <Text size="xs" className="text-base-contrast-54 mb-1">
            Max {side === "BUY" ? "Buy" : "Sell"} Quantity
          </Text>
          <Tooltip content="Maximum quantity you can trade based on your available balance and leverage">
            <Text size="lg" weight="bold" className={canTrade ? sideColor : "text-base-contrast-36"}>
              {maxQty.toFixed(4)}
            </Text>
          </Tooltip>
        </div>
        
        {onMaxClick && canTrade && (
          <button
            onClick={() => onMaxClick(maxQty)}
            className={`px-3 py-1 rounded-md font-semibold text-xs transition-all ${
              side === "BUY"
                ? "bg-green-500/20 text-green-500 hover:bg-green-500/30"
                : "bg-red-500/20 text-red-500 hover:bg-red-500/30"
            }`}
          >
            Use Max
          </button>
        )}

        {!canTrade && (
          <div className="px-3 py-1 rounded-md bg-base-700 text-base-contrast-54 text-xs font-semibold">
            Insufficient Balance
          </div>
        )}
      </Flex>
    </Box>
  );
}

interface DualMaxQtyDisplayProps {
  symbol: string;
  onMaxBuyClick?: (maxQty: number) => void;
  onMaxSellClick?: (maxQty: number) => void;
}

/**
 * Shows both buy and sell max quantities side by side
 */
export function DualMaxQtyDisplay({ symbol, onMaxBuyClick, onMaxSellClick }: DualMaxQtyDisplayProps) {
  const { maxQty: maxBuy, isLoading: buyLoading } = useMaxQty(symbol, "BUY");
  const { maxQty: maxSell, isLoading: sellLoading } = useMaxQty(symbol, "SELL");

  if (buyLoading || sellLoading) {
    return (
      <Box p={4} r="lg" intensity={800} className="animate-pulse">
        <div className="h-20 bg-base-700 rounded" />
      </Box>
    );
  }

  return (
    <Box p={4} r="lg" intensity={800}>
      <Text size="xs" weight="semibold" className="text-base-contrast-80 mb-3">
        MAXIMUM QUANTITY
      </Text>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Text size="xs" className="text-base-contrast-54 mb-2">Max Buy</Text>
          <Flex justify="between" align="center">
            <Text size="xl" weight="bold" className="text-green-500">
              {maxBuy.toFixed(4)}
            </Text>
            {onMaxBuyClick && maxBuy > 0 && (
              <button
                onClick={() => onMaxBuyClick(maxBuy)}
                className="px-2 py-1 rounded bg-green-500/20 text-green-500 hover:bg-green-500/30 text-xs font-semibold transition-all"
              >
                Use
              </button>
            )}
          </Flex>
        </div>

        <div>
          <Text size="xs" className="text-base-contrast-54 mb-2">Max Sell</Text>
          <Flex justify="between" align="center">
            <Text size="xl" weight="bold" className="text-red-500">
              {maxSell.toFixed(4)}
            </Text>
            {onMaxSellClick && maxSell > 0 && (
              <button
                onClick={() => onMaxSellClick(maxSell)}
                className="px-2 py-1 rounded bg-red-500/20 text-red-500 hover:bg-red-500/30 text-xs font-semibold transition-all"
              >
                Use
              </button>
            )}
          </Flex>
        </div>
      </div>
    </Box>
  );
}

