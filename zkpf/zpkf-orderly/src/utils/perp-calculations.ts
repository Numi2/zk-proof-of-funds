/**
 * Orderly Perp SDK v4 Calculation Utilities
 * 
 * High-quality wrapper functions around @orderly.network/perp SDK v4.8.6
 * Updated to match the actual v4 API with proper input objects
 */

import * as PerpSDK from "@orderly.network/perp";
import { OrderSide } from "@orderly.network/types";
import type { API } from "@orderly.network/types";
import { Decimal } from "@orderly.network/utils";

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface AccountMetrics {
  /** Initial Margin Requirement (total across all positions) */
  IMR: number;
  /** Available balance for trading */
  availableBalance: number;
  /** Current leverage of the account */
  currentLeverage: number;
  /** Free collateral available */
  freeCollateral: number;
  /** Total collateral in the account */
  totalCollateral: number;
  /** Total initial margin with orders */
  totalInitialMarginWithOrders: number;
  /** Total margin ratio */
  totalMarginRatio: number;
  /** Total unrealized ROI */
  totalUnrealizedROI: number;
  /** Total value of the account */
  totalValue: number;
}

export interface PositionMetrics {
  /** Maintenance Margin Requirement */
  MMR: number;
  /** Liquidation price */
  liqPrice: number;
  /** Maintenance margin */
  maintenanceMargin: number;
  /** Total notional value */
  totalNotional: number;
  /** Unrealized PnL */
  unrealizedPnL: number;
  /** Unrealized ROI */
  unrealizedROI: number;
  /** Unsettlement PnL */
  unsettlementPnL: number;
}

export interface MaxQtyParams {
  symbol: string;
  side: OrderSide;
  accountInfo?: API.AccountInfo;
  positions?: API.PositionExt[];
  orders?: API.Order[];
  markPrice?: number;
  symbolInfo?: any;
}

export interface LiqPriceParams {
  markPrice: number;
  totalCollateral: number;
  positionQty: number;
  positions: Pick<API.PositionExt, "position_qty" | "mark_price" | "mmr">[];
  MMR: number;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS TO EXTRACT DATA FROM API OBJECTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Extract USDC holding from aggregated position data
 */
function getUSDCHolding(totalCollateral?: Decimal | number): number {
  if (!totalCollateral) return 0;
  return typeof totalCollateral === 'number' ? totalCollateral : parseFloat(totalCollateral.toString());
}

/**
 * Extract non-USDC holdings from account (if any exist)
 */
function getNonUSDCHoldings(): Array<{
  holding: number;
  indexPrice: number;
  collateralCap: number;
  collateralRatio: Decimal;
}> {
  // For now, most accounts only have USDC, return empty array
  return [];
}

/**
 * Get unsettlement PnL from position data
 */
function getUnsettlementPnL(positions?: any[]): number {
  if (!positions) return 0;
  return calculateTotalUnsettlementPnL(positions);
}

/**
 * Get mark prices map from positions
 */
function getMarkPricesMap(positions: API.Position[]): { [key: string]: number } {
  const map: { [key: string]: number } = {};
  positions.forEach(pos => {
    if (pos.symbol && pos.mark_price) {
      map[pos.symbol] = pos.mark_price;
    }
  });
  return map;
}

// ═══════════════════════════════════════════════════════════════════════════════
// ACCOUNT CALCULATIONS (V4 API)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate total value of the account
 * User's total asset value (denominated in USDC)
 * Note: This should be provided by usePositionStream aggregated data
 */
export function calculateTotalValue(
  totalCollateral?: Decimal | number,
  totalUnrealizedPnL?: number
): number {
  try {
    if (totalCollateral === undefined) return 0;
    const collateral = getUSDCHolding(totalCollateral);
    const pnl = totalUnrealizedPnL || 0;
    return collateral + pnl;
  } catch (error) {
    console.error("Error calculating total value:", error);
    return 0;
  }
}

/**
 * Calculate total collateral in the account
 * Total value of available collateral (denominated in USDC)
 * Note: This is provided by usePositionStream aggregated data
 */
export function calculateTotalCollateral(totalCollateral?: Decimal | number): number {
  try {
    return getUSDCHolding(totalCollateral);
  } catch (error) {
    console.error("Error calculating total collateral:", error);
    return 0;
  }
}

/**
 * Calculate free collateral
 * The amount of collateral not tied up in positions
 */
export function calculateFreeCollateral(
  accountInfo?: API.AccountInfo,
  positions?: API.PositionExt[],
  orders?: API.Order[]
): number {
  if (!accountInfo) return 0;
  try {
    const totalColl = calculateTotalCollateral(accountInfo);
    const totalIM = calculateTotalInitialMarginWithOrders(accountInfo, positions, orders);
    const result = PerpSDK.freeCollateral({
      totalCollateral: new Decimal(totalColl),
      totalInitialMarginWithOrders: totalIM,
    });
    return parseFloat(result.toString());
  } catch (error) {
    console.error("Error calculating free collateral:", error);
    return accountInfo.freeCollateral || 0;
  }
}

/**
 * Calculate available balance for trading
 * Balance available to open new positions
 */
export function calculateAvailableBalance(
  accountInfo?: API.AccountInfo,
  positions?: API.PositionExt[],
  orders?: API.Order[]
): number {
  if (!accountInfo) return 0;
  try {
    const result = PerpSDK.availableBalance({
      USDCHolding: getUSDCHolding(accountInfo),
      unsettlementPnL: getUnsettlementPnL(accountInfo),
    });
    return result;
  } catch (error) {
    console.error("Error calculating available balance:", error);
    return accountInfo.availableBalance || 0;
  }
}

/**
 * Calculate total margin ratio
 * Ratio of total collateral to maintenance margin
 */
export function calculateTotalMarginRatio(
  accountInfo?: API.AccountInfo,
  positions?: API.PositionExt[]
): number {
  if (!accountInfo || !positions || positions.length === 0) return 999; // Very high = safe
  try {
    const totalColl = calculateTotalCollateral(accountInfo);
    const markPrices = getMarkPricesMap(positions);
    const result = PerpSDK.totalMarginRatio({
      totalCollateral: totalColl,
      markPrices,
      positions,
    });
    return result;
  } catch (error) {
    console.error("Error calculating total margin ratio:", error);
    return 0;
  }
}

/**
 * Calculate current leverage of the account
 * Shows how much leverage is currently being used
 */
export function calculateCurrentLeverage(
  accountInfo?: API.AccountInfo,
  positions?: API.PositionExt[]
): number {
  if (!accountInfo || !positions) return 0;
  try {
    const marginRatio = calculateTotalMarginRatio(accountInfo, positions);
    return PerpSDK.currentLeverage(marginRatio);
  } catch (error) {
    console.error("Error calculating current leverage:", error);
    return 0;
  }
}

/**
 * Calculate total unrealized ROI
 * Return on investment across all positions
 */
export function calculateTotalUnrealizedROI(
  accountInfo?: API.AccountInfo,
  positions?: API.PositionExt[]
): number {
  if (!accountInfo || !positions) return 0;
  try {
    const totalUnrealizedPnL = calculateTotalUnrealizedPnL(positions);
    const totalValue = calculateTotalValue(accountInfo, positions);
    const result = PerpSDK.totalUnrealizedROI({
      totalUnrealizedPnL,
      totalValue,
    });
    return result;
  } catch (error) {
    console.error("Error calculating total unrealized ROI:", error);
    return 0;
  }
}

/**
 * Calculate total initial margin with orders
 * Includes margin requirements for both positions and open orders
 * Note: This uses a simplified approach as the full v4 API requires symbolInfo
 */
export function calculateTotalInitialMarginWithOrders(
  accountInfo?: API.AccountInfo,
  positions?: API.PositionExt[],
  orders?: API.Order[]
): number {
  if (!accountInfo || !positions) return 0;
  try {
    // Fallback: use the value from account info if available
    return accountInfo.totalInitialMarginWithOrders || 0;
  } catch (error) {
    console.error("Error calculating total initial margin with orders:", error);
    return 0;
  }
}

/**
 * Calculate Initial Margin Requirement (IMR) for a symbol
 * This is a simplified wrapper - full implementation needs symbolInfo
 */
export function calculateIMR(
  accountInfo?: API.AccountInfo,
  positions?: API.PositionExt[]
): number {
  if (!accountInfo || !positions) return 0;
  try {
    // Use account info value as fallback
    return accountInfo.totalInitialMargin || 0;
  } catch (error) {
    console.error("Error calculating IMR:", error);
    return 0;
  }
}

/**
 * Calculate maximum quantity that can be opened for a symbol
 * Note: Simplified implementation - full v4 API requires more symbol-specific data
 */
export function calculateMaxQty(params: MaxQtyParams): number {
  const { symbol, side, accountInfo, positions, orders, markPrice, symbolInfo } = params;
  
  if (!accountInfo || !positions) return 0;
  
  try {
    // Simplified calculation based on free collateral and mark price
    const freeColl = calculateFreeCollateral(accountInfo, positions, orders);
    const price = markPrice || 1;
    const maxLev = accountInfo.max_leverage || 10;
    
    // Basic formula: (free collateral * leverage) / price
    const maxNotional = freeColl * maxLev;
    return maxNotional / price;
  } catch (error) {
    console.error("Error calculating max quantity:", error);
    return 0;
  }
}

/**
 * Calculate all account metrics at once
 * More efficient than calling each function separately
 */
export function calculateAccountMetrics(
  accountInfo?: API.AccountInfo,
  positions?: API.PositionExt[],
  orders?: API.Order[]
): AccountMetrics {
  return {
    IMR: calculateIMR(accountInfo, positions),
    availableBalance: calculateAvailableBalance(accountInfo, positions, orders),
    currentLeverage: calculateCurrentLeverage(accountInfo, positions),
    freeCollateral: calculateFreeCollateral(accountInfo, positions),
    totalCollateral: calculateTotalCollateral(accountInfo),
    totalInitialMarginWithOrders: calculateTotalInitialMarginWithOrders(
      accountInfo,
      positions,
      orders
    ),
    totalMarginRatio: calculateTotalMarginRatio(accountInfo, positions),
    totalUnrealizedROI: calculateTotalUnrealizedROI(accountInfo, positions),
    totalValue: calculateTotalValue(accountInfo, positions),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// POSITION CALCULATIONS (V4 API)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Calculate total notional value of a position
 * Position size multiplied by mark price
 */
export function calculateTotalNotional(position?: API.PositionExt): number {
  if (!position) return 0;
  try {
    const qty = position.position_qty || 0;
    const price = position.mark_price || 0;
    return PerpSDK.notional(qty, price);
  } catch (error) {
    console.error("Error calculating total notional:", error);
    return 0;
  }
}

/**
 * Calculate unrealized PnL for a position
 * Profit/loss that would be realized if position closed at current price
 */
export function calculateUnrealizedPnL(position?: API.PositionExt): number {
  if (!position) return 0;
  try {
    const markPrice = position.mark_price || 0;
    const openPrice = position.average_open_price || 0;
    const qty = position.position_qty || 0;
    
    return PerpSDK.unrealizedPnL({
      markPrice,
      openPrice,
      qty,
    });
  } catch (error) {
    console.error("Error calculating unrealized PnL:", error);
    return 0;
  }
}

/**
 * Calculate unrealized ROI for a position
 * Return on investment as a percentage
 */
export function calculateUnrealizedROI(position?: API.PositionExt): number {
  if (!position) return 0;
  try {
    const positionQty = position.position_qty || 0;
    const openPrice = position.average_open_price || 0;
    const IMR = position.imr || 0;
    const unrealizedPnL = calculateUnrealizedPnL(position);
    
    return PerpSDK.unrealizedPnLROI({
      positionQty,
      openPrice,
      IMR,
      unrealizedPnL,
    });
  } catch (error) {
    console.error("Error calculating unrealized ROI:", error);
    return 0;
  }
}

/**
 * Calculate total unrealized PnL across all positions
 * Sum of unrealized PnL for all open positions
 */
export function calculateTotalUnrealizedPnL(positions?: API.PositionExt[]): number {
  if (!positions || positions.length === 0) return 0;
  try {
    return PerpSDK.totalUnrealizedPnL(positions);
  } catch (error) {
    console.error("Error calculating total unrealized PnL:", error);
    return 0;
  }
}

/**
 * Calculate unsettlement PnL for a position
 * PnL that has not yet been settled
 */
export function calculateUnsettlementPnL(position?: API.PositionExt): number {
  if (!position) return 0;
  try {
    const positionQty = position.position_qty || 0;
    const markPrice = position.mark_price || 0;
    const costPosition = position.cost_position || 0;
    const sumUnitaryFunding = position.sum_unitary_funding || 0;
    const lastSumUnitaryFunding = position.last_sum_unitary_funding || 0;
    
    return PerpSDK.unsettlementPnL({
      positionQty,
      markPrice,
      costPosition,
      sumUnitaryFunding,
      lastSumUnitaryFunding,
    });
  } catch (error) {
    console.error("Error calculating unsettlement PnL:", error);
    return 0;
  }
}

/**
 * Calculate total unsettlement PnL across all positions
 * Sum of unsettled PnL for all positions
 */
export function calculateTotalUnsettlementPnL(positions?: API.PositionExt[]): number {
  if (!positions || positions.length === 0) return 0;
  try {
    // Map positions to include sum_unitary_funding
    const positionsWithFunding = positions.map(p => ({
      ...p,
      sum_unitary_funding: p.sum_unitary_funding || 0,
    }));
    return PerpSDK.totalUnsettlementPnL(positionsWithFunding);
  } catch (error) {
    console.error("Error calculating total unsettlement PnL:", error);
    return 0;
  }
}

/**
 * Calculate maintenance margin for a position
 * The minimum margin needed to keep the position open
 */
export function calculateMaintenanceMargin(position?: API.PositionExt): number {
  if (!position) return 0;
  try {
    const positionQty = position.position_qty || 0;
    const markPrice = position.mark_price || 0;
    const MMR = position.mmr || 0;
    
    return PerpSDK.maintenanceMargin({
      positionQty,
      markPrice,
      MMR,
    });
  } catch (error) {
    console.error("Error calculating maintenance margin:", error);
    return 0;
  }
}

/**
 * Calculate Maintenance Margin Requirement (MMR) for a position
 * MMR is the minimum margin required to maintain a position
 */
export function calculateMMR(position?: API.PositionExt): number {
  if (!position) return 0;
  try {
    // If position already has MMR, return it
    if (position.mmr) return position.mmr;
    
    // Otherwise calculate it (requires symbol info which we may not have)
    return position.mmr || 0;
  } catch (error) {
    console.error("Error calculating MMR:", error);
    return 0;
  }
}

/**
 * Calculate liquidation price for a position
 * The price at which the position will be liquidated
 */
export function calculateLiqPrice(params: LiqPriceParams): number {
  const { markPrice, totalCollateral, positionQty, positions, MMR } = params;
  
  if (!markPrice || !totalCollateral || !positionQty || !positions) return 0;
  
  try {
    const result = PerpSDK.liqPrice({
      markPrice,
      totalCollateral,
      positionQty,
      positions,
      MMR,
    });
    return result || 0;
  } catch (error) {
    console.error("Error calculating liquidation price:", error);
    return 0;
  }
}

/**
 * Calculate liquidation price for a specific position
 * Convenience function that extracts necessary data from position and account
 */
export function calculatePositionLiqPrice(
  position?: API.PositionExt,
  accountInfo?: API.AccountInfo,
  allPositions?: API.PositionExt[]
): number {
  if (!position || !accountInfo) return 0;
  
  const markPrice = position.mark_price || 0;
  const totalCollateral = calculateTotalCollateral(accountInfo);
  const positionQty = position.position_qty || 0;
  const MMR = calculateMMR(position);
  const positions = allPositions || [position];
  
  return calculateLiqPrice({
    markPrice,
    totalCollateral,
    positionQty,
    positions: positions.map(p => ({
      position_qty: p.position_qty || 0,
      mark_price: p.mark_price || 0,
      mmr: p.mmr || 0,
    })),
    MMR,
  });
}

/**
 * Calculate all position metrics at once
 * More efficient than calling each function separately
 */
export function calculatePositionMetrics(
  position?: API.PositionExt,
  accountInfo?: API.AccountInfo,
  allPositions?: API.PositionExt[]
): PositionMetrics {
  return {
    MMR: calculateMMR(position),
    liqPrice: calculatePositionLiqPrice(position, accountInfo, allPositions),
    maintenanceMargin: calculateMaintenanceMargin(position),
    totalNotional: calculateTotalNotional(position),
    unrealizedPnL: calculateUnrealizedPnL(position),
    unrealizedROI: calculateUnrealizedROI(position),
    unsettlementPnL: calculateUnsettlementPnL(position),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// FORMATTING UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Format a number as USD currency
 */
export function formatUSD(value: number, decimals: number = 2): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/**
 * Format a number as percentage
 */
export function formatPercentage(value: number, decimals: number = 2): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/**
 * Format leverage value
 */
export function formatLeverage(value: number, decimals: number = 2): string {
  return `${value.toFixed(decimals)}x`;
}

/**
 * Format a large number with K/M/B suffixes
 */
export function formatCompactNumber(value: number): string {
  if (Math.abs(value) >= 1e9) {
    return `$${(value / 1e9).toFixed(2)}B`;
  } else if (Math.abs(value) >= 1e6) {
    return `$${(value / 1e6).toFixed(2)}M`;
  } else if (Math.abs(value) >= 1e3) {
    return `$${(value / 1e3).toFixed(2)}K`;
  }
  return formatUSD(value);
}

/**
 * Get color class based on positive/negative value
 */
export function getValueColor(value: number): string {
  if (value > 0) return "text-green-500";
  if (value < 0) return "text-red-500";
  return "text-gray-500";
}

/**
 * Get risk level based on margin ratio
 * Higher ratio = lower risk
 */
export function getRiskLevel(marginRatio: number): {
  level: "safe" | "moderate" | "high" | "critical";
  color: string;
  label: string;
} {
  if (marginRatio >= 2.0) {
    return { level: "safe", color: "text-green-500", label: "Safe" };
  } else if (marginRatio >= 1.5) {
    return { level: "moderate", color: "text-yellow-500", label: "Moderate" };
  } else if (marginRatio >= 1.1) {
    return { level: "high", color: "text-orange-500", label: "High Risk" };
  } else {
    return { level: "critical", color: "text-red-500", label: "Critical" };
  }
}

