import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { TradingPageProps } from "@orderly.network/trading";
import { API } from "@orderly.network/types";
import { BaseLayout } from "../../components/layout";
import { PathEnum } from "../../constant";
import { useOrderlyConfig } from "../../hooks/useOrderlyConfig";
import { updateSymbol } from "../../storage";
import { generateLocalePath } from "../../utils";
import { EnhancedTradingPage } from "../../components/perp";

export type PerpViewProps = Pick<TradingPageProps, "symbol">;

export default function PerpPage() {
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

  return (
    <BaseLayout>
      <EnhancedTradingPage
        symbol={symbol}
        onSymbolChange={onSymbolChange}
        sharePnLConfig={config.tradingPage.sharePnLConfig}
        showPositionMetrics={true}
        showMaxQty={true}
        showRiskIndicator={true}
      />
    </BaseLayout>
  );
}
