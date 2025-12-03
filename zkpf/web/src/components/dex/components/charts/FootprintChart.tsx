/**
 * Footprint Chart Component
 * 
 * Displays order flow footprint chart with buy/sell volume at different price levels
 * Integrated with Orderly DEX market data
 */

import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "./Card";
import type { IMarketDataService, Trade } from "../../../../lib/market-data";
import { TickSizeControl } from "./TickSizeControl";
import {
  accumulateFootprintBars,
  buildFootprintBarsFromTrades,
  type FootprintBar,
  quantizePrice,
  getAggregationStep,
} from "../../../../lib/footprint";
import "./FootprintChart.css";

// Extend CanvasRenderingContext2D to include roundRect
declare global {
  interface CanvasRenderingContext2D {
    roundRect?(x: number, y: number, w: number, h: number, r: number): void;
  }
}

const DEFAULT_TIMEFRAME_SECONDS = 60;
const DEFAULT_PRICE_STEP = 1;
const MAX_BARS = 60;

const BAR_WIDTH = 54;
const BAR_GAP = 4;
const CELL_HEIGHT = 18;
const LEFT_MARGIN = 28;
const TOP_MARGIN = 36;
const DATA_BOTTOM_PADDING = 12;
const PRICE_AXIS_WIDTH = 76;
const TIME_AXIS_HEIGHT = 36;

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export interface FootprintChartProps {
  symbol: string;
  marketDataRef: React.MutableRefObject<IMarketDataService | null>;
  timeframeSeconds?: number;
  priceStep?: number;
  maxBars?: number;
  epoch?: number;
  onTickSizeChange?: (tickSize: number | null) => void;
  manualTickSize?: number | null;
  seedTrades?: Trade[] | null;
  seedBars?: FootprintBar[] | null;
}

export function FootprintChart({
  symbol,
  marketDataRef,
  timeframeSeconds = DEFAULT_TIMEFRAME_SECONDS,
  priceStep = DEFAULT_PRICE_STEP,
  maxBars = MAX_BARS,
  epoch = 0,
  onTickSizeChange,
  manualTickSize = null,
  seedTrades = null,
  seedBars = null,
}: FootprintChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const priceAxisRef = useRef<HTMLCanvasElement>(null);
  const timeAxisRef = useRef<HTMLCanvasElement>(null);
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
  const [scrollOffset, setScrollOffset] = useState({ left: 0, top: 0 });
  const barsRef = useRef<FootprintBar[]>([]);
  const [bars, setBars] = useState<FootprintBar[]>([]);
  const [lastTradedPrice, setLastTradedPrice] = useState<number | null>(null);
  const allTradesRef = useRef<Trade[]>([]);
  const manualTickSizeRef = useRef<number | null>(manualTickSize);

  useEffect(() => {
    manualTickSizeRef.current = manualTickSize;
  }, [manualTickSize]);

  useEffect(() => {
    barsRef.current = [];
    setBars([]);
    setLastTradedPrice(null);
    allTradesRef.current = [];
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({ left: 0, top: 0 });
    }
    setScrollOffset({ left: 0, top: 0 });
  }, [symbol, timeframeSeconds, priceStep, maxBars, epoch]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container) {
          const { width, height } = entry.contentRect;
          setViewportSize({ width, height });
        }
      }
    });
    observer.observe(container);

    const handleScroll = () => {
      const nextLeft = container.scrollLeft;
      const nextTop = container.scrollTop;
      setScrollOffset((prev) => {
        if (prev.left === nextLeft && prev.top === nextTop) return prev;
        return { left: nextLeft, top: nextTop };
      });
    };

    container.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      observer.disconnect();
      container.removeEventListener("scroll", handleScroll);
    };
  }, []);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleWheel = (event: WheelEvent) => {
      if (!container) return;
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;

      const { scrollLeft, scrollWidth, clientWidth } = container;
      const maxScrollLeft = Math.max(0, scrollWidth - clientWidth);
      const atLeftEdge = scrollLeft <= 0 && event.deltaX < 0;
      const atRightEdge = scrollLeft >= maxScrollLeft && event.deltaX > 0;

      if (atLeftEdge || atRightEdge) {
        event.preventDefault();
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });

    return () => {
      container.removeEventListener("wheel", handleWheel);
    };
  }, []);

  useEffect(() => {
    const service = marketDataRef.current;
    if (!service) return;

    service.connectTrades();

    const handleTrade = (trade: Trade) => {
      setLastTradedPrice(trade.price);
      // Store the trade
      allTradesRef.current.push(trade);
      // Use current tick size from ref
      const currentSettings = {
        timeframeMs: timeframeSeconds * 1000,
        priceStep: Math.max(Number.EPSILON, priceStep),
        maxBars: Math.max(1, maxBars),
        manualTickSize: manualTickSizeRef.current,
      };
      barsRef.current = accumulateFootprintBars(barsRef.current, trade, currentSettings);
      setBars(barsRef.current);
    };

    const unsubscribe = service.onTrade(handleTrade);
    return () => {
      unsubscribe();
    };
  }, [marketDataRef, timeframeSeconds, priceStep, maxBars, symbol, epoch]);

  useEffect(() => {
    if (!seedBars) return;
    barsRef.current = seedBars.map((bar) => ({
      ...bar,
      priceLevels: new Map(bar.priceLevels),
    }));
    setBars(barsRef.current);
  }, [seedBars]);

  useEffect(() => {
    if (seedBars) return;
    if (!seedTrades) {
      return;
    }

    if (seedTrades.length === 0) {
      barsRef.current = [];
      setBars([]);
      allTradesRef.current = [];
      return;
    }

    // Store seed trades
    allTradesRef.current = [...seedTrades];

    const settings = {
      timeframeMs: timeframeSeconds * 1000,
      priceStep: Math.max(Number.EPSILON, priceStep),
      maxBars: Math.max(1, maxBars),
      manualTickSize: manualTickSizeRef.current,
    };

    const nextBars = buildFootprintBarsFromTrades(seedTrades, settings);
    barsRef.current = nextBars;
    setBars(nextBars);

    // Set last traded price from the most recent trade
    if (seedTrades.length > 0) {
      const lastTrade = seedTrades[seedTrades.length - 1];
      setLastTradedPrice(lastTrade.price);
    }
  }, [seedTrades, seedBars, timeframeSeconds, priceStep, maxBars]);

  // Rebuild bars when tick size changes, preserving trade history
  useEffect(() => {
    const allTrades = allTradesRef.current;
    if (allTrades.length === 0) {
      return;
    }

    const settings = {
      timeframeMs: timeframeSeconds * 1000,
      priceStep: Math.max(Number.EPSILON, priceStep),
      maxBars: Math.max(1, maxBars),
      manualTickSize,
    };

    const nextBars = buildFootprintBarsFromTrades(allTrades, settings);
    barsRef.current = nextBars;
    setBars(nextBars);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualTickSize]);

  const priceLevels = useMemo(() => {
    const levels = new Set<number>();
    for (const bar of bars) {
      for (const price of bar.priceLevels.keys()) {
        levels.add(price);
      }
    }
    return Array.from(levels).sort((a, b) => b - a);
  }, [bars]);

  const { maxDelta, maxVolume } = useMemo(() => {
    let maxAbsDelta = 0;
    let maxTotalVolume = 0;
    for (const bar of bars) {
      for (const cell of bar.priceLevels.values()) {
        const netDelta = cell.buyVolume - cell.sellVolume;
        const total = cell.totalVolume;
        const absNet = Math.abs(netDelta);
        if (absNet > maxAbsDelta) maxAbsDelta = absNet;
        if (total > maxTotalVolume) maxTotalVolume = total;
      }
    }
    return {
      maxDelta: maxAbsDelta || 1,
      maxVolume: maxTotalVolume || 1,
    };
  }, [bars]);

  const priceLabels = useMemo(() => priceLevels.map((price) => price.toString()), [priceLevels]);
  const timeLabels = useMemo(
    () => bars.map((bar) => {
      try {
        // Validate timestamp before formatting
        if (!bar.start || isNaN(bar.start) || bar.start < 0) {
          return "--:--";
        }
        const date = new Date(bar.start);
        if (isNaN(date.getTime())) {
          return "--:--";
        }
        return timeFormatter.format(date);
      } catch {
        return "--:--";
      }
    }),
    [bars]
  );
  const cellRadius = Math.max(4, Math.floor((CELL_HEIGHT - 2) / 2));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const viewWidth = Math.max(1, viewportSize.width);
    const viewHeight = Math.max(1, viewportSize.height);
    const computedWidth = Math.max(viewWidth, LEFT_MARGIN + bars.length * BAR_WIDTH);
    const computedHeight = Math.max(
      viewHeight,
      TOP_MARGIN + priceLevels.length * CELL_HEIGHT + DATA_BOTTOM_PADDING
    );

    canvas.width = computedWidth * dpr;
    canvas.height = computedHeight * dpr;
    canvas.style.width = `${computedWidth}px`;
    canvas.style.height = `${computedHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Polyfill for roundRect if not available
    if (!ctx.roundRect) {
      ctx.roundRect = function (x: number, y: number, w: number, h: number, r: number) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
        return this;
      };
    }

    ctx.fillStyle = "#0b162b";
    ctx.fillRect(0, 0, computedWidth, computedHeight);

    for (let i = 0; i < priceLevels.length; i++) {
      const y = TOP_MARGIN + i * CELL_HEIGHT;
      ctx.fillStyle = "rgba(148, 163, 184, 0.12)";
      ctx.fillRect(LEFT_MARGIN, y - 0.5, computedWidth - LEFT_MARGIN, 1);
    }

    bars.forEach((bar, barIdx) => {
      const x = LEFT_MARGIN + barIdx * BAR_WIDTH;
      const barWidth = BAR_WIDTH - BAR_GAP;
      const barValues = Array.from(bar.priceLevels.values());
      const netDelta = barValues.reduce((acc, cell) => acc + (cell.buyVolume - cell.sellVolume), 0);
      const roundedNetDelta = Math.round(netDelta);
      const netDeltaText = roundedNetDelta >= 0 ? ` +${roundedNetDelta}` : ` ${roundedNetDelta}`;

      priceLevels.forEach((price, levelIdx) => {
        const cell = bar.priceLevels.get(price);
        const y = TOP_MARGIN + levelIdx * CELL_HEIGHT + 1;
        const height = CELL_HEIGHT - 2;

        if (!cell || cell.totalVolume === 0) {
          ctx.fillStyle = "rgba(30, 41, 59, 0.55)";
          ctx.beginPath();
          ctx.roundRect(x + BAR_GAP / 2, y, barWidth, height, cellRadius);
          ctx.fill();
          return;
        }

        const netDelta = cell.buyVolume - cell.sellVolume;
        const totalVolume = cell.totalVolume;
        const volumeRatio = Math.min(1, totalVolume / maxVolume);
        const deltaRatio = Math.min(1, Math.abs(netDelta) / maxDelta);
        const intensity = Math.max(volumeRatio, deltaRatio);
        const blend = Math.pow(intensity, 0.65);

        let base: [number, number, number];
        let highlight: [number, number, number];
        let strokeStyle: string;
        let shadowColor: string;

        if (netDelta > 0) {
          base = [34, 197, 94];
          highlight = [16, 185, 129];
          strokeStyle = "rgba(12, 74, 40, 0.35)";
          shadowColor = "rgba(15, 118, 110, 0.35)";
        } else if (netDelta < 0) {
          base = [248, 113, 113];
          highlight = [239, 68, 68];
          strokeStyle = "rgba(127, 29, 29, 0.35)";
          shadowColor = "rgba(185, 28, 28, 0.35)";
        } else {
          base = [148, 163, 184];
          highlight = [226, 232, 240];
          strokeStyle = "rgba(71, 85, 105, 0.4)";
          shadowColor = "rgba(15, 23, 42, 0.35)";
        }

        const r = Math.round(lerp(base[0], highlight[0], blend));
        const g = Math.round(lerp(base[1], highlight[1], blend));
        const b = Math.round(lerp(base[2], highlight[2], blend));
        const alpha = 0.2 + volumeRatio * 0.7;

        ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${alpha.toFixed(3)})`;
        ctx.beginPath();
        ctx.roundRect(x + BAR_GAP / 2, y, barWidth, height, cellRadius);
        ctx.fill();

        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = 1;
        ctx.stroke();

        const displayValue = totalVolume >= 100 ? totalVolume.toFixed(0) : totalVolume.toFixed(1);
        ctx.font = "11px 'Inter', system-ui";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        let textColor = "#e2e8f0";
        if (volumeRatio > 0.65) {
          textColor = "#0b1120";
        } else if (netDelta > 0) {
          textColor = "rgba(240, 253, 244, 0.98)";
        } else if (netDelta < 0) {
          textColor = "rgba(254, 226, 226, 0.98)";
        }

        ctx.fillStyle = textColor;
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = volumeRatio > 0.45 ? 2 : 3;
        ctx.fillText(displayValue, x + BAR_GAP / 2 + barWidth / 2, y + height / 2);
        ctx.shadowBlur = 0;
      });

      ctx.fillStyle = "#94a3b8";
      ctx.font = "10px 'Inter', system-ui";
      ctx.textAlign = "center";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        ` ${bar.totalVolume.toFixed(2)}`,
        x + (BAR_WIDTH - BAR_GAP) / 2 + BAR_GAP / 2,
        TOP_MARGIN - 18
      );

      ctx.fillStyle = netDelta >= 0 ? "#34d399" : "#f97316";
      ctx.font = "11px 'Inter', system-ui";
      ctx.textBaseline = "bottom";
      ctx.fillText(
        netDeltaText,
        x + (BAR_WIDTH - BAR_GAP) / 2 + BAR_GAP / 2,
        TOP_MARGIN - 4
      );
    });
  }, [bars, priceLevels, maxDelta, maxVolume, viewportSize]);

  useEffect(() => {
    const canvas = priceAxisRef.current;
    if (!canvas) return;
    const axisHeight = viewportSize.height;
    if (axisHeight <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = PRICE_AXIS_WIDTH * dpr;
    canvas.height = axisHeight * dpr;
    canvas.style.width = `${PRICE_AXIS_WIDTH}px`;
    canvas.style.height = `${axisHeight}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, PRICE_AXIS_WIDTH, axisHeight);
    ctx.fillStyle = "#0f1b34";
    ctx.fillRect(0, 0, PRICE_AXIS_WIDTH, axisHeight);

    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, 0);
    ctx.lineTo(0.5, axisHeight);
    ctx.stroke();

    // Calculate the quantized price level for the last traded price
    let highlightedPriceLevel: number | null = null;
    if (lastTradedPrice !== null) {
      const aggregationStep = manualTickSize ?? getAggregationStep(lastTradedPrice, priceStep);
      const quantizedPrice = quantizePrice(lastTradedPrice, aggregationStep);
      // Check if this quantized price exists in the price levels
      if (priceLevels.includes(quantizedPrice)) {
        highlightedPriceLevel = quantizedPrice;
      }
    }

    ctx.font = "12px 'Inter', system-ui";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";

    for (let i = 0; i < priceLevels.length; i++) {
      const y = TOP_MARGIN + i * CELL_HEIGHT - scrollOffset.top;
      if (y + CELL_HEIGHT < 0 || y > axisHeight) continue;

      const priceLevel = priceLevels[i];
      const isHighlighted = highlightedPriceLevel !== null && priceLevel === highlightedPriceLevel;

      const label = priceLabels[i] ?? priceLevel.toString();

      // Highlight background for last traded price
      if (isHighlighted) {
        ctx.fillStyle = "rgba(59, 130, 246, 0.2)";
        ctx.fillRect(0, y, PRICE_AXIS_WIDTH, CELL_HEIGHT);
      }

      // Text color - brighter for highlighted price
      ctx.fillStyle = isHighlighted ? "#60a5fa" : "#cbd5f5";
      ctx.fillText(label, 12, y + CELL_HEIGHT / 2);

      ctx.fillStyle = isHighlighted ? "rgba(59, 130, 246, 0.4)" : "rgba(148, 163, 184, 0.2)";
      ctx.fillRect(0, y + CELL_HEIGHT - 1, PRICE_AXIS_WIDTH, 1);
    }
  }, [priceLevels, priceLabels, viewportSize.height, scrollOffset.top, lastTradedPrice, manualTickSize, priceStep]);

  useEffect(() => {
    const canvas = timeAxisRef.current;
    if (!canvas) return;
    const axisWidth = viewportSize.width;
    if (axisWidth <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = axisWidth * dpr;
    canvas.height = TIME_AXIS_HEIGHT * dpr;
    canvas.style.width = `${axisWidth}px`;
    canvas.style.height = `${TIME_AXIS_HEIGHT}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.clearRect(0, 0, axisWidth, TIME_AXIS_HEIGHT);
    ctx.fillStyle = "#0f1b34";
    ctx.fillRect(0, 0, axisWidth, TIME_AXIS_HEIGHT);

    ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.lineTo(axisWidth, 0.5);
    ctx.stroke();

    ctx.font = "12px 'Inter', system-ui";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";

    if (bars.length === 0) {
      ctx.fillStyle = "#64748b";
      ctx.fillText("Waiting for trades…", axisWidth / 2, 10);
      return;
    }

    for (let i = 0; i < bars.length; i++) {
      const center = LEFT_MARGIN + i * BAR_WIDTH + (BAR_WIDTH - BAR_GAP) / 2 - scrollOffset.left;
      if (center + BAR_WIDTH < 0 || center - BAR_WIDTH > axisWidth) continue;

      const label = timeLabels[i] ?? "";
      ctx.fillStyle = "#cbd5f5";
      ctx.fillText(label, center, 10);

      ctx.fillStyle = "rgba(148, 163, 184, 0.18)";
      ctx.fillRect(center - (BAR_WIDTH - BAR_GAP) / 2, TIME_AXIS_HEIGHT - 6, BAR_WIDTH - BAR_GAP, 2);
    }
  }, [bars, timeLabels, viewportSize.width, scrollOffset.left]);

  return (
    <Card className="footprint-chart-card">
      <div className="footprint-chart-header">
        <div>
          <div className="footprint-chart-title">
            Footprint Chart
          </div>
        </div>
        {onTickSizeChange && (
          <TickSizeControl
            currentTickSize={manualTickSize}
            onTickSizeChange={onTickSizeChange}
            label="Chart Tick"
          />
        )}
      </div>
      <div className="footprint-chart-content">
        <div
          ref={scrollContainerRef}
          className="footprint-chart-scroll-container"
          style={{
            right: `${PRICE_AXIS_WIDTH}px`,
            bottom: `${TIME_AXIS_HEIGHT}px`,
          }}
        >
          <canvas ref={canvasRef} className="footprint-chart-canvas" />
        </div>
        <canvas
          ref={priceAxisRef}
          className="footprint-chart-price-axis"
          style={{ width: `${PRICE_AXIS_WIDTH}px`, bottom: `${TIME_AXIS_HEIGHT}px` }}
        />
        <canvas
          ref={timeAxisRef}
          className="footprint-chart-time-axis"
          style={{ height: `${TIME_AXIS_HEIGHT}px`, right: `${PRICE_AXIS_WIDTH}px` }}
        />
        <div
          className="footprint-chart-corner"
          style={{
            width: `${PRICE_AXIS_WIDTH}px`,
            height: `${TIME_AXIS_HEIGHT}px`,
          }}
        />
      </div>
    </Card>
  );
}

