/**
 * Account Metrics Card Component
 * 
 * Beautiful, responsive card showing comprehensive account metrics
 * Integrates seamlessly with Orderly UI components
 */

import { useMemo } from "react";
import { Box, Flex, Text, Tooltip } from "@orderly.network/ui";
import { useAccountMetrics, useAccountRisk, useAccountLeverage } from "../../hooks/usePerpCalculations";
import {
  formatUSD,
  formatPercentage,
  formatLeverage,
  getValueColor,
  getRiskLevel,
} from "../../utils/perp-calculations";

interface MetricItemProps {
  label: string;
  value: string | number;
  tooltip?: string;
  valueColor?: string;
  highlight?: boolean;
}

function MetricItem({ label, value, tooltip, valueColor, highlight }: MetricItemProps) {
  const content = (
    <Flex direction="column" gap={1} className={highlight ? "p-2 bg-base-700 rounded-lg" : "p-2"}>
      <Text size="xs" className="text-base-contrast-54">
        {label}
      </Text>
      <Text size="2xl" weight="semibold" className={valueColor || "text-base-contrast"}>
        {value}
      </Text>
    </Flex>
  );

  if (tooltip) {
    return (
      <Tooltip content={tooltip} delayDuration={200}>
        {content}
      </Tooltip>
    );
  }

  return content;
}

export function AccountMetricsCard() {
  const { metrics, isLoading } = useAccountMetrics();
  const { riskLevel, marginRatio } = useAccountRisk();
  const { currentLeverage, maxLeverage, leverageUtilization } = useAccountLeverage();

  const riskInfo = useMemo(() => getRiskLevel(marginRatio), [marginRatio]);

  if (isLoading) {
    return (
      <Box p={6} r="xl" intensity={900} className="animate-pulse">
        <Flex direction="column" gap={4}>
          <div className="h-6 bg-base-700 rounded w-1/3" />
          <div className="h-20 bg-base-700 rounded" />
          <div className="h-20 bg-base-700 rounded" />
        </Flex>
      </Box>
    );
  }

  return (
    <Box p={6} r="xl" intensity={900} className="shadow-lg">
      {/* Header */}
      <Flex justify="between" align="center" mb={4}>
        <Text size="xl" weight="semibold">
          Account Overview
        </Text>
        <Flex gap={2} align="center">
          <div className={`px-3 py-1 rounded-full text-xs font-semibold ${
            riskInfo.level === "safe" ? "bg-green-500/20 text-green-500" :
            riskInfo.level === "moderate" ? "bg-yellow-500/20 text-yellow-500" :
            riskInfo.level === "high" ? "bg-orange-500/20 text-orange-500" :
            "bg-red-500/20 text-red-500"
          }`}>
            {riskInfo.label}
          </div>
        </Flex>
      </Flex>

      {/* Main Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <MetricItem
          label="Total Value"
          value={formatUSD(metrics.totalValue)}
          tooltip="Total account equity including unrealized PnL"
          highlight
        />
        <MetricItem
          label="Available Balance"
          value={formatUSD(metrics.availableBalance)}
          tooltip="Balance available for opening new positions"
          valueColor="text-green-500"
          highlight
        />
        <MetricItem
          label="Total Collateral"
          value={formatUSD(metrics.totalCollateral)}
          tooltip="Total collateral in your account"
        />
        <MetricItem
          label="Free Collateral"
          value={formatUSD(metrics.freeCollateral)}
          tooltip="Collateral not tied up in positions"
        />
      </div>

      {/* Leverage & Margin */}
      <Box p={4} r="lg" intensity={800} mb={4}>
        <Text size="sm" weight="semibold" mb={3} className="text-base-contrast-80">
          Leverage & Margin
        </Text>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">
              Current Leverage
            </Text>
            <Flex align="baseline" gap={1}>
              <Text size="lg" weight="semibold">
                {formatLeverage(currentLeverage)}
              </Text>
              <Text size="xs" className="text-base-contrast-54">
                / {formatLeverage(maxLeverage)}
              </Text>
            </Flex>
            {/* Leverage Bar */}
            <div className="mt-2 h-2 bg-base-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  leverageUtilization > 80 ? "bg-red-500" :
                  leverageUtilization > 60 ? "bg-orange-500" :
                  leverageUtilization > 40 ? "bg-yellow-500" :
                  "bg-green-500"
                }`}
                style={{ width: `${Math.min(leverageUtilization, 100)}%` }}
              />
            </div>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">
              Margin Ratio
            </Text>
            <Tooltip content="Ratio of total collateral to maintenance margin">
              <Text size="lg" weight="semibold" className={riskInfo.color}>
                {marginRatio.toFixed(2)}x
              </Text>
            </Tooltip>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">
              Total Unrealized ROI
            </Text>
            <Text
              size="lg"
              weight="semibold"
              className={getValueColor(metrics.totalUnrealizedROI)}
            >
              {formatPercentage(metrics.totalUnrealizedROI)}
            </Text>
          </div>
        </div>
      </Box>

      {/* Additional Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <MetricItem
          label="Initial Margin (IMR)"
          value={formatUSD(metrics.IMR)}
          tooltip="Minimum margin required to open positions"
        />
        <MetricItem
          label="Total IM w/ Orders"
          value={formatUSD(metrics.totalInitialMarginWithOrders)}
          tooltip="Initial margin including open orders"
        />
        <MetricItem
          label="Margin Utilization"
          value={formatPercentage(leverageUtilization / 100)}
          tooltip="Percentage of maximum leverage being used"
          valueColor={
            leverageUtilization > 80 ? "text-red-500" :
            leverageUtilization > 60 ? "text-orange-500" :
            "text-green-500"
          }
        />
      </div>
    </Box>
  );
}

