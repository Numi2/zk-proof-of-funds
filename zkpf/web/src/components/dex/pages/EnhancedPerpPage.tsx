/**
 * Enhanced Perpetual Futures Trading Page
 * 
 * Example integration showing how to use all the new Orderly hooks components
 * together with the existing Orderly SDK TradingPage component
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { TradingPage, type TradingPageProps } from "@orderly.network/trading";
import { type API, AccountStatusEnum } from "@orderly.network/types";
import { BaseLayout } from "../layout";
import { PathEnum } from "../constant";
import { useOrderlyConfig } from "../hooks/useOrderlyConfig";
import { updateSymbol } from "../storage";
import { generateLocalePath } from "../utils";

// Import new integrated components
import { OrderTemplatesIntegrated } from "../components/trading/OrderTemplatesIntegrated";
import { PositionCalculatorIntegrated } from "../components/trading/PositionCalculatorIntegrated";
import { FundingRateTracker } from "../components/tools/FundingRateTracker";
import { EnhancedOrderEntry } from "../components/trading/EnhancedOrderEntry";
import { FootprintChartWrapper } from "../components/charts/FootprintChartWrapper";

// Import hooks
import { useAccount, usePositionStream, useMediaQuery } from "../hooks/useOrderlyHooks";

export default function EnhancedPerpPage() {
  const params = useParams();
  const [symbol, setSymbol] = useState(params.symbol!);
  const [showEnhancedUI, setShowEnhancedUI] = useState(false);
  const [showFootprintChart, setShowFootprintChart] = useState(false);
  const navigate = useNavigate();
  const config = useOrderlyConfig();

  // Orderly hooks
  const { state: accountState } = useAccount();
  const positions = usePositionStream();
  const isMobile = useMediaQuery('(max-width: 768px)');

  useEffect(() => {
    updateSymbol(symbol);
  }, [symbol]);

  const onSymbolChange = useCallback(
    (data: API.Symbol) => {
      const newSymbol = data.symbol;
      setSymbol(newSymbol);
      navigate(generateLocalePath(`${PathEnum.Perp}/${newSymbol}`));
    },
    [navigate],
  );

  const handleOrderPlaced = useCallback(() => {
    console.log('Order placed successfully!');
    // Could refresh positions, update UI, etc.
  }, []);

  // Toggle between standard and enhanced UI
  const toggleUI = () => setShowEnhancedUI(!showEnhancedUI);

  if (!showEnhancedUI) {
    // Standard Orderly UI
    return (
      <BaseLayout>
        <div style={{ position: 'relative' }}>
          <button
            onClick={toggleUI}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              zIndex: 1000,
              padding: '8px 16px',
              background: '#4CAF50',
              color: 'white',
              border: 'none',
              borderRadius: '4px',
              cursor: 'pointer',
            }}
          >
            🚀 Try Enhanced UI
          </button>
          <TradingPage
            symbol={symbol}
            onSymbolChange={onSymbolChange}
            tradingViewConfig={config.tradingPage.tradingViewConfig}
            sharePnLConfig={config.tradingPage.sharePnLConfig}
          />
        </div>
      </BaseLayout>
    );
  }

  // Enhanced UI with new components
  return (
    <BaseLayout>
      <div className="enhanced-trading-page">
        <div className="enhanced-trading-header">
          <h2>{symbol.replace('PERP_', '').replace('_USDC', '-USDC')}</h2>
          <button onClick={toggleUI} className="toggle-ui-btn">
            ← Back to Standard UI
          </button>
        </div>

        <div className="enhanced-trading-grid">
          {/* Left Panel: Order Entry & Templates */}
          <div className="enhanced-panel enhanced-panel-left">
            <div className="panel-section">
              <h3>Quick Orders</h3>
              <OrderTemplatesIntegrated
                symbol={symbol}
                onTemplateExecuted={handleOrderPlaced}
              />
            </div>

            {!isMobile && (
              <div className="panel-section">
                <h3>Manual Order Entry</h3>
                <EnhancedOrderEntry
                  symbol={symbol}
                  onOrderPlaced={handleOrderPlaced}
                />
              </div>
            )}
          </div>

          {/* Center: Orderly TradingPage or Footprint Chart */}
          <div className="enhanced-panel enhanced-panel-center">
            <div className="chart-toggle-container">
              <div className="chart-toggle-buttons">
                <button
                  className={`chart-toggle-btn ${!showFootprintChart ? 'active' : ''}`}
                  onClick={() => setShowFootprintChart(false)}
                >
                  Trading View
                </button>
                <button
                  className={`chart-toggle-btn ${showFootprintChart ? 'active' : ''}`}
                  onClick={() => setShowFootprintChart(true)}
                >
                  Footprint Chart
                </button>
              </div>
            </div>
            {showFootprintChart ? (
              <div className="footprint-chart-container">
                <FootprintChartWrapper symbol={symbol} />
              </div>
            ) : (
              <TradingPage
                symbol={symbol}
                onSymbolChange={onSymbolChange}
                tradingViewConfig={config.tradingPage.tradingViewConfig}
                sharePnLConfig={config.tradingPage.sharePnLConfig}
              />
            )}
          </div>

          {/* Right Panel: Calculator & Tools */}
          <div className="enhanced-panel enhanced-panel-right">
            <div className="panel-section">
              <h3>Position Calculator</h3>
              <PositionCalculatorIntegrated
                symbol={symbol}
                side="BUY"
              />
            </div>

            <div className="panel-section">
              <h3>Funding Rate</h3>
              <FundingRateTracker symbol={{ symbol } as API.Symbol} />
            </div>

            {/* Account Info */}
            {accountState.status >= AccountStatusEnum.SignedIn && (
              <div className="panel-section">
                <h3>Account Status</h3>
                <div className="account-info">
                  <div className="info-row">
                    <span>Total Collateral:</span>
                    <span>${(accountState as any).totalCollateral?.toFixed(2) || '0.00'}</span>
                  </div>
                  <div className="info-row">
                    <span>Free Collateral:</span>
                    <span>${(accountState as any).freeCollateral?.toFixed(2) || '0.00'}</span>
                  </div>
                  <div className="info-row">
                    <span>Max Leverage:</span>
                    <span>{(accountState as any).maxLeverage || 10}x</span>
                  </div>
                </div>
              </div>
            )}

            {/* Open Positions */}
            {positions && Array.isArray(positions) && positions.length > 0 && (
              <div className="panel-section">
                <h3>Open Positions</h3>
                <div className="positions-list">
                  {positions.map((pos: any) => (
                    <div key={pos.symbol} className="position-item">
                      <div className="position-header">
                        <span className="position-symbol">{pos.symbol}</span>
                        <span className={`position-side ${pos.position_qty > 0 ? 'long' : 'short'}`}>
                          {pos.position_qty > 0 ? 'LONG' : 'SHORT'}
                        </span>
                      </div>
                      <div className="position-details">
                        <div className="detail-row">
                          <span>Qty:</span>
                          <span>{Math.abs(pos.position_qty).toFixed(4)}</span>
                        </div>
                        <div className="detail-row">
                          <span>Entry:</span>
                          <span>${pos.average_open_price?.toFixed(2)}</span>
                        </div>
                        <div className="detail-row">
                          <span>Mark:</span>
                          <span>${pos.mark_price?.toFixed(2)}</span>
                        </div>
                        <div className="detail-row">
                          <span>Unrealized PnL:</span>
                          <span className={pos.unrealized_pnl >= 0 ? 'profit' : 'loss'}>
                            ${pos.unrealized_pnl?.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        .enhanced-trading-page {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
        }

        .enhanced-trading-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 16px;
          background: var(--primary-bg, #1a1a1a);
          border-bottom: 1px solid var(--border-color, #333);
        }

        .enhanced-trading-header h2 {
          margin: 0;
          font-size: 24px;
          color: var(--text-primary, #fff);
        }

        .toggle-ui-btn {
          padding: 8px 16px;
          background: var(--secondary-bg, #2a2a2a);
          color: var(--text-primary, #fff);
          border: 1px solid var(--border-color, #444);
          border-radius: 4px;
          cursor: pointer;
          transition: all 0.2s;
        }

        .toggle-ui-btn:hover {
          background: var(--hover-bg, #333);
        }

        .enhanced-trading-grid {
          display: grid;
          grid-template-columns: 320px 1fr 320px;
          gap: 16px;
          padding: 16px;
          flex: 1;
          overflow: hidden;
        }

        @media (max-width: 1200px) {
          .enhanced-trading-grid {
            grid-template-columns: 280px 1fr 280px;
          }
        }

        @media (max-width: 768px) {
          .enhanced-trading-grid {
            grid-template-columns: 1fr;
            grid-template-rows: auto 1fr auto;
          }
        }

        .enhanced-panel {
          background: var(--panel-bg, #1e1e1e);
          border-radius: 8px;
          padding: 16px;
          overflow-y: auto;
        }

        .enhanced-panel-center {
          min-height: 600px;
        }

        .panel-section {
          margin-bottom: 24px;
        }

        .panel-section:last-child {
          margin-bottom: 0;
        }

        .panel-section h3 {
          margin: 0 0 12px 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--text-secondary, #aaa);
        }

        .account-info, .positions-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .info-row, .detail-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          font-size: 14px;
        }

        .info-row span:first-child,
        .detail-row span:first-child {
          color: var(--text-secondary, #aaa);
        }

        .info-row span:last-child,
        .detail-row span:last-child {
          color: var(--text-primary, #fff);
          font-weight: 500;
        }

        .position-item {
          background: var(--secondary-bg, #252525);
          padding: 12px;
          border-radius: 6px;
          border: 1px solid var(--border-color, #333);
        }

        .position-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .position-symbol {
          font-weight: 600;
          color: var(--text-primary, #fff);
        }

        .position-side {
          padding: 2px 8px;
          border-radius: 3px;
          font-size: 12px;
          font-weight: 600;
        }

        .position-side.long {
          background: rgba(76, 175, 80, 0.2);
          color: #4CAF50;
        }

        .position-side.short {
          background: rgba(244, 67, 54, 0.2);
          color: #F44336;
        }

        .position-details {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .profit {
          color: #4CAF50;
        }

        .loss {
          color: #F44336;
        }

        .chart-toggle-container {
          margin-bottom: 12px;
        }

        .chart-toggle-buttons {
          display: flex;
          gap: 8px;
          background: var(--secondary-bg, #252525);
          padding: 4px;
          border-radius: 6px;
          width: fit-content;
        }

        .chart-toggle-btn {
          padding: 6px 16px;
          background: transparent;
          border: none;
          border-radius: 4px;
          color: var(--text-secondary, #aaa);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .chart-toggle-btn:hover {
          color: var(--text-primary, #fff);
          background: rgba(255, 255, 255, 0.05);
        }

        .chart-toggle-btn.active {
          background: var(--primary-bg, #1a1a1a);
          color: var(--text-primary, #fff);
          box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
        }

        .footprint-chart-container {
          width: 100%;
          height: 100%;
          min-height: 600px;
        }
      `}</style>
    </BaseLayout>
  );
}

