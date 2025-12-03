import React, { useMemo } from 'react';
import type { API } from '@orderly.network/types';
import { useOrderlyFundingRate, useOrderlyFundingRateHistory, useOrderlyTicker } from '../../../../hooks/useOrderlyMarket';
import './FundingRateTracker.css';

interface FundingRateTrackerProps {
  symbol: API.Symbol;
}

export function FundingRateTracker({ symbol }: FundingRateTrackerProps) {
  const symbolStr = symbol.symbol;
  
  // Fetch real-time funding rate data
  const { fundingRate, loading: fundingLoading, error: fundingError } = useOrderlyFundingRate(symbolStr);
  const { history: fundingHistory, loading: historyLoading } = useOrderlyFundingRateHistory(symbolStr, 24);
  const { ticker } = useOrderlyTicker(symbolStr);

  // Transform funding rate data
  const fundingData = useMemo(() => {
    if (!fundingRate) return null;
    
    const rate = parseFloat(fundingRate.funding_rate || '0');
    const predictedRate = ticker?.predicted_rate ? parseFloat(ticker.predicted_rate) : rate;
    
    return {
      symbol: symbolStr,
      fundingRate: rate,
      nextFundingTime: fundingRate.next_funding_time * 1000, // Convert to milliseconds
      predictedRate,
    };
  }, [fundingRate, ticker, symbolStr]);

  // Transform history data
  const history = useMemo(() => {
    return fundingHistory.map((item) => ({
      time: item.funding_rate_timestamp * 1000, // Convert to milliseconds
      rate: parseFloat(item.funding_rate || '0'),
    })).sort((a, b) => a.time - b.time);
  }, [fundingHistory]);

  if (fundingLoading || historyLoading) {
    return <div className="dex-funding-loading">Loading funding rate...</div>;
  }

  if (fundingError || !fundingData) {
    return (
      <div className="dex-funding-error">
        {fundingError ? `Error: ${fundingError.message}` : 'No funding rate data available'}
      </div>
    );
  }

  if (!fundingData) {
    return <div className="dex-funding-loading">Loading funding rate...</div>;
  }

  const isPositive = fundingData.fundingRate > 0;
  const nextFundingDate = new Date(fundingData.nextFundingTime);
  const hasPredictedRate = fundingData.predictedRate !== fundingData.fundingRate;

  return (
    <div className="dex-funding-tracker">
      <h4>Funding Rate</h4>
      
      <div className="dex-funding-current">
        <div className="dex-funding-rate">
          <span className="dex-funding-label">Current Rate:</span>
          <span className={`dex-funding-value ${isPositive ? 'dex-profit-text' : 'dex-loss-text'}`}>
            {(fundingData.fundingRate * 100).toFixed(4)}%
          </span>
        </div>
        <div className="dex-funding-next">
          <span className="dex-funding-label">Next Funding:</span>
          <span className="dex-funding-value">
            {nextFundingDate.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {hasPredictedRate && (
        <div className="dex-funding-prediction">
          <span className="dex-funding-label">Predicted Rate:</span>
          <span className={`dex-funding-value ${fundingData.predictedRate > fundingData.fundingRate ? 'dex-profit-text' : 'dex-loss-text'}`}>
            {(fundingData.predictedRate * 100).toFixed(4)}%
          </span>
        </div>
      )}

      {history.length > 0 && (
        <div className="dex-funding-history">
          <h5>24h History</h5>
          <div className="dex-funding-history-list">
            {history.map((item, idx) => (
              <div key={idx} className="dex-funding-history-item">
                <span className="dex-funding-time">
                  {new Date(item.time).toLocaleTimeString()}
                </span>
                <span className={`dex-funding-rate-value ${item.rate > 0 ? 'dex-profit-text' : 'dex-loss-text'}`}>
                  {(item.rate * 100).toFixed(4)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

