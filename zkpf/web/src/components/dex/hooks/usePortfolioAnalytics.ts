import { useState, useEffect, useMemo } from 'react';
import { usePrivateQuery } from '@orderly.network/hooks';

interface PnLDataPoint {
  date: string;
  pnl: number;
  cumulative: number;
}

interface PerformanceMetrics {
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

interface AnalyticsData {
  pnlData: PnLDataPoint[];
  metrics: PerformanceMetrics;
}

interface OrderlyTrade {
  symbol: string;
  side: 'BUY' | 'SELL';
  executed_price: number;
  executed_quantity: number;
  fee: number;
  realized_pnl: number;
  executed_timestamp: number;
}

interface OrderlyTradesResponse {
  success: boolean;
  data: {
    rows: OrderlyTrade[];
    meta?: {
      total?: number;
    };
  };
}

/**
 * Calculate performance metrics from trade history
 */
function calculateMetrics(trades: OrderlyTrade[]): PerformanceMetrics {
  if (!trades || trades.length === 0) {
    return {
      winRate: 0,
      sharpeRatio: 0,
      maxDrawdown: 0,
      totalTrades: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
    };
  }

  // Separate winning and losing trades
  const wins = trades.filter(t => t.realized_pnl > 0);
  const losses = trades.filter(t => t.realized_pnl < 0);
  
  const totalWins = wins.reduce((sum, t) => sum + t.realized_pnl, 0);
  const totalLosses = Math.abs(losses.reduce((sum, t) => sum + t.realized_pnl, 0));
  
  const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
  const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
  
  const winRate = trades.length > 0 ? (wins.length / trades.length) * 100 : 0;
  const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;
  
  // Calculate Sharpe ratio (simplified)
  const returns = trades.map(t => t.realized_pnl);
  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0; // Annualized
  
  // Calculate max drawdown
  let maxDrawdown = 0;
  let peak = 0;
  let cumulative = 0;
  
  trades.forEach(trade => {
    cumulative += trade.realized_pnl;
    if (cumulative > peak) {
      peak = cumulative;
    }
    const drawdown = ((peak - cumulative) / Math.max(peak, 1)) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  });
  
  return {
    winRate: parseFloat(winRate.toFixed(2)),
    sharpeRatio: parseFloat(sharpeRatio.toFixed(2)),
    maxDrawdown: -parseFloat(maxDrawdown.toFixed(2)),
    totalTrades: trades.length,
    avgWin: parseFloat(avgWin.toFixed(2)),
    avgLoss: parseFloat(avgLoss.toFixed(2)),
    profitFactor: parseFloat(profitFactor.toFixed(2)),
  };
}

/**
 * Aggregate trades into daily PnL data points
 */
function aggregateToPnLData(trades: OrderlyTrade[]): PnLDataPoint[] {
  if (!trades || trades.length === 0) {
    return [];
  }

  // Group trades by date
  const dailyPnL = new Map<string, number>();
  
  trades.forEach(trade => {
    const date = new Date(trade.executed_timestamp).toISOString().split('T')[0];
    const currentPnL = dailyPnL.get(date) || 0;
    dailyPnL.set(date, currentPnL + trade.realized_pnl);
  });
  
  // Convert to array and sort by date
  const sortedDates = Array.from(dailyPnL.keys()).sort();
  
  let cumulative = 0;
  return sortedDates.map(date => {
    const pnl = dailyPnL.get(date) || 0;
    cumulative += pnl;
    return {
      date: new Date(date).toISOString(),
      pnl: parseFloat(pnl.toFixed(2)),
      cumulative: parseFloat(cumulative.toFixed(2)),
    };
  });
}

export function usePortfolioAnalytics(params: {
  symbol?: string;
  timeframe?: 'daily' | 'weekly' | 'monthly';
} = {}) {
  const { symbol, timeframe = 'daily' } = params;
  
  // Calculate date range based on timeframe
  const { startTime, endTime } = useMemo(() => {
    const end = Date.now();
    let start: number;
    
    switch (timeframe) {
      case 'weekly':
        start = end - 7 * 24 * 60 * 60 * 1000;
        break;
      case 'monthly':
        start = end - 30 * 24 * 60 * 60 * 1000;
        break;
      default: // daily
        start = end - 24 * 60 * 60 * 1000;
        break;
    }
    
    return { startTime: start, endTime: end };
  }, [timeframe]);
  
  // Fetch trade history from Orderly API
  // Note: Using GET /v1/trades endpoint for user trade history
  const tradesUrl = useMemo(() => {
    const params = new URLSearchParams({
      size: '500', // Fetch up to 500 trades
      start_t: startTime.toString(),
      end_t: endTime.toString(),
    });
    
    if (symbol) {
      params.set('symbol', symbol);
    }
    
    return `/v1/trades?${params.toString()}`;
  }, [symbol, startTime, endTime]);
  
  const { data: tradesResponse, isLoading } = usePrivateQuery<OrderlyTradesResponse>(
    tradesUrl,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // Cache for 1 minute
    }
  );
  
  // Process trade data
  const data = useMemo(() => {
    if (!tradesResponse?.data?.rows) {
      return null;
    }
    
    const trades = tradesResponse.data.rows;
    
    return {
      pnlData: aggregateToPnLData(trades),
      metrics: calculateMetrics(trades),
    };
  }, [tradesResponse]);

  const exportData = (format: 'csv' | 'pdf') => {
    if (!data) return;

    if (format === 'csv') {
      const csv = [
        ['Date', 'PnL', 'Cumulative PnL'],
        ...data.pnlData.map(d => [d.date, d.pnl.toString(), d.cumulative.toString()]),
      ].map(row => row.join(',')).join('\n');

      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `portfolio-analytics-${new Date().toISOString()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      // PDF export would require a library like jsPDF
      alert('PDF export coming soon');
    }
  };

  return { data, isLoading, exportData };
}

