/**
 * Position Calculator with Orderly SDK Integration
 * 
 * Uses accurate Orderly formulas for margin, leverage, and liquidation calculations
 * 
 * @see https://orderly.network/docs/introduction/perpetual-futures-basics
 */

import React, { useState, useMemo, useEffect } from 'react';
import type { API } from '@orderly.network/types';
import { usePositionCalculator, useAccount, useMarkPrice, useSymbolsInfo } from '../../hooks/useOrderlyHooks';
import './PositionCalculator.css';

interface PositionCalculatorProps {
  symbol: string;
  side?: 'BUY' | 'SELL';
}

interface SymbolConfig {
  baseIMR: number;      // Base Initial Margin Ratio
  baseMMR: number;      // Base Maintenance Margin Ratio
  imrFactor: number;    // IMR Factor for large positions
  maxLeverage: number;  // Maximum leverage
}

// Symbol-specific configuration based on Orderly documentation
const SYMBOL_CONFIGS: Record<string, SymbolConfig> = {
  'PERP_BTC_USDC': {
    baseIMR: 0.01,      // 1% (100x leverage)
    baseMMR: 0.006,     // 0.6%
    imrFactor: 0.0000000910,
    maxLeverage: 100,
  },
  'PERP_ETH_USDC': {
    baseIMR: 0.01,      // 1% (100x leverage)
    baseMMR: 0.006,     // 0.6%
    imrFactor: 0.0000001724,
    maxLeverage: 100,
  },
  'PERP_ARB_USDC': {
    baseIMR: 0.10,      // 10% (10x leverage)
    baseMMR: 0.05,      // 5%
    imrFactor: 0.000002148,
    maxLeverage: 10,
  },
  // Default for other symbols
  'DEFAULT': {
    baseIMR: 0.05,      // 5% (20x leverage)
    baseMMR: 0.025,     // 2.5%
    imrFactor: 0.0001,
    maxLeverage: 20,
  },
};

function getSymbolConfig(symbol: string): SymbolConfig {
  return SYMBOL_CONFIGS[symbol] || SYMBOL_CONFIGS['DEFAULT'];
}

export function PositionCalculatorIntegrated({ symbol, side = 'BUY' }: PositionCalculatorProps) {
  const [quantity, setQuantity] = useState<number>(0);
  const [leverage, setLeverage] = useState<number>(10);
  const [targetPrice, setTargetPrice] = useState<number | null>(null);
  
  const { state: accountState } = useAccount();
  const markPriceHook = useMarkPrice(symbol);
  const { calculatePosition, currentPrice, maxQty, loading } = usePositionCalculator(symbol);
  
  const markPrice = markPriceHook.data || currentPrice || 0;
  const config = getSymbolConfig(symbol);
  
  // Sync leverage input with max allowed
  useEffect(() => {
    const accountMaxLeverage = (accountState as any).maxLeverage || config.maxLeverage;
    if (leverage > accountMaxLeverage) {
      setLeverage(accountMaxLeverage);
    }
  }, [(accountState as any).maxLeverage, config.maxLeverage, leverage]);

  // Calculate all position metrics using Orderly formulas
  const calculations = useMemo(() => {
    if (!quantity || !markPrice) {
      return null;
    }

    // Notional Value = Position Qty * Mark Price
    const notional = Math.abs(quantity * markPrice);
    
    // IMR i = Max(1 / Max Account Leverage, Base IMR i, IMR Factor i * Abs(Position Notional i)^(4/5))
    const imrFromLeverage = 1 / leverage;
    const imrFromSize = config.imrFactor * Math.pow(notional, 4/5);
    const IMR = Math.max(imrFromLeverage, config.baseIMR, imrFromSize);
    
    // Initial Margin = abs(position_notional * IMR)
    const initialMargin = notional * IMR;
    
    // MMR i = Max(Base MMR i, (Base MMR i / Base IMR i) * IMR Factor i * Abs(Position Notional i)^(4/5))
    const mmrFromSize = (config.baseMMR / config.baseIMR) * config.imrFactor * Math.pow(notional, 4/5);
    const MMR = Math.max(config.baseMMR, mmrFromSize);
    
    // Maintenance Margin = abs(position_notional * MMR)
    const maintenanceMargin = notional * MMR;
    
    // Total Collateral Value = total_balance + upnl + pending_short_USDC
    const totalCollateral = (accountState as any).totalCollateral || 0;
    
    // Liquidation Price = max[(Mark Price + (total_collateral_value - total_notional * MMR) / (|Qi| * MMR - Qi)), 0]
    const Qi = quantity * (side === 'BUY' ? 1 : -1);
    const liquidationPrice = Math.max(
      markPrice + (totalCollateral - notional * MMR) / (Math.abs(Qi) * MMR - Qi),
      0
    );
    
    // Effective leverage = Notional / Initial Margin
    const effectiveLeverage = initialMargin > 0 ? notional / initialMargin : 0;
    
    // Calculate PnL at target price
    const estimatePnL = (price: number) => {
      const priceDiff = price - markPrice;
      return quantity * priceDiff * (side === 'BUY' ? 1 : -1);
    };
    
    // ROE (Return on Equity) = PnL / Initial Margin
    const calculateROE = (price: number) => {
      const pnl = estimatePnL(price);
      return initialMargin > 0 ? (pnl / initialMargin) * 100 : 0;
    };

    return {
      notional,
      initialMargin,
      maintenanceMargin,
      liquidationPrice,
      effectiveLeverage,
      IMR: IMR * 100, // Convert to percentage
      MMR: MMR * 100, // Convert to percentage
      estimatePnL,
      calculateROE,
      canAfford: initialMargin <= ((accountState as any).freeCollateral || 0),
      freeCollateral: (accountState as any).freeCollateral || 0,
    };
  }, [quantity, markPrice, leverage, config, accountState, side]);

  const targetPnL = useMemo(() => {
    if (!calculations || !targetPrice) return null;
    return {
      pnl: calculations.estimatePnL(targetPrice),
      roe: calculations.calculateROE(targetPrice),
    };
  }, [calculations, targetPrice]);

  if (loading) {
    return <div className="dex-position-calculator">Loading calculator...</div>;
  }

  return (
    <div className="dex-position-calculator">
      <h4>Position Calculator</h4>
      <p className="dex-calc-subtitle">Using Orderly margin formulas</p>
      
      <div className="dex-calc-form">
        <div className="dex-calc-group">
          <label>
            Side
            <span className={`dex-calc-badge dex-calc-badge-${side.toLowerCase()}`}>
              {side}
            </span>
          </label>
        </div>

        <div className="dex-calc-group">
          <label>Quantity</label>
          <input
            type="number"
            value={quantity || ''}
            onChange={(e) => setQuantity(Number(e.target.value) || 0)}
            placeholder="0.00"
            step="0.001"
            className="dex-calc-input"
          />
          {maxQty > 0 && (
            <span className="dex-calc-hint">Max: {maxQty.toFixed(3)}</span>
          )}
        </div>

        <div className="dex-calc-group">
          <label>Leverage (1x - {config.maxLeverage}x)</label>
          <div className="dex-calc-leverage-input">
            <input
              type="range"
              min="1"
              max={Math.min(leverage * 2, config.maxLeverage)}
              value={leverage}
              onChange={(e) => setLeverage(Number(e.target.value))}
              className="dex-calc-slider"
            />
            <input
              type="number"
              value={leverage || ''}
              onChange={(e) => setLeverage(Math.min(Number(e.target.value) || 1, config.maxLeverage))}
              min="1"
              max={config.maxLeverage}
              className="dex-calc-input dex-calc-input-small"
            />
          </div>
        </div>

        <div className="dex-calc-group">
          <label>Current Mark Price</label>
          <input
            type="number"
            value={markPrice.toFixed(2)}
            disabled
            className="dex-calc-input"
          />
        </div>

        <div className="dex-calc-group">
          <label>Target Price (optional)</label>
          <input
            type="number"
            value={targetPrice || ''}
            onChange={(e) => setTargetPrice(Number(e.target.value) || null)}
            placeholder={markPrice.toFixed(2)}
            step="0.01"
            className="dex-calc-input"
          />
        </div>
      </div>

      {calculations && (
        <>
          <div className="dex-calc-results">
            <div className="dex-calc-section">
              <h5>Position Details</h5>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Notional Value:</span>
                <span className="dex-calc-value">${calculations.notional.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Initial Margin Required:</span>
                <span className="dex-calc-value">${calculations.initialMargin.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Maintenance Margin:</span>
                <span className="dex-calc-value">${calculations.maintenanceMargin.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Effective Leverage:</span>
                <span className="dex-calc-value">{calculations.effectiveLeverage.toFixed(2)}x</span>
              </div>
            </div>

            <div className="dex-calc-section">
              <h5>Risk Metrics</h5>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Initial Margin Ratio:</span>
                <span className="dex-calc-value">{calculations.IMR.toFixed(2)}%</span>
              </div>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Maintenance Margin Ratio:</span>
                <span className="dex-calc-value">{calculations.MMR.toFixed(2)}%</span>
              </div>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Liquidation Price:</span>
                <span className="dex-calc-value dex-loss-text">
                  ${calculations.liquidationPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Distance to Liquidation:</span>
                <span className="dex-calc-value">
                  {(((markPrice - calculations.liquidationPrice) / markPrice) * 100).toFixed(2)}%
                </span>
              </div>
            </div>

            {targetPnL && (
              <div className="dex-calc-section">
                <h5>PnL Estimate @ ${targetPrice?.toFixed(2)}</h5>
                <div className="dex-calc-result-item">
                  <span className="dex-calc-label">Estimated PnL:</span>
                  <span className={`dex-calc-value ${targetPnL.pnl >= 0 ? 'dex-profit-text' : 'dex-loss-text'}`}>
                    ${targetPnL.pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </div>
                <div className="dex-calc-result-item">
                  <span className="dex-calc-label">ROE (Return on Equity):</span>
                  <span className={`dex-calc-value ${targetPnL.roe >= 0 ? 'dex-profit-text' : 'dex-loss-text'}`}>
                    {targetPnL.roe.toFixed(2)}%
                  </span>
                </div>
              </div>
            )}

            <div className="dex-calc-section">
              <h5>Account Status</h5>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Free Collateral:</span>
                <span className="dex-calc-value">${calculations.freeCollateral.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
              </div>
              <div className="dex-calc-result-item">
                <span className="dex-calc-label">Can Afford Position:</span>
                <span className={`dex-calc-value ${calculations.canAfford ? 'dex-profit-text' : 'dex-loss-text'}`}>
                  {calculations.canAfford ? '✓ Yes' : '✗ No'}
                </span>
              </div>
            </div>
          </div>

          {!calculations.canAfford && (
            <div className="dex-calc-warning">
              ⚠️ Insufficient collateral. Required: ${calculations.initialMargin.toFixed(2)}, Available: ${calculations.freeCollateral.toFixed(2)}
            </div>
          )}
        </>
      )}
    </div>
  );
}

