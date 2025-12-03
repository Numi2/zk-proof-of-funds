/**
 * Mobile Order Entry Component
 * 
 * Optimized order entry interface for mobile devices using bottom sheet pattern.
 * Provides tap-to-trade functionality and simplified order placement.
 */

import React, { useState, useCallback } from 'react';
import { OrderBottomSheet } from './OrderBottomSheet';
import { EnhancedOrderEntry } from '../trading/EnhancedOrderEntry';
import { useMediaQuery } from '../../hooks/useOrderlyHooks';
import './MobileOrderEntry.css';

interface MobileOrderEntryProps {
  symbol: string;
  onOrderPlaced?: () => void;
}

export function MobileOrderEntry({ symbol, onOrderPlaced }: MobileOrderEntryProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [quickAction, setQuickAction] = useState<'buy' | 'sell' | null>(null);
  const isMobile = useMediaQuery('(max-width: 768px)');

  const handleOpen = useCallback((action: 'buy' | 'sell') => {
    setQuickAction(action);
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    setQuickAction(null);
  }, []);

  const handleOrderPlaced = useCallback(() => {
    handleClose();
    onOrderPlaced?.();
  }, [handleClose, onOrderPlaced]);

  // On desktop, render standard component
  if (!isMobile) {
    return <EnhancedOrderEntry symbol={symbol} onOrderPlaced={onOrderPlaced} />;
  }

  return (
    <>
      {/* Quick Action Buttons - Always Visible */}
      <div className="mobile-order-quick-actions">
        <button
          className="mobile-quick-action mobile-quick-buy"
          onClick={() => handleOpen('buy')}
        >
          <span className="action-icon">📈</span>
          <span className="action-label">Buy</span>
        </button>
        <button
          className="mobile-quick-action mobile-quick-sell"
          onClick={() => handleOpen('sell')}
        >
          <span className="action-icon">📉</span>
          <span className="action-label">Sell</span>
        </button>
      </div>

      {/* Bottom Sheet with Order Entry */}
      <OrderBottomSheet isOpen={isOpen} onClose={handleClose}>
        <div className="mobile-order-entry-container">
          <div className="mobile-order-header">
            <h3 className="mobile-order-title">
              {quickAction === 'buy' ? 'Buy' : 'Sell'} {symbol.replace('PERP_', '').replace('_USDC', '')}
            </h3>
            <button className="mobile-order-close" onClick={handleClose}>
              ✕
            </button>
          </div>
          
          <div className="mobile-order-content">
            <EnhancedOrderEntry 
              symbol={symbol} 
              onOrderPlaced={handleOrderPlaced}
              defaultSide={quickAction === 'buy' ? 'BUY' : 'SELL'}
            />
          </div>
        </div>
      </OrderBottomSheet>
    </>
  );
}

