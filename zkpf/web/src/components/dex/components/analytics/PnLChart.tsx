import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Area, AreaChart } from 'recharts';
import './PnLChart.css';

interface PnLDataPoint {
  date: string;
  pnl: number;
  cumulative: number;
}

interface PnLChartProps {
  data: PnLDataPoint[];
  timeframe: 'daily' | 'weekly' | 'monthly';
}

export function PnLChart({ data, timeframe }: PnLChartProps) {
  const formatDate = (date: string) => {
    const d = new Date(date);
    switch (timeframe) {
      case 'daily':
        return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      case 'weekly':
        return `Week ${Math.ceil(d.getDate() / 7)}`;
      case 'monthly':
        return d.toLocaleDateString('en-US', { month: 'short' });
      default:
        return date;
    }
  };

  return (
    <div className="dex-pnl-chart">
      <h3>Profit & Loss</h3>
      <ResponsiveContainer width="100%" height={400}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--dex-profit)" stopOpacity={0.3} />
              <stop offset="95%" stopColor="var(--dex-profit)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--dex-border-primary)" />
          <XAxis
            dataKey="date"
            tickFormatter={formatDate}
            stroke="var(--dex-text-secondary)"
            style={{ fontSize: '0.75rem' }}
          />
          <YAxis
            tickFormatter={(value) => `$${value.toLocaleString()}`}
            stroke="var(--dex-text-secondary)"
            style={{ fontSize: '0.75rem' }}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--dex-bg-elevated)',
              border: '1px solid var(--dex-border-primary)',
              borderRadius: '8px',
            }}
            formatter={(value: number) => [`$${value.toLocaleString()}`, 'PnL']}
          />
          <Area
            type="monotone"
            dataKey="cumulative"
            stroke="var(--dex-profit)"
            fill="url(#pnlGradient)"
            strokeWidth={2}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

