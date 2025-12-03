/**
 * Orderly Perp Calculations React Hooks
 * 
 * High-quality React hooks that integrate Orderly SDK data with perp calculations
 * Provides real-time calculated metrics for account and position management
 */

import { useMemo } from "react";
import { useAccountInfo, usePositionStream, useOrderStream } from "@orderly.network/hooks";
import type { API, OrderSide } from "@orderly.network/types";
import {
  calculateAccountMetrics,
  calculatePositionMetrics,
  calculateMaxQty,
  type AccountMetrics,
  type PositionMetrics,
  type MaxQtyParams,
} from "../utils/perp-calculations";

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get comprehensive account metrics with all perp calculations
 * Automatically updates when account data changes
 */
export function useAccountMetrics(): {
  metrics: AccountMetrics;
  accountInfo: API.AccountInfo | undefined;
  isLoading: boolean;
} {
  const { data: accountInfo, isLoading: accountLoading } = useAccountInfo();
  const [positionsData] = usePositionStream();
  const [orders, ordersHelpers] = useOrderStream({});

  const positions = positionsData?.rows || [];

  const metrics = useMemo(() => {
    return calculateAccountMetrics(accountInfo, positions, orders);
  }, [accountInfo, positions, orders]);

  return {
    metrics,
    accountInfo,
    isLoading: accountLoading || ordersHelpers.isLoading,
  };
}

/**
 * Get specific account metric
 * More efficient if you only need one metric
 */
export function useAccountMetric<K extends keyof AccountMetrics>(
  metric: K
): {
  value: AccountMetrics[K];
  isLoading: boolean;
} {
  const { metrics, isLoading } = useAccountMetrics();
  
  return {
    value: metrics[metric],
    isLoading,
  };
}

/**
 * Calculate maximum quantity that can be traded for a symbol
 * Takes into account available balance, leverage, and existing positions
 */
export function useMaxQty(
  symbol: string,
  side: OrderSide
): {
  maxQty: number;
  isLoading: boolean;
  canTrade: boolean;
} {
  const { data: accountInfo, isLoading: accountLoading } = useAccountInfo();
  const [positionsData] = usePositionStream();

  const positions = positionsData?.rows || [];

  const maxQty = useMemo(() => {
    if (!accountInfo || !positions) return 0;
    
    const params: MaxQtyParams = {
      symbol,
      side,
      accountInfo,
      positions,
    };
    
    return calculateMaxQty(params);
  }, [symbol, side, accountInfo, positions]);

  return {
    maxQty,
    isLoading: accountLoading,
    canTrade: maxQty > 0,
  };
}

/**
 * Check if account is at risk of liquidation
 * Returns risk level and margin ratio
 */
export function useAccountRisk(): {
  marginRatio: number;
  riskLevel: "safe" | "moderate" | "high" | "critical";
  isAtRisk: boolean;
  isLoading: boolean;
} {
  const { metrics, isLoading } = useAccountMetrics();

  const riskLevel = useMemo(() => {
    const ratio = metrics.totalMarginRatio;
    if (ratio >= 2.0) return "safe";
    if (ratio >= 1.5) return "moderate";
    if (ratio >= 1.1) return "high";
    return "critical";
  }, [metrics.totalMarginRatio]);

  return {
    marginRatio: metrics.totalMarginRatio,
    riskLevel,
    isAtRisk: riskLevel === "high" || riskLevel === "critical",
    isLoading,
  };
}

/**
 * Get account leverage information
 * Includes current leverage and maximum leverage
 */
export function useAccountLeverage(): {
  currentLeverage: number;
  maxLeverage: number;
  leverageUtilization: number; // Percentage of max leverage being used
  isLoading: boolean;
} {
  const { data: accountInfo } = useAccountInfo();
  const { metrics, isLoading } = useAccountMetrics();

  const maxLeverage = accountInfo?.max_leverage || 10;
  const leverageUtilization = useMemo(() => {
    if (maxLeverage === 0) return 0;
    return (metrics.currentLeverage / maxLeverage) * 100;
  }, [metrics.currentLeverage, maxLeverage]);

  return {
    currentLeverage: metrics.currentLeverage,
    maxLeverage,
    leverageUtilization,
    isLoading,
  };
}

/**
 * Get detailed collateral information
 * Includes total, free, and used collateral
 */
export function useCollateralInfo(): {
  totalCollateral: number;
  freeCollateral: number;
  usedCollateral: number;
  collateralUtilization: number; // Percentage of collateral being used
  isLoading: boolean;
} {
  const { metrics, isLoading } = useAccountMetrics();

  const usedCollateral = useMemo(() => {
    return metrics.totalCollateral - metrics.freeCollateral;
  }, [metrics.totalCollateral, metrics.freeCollateral]);

  const collateralUtilization = useMemo(() => {
    if (metrics.totalCollateral === 0) return 0;
    return (usedCollateral / metrics.totalCollateral) * 100;
  }, [usedCollateral, metrics.totalCollateral]);

  return {
    totalCollateral: metrics.totalCollateral,
    freeCollateral: metrics.freeCollateral,
    usedCollateral,
    collateralUtilization,
    isLoading,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// POSITION HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get metrics for all positions
 * Returns array of position metrics
 */
export function usePositionsMetrics(): {
  positionsMetrics: Array<PositionMetrics & { symbol: string }>;
  isLoading: boolean;
} {
  const { data: accountInfo } = useAccountInfo();
  const [positionsData] = usePositionStream();

  const positions = positionsData?.rows || [];

  const positionsMetrics = useMemo(() => {
    if (!positions || positions.length === 0) return [];
    
    return positions.map((position: any) => ({
      symbol: position.symbol,
      ...calculatePositionMetrics(position, accountInfo, positions),
    }));
  }, [positions, accountInfo]);

  return {
    positionsMetrics,
    isLoading: false, // Position stream doesn't provide isLoading
  };
}

/**
 * Get metrics for a specific position by symbol
 */
export function usePositionMetrics(
  symbol: string
): {
  metrics: PositionMetrics | null;
  position: API.PositionTPSLExt | undefined;
  isLoading: boolean;
} {
  const { data: accountInfo } = useAccountInfo();
  const [positionsData] = usePositionStream();

  const positions = positionsData?.rows || [];

  const position = useMemo(() => {
    return positions?.find((p: any) => p.symbol === symbol);
  }, [positions, symbol]);

  const metrics = useMemo(() => {
    if (!position) return null;
    return calculatePositionMetrics(position, accountInfo, positions);
  }, [position, accountInfo, positions]);

  return {
    metrics,
    position,
    isLoading: false,
  };
}

/**
 * Check if a position is at risk of liquidation
 */
export function usePositionRisk(
  symbol: string
): {
  liqPrice: number;
  distanceToLiq: number; // Percentage distance to liquidation
  isAtRisk: boolean;
  riskLevel: "safe" | "moderate" | "high" | "critical";
  isLoading: boolean;
} {
  const { metrics, position, isLoading } = usePositionMetrics(symbol);

  const distanceToLiq = useMemo(() => {
    if (!metrics || !position || metrics.liqPrice === 0) return 100;
    
    const currentPrice = position.mark_price || 0;
    const liqPrice = metrics.liqPrice;
    
    if (currentPrice === 0) return 100;
    
    // Calculate percentage distance
    return Math.abs((currentPrice - liqPrice) / currentPrice) * 100;
  }, [metrics, position]);

  const riskLevel = useMemo(() => {
    if (distanceToLiq >= 20) return "safe";
    if (distanceToLiq >= 10) return "moderate";
    if (distanceToLiq >= 5) return "high";
    return "critical";
  }, [distanceToLiq]);

  return {
    liqPrice: metrics?.liqPrice || 0,
    distanceToLiq,
    isAtRisk: riskLevel === "high" || riskLevel === "critical",
    riskLevel,
    isLoading,
  };
}

/**
 * Get PnL information for a position
 */
export function usePositionPnL(
  symbol: string
): {
  unrealizedPnL: number;
  unrealizedROI: number;
  unsettlementPnL: number;
  totalNotional: number;
  isLoading: boolean;
} {
  const { metrics, isLoading } = usePositionMetrics(symbol);

  return {
    unrealizedPnL: metrics?.unrealizedPnL || 0,
    unrealizedROI: metrics?.unrealizedROI || 0,
    unsettlementPnL: metrics?.unsettlementPnL || 0,
    totalNotional: metrics?.totalNotional || 0,
    isLoading,
  };
}

/**
 * Get total PnL across all positions
 */
export function useTotalPnL(): {
  totalUnrealizedPnL: number;
  totalUnrealizedROI: number;
  totalUnsettlementPnL: number;
  isLoading: boolean;
} {
  const { positionsMetrics, isLoading } = usePositionsMetrics();

  const totalUnrealizedPnL = useMemo(() => {
    return positionsMetrics.reduce((sum, p) => sum + p.unrealizedPnL, 0);
  }, [positionsMetrics]);

  const totalUnsettlementPnL = useMemo(() => {
    return positionsMetrics.reduce((sum, p) => sum + p.unsettlementPnL, 0);
  }, [positionsMetrics]);

  const { metrics: accountMetrics } = useAccountMetrics();

  return {
    totalUnrealizedPnL,
    totalUnrealizedROI: accountMetrics.totalUnrealizedROI,
    totalUnsettlementPnL,
    isLoading,
  };
}

/**
 * Get maintenance margin information for a position
 */
export function usePositionMargin(
  symbol: string
): {
  MMR: number;
  maintenanceMargin: number;
  isLoading: boolean;
} {
  const { metrics, isLoading } = usePositionMetrics(symbol);

  return {
    MMR: metrics?.MMR || 0,
    maintenanceMargin: metrics?.maintenanceMargin || 0,
    isLoading,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMBINED HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Get comprehensive trading overview
 * Combines account and position metrics for a complete dashboard view
 */
export function useTradingOverview(): {
  account: {
    totalValue: number;
    availableBalance: number;
    totalCollateral: number;
    freeCollateral: number;
    currentLeverage: number;
    marginRatio: number;
  };
  positions: {
    count: number;
    totalUnrealizedPnL: number;
    totalUnrealizedROI: number;
    positionsAtRisk: number;
  };
  risk: {
    accountRiskLevel: "safe" | "moderate" | "high" | "critical";
    isAccountAtRisk: boolean;
    marginRatio: number;
  };
  isLoading: boolean;
} {
  const { metrics: accountMetrics, isLoading: accountLoading } = useAccountMetrics();
  const { positionsMetrics, isLoading: positionsLoading } = usePositionsMetrics();
  const { riskLevel, isAtRisk, marginRatio } = useAccountRisk();

  const positionsAtRisk = useMemo(() => {
    return positionsMetrics.filter((p) => {
      const distanceToLiq = p.liqPrice > 0 ? 
        Math.abs((p.totalNotional - p.liqPrice) / p.totalNotional) * 100 : 100;
      return distanceToLiq < 10; // Less than 10% away from liquidation
    }).length;
  }, [positionsMetrics]);

  return {
    account: {
      totalValue: accountMetrics.totalValue,
      availableBalance: accountMetrics.availableBalance,
      totalCollateral: accountMetrics.totalCollateral,
      freeCollateral: accountMetrics.freeCollateral,
      currentLeverage: accountMetrics.currentLeverage,
      marginRatio: accountMetrics.totalMarginRatio,
    },
    positions: {
      count: positionsMetrics.length,
      totalUnrealizedPnL: accountMetrics.totalUnrealizedROI,
      totalUnrealizedROI: accountMetrics.totalUnrealizedROI,
      positionsAtRisk,
    },
    risk: {
      accountRiskLevel: riskLevel,
      isAccountAtRisk: isAtRisk,
      marginRatio,
    },
    isLoading: accountLoading || positionsLoading,
  };
}

/**
 * Get symbol-specific trading info including max qty and risk
 */
export function useSymbolTradingInfo(
  symbol: string
): {
  maxQtyBuy: number;
  maxQtySell: number;
  currentPosition: API.PositionTPSLExt | undefined;
  positionMetrics: PositionMetrics | null;
  positionRisk: {
    liqPrice: number;
    distanceToLiq: number;
    isAtRisk: boolean;
    riskLevel: "safe" | "moderate" | "high" | "critical";
  };
  isLoading: boolean;
} {
  const { maxQty: maxQtyBuy, isLoading: buyLoading } = useMaxQty(symbol, OrderSide.BUY);
  const { maxQty: maxQtySell, isLoading: sellLoading } = useMaxQty(symbol, OrderSide.SELL);
  const { metrics, position, isLoading: positionLoading } = usePositionMetrics(symbol);
  const { liqPrice, distanceToLiq, isAtRisk, riskLevel, isLoading: riskLoading } = 
    usePositionRisk(symbol);

  return {
    maxQtyBuy,
    maxQtySell,
    currentPosition: position,
    positionMetrics: metrics,
    positionRisk: {
      liqPrice,
      distanceToLiq,
      isAtRisk,
      riskLevel,
    },
    isLoading: buyLoading || sellLoading || positionLoading || riskLoading,
  };
}

