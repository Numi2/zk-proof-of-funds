/**
 * Risk Indicator Component
 * 
 * Visual risk indicator for account and position risk levels
 * Can be used inline or as a standalone widget
 */

import { useMemo } from "react";
import { Flex, Text, Tooltip } from "@orderly.network/ui";
import { useAccountRisk, usePositionRisk } from "../../hooks/usePerpCalculations";

interface RiskIndicatorProps {
  symbol?: string; // If provided, shows position risk. Otherwise shows account risk
  variant?: "compact" | "full" | "badge";
  showLabel?: boolean;
}

export function RiskIndicator({ symbol, variant = "compact", showLabel = true }: RiskIndicatorProps) {
  const accountRisk = useAccountRisk();
  const positionRisk = usePositionRisk(symbol || "");

  const { riskLevel, marginRatio, distanceToLiq } = useMemo(() => {
    if (symbol) {
      return {
        riskLevel: positionRisk.riskLevel,
        marginRatio: 0,
        distanceToLiq: positionRisk.distanceToLiq,
      };
    }
    return {
      riskLevel: accountRisk.riskLevel,
      marginRatio: accountRisk.marginRatio,
      distanceToLiq: 0,
    };
  }, [symbol, accountRisk, positionRisk]);

  const config = useMemo(() => {
    const configs = {
      safe: {
        color: "text-green-500",
        bg: "bg-green-500",
        bgOpacity: "bg-green-500/20",
        label: "Safe",
        icon: "✓",
      },
      moderate: {
        color: "text-yellow-500",
        bg: "bg-yellow-500",
        bgOpacity: "bg-yellow-500/20",
        label: "Moderate",
        icon: "⚡",
      },
      high: {
        color: "text-orange-500",
        bg: "bg-orange-500",
        bgOpacity: "bg-orange-500/20",
        label: "High Risk",
        icon: "⚠",
      },
      critical: {
        color: "text-red-500",
        bg: "bg-red-500",
        bgOpacity: "bg-red-500/20",
        label: "Critical",
        icon: "🚨",
      },
    };
    return configs[riskLevel];
  }, [riskLevel]);

  const tooltipContent = useMemo(() => {
    if (symbol) {
      return `Position is ${distanceToLiq.toFixed(1)}% away from liquidation`;
    }
    return `Account margin ratio: ${marginRatio.toFixed(2)}x`;
  }, [symbol, distanceToLiq, marginRatio]);

  if (variant === "badge") {
    return (
      <Tooltip content={tooltipContent}>
        <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full ${config.bgOpacity} ${config.color} font-semibold text-xs`}>
          <span>{config.icon}</span>
          {showLabel && <span>{config.label}</span>}
        </div>
      </Tooltip>
    );
  }

  if (variant === "compact") {
    return (
      <Tooltip content={tooltipContent}>
        <Flex align="center" gap={1}>
          <div className={`w-2 h-2 rounded-full ${config.bg}`} />
          {showLabel && (
            <Text size="xs" className={config.color}>
              {config.label}
            </Text>
          )}
        </Flex>
      </Tooltip>
    );
  }

  // Full variant
  return (
    <Tooltip content={tooltipContent}>
      <Flex direction="column" gap={2} className="p-3 rounded-lg" style={{ backgroundColor: `${config.bgOpacity}` }}>
        <Flex align="center" gap={2}>
          <span className="text-lg">{config.icon}</span>
          <div>
            <Text size="xs" className="text-base-contrast-54">
              {symbol ? "Position Risk" : "Account Risk"}
            </Text>
            <Text size="sm" weight="semibold" className={config.color}>
              {config.label}
            </Text>
          </div>
        </Flex>
        
        {symbol ? (
          <div>
            <Text size="xs" className="text-base-contrast-54">Distance to Liquidation</Text>
            <Text size="lg" weight="bold" className={config.color}>
              {distanceToLiq.toFixed(2)}%
            </Text>
          </div>
        ) : (
          <div>
            <Text size="xs" className="text-base-contrast-54">Margin Ratio</Text>
            <Text size="lg" weight="bold" className={config.color}>
              {marginRatio.toFixed(2)}x
            </Text>
          </div>
        )}
      </Flex>
    </Tooltip>
  );
}

/**
 * Quick risk gauge that shows visual progress bar
 */
export function RiskGauge({ symbol }: { symbol?: string }) {
  const accountRisk = useAccountRisk();
  const positionRisk = usePositionRisk(symbol || "");

  const { riskLevel, percentage } = useMemo(() => {
    if (symbol) {
      const distanceToLiq = positionRisk.distanceToLiq;
      return {
        riskLevel: positionRisk.riskLevel,
        percentage: Math.min(distanceToLiq, 100),
      };
    }
    return {
      riskLevel: accountRisk.riskLevel,
      percentage: Math.min((accountRisk.marginRatio / 3) * 100, 100),
    };
  }, [symbol, accountRisk, positionRisk]);

  const barColor = useMemo(() => {
    if (riskLevel === "safe") return "bg-green-500";
    if (riskLevel === "moderate") return "bg-yellow-500";
    if (riskLevel === "high") return "bg-orange-500";
    return "bg-red-500";
  }, [riskLevel]);

  return (
    <div>
      <Flex justify="between" align="center" mb={1}>
        <Text size="xs" className="text-base-contrast-54">
          {symbol ? "Position Risk" : "Account Risk"}
        </Text>
        <RiskIndicator symbol={symbol} variant="compact" />
      </Flex>
      <div className="h-2 bg-base-700 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all duration-500 ${barColor}`}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}

