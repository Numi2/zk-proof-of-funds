import React from 'react';
import './Skeleton.css';

export function OrderbookSkeleton() {
  return (
    <div className="dex-skeleton-container">
      <div className="dex-skeleton-header">
        <div className="dex-skeleton-line" style={{ width: '120px', height: '20px' }} />
        <div className="dex-skeleton-line" style={{ width: '80px', height: '20px' }} />
      </div>
      <div className="dex-skeleton-orderbook">
        {/* Ask side */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={`ask-${i}`} className="dex-skeleton-orderbook-row">
            <div className="dex-skeleton-line" style={{ width: '60px' }} />
            <div className="dex-skeleton-line" style={{ width: '80px' }} />
            <div className="dex-skeleton-line" style={{ width: '70px' }} />
          </div>
        ))}
        {/* Spread */}
        <div className="dex-skeleton-spread">
          <div className="dex-skeleton-line" style={{ width: '100px', height: '24px' }} />
        </div>
        {/* Bid side */}
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={`bid-${i}`} className="dex-skeleton-orderbook-row">
            <div className="dex-skeleton-line" style={{ width: '60px' }} />
            <div className="dex-skeleton-line" style={{ width: '80px' }} />
            <div className="dex-skeleton-line" style={{ width: '70px' }} />
          </div>
        ))}
      </div>
    </div>
  );
}

