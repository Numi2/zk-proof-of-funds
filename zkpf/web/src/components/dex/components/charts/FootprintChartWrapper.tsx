/**
 * Footprint Chart Wrapper Component
 * 
 * A self-contained footprint chart component that can be imported and used anywhere.
 * Connects to Orderly market data automatically.
 * 
 * Usage:
 *   import { FootprintChartWrapper } from './components/charts';
 *   <FootprintChartWrapper symbol="PERP_BTC_USDC" />
 */

import { useRef, useEffect, useState } from "react";
import { FootprintChart } from "./FootprintChart";
import { OrderlyMarketDataService } from "../../../../lib/orderly-market-data";
import type { IMarketDataService, Trade } from "../../../../lib/market-data";

export interface FootprintChartWrapperProps {
  /** Orderly symbol (e.g., "PERP_BTC_USDC") */
  symbol: string;
  /** Timeframe in seconds (default: 60) */
  timeframeSeconds?: number;
  /** Price step for aggregation (default: 1) */
  priceStep?: number;
  /** Maximum number of bars to display (default: 60) */
  maxBars?: number;
  /** Optional className for styling */
  className?: string;
  /** Optional style object */
  style?: React.CSSProperties;
}

export function FootprintChartWrapper({
  symbol,
  timeframeSeconds = 60,
  priceStep = 1,
  maxBars = 60,
  className,
  style,
}: FootprintChartWrapperProps) {
  const marketDataRef = useRef<IMarketDataService | null>(null);
  const [manualTickSize, setManualTickSize] = useState<number | null>(null);
  const [seedTrades, setSeedTrades] = useState<Trade[] | null>(null);
  const [key, setKey] = useState(0);

  // Initialize market data service when symbol changes
  useEffect(() => {
    // Cleanup previous service
    if (marketDataRef.current) {
      marketDataRef.current.disconnectTrades();
    }

    // Reset state for new symbol
    setSeedTrades(null);
    setKey(k => k + 1);

    // Create new service
    const service = new OrderlyMarketDataService(symbol);
    marketDataRef.current = service;

    // Load initial historical trades
    service.getHistoricalTrades?.(100).then((trades) => {
      if (trades && trades.length > 0) {
        setSeedTrades(trades);
      }
    }).catch(err => {
      console.warn("[FootprintChart] Failed to load historical trades:", err);
    });

    // Cleanup on unmount or symbol change
    return () => {
      service.disconnectTrades();
    };
  }, [symbol]);

  const handleTickSizeChange = (tickSize: number | null) => {
    setManualTickSize(tickSize);
  };

  return (
    <div className={className} style={style}>
      <FootprintChart
        key={key}
        symbol={symbol}
        marketDataRef={marketDataRef}
        timeframeSeconds={timeframeSeconds}
        priceStep={priceStep}
        maxBars={maxBars}
        onTickSizeChange={handleTickSizeChange}
        manualTickSize={manualTickSize}
        seedTrades={seedTrades}
      />
    </div>
  );
}
