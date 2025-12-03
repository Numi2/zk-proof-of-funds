import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import './MobileTradingView.css';

interface MobileTradingViewProps {
  children: React.ReactNode;
}

export function MobileTradingView({ children }: MobileTradingViewProps) {
  const [activeTab, setActiveTab] = useState<'chart' | 'orderbook' | 'trades'>('chart');

  return (
    <div className="dex-mobile-trading">
      <div className="dex-mobile-tabs">
        <button
          className={`dex-mobile-tab ${activeTab === 'chart' ? 'active' : ''}`}
          onClick={() => setActiveTab('chart')}
        >
          Chart
        </button>
        <button
          className={`dex-mobile-tab ${activeTab === 'orderbook' ? 'active' : ''}`}
          onClick={() => setActiveTab('orderbook')}
        >
          Orderbook
        </button>
        <button
          className={`dex-mobile-tab ${activeTab === 'trades' ? 'active' : ''}`}
          onClick={() => setActiveTab('trades')}
        >
          Trades
        </button>
      </div>
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: -20 }}
          transition={{ duration: 0.2 }}
          className="dex-mobile-content"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

