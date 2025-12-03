import { useState } from 'react';
import { PnLChart } from '../../components/analytics/PnLChart';
import { PerformanceMetrics } from '../../components/analytics/PerformanceMetrics';
import { usePortfolioAnalytics } from '../../hooks/usePortfolioAnalytics';
import './AnalyticsPage.css';

export default function AnalyticsPage() {
  const [timeframe, setTimeframe] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const { data, isLoading, exportData } = usePortfolioAnalytics({ timeframe });

  if (isLoading) {
    return <div className="dex-analytics-loading">Loading analytics...</div>;
  }

  return (
    <div className="dex-analytics-page">
      <div className="dex-analytics-header">
        <h2>Portfolio Analytics</h2>
        <div className="dex-analytics-controls">
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as 'daily' | 'weekly' | 'monthly')}
            className="dex-timeframe-select"
          >
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
          </select>
          <button onClick={() => exportData('csv')} className="dex-export-button">
            Export CSV
          </button>
          <button onClick={() => exportData('pdf')} className="dex-export-button">
            Export PDF
          </button>
        </div>
      </div>

      <div className="dex-analytics-content">
        <div className="dex-analytics-chart-section">
          <PnLChart data={data?.pnlData || []} timeframe={timeframe} />
        </div>
        <div className="dex-analytics-metrics-section">
          <PerformanceMetrics metrics={data?.metrics} />
        </div>
      </div>
    </div>
  );
}

