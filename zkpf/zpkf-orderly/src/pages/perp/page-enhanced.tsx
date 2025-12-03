/**
 * Enhanced Perp Trading Page with Orderbook
 * 
 * Comprehensive trading interface with integrated orderbook and recent trades
 */

import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { TradingPage, TradingPageProps } from "@orderly.network/trading";
import { API } from "@orderly.network/types";
import { Flex } from "@orderly.network/ui";
import { BaseLayout } from "../../components/layout";
import { PathEnum } from "../../constant";
import { useOrderlyConfig } from "../../hooks/useOrderlyConfig";
import { updateSymbol } from "../../storage";
import { generateLocalePath } from "../../utils";
import { OrderbookDisplay, RecentTrades, TradeStats } from "../../components/orderbook";

export type PerpViewProps = Pick<TradingPageProps, "symbol">;

export default function PerpPageEnhanced() {
  const params = useParams();
  const [symbol, setSymbol] = useState(params.symbol!);
  const navigate = useNavigate();
  const config = useOrderlyConfig();

  useEffect(() => {
    updateSymbol(symbol);
  }, [symbol]);

  const onSymbolChange = useCallback(
    (data: API.Symbol) => {
      const symbol = data.symbol;
      setSymbol(symbol);
      navigate(generateLocalePath(`${PathEnum.Perp}/${symbol}`));
    },
    [navigate],
  );

  const handlePriceClick = useCallback((price: number, side: "buy" | "sell") => {
    console.log(`Price clicked: ${price} (${side})`);
    // In production, this would populate the order entry form
  }, []);

  return (
    <BaseLayout>
      <div className="grid grid-cols-12 gap-4 p-4">
        {/* Main Trading View - 8 columns */}
        <div className="col-span-12 lg:col-span-8">
          <TradingPage
            symbol={symbol}
            onSymbolChange={onSymbolChange}
            sharePnLConfig={config.tradingPage.sharePnLConfig}
          />
        </div>

        {/* Right Sidebar - Orderbook and Trades - 4 columns */}
        <div className="col-span-12 lg:col-span-4">
          <Flex direction="column" gap={4}>
            {/* 24h Stats */}
            <TradeStats symbol={symbol} />

            {/* Orderbook */}
            <OrderbookDisplay
              symbol={symbol}
              level={15}
              onPriceClick={handlePriceClick}
            />

            {/* Recent Trades */}
            <RecentTrades symbol={symbol} maxTrades={15} />
          </Flex>
        </div>
      </div>
    </BaseLayout>
  );
}

