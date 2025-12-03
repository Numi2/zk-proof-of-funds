import React, { useState, useMemo } from 'react';
import type { API } from '@orderly.network/types';
import './PositionCalculator.css';

interface PositionCalculatorProps {
  symbol: API.Symbol;
  markPrice: number;
  leverage?: number;
}

export function PositionCalculator({ symbol, markPrice, leverage = 1 }: PositionCalculatorProps) {
  const [quantity, setQuantity] = useState<number>(0);
  const [entryPrice, setEntryPrice] = useState<number>(markPrice);
  const [leverageValue, setLeverageValue] = useState<number>(leverage);

  const calculations = useMemo(() => {
    const notional = quantity * entryPrice;
    const margin = notional / leverageValue;
    const liquidationPrice = entryPrice * (1 - 1 / leverageValue);
    
    return {
      notional,
      margin,
      liquidationPrice,
    };
  }, [quantity, entryPrice, leverageValue]);

  return (
    <div className="dex-position-calculator">
      <h4>Position Calculator</h4>
      
      <div className="dex-calc-form">
        <div className="dex-calc-group">
          <label>Quantity</label>
          <input
            type="number"
            value={quantity || ''}
            onChange={(e) => setQuantity(Number(e.target.value) || 0)}
            placeholder="0"
            className="dex-calc-input"
          />
        </div>

        <div className="dex-calc-group">
          <label>Entry Price</label>
          <input
            type="number"
            value={entryPrice || ''}
            onChange={(e) => setEntryPrice(Number(e.target.value) || 0)}
            placeholder="0"
            className="dex-calc-input"
          />
        </div>

        <div className="dex-calc-group">
          <label>Leverage</label>
          <input
            type="number"
            value={leverageValue || ''}
            onChange={(e) => setLeverageValue(Number(e.target.value) || 1)}
            min="1"
            max="100"
            className="dex-calc-input"
          />
        </div>
      </div>

      <div className="dex-calc-results">
        <div className="dex-calc-result-item">
          <span className="dex-calc-label">Notional Value:</span>
          <span className="dex-calc-value">${calculations.notional.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="dex-calc-result-item">
          <span className="dex-calc-label">Required Margin:</span>
          <span className="dex-calc-value">${calculations.margin.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="dex-calc-result-item">
          <span className="dex-calc-label">Liquidation Price:</span>
          <span className="dex-calc-value dex-loss-text">${calculations.liquidationPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
      </div>
    </div>
  );
}

