/**
 * Position Metrics Card Component
 * 
 * Beautiful card showing detailed position metrics and risk information
 * Perfect for position pages and trading interfaces
 */

import { useMemo } from "react";
import { Box, Flex, Text, Tooltip } from "@orderly.network/ui";
import { usePositionMetrics, usePositionRisk } from "../../hooks/usePerpCalculations";
import {
  formatUSD,
  formatPercentage,
  getValueColor,
} from "../../utils/perp-calculations";

interface PositionMetricsCardProps {
  symbol: string;
  compact?: boolean;
}

export function PositionMetricsCard({ symbol, compact = false }: PositionMetricsCardProps) {
  const { metrics, position, isLoading } = usePositionMetrics(symbol);
  const { liqPrice, distanceToLiq, riskLevel } = usePositionRisk(symbol);

  const riskColor = useMemo(() => {
    if (riskLevel === "safe") return "text-green-500";
    if (riskLevel === "moderate") return "text-yellow-500";
    if (riskLevel === "high") return "text-orange-500";
    return "text-red-500";
  }, [riskLevel]);

  const riskBgColor = useMemo(() => {
    if (riskLevel === "safe") return "bg-green-500/20";
    if (riskLevel === "moderate") return "bg-yellow-500/20";
    if (riskLevel === "high") return "bg-orange-500/20";
    return "bg-red-500/20";
  }, [riskLevel]);

  if (isLoading || !metrics || !position) {
    return compact ? null : (
      <Box p={4} r="lg" intensity={800} className="animate-pulse">
        <div className="h-6 bg-base-700 rounded w-1/2 mb-4" />
        <div className="h-16 bg-base-700 rounded" />
      </Box>
    );
  }

  if (compact) {
    return (
      <Flex gap={4} wrap="wrap" align="center" className="text-sm">
        <div>
          <Text size="xs" className="text-base-contrast-54">Unrealized PnL</Text>
          <Text size="sm" weight="semibold" className={getValueColor(metrics.unrealizedPnL)}>
            {formatUSD(metrics.unrealizedPnL)}
          </Text>
        </div>
        <div>
          <Text size="xs" className="text-base-contrast-54">ROI</Text>
          <Text size="sm" weight="semibold" className={getValueColor(metrics.unrealizedROI)}>
            {formatPercentage(metrics.unrealizedROI)}
          </Text>
        </div>
        <div>
          <Text size="xs" className="text-base-contrast-54">Liq Price</Text>
          <Text size="sm" weight="semibold" className={riskColor}>
            {formatUSD(liqPrice)}
          </Text>
        </div>
      </Flex>
    );
  }

  return (
    <Box p={5} r="xl" intensity={900} className="shadow-md">
      {/* Header with Symbol and Risk Badge */}
      <Flex justify="between" align="center" mb={4}>
        <Text size="lg" weight="semibold">
          {symbol} Position Metrics
        </Text>
        <div className={`px-3 py-1 rounded-full text-xs font-semibold ${riskBgColor} ${riskColor}`}>
          {riskLevel.toUpperCase()}
        </div>
      </Flex>

      {/* PnL Section */}
      <Box p={4} r="lg" intensity={800} mb={4}>
        <Text size="xs" weight="semibold" className="text-base-contrast-80 mb-3">
          PROFIT & LOSS
        </Text>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">
              Unrealized PnL
            </Text>
            <Tooltip content="Profit/loss if position closed at current price">
              <Text size="xl" weight="bold" className={getValueColor(metrics.unrealizedPnL)}>
                {formatUSD(metrics.unrealizedPnL)}
              </Text>
            </Tooltip>
          </div>
          
          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">
              Unrealized ROI
            </Text>
            <Text size="xl" weight="bold" className={getValueColor(metrics.unrealizedROI)}>
              {formatPercentage(metrics.unrealizedROI)}
            </Text>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">
              Unsettlement PnL
            </Text>
            <Tooltip content="PnL that has not yet been settled">
              <Text size="xl" weight="bold" className={getValueColor(metrics.unsettlementPnL)}>
                {formatUSD(metrics.unsettlementPnL)}
              </Text>
            </Tooltip>
          </div>
        </div>
      </Box>

      {/* Risk Section */}
      <Box p={4} r="lg" intensity={800} mb={4}>
        <Text size="xs" weight="semibold" className="text-base-contrast-80 mb-3">
          LIQUIDATION RISK
        </Text>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">
              Liquidation Price
            </Text>
            <Text size="xl" weight="bold" className={riskColor}>
              {formatUSD(liqPrice)}
            </Text>
            <Text size="xs" className="text-base-contrast-54 mt-1">
              Current: {formatUSD(position.mark_price || 0)}
            </Text>
          </div>
          
          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">
              Distance to Liquidation
            </Text>
            <Text size="xl" weight="bold" className={riskColor}>
              {distanceToLiq.toFixed(2)}%
            </Text>
            {/* Progress Bar */}
            <div className="mt-2 h-2 bg-base-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  distanceToLiq < 5 ? "bg-red-500" :
                  distanceToLiq < 10 ? "bg-orange-500" :
                  distanceToLiq < 20 ? "bg-yellow-500" :
                  "bg-green-500"
                }`}
                style={{ width: `${Math.min(distanceToLiq, 100)}%` }}
              />
            </div>
          </div>
        </div>
      </Box>

      {/* Position Details */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div>
          <Text size="xs" className="text-base-contrast-54">Total Notional</Text>
          <Text size="sm" weight="semibold">
            {formatUSD(metrics.totalNotional)}
          </Text>
        </div>
        
        <div>
          <Text size="xs" className="text-base-contrast-54">MMR</Text>
          <Tooltip content="Maintenance Margin Requirement">
            <Text size="sm" weight="semibold">
              {formatPercentage(metrics.MMR)}
            </Text>
          </Tooltip>
        </div>

        <div>
          <Text size="xs" className="text-base-contrast-54">Maint. Margin</Text>
          <Tooltip content="Minimum margin to maintain position">
            <Text size="sm" weight="semibold">
              {formatUSD(metrics.maintenanceMargin)}
            </Text>
          </Tooltip>
        </div>

        <div>
          <Text size="xs" className="text-base-contrast-54">Position Size</Text>
          <Text size="sm" weight="semibold">
            {position.position_qty?.toFixed(4) || "0"}
          </Text>
        </div>
      </div>
    </Box>
  );
}

