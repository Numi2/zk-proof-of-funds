import React from 'react';
import './PerformanceMetrics.css';

interface PerformanceMetrics {
  winRate: number;
  sharpeRatio: number;
  maxDrawdown: number;
  totalTrades: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
}

interface PerformanceMetricsProps {
  metrics?: PerformanceMetrics;
}

export function PerformanceMetrics({ metrics }: PerformanceMetricsProps) {
  if (!metrics) {
    return (
      <div className="dex-metrics-empty">
        <p>No trading data available</p>
      </div>
    );
  }

  return (
    <div className="dex-performance-metrics">
      <h3>Performance Metrics</h3>
      <div className="dex-metrics-grid">
        <div className="dex-metric-card">
          <span className="dex-metric-label">Win Rate</span>
          <span className="dex-metric-value">{metrics.winRate.toFixed(1)}%</span>
        </div>
        <div className="dex-metric-card">
          <span className="dex-metric-label">Sharpe Ratio</span>
          <span className={`dex-metric-value ${metrics.sharpeRatio > 1 ? 'dex-profit-text' : ''}`}>
            {metrics.sharpeRatio.toFixed(2)}
          </span>
        </div>
        <div className="dex-metric-card">
          <span className="dex-metric-label">Max Drawdown</span>
          <span className="dex-metric-value dex-loss-text">
            {metrics.maxDrawdown.toFixed(2)}%
          </span>
        </div>
        <div className="dex-metric-card">
          <span className="dex-metric-label">Total Trades</span>
          <span className="dex-metric-value">{metrics.totalTrades}</span>
        </div>
        <div className="dex-metric-card">
          <span className="dex-metric-label">Avg Win</span>
          <span className="dex-metric-value dex-profit-text">
            ${metrics.avgWin.toLocaleString()}
          </span>
        </div>
        <div className="dex-metric-card">
          <span className="dex-metric-label">Avg Loss</span>
          <span className="dex-metric-value dex-loss-text">
            ${metrics.avgLoss.toLocaleString()}
          </span>
        </div>
        <div className="dex-metric-card">
          <span className="dex-metric-label">Profit Factor</span>
          <span className={`dex-metric-value ${metrics.profitFactor > 1 ? 'dex-profit-text' : 'dex-loss-text'}`}>
            {metrics.profitFactor.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

