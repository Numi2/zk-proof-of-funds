import { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { PositionsModule } from "@orderly.network/portfolio";
import { useTradingLocalStorage } from "@orderly.network/trading";
import { API } from "@orderly.network/types";
import { Box, Flex } from "@orderly.network/ui";
import { PathEnum } from "../../../constant";
import { useOrderlyConfig } from "../../../hooks/useOrderlyConfig";
import { updateSymbol } from "../../../storage";
import { generateLocalePath } from "../../../utils";
import { AccountMetricsCard } from "../../../components/perp";

// CSS to hide "Risk rate" - injected once globally
const RISK_RATE_HIDE_STYLE_ID = 'hide-risk-rate-style';

export default function PositionsPage() {
  const navigate = useNavigate();
  const local = useTradingLocalStorage();
  const config = useOrderlyConfig();
  const containerRef = useRef<HTMLDivElement>(null);

  const onSymbolChange = useCallback(
    (data: API.Symbol) => {
      const symbol = data.symbol;
      updateSymbol(symbol);
      navigate(generateLocalePath(`${PathEnum.Perp}/${symbol}`));
    },
    [navigate],
  );

  // Hide the "Risk rate" component - optimized approach
  useEffect(() => {
    // Inject CSS once to add data attribute styling
    if (!document.getElementById(RISK_RATE_HIDE_STYLE_ID)) {
      const style = document.createElement('style');
      style.id = RISK_RATE_HIDE_STYLE_ID;
      style.textContent = `[data-hide-risk-rate="true"] { display: none !important; }`;
      document.head.appendChild(style);
    }

    // Target specific element: oui-box with p-3, rounded-2xl, bg-base-9, relative
    const selector = '.oui-box.oui-p-3.oui-rounded-2xl.oui-bg-base-9.oui-relative';
    
    const hideRiskRate = () => {
      const container = containerRef.current;
      if (!container) return;
      
      const elements = container.querySelectorAll(selector);
      elements.forEach((el) => {
        if (el.textContent?.includes('Risk rate')) {
          el.setAttribute('data-hide-risk-rate', 'true');
        }
      });
    };

    // Run after a short delay to let SDK render
    const timeout = setTimeout(hideRiskRate, 100);
    
    // Observe only the container, not the whole document
    const observer = new MutationObserver((mutations) => {
      // Only process if new nodes were added
      const hasNewNodes = mutations.some(m => m.addedNodes.length > 0);
      if (hasNewNodes) {
        requestAnimationFrame(hideRiskRate);
      }
    });

    const container = containerRef.current;
    if (container) {
      observer.observe(container, { childList: true, subtree: true });
    }

    return () => {
      clearTimeout(timeout);
      observer.disconnect();
    };
  }, []);

  return (
    <Flex direction="column" gap={6} p={6}>
      {/* Account Metrics with Perp SDK Calculations */}
      <AccountMetricsCard />
      
      {/* Positions Table */}
      <Box
        ref={containerRef}
        p={6}
        pb={0}
        intensity={900}
        r="xl"
        width="100%"
        style={{
          minHeight: 379,
          maxHeight: 2560,
          overflow: "hidden",
          // Make the table scroll instead of the page scroll
          height: "calc(100vh - 48px - 29px - 48px - 200px)",
        }}
      >
        <PositionsModule.PositionsPage
          sharePnLConfig={config.tradingPage.sharePnLConfig}
          pnlNotionalDecimalPrecision={local.pnlNotionalDecimalPrecision}
          calcMode={local.unPnlPriceBasis}
          onSymbolChange={onSymbolChange}
        />
      </Box>
    </Flex>
  );
}
