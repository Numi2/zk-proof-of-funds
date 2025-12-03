/**
 * Trading Overview Card Component
 * 
 * Comprehensive dashboard showing account, positions, and risk at a glance
 * Perfect for the portfolio overview page
 */

import { useMemo } from "react";
import { Box, Flex, Text, Tooltip } from "@orderly.network/ui";
import { useTradingOverview } from "../../hooks/usePerpCalculations";
import { formatUSD, formatPercentage, formatLeverage, getValueColor } from "../../utils/perp-calculations";

export function TradingOverviewCard() {
  const { account, positions, risk, isLoading } = useTradingOverview();

  const riskBadge = useMemo(() => {
    const level = risk.accountRiskLevel;
    const config = {
      safe: { bg: "bg-green-500/20", text: "text-green-500", label: "Safe" },
      moderate: { bg: "bg-yellow-500/20", text: "text-yellow-500", label: "Moderate" },
      high: { bg: "bg-orange-500/20", text: "text-orange-500", label: "High Risk" },
      critical: { bg: "bg-red-500/20", text: "text-red-500", label: "Critical" },
    };
    return config[level];
  }, [risk.accountRiskLevel]);

  if (isLoading) {
    return (
      <Box p={6} r="xl" intensity={900} className="animate-pulse">
        <div className="h-8 bg-base-700 rounded w-1/3 mb-6" />
        <div className="space-y-4">
          <div className="h-24 bg-base-700 rounded" />
          <div className="h-24 bg-base-700 rounded" />
          <div className="h-24 bg-base-700 rounded" />
        </div>
      </Box>
    );
  }

  return (
    <Box p={6} r="xl" intensity={900} className="shadow-lg">
      {/* Header */}
      <Flex justify="between" align="center" mb={6}>
        <div>
          <Text size="2xl" weight="bold" mb={1}>
            Trading Overview
          </Text>
          <Text size="sm" className="text-base-contrast-54">
            Comprehensive account and position metrics
          </Text>
        </div>
        <div className={`px-4 py-2 rounded-full font-semibold ${riskBadge.bg} ${riskBadge.text}`}>
          {riskBadge.label}
        </div>
      </Flex>

      {/* Account Section */}
      <Box p={5} r="lg" intensity={800} mb={4}>
        <div className="mb-4">
            <Flex justify="between" align="center">
              <Text size="sm" weight="semibold" className="text-base-contrast-80">
                ACCOUNT BALANCE
              </Text>
              <Tooltip content="Total account equity including unrealized PnL">
                <Text size="2xl" weight="bold">
                  {formatUSD(account.totalValue)}
                </Text>
              </Tooltip>
            </Flex>
          </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Available Balance</Text>
            <Text size="lg" weight="semibold" className="text-green-500">
              {formatUSD(account.availableBalance)}
            </Text>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Total Collateral</Text>
            <Text size="lg" weight="semibold">
              {formatUSD(account.totalCollateral)}
            </Text>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Free Collateral</Text>
            <Text size="lg" weight="semibold">
              {formatUSD(account.freeCollateral)}
            </Text>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Current Leverage</Text>
            <Text size="lg" weight="semibold">
              {formatLeverage(account.currentLeverage)}
            </Text>
          </div>
        </div>
      </Box>

      {/* Positions Section */}
      <Box p={5} r="lg" intensity={800} mb={4}>
        <div className="mb-4">
          <Text size="sm" weight="semibold" className="text-base-contrast-80">
            POSITIONS SUMMARY
          </Text>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Open Positions</Text>
            <Flex align="baseline" gap={2}>
              <Text size="2xl" weight="bold">
                {positions.count}
              </Text>
              {positions.positionsAtRisk > 0 && (
                <Tooltip content={`${positions.positionsAtRisk} position(s) at risk`}>
                  <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/20 text-red-500 text-xs font-semibold">
                    ⚠ {positions.positionsAtRisk}
                  </div>
                </Tooltip>
              )}
            </Flex>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Total Unrealized PnL</Text>
            <Text
              size="2xl"
              weight="bold"
              className={getValueColor(positions.totalUnrealizedPnL)}
            >
              {formatUSD(positions.totalUnrealizedPnL)}
            </Text>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Total Unrealized ROI</Text>
            <Text
              size="2xl"
              weight="bold"
              className={getValueColor(positions.totalUnrealizedROI)}
            >
              {formatPercentage(positions.totalUnrealizedROI)}
            </Text>
          </div>
        </div>
      </Box>

      {/* Risk Section */}
      <Box p={5} r="lg" intensity={800}>
        <div className="mb-4">
          <Text size="sm" weight="semibold" className="text-base-contrast-80">
            RISK METRICS
          </Text>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Account Risk</Text>
            <Text size="xl" weight="bold" className={riskBadge.text}>
              {riskBadge.label}
            </Text>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Margin Ratio</Text>
            <Tooltip content="Ratio of total collateral to maintenance margin">
              <Text size="xl" weight="bold" className={riskBadge.text}>
                {risk.marginRatio.toFixed(2)}x
              </Text>
            </Tooltip>
            <div className="mt-2 h-2 bg-base-700 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  risk.marginRatio < 1.1 ? "bg-red-500" :
                  risk.marginRatio < 1.5 ? "bg-orange-500" :
                  risk.marginRatio < 2.0 ? "bg-yellow-500" :
                  "bg-green-500"
                }`}
                style={{ width: `${Math.min((risk.marginRatio / 3) * 100, 100)}%` }}
              />
            </div>
          </div>

          <div>
            <Text size="xs" className="text-base-contrast-54 mb-1">Positions at Risk</Text>
            <Text size="xl" weight="bold" className={positions.positionsAtRisk > 0 ? "text-red-500" : "text-green-500"}>
              {positions.positionsAtRisk}
            </Text>
          </div>
        </div>

        {risk.isAccountAtRisk && (
          <Box p={3} r="md" mt={4} className="bg-red-500/10 border border-red-500/30">
            <Flex gap={2} align="center">
              <span className="text-red-500 text-xl">⚠️</span>
              <div>
                <Text size="sm" weight="semibold" className="text-red-500">
                  Account Risk Warning
                </Text>
                <Text size="xs" className="text-red-400">
                  Your account is at {risk.accountRiskLevel} risk. Consider reducing positions or adding collateral.
                </Text>
              </div>
            </Flex>
          </Box>
        )}
      </Box>
    </Box>
  );
}

