import React, { useState, useMemo } from 'react';
import './RiskRewardPanel.css';

interface RiskRewardPanelProps {
  entryPrice: number;
  stopLoss?: number;
  takeProfit?: number;
  quantity: number;
}

export function RiskRewardPanel({ entryPrice, stopLoss, takeProfit, quantity }: RiskRewardPanelProps) {
  const [slPrice, setSlPrice] = useState<number>(stopLoss || entryPrice * 0.95);
  const [tpPrice, setTpPrice] = useState<number>(takeProfit || entryPrice * 1.05);

  const riskReward = useMemo(() => {
    if (!slPrice || !tpPrice || !entryPrice) {
      return { ratio: 0, risk: 0, reward: 0 };
    }

    const risk = Math.abs(entryPrice - slPrice) * quantity;
    const reward = Math.abs(tpPrice - entryPrice) * quantity;
    const ratio = risk > 0 ? reward / risk : 0;

    return { ratio, risk, reward };
  }, [entryPrice, slPrice, tpPrice, quantity]);

  return (
    <div className="dex-risk-reward-panel">
      <h4>Risk/Reward</h4>
      
      <div className="dex-rr-inputs">
        <div className="dex-rr-group">
          <label>Stop Loss</label>
          <input
            type="number"
            value={slPrice || ''}
            onChange={(e) => setSlPrice(Number(e.target.value) || 0)}
            className="dex-rr-input"
          />
        </div>
        <div className="dex-rr-group">
          <label>Take Profit</label>
          <input
            type="number"
            value={tpPrice || ''}
            onChange={(e) => setTpPrice(Number(e.target.value) || 0)}
            className="dex-rr-input"
          />
        </div>
      </div>

      <div className="dex-rr-visualization">
        <div className="dex-rr-bar">
          <div
            className="dex-rr-risk"
            style={{ width: `${Math.min(50, (riskReward.risk / (riskReward.risk + riskReward.reward)) * 100)}%` }}
          />
          <div
            className="dex-rr-reward"
            style={{ width: `${Math.min(50, (riskReward.reward / (riskReward.risk + riskReward.reward)) * 100)}%` }}
          />
        </div>
      </div>

      <div className="dex-rr-metrics">
        <div className="dex-rr-metric">
          <span className="dex-rr-label">Risk:</span>
          <span className="dex-rr-value dex-loss-text">${riskReward.risk.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="dex-rr-metric">
          <span className="dex-rr-label">Reward:</span>
          <span className="dex-rr-value dex-profit-text">${riskReward.reward.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
        </div>
        <div className="dex-rr-metric">
          <span className="dex-rr-label">R:R Ratio:</span>
          <span className={`dex-rr-value ${riskReward.ratio >= 2 ? 'dex-profit-text' : riskReward.ratio >= 1 ? '' : 'dex-loss-text'}`}>
            {riskReward.ratio.toFixed(2)}:1
          </span>
        </div>
      </div>
    </div>
  );
}

