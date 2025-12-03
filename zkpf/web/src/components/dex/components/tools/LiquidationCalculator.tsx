import React, { useState, useMemo } from 'react';
import './LiquidationCalculator.css';

interface LiquidationCalculatorProps {
  markPrice: number;
  leverage: number;
}

export function LiquidationCalculator({ markPrice, leverage }: LiquidationCalculatorProps) {
  const [entryPrice, setEntryPrice] = useState<number>(markPrice);
  const [positionSize, setPositionSize] = useState<number>(0);
  const [margin, setMargin] = useState<number>(0);

  const liquidationPrice = useMemo(() => {
    if (!leverage || !entryPrice) return 0;
    return entryPrice * (1 - 1 / leverage);
  }, [entryPrice, leverage]);

  const priceToLiquidation = useMemo(() => {
    if (!markPrice || !liquidationPrice) return 0;
    return Math.abs(markPrice - liquidationPrice);
  }, [markPrice, liquidationPrice]);

  const percentToLiquidation = useMemo(() => {
    if (!entryPrice || !liquidationPrice) return 0;
    return Math.abs((entryPrice - liquidationPrice) / entryPrice) * 100;
  }, [entryPrice, liquidationPrice]);

  return (
    <div className="dex-liquidation-calculator">
      <h4>Liquidation Calculator</h4>
      
      <div className="dex-liq-inputs">
        <div className="dex-liq-group">
          <label>Entry Price</label>
          <input
            type="number"
            value={entryPrice || ''}
            onChange={(e) => setEntryPrice(Number(e.target.value) || 0)}
            className="dex-liq-input"
          />
        </div>
        <div className="dex-liq-group">
          <label>Position Size</label>
          <input
            type="number"
            value={positionSize || ''}
            onChange={(e) => setPositionSize(Number(e.target.value) || 0)}
            className="dex-liq-input"
          />
        </div>
        <div className="dex-liq-group">
          <label>Margin</label>
          <input
            type="number"
            value={margin || ''}
            onChange={(e) => setMargin(Number(e.target.value) || 0)}
            className="dex-liq-input"
          />
        </div>
        <div className="dex-liq-group">
          <label>Leverage</label>
          <input
            type="number"
            value={leverage || ''}
            readOnly
            className="dex-liq-input"
          />
        </div>
      </div>

      <div className="dex-liq-results">
        <div className="dex-liq-result-item dex-liq-critical">
          <span className="dex-liq-label">Liquidation Price:</span>
          <span className="dex-liq-value">${liquidationPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="dex-liq-result-item">
          <span className="dex-liq-label">Distance to Liquidation:</span>
          <span className="dex-liq-value">${priceToLiquidation.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="dex-liq-result-item">
          <span className="dex-liq-label">% to Liquidation:</span>
          <span className={`dex-liq-value ${percentToLiquidation < 5 ? 'dex-loss-text' : percentToLiquidation < 10 ? '' : 'dex-profit-text'}`}>
            {percentToLiquidation.toFixed(2)}%
          </span>
        </div>
      </div>

      <div className="dex-liq-warning">
        {percentToLiquidation < 5 && (
          <div className="dex-liq-alert">
            ⚠️ Warning: Position is very close to liquidation!
          </div>
        )}
      </div>
    </div>
  );
}

