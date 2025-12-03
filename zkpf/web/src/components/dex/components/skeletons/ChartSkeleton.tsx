import React from 'react';
import './Skeleton.css';

export function ChartSkeleton() {
  return (
    <div className="dex-skeleton-chart">
      <div className="dex-skeleton-chart-header">
        <div className="dex-skeleton-line" style={{ width: '150px', height: '28px' }} />
        <div className="dex-skeleton-line" style={{ width: '100px', height: '20px' }} />
      </div>
      <div className="dex-skeleton-chart-body">
        {/* Simulate chart area with grid pattern */}
        <svg width="100%" height="100%" className="dex-skeleton-chart-svg">
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--dex-border-primary)" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
          {/* Simulate price line */}
          <path
            d="M 0,200 Q 200,150 400,100 T 800,50"
            fill="none"
            stroke="var(--dex-border-secondary)"
            strokeWidth="2"
            opacity="0.5"
            className="dex-skeleton-line-animated"
          />
        </svg>
      </div>
      <div className="dex-skeleton-chart-footer">
        <div className="dex-skeleton-line" style={{ width: '80px' }} />
        <div className="dex-skeleton-line" style={{ width: '80px' }} />
        <div className="dex-skeleton-line" style={{ width: '80px' }} />
      </div>
    </div>
  );
}

