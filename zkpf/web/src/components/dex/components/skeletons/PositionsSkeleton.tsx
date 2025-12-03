import React from 'react';
import './Skeleton.css';

export function PositionsSkeleton() {
  return (
    <div className="dex-skeleton-container">
      <div className="dex-skeleton-header">
        <div className="dex-skeleton-line" style={{ width: '200px', height: '24px' }} />
      </div>
      <div className="dex-skeleton-table">
        {/* Table header */}
        <div className="dex-skeleton-table-header">
          <div className="dex-skeleton-line" style={{ width: '100px' }} />
          <div className="dex-skeleton-line" style={{ width: '120px' }} />
          <div className="dex-skeleton-line" style={{ width: '100px' }} />
          <div className="dex-skeleton-line" style={{ width: '100px' }} />
          <div className="dex-skeleton-line" style={{ width: '100px' }} />
          <div className="dex-skeleton-line" style={{ width: '80px' }} />
        </div>
        {/* Table rows */}
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="dex-skeleton-table-row">
            <div className="dex-skeleton-line" style={{ width: '100px' }} />
            <div className="dex-skeleton-line" style={{ width: '120px' }} />
            <div className="dex-skeleton-line" style={{ width: '100px' }} />
            <div className="dex-skeleton-line" style={{ width: '100px' }} />
            <div className="dex-skeleton-line" style={{ width: '100px' }} />
            <div className="dex-skeleton-line" style={{ width: '80px' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

