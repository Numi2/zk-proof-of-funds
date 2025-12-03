import React from "react";
import { BaseLayout } from "../layout";
import { PathEnum } from "../constant";
import { SupportedMarketsList } from "../components/markets";
import { useOrderlyMarketInfo } from "../../../hooks/useOrderlyMarket";
import { getEnabledMarkets } from "../../../config/orderly-markets";
import { useNavigate } from "react-router-dom";
import { generateLocalePath } from "../utils";
import { useSymbolsInfo } from "../hooks/useOrderlyHooks";
import "./MarketsPage.css";

export default function MarketsPage() {
  const { symbols: apiSymbols, loading } = useOrderlyMarketInfo();
  const symbolsInfo = useSymbolsInfo(); // This is what TradingPage uses internally
  const navigate = useNavigate();
  const enabledMarkets = getEnabledMarkets();

  // Debug: Log symbols to verify ZEC is in the API and SDK
  React.useEffect(() => {
    if (!loading && apiSymbols.length > 0) {
      const zecSymbol = apiSymbols.find((s: any) => s.symbol === 'PERP_ZEC_USDC');
      console.log('[MarketsPage] Total symbols from API:', apiSymbols.length);
      console.log('[MarketsPage] PERP_ZEC_USDC found in API:', !!zecSymbol);
      if (zecSymbol) {
        console.log('[MarketsPage] PERP_ZEC_USDC details:', zecSymbol);
      }
    }
    
    // Check what useSymbolsInfo returns (used by TradingPage)
    if (symbolsInfo && Array.isArray(symbolsInfo)) {
      const zecInSDK = symbolsInfo.find((s: any) => s?.symbol === 'PERP_ZEC_USDC');
      console.log('[MarketsPage] Total symbols from SDK useSymbolsInfo:', symbolsInfo.length);
      console.log('[MarketsPage] PERP_ZEC_USDC found in SDK:', !!zecInSDK);
      if (!zecInSDK) {
        console.log('[MarketsPage] SDK symbols sample:', symbolsInfo.slice(0, 10).map((s: any) => s?.symbol));
      }
    } else if (symbolsInfo && typeof symbolsInfo === 'object') {
      // useSymbolsInfo might return an object with data property
      const symbols = (symbolsInfo as any).data || (symbolsInfo as any).symbols || [];
      const zecInSDK = symbols.find((s: any) => s?.symbol === 'PERP_ZEC_USDC');
      console.log('[MarketsPage] SDK useSymbolsInfo structure:', Object.keys(symbolsInfo));
      console.log('[MarketsPage] PERP_ZEC_USDC found in SDK:', !!zecInSDK);
    }
  }, [apiSymbols, loading, symbolsInfo]);

  // Create a set of available symbols from Orderly API for quick lookup
  const availableSymbols = new Set(apiSymbols.map((s: any) => s.symbol));

  const handleMarketClick = (symbol: string) => {
    // Navigate to trading page for this symbol
    navigate(generateLocalePath(`${PathEnum.Perp}/${symbol}`));
  };

  return (
    <BaseLayout initialMenu={PathEnum.Markets}>
      <div className="markets-page">
        <div className="markets-page-header">
          <h1>Perpetual Futures Markets</h1>
          <p className="markets-page-subtitle">
            Trade perpetual futures contracts denominated and settled in USDC
          </p>
        </div>

        {loading ? (
          <div className="markets-loading">
            <div className="loader" />
            <p>Loading market information...</p>
          </div>
        ) : (
          <div className="markets-content">
            <SupportedMarketsList showOnlyEnabled={true} />
            
            {/* Market Grid with Clickable Cards */}
            <div className="markets-grid-section">
              <h2>Available Markets</h2>
              <div className="markets-grid">
                {enabledMarkets.map((market) => {
                  const isAvailable = availableSymbols.has(market.tokenSymbol);
                  return (
                    <div
                      key={market.tokenSymbol}
                      className={`market-card ${isAvailable ? 'available' : 'unavailable'}`}
                      onClick={() => isAvailable && handleMarketClick(market.tokenSymbol)}
                      style={{ cursor: isAvailable ? 'pointer' : 'not-allowed' }}
                    >
                      <div className="market-card-header">
                        <span className="market-ticker">{market.tokenTicker}</span>
                        <span className={`market-status ${isAvailable ? 'available' : 'unavailable'}`}>
                          {isAvailable ? '✓ Available' : 'Coming Soon'}
                        </span>
                      </div>
                      <div className="market-name">{market.tokenName}</div>
                      <div className="market-symbol">{market.tokenSymbol}</div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </BaseLayout>
  );
}

