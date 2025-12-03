/**
 * Footprint Chart Utilities
 * 
 * Functions for building and accumulating footprint bars from trade data
 */

import type { Trade } from "./market-data";

export interface FootprintCell {
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
}

export interface FootprintBar {
  start: number; // timestamp
  end: number; // timestamp
  priceLevels: Map<number, FootprintCell>;
  totalVolume: number;
}

export interface FootprintSettings {
  timeframeMs: number;
  priceStep: number;
  maxBars: number;
  manualTickSize: number | null;
}

/**
 * Quantize a price to the nearest tick size
 */
export function quantizePrice(price: number, tickSize: number): number {
  return Math.round(price / tickSize) * tickSize;
}

/**
 * Get aggregation step based on price and default step
 */
export function getAggregationStep(price: number, defaultStep: number): number {
  // Simple logic: use default step, but could be enhanced with price-based logic
  // For example, for prices > 1000, use larger steps
  if (price > 1000) {
    return Math.max(defaultStep, 10);
  } else if (price > 100) {
    return Math.max(defaultStep, 1);
  } else if (price > 10) {
    return Math.max(defaultStep, 0.1);
  } else {
    return Math.max(defaultStep, 0.01);
  }
}

/**
 * Build footprint bars from a list of trades
 */
export function buildFootprintBarsFromTrades(
  trades: Trade[],
  settings: FootprintSettings
): FootprintBar[] {
  if (trades.length === 0) {
    return [];
  }

  // Filter out trades with invalid timestamps and sort by timestamp
  const validTrades = trades.filter(t => 
    t.timestamp && !isNaN(t.timestamp) && t.timestamp > 0 && 
    t.price && !isNaN(t.price) && t.price > 0
  );
  
  if (validTrades.length === 0) {
    return [];
  }
  
  const sortedTrades = [...validTrades].sort((a, b) => a.timestamp - b.timestamp);

  // Determine aggregation step
  const firstPrice = sortedTrades[0].price;
  const aggregationStep =
    settings.manualTickSize ?? getAggregationStep(firstPrice, settings.priceStep);

  // Group trades into time buckets
  const barsMap = new Map<number, FootprintBar>();

  for (const trade of sortedTrades) {
    const barStart = Math.floor(trade.timestamp / settings.timeframeMs) * settings.timeframeMs;
    const quantizedPrice = quantizePrice(trade.price, aggregationStep);

    let bar = barsMap.get(barStart);
    if (!bar) {
      bar = {
        start: barStart,
        end: barStart + settings.timeframeMs,
        priceLevels: new Map(),
        totalVolume: 0,
      };
      barsMap.set(barStart, bar);
    }

    let cell = bar.priceLevels.get(quantizedPrice);
    if (!cell) {
      cell = {
        buyVolume: 0,
        sellVolume: 0,
        totalVolume: 0,
      };
      bar.priceLevels.set(quantizedPrice, cell);
    }

    if (trade.side === "BUY") {
      cell.buyVolume += trade.quantity;
    } else {
      cell.sellVolume += trade.quantity;
    }
    cell.totalVolume += trade.quantity;
    bar.totalVolume += trade.quantity;
  }

  // Convert to array and sort by start time
  let bars = Array.from(barsMap.values()).sort((a, b) => a.start - b.start);

  // Limit to maxBars (keep most recent)
  if (bars.length > settings.maxBars) {
    bars = bars.slice(-settings.maxBars);
  }

  return bars;
}

/**
 * Accumulate a new trade into existing footprint bars
 */
export function accumulateFootprintBars(
  existingBars: FootprintBar[],
  trade: Trade,
  settings: FootprintSettings
): FootprintBar[] {
  // Validate trade data
  if (!trade.timestamp || isNaN(trade.timestamp) || trade.timestamp <= 0 ||
      !trade.price || isNaN(trade.price) || trade.price <= 0) {
    return existingBars;
  }
  
  // Determine aggregation step
  const aggregationStep =
    settings.manualTickSize ?? getAggregationStep(trade.price, settings.priceStep);

  const barStart = Math.floor(trade.timestamp / settings.timeframeMs) * settings.timeframeMs;
  const quantizedPrice = quantizePrice(trade.price, aggregationStep);

  // Find or create the bar for this time period
  let bar = existingBars.find((b) => b.start === barStart);

  if (!bar) {
    // Create new bar
    bar = {
      start: barStart,
      end: barStart + settings.timeframeMs,
      priceLevels: new Map(),
      totalVolume: 0,
    };
    existingBars.push(bar);
    // Sort by start time
    existingBars.sort((a, b) => a.start - b.start);
  }

  // Update or create cell for this price level
  let cell = bar.priceLevels.get(quantizedPrice);
  if (!cell) {
    cell = {
      buyVolume: 0,
      sellVolume: 0,
      totalVolume: 0,
    };
    bar.priceLevels.set(quantizedPrice, cell);
  }

  // Update cell with trade data
  if (trade.side === "BUY") {
    cell.buyVolume += trade.quantity;
  } else {
    cell.sellVolume += trade.quantity;
  }
  cell.totalVolume += trade.quantity;
  bar.totalVolume += trade.quantity;

  // Limit to maxBars (keep most recent)
  if (existingBars.length > settings.maxBars) {
    return existingBars.slice(-settings.maxBars);
  }

  return existingBars;
}

