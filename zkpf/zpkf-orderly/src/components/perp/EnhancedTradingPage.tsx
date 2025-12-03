/**
 * Enhanced Trading Page Component
 * 
 * Wraps the Orderly TradingPage with additional perp SDK metrics
 * Provides comprehensive trading information with risk indicators
 */

import { useMemo } from "react";
import { Flex, Box } from "@orderly.network/ui";
import type { TradingPageProps } from "@orderly.network/trading";
import { TradingPage } from "@orderly.network/trading";
import { PositionMetricsCard } from "./PositionMetricsCard";
import { DualMaxQtyDisplay } from "./MaxQtyDisplay";
import { RiskIndicator } from "./RiskIndicator";
import { usePositionStream } from "@orderly.network/hooks";

interface EnhancedTradingPageProps extends TradingPageProps {
  showPositionMetrics?: boolean;
  showMaxQty?: boolean;
  showRiskIndicator?: boolean;
}

export function EnhancedTradingPage({
  symbol,
  showPositionMetrics = true,
  showMaxQty = true,
  showRiskIndicator = true,
  ...tradingPageProps
}: EnhancedTradingPageProps) {
  const { data: positions } = usePositionStream();

  // Check if there's an active position for this symbol
  const hasPosition = useMemo(() => {
    return positions?.some((p) => p.symbol === symbol) || false;
  }, [positions, symbol]);

  return (
    <div className="relative">
      {/* Risk Indicator Overlay (top-right) */}
      {showRiskIndicator && (
        <div className="absolute top-4 right-4 z-10">
          <RiskIndicator variant="badge" />
        </div>
      )}

      {/* Main Trading Interface */}
      <TradingPage symbol={symbol} {...tradingPageProps} />

      {/* Enhanced Metrics Panel */}
      <Flex direction="column" gap={4} p={4} className="bg-base-900">
        {/* Max Quantity Display */}
        {showMaxQty && (
          <DualMaxQtyDisplay symbol={symbol} />
        )}

        {/* Position Metrics (only show if position exists) */}
        {showPositionMetrics && hasPosition && (
          <PositionMetricsCard symbol={symbol} />
        )}

        {/* Info Text for No Position */}
        {showPositionMetrics && !hasPosition && (
          <Box p={4} r="lg" intensity={800} className="text-center">
            <p className="text-base-contrast-54 text-sm">
              No active position for {symbol}. Open a position to see detailed metrics.
            </p>
          </Box>
        )}
      </Flex>
    </div>
  );
}

