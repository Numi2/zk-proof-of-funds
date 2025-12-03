import React from 'react';
import './LeverageWarning.css';

interface LeverageWarningProps {
  leverage: number;
  liquidationPrice?: number;
  currentPrice?: number;
  onAcknowledge?: () => void;
  onAccept?: () => void;
  onCancel?: () => void;
}

export function LeverageWarning({ leverage, liquidationPrice, currentPrice, onAcknowledge, onAccept, onCancel }: LeverageWarningProps) {
  const distanceToLiquidation = Math.abs((currentPrice || 0) - (liquidationPrice || 0));
  const percentToLiquidation = (distanceToLiquidation / (currentPrice || 1)) * 100;
  const isHighRisk = percentToLiquidation < 10;

  return (
    <div className={`dex-leverage-warning ${isHighRisk ? 'dex-leverage-critical' : ''}`}>
      <div className="dex-leverage-header">
        <span className="dex-leverage-icon">⚠️</span>
        <h4>High Leverage Warning</h4>
      </div>
      <div className="dex-leverage-content">
        <p>
          You are trading with <strong>{leverage}x leverage</strong>. This significantly increases your risk.
        </p>
        <div className="dex-leverage-details">
          <div className="dex-leverage-item">
            <span>Liquidation Price:</span>
            <span className="dex-loss-text">${liquidationPrice.toLocaleString()}</span>
          </div>
          <div className="dex-leverage-item">
            <span>Distance to Liquidation:</span>
            <span className={isHighRisk ? 'dex-loss-text' : ''}>
              {percentToLiquidation.toFixed(2)}%
            </span>
          </div>
        </div>
        {isHighRisk && (
          <div className="dex-leverage-alert">
            ⚠️ Your position is very close to liquidation. Consider reducing leverage or adding margin.
          </div>
        )}
        <button className="dex-leverage-acknowledge" onClick={onAcknowledge}>
          I Understand the Risks
        </button>
      </div>
    </div>
  );
}

