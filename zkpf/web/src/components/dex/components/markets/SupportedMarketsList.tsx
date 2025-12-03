/**
 * Supported Markets List Component
 * 
 * Displays all supported perpetual futures markets on Orderly Network
 */

import React from 'react';
import { ORDERLY_SUPPORTED_MARKETS, getEnabledMarkets } from '../../../../config/orderly-markets';
import './SupportedMarketsList.css';

interface SupportedMarketsListProps {
  /** Show only enabled markets */
  showOnlyEnabled?: boolean;
  /** Show market symbols */
  showSymbols?: boolean;
  /** Custom className */
  className?: string;
}

export function SupportedMarketsList({
  showOnlyEnabled = false,
  showSymbols = true,
  className = '',
}: SupportedMarketsListProps) {
  const markets = showOnlyEnabled ? getEnabledMarkets() : ORDERLY_SUPPORTED_MARKETS;

  return (
    <div className={`supported-markets-list ${className}`}>
      <div className="supported-markets-header">
        <h3>Supported Markets</h3>
        <p className="supported-markets-subtitle">
          All perpetual futures contracts are denominated and settled in USDC
        </p>
      </div>

      <div className="supported-markets-table-container">
        <table className="supported-markets-table">
          <thead>
            <tr>
              <th>Token Name</th>
              <th>Token Ticker</th>
              {showSymbols && <th>Token Symbol</th>}
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((market) => (
              <tr key={market.tokenSymbol} className={market.enabled === false ? 'disabled' : ''}>
                <td>{market.tokenName}</td>
                <td>
                  <span className="token-ticker">{market.tokenTicker}</span>
                </td>
                {showSymbols && (
                  <td>
                    <code className="token-symbol">{market.tokenSymbol}</code>
                  </td>
                )}
                <td>
                  <span className={`status-badge ${market.enabled === false ? 'disabled' : 'enabled'}`}>
                    {market.enabled === false ? 'Disabled' : 'Enabled'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="supported-markets-footer">
        <p className="supported-markets-note">
          <strong>Note:</strong> Front-end applications can choose which of the supported markets 
          they want to list on their platform.
        </p>
      </div>
    </div>
  );
}

