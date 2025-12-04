import "@orderly.network/ui/dist/styles.css";
import "../../styles/orderly-fonts.css";
import "../../styles/orderly-theme.css";
import "../../styles/dex-theme.css";
import { useEffect, useLayoutEffect } from "react";

// Force mobile view by overriding matchMedia
// This must run before any component renders
const originalMatchMedia = window.matchMedia.bind(window);
(window as any).matchMedia = (query: string) => {
  // Force mobile breakpoint queries to return true
  if (query === '(max-width: 768px)' || query === '(max-width: 767px)') {
    return {
      matches: true,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
  }
  // Force desktop breakpoint queries to return false
  if (query === '(min-width: 769px)' || query === '(min-width: 768px)') {
    return {
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => true,
    };
  }
  return originalMatchMedia(query);
};
import {
  Navigate,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  getLocalePathFromPathname,
  i18n,
  parseI18nLang,
} from "@orderly.network/i18n";
import { PortfolioLayout, TradingRewardsLayout } from "./layout";
import { OrderlyProvider } from "./OrderlyProvider";
import { NetworkProvider } from "./context/NetworkContext";
import { DexThemeProvider } from "./context/DexThemeContext";
import { ZKPFCreditProvider } from "./context/ZKPFCreditContext";
import { NearProvider } from "./context/NearContext";
import { PathEnum } from "./constant";
import LeaderboardPage from "./pages/LeaderboardPage";
import MarketsPage from "./pages/MarketsPage";
import PerpPage from "./pages/PerpPage";
import LoginPage from "./pages/LoginPage";
import APIKeyPage from "./pages/portfolio/ApiKeyPage";
import AssetsPage from "./pages/portfolio/AssetsPage";
import FeeTierPage from "./pages/portfolio/FeeTierPage";
import HistoryPage from "./pages/portfolio/HistoryPage";
import OrdersPage from "./pages/portfolio/OrdersPage";
import PortfolioPage from "./pages/portfolio/PortfolioPage";
import PositionsPage from "./pages/portfolio/PositionsPage";
import SettingsPage from "./pages/portfolio/SettingsPage";
import AnalyticsPage from "./pages/portfolio/AnalyticsPage";
import NearAssetsPage from "./pages/portfolio/NearAssetsPage";
import AffiliatePage from "./pages/rewards/AffiliatePage";
import TradingRewardsPage from "./pages/rewards/TradingRewardsPage";
import { getSymbol } from "./storage";

const DexAppRoutes = () => {
  const location = useLocation();
  
  // Hide TradingView license message component
  useEffect(() => {
    const hideTradingViewMessage = () => {
      const checkAndHide = () => {
        // Find all elements that might contain the TradingView license message
        const allElements = document.querySelectorAll('div');
        allElements.forEach((el) => {
          const text = el.textContent || '';
          if (text.includes('TradingView') || text.includes('tradingview')) {
            // Check if it has the oui classes
            if (
              el.classList.contains('oui-absolute') &&
              el.classList.contains('oui-inset-0')
            ) {
              el.style.display = 'none';
              el.style.visibility = 'hidden';
              el.style.opacity = '0';
              el.style.height = '0';
              el.style.overflow = 'hidden';
              el.style.pointerEvents = 'none';
            }
          }
        });
      };

      // Run immediately
      checkAndHide();

      // Also run after delays to catch dynamically rendered content
      setTimeout(checkAndHide, 1000);
      setTimeout(checkAndHide, 3000);
      setTimeout(checkAndHide, 5000);

      // Use MutationObserver to catch dynamically added content
      const observer = new MutationObserver(checkAndHide);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      return () => observer.disconnect();
    };

    const cleanup = hideTradingViewMessage();
    return cleanup;
  }, []);

  // Hide chart tab and set default to orderbook/trades for orderflow trading
  useEffect(() => {
    const hideChartAndSetDefaultTab = () => {
      const checkAndHide = () => {
        // Find chart tab button by text content
        const allButtons = document.querySelectorAll('button[role="tab"]');
        allButtons.forEach((btn) => {
          const text = btn.textContent || '';
          if (text.trim() === 'Chart' || text.includes('Chart')) {
            // Hide the chart tab button
            (btn as HTMLElement).style.display = 'none';
            (btn as HTMLElement).style.visibility = 'hidden';
            (btn as HTMLElement).style.opacity = '0';
            (btn as HTMLElement).style.height = '0';
            (btn as HTMLElement).style.overflow = 'hidden';
            (btn as HTMLElement).style.pointerEvents = 'none';
            (btn as HTMLElement).style.width = '0';
            (btn as HTMLElement).style.padding = '0';
            (btn as HTMLElement).style.margin = '0';
          }
        });

        // Find chart content panel by aria-controls or data attributes
        const chartTabs = document.querySelectorAll('[aria-controls*="chart"], [id*="chart"]');
        chartTabs.forEach((tab) => {
          const text = tab.textContent || '';
          if (text.includes('Chart') || tab.getAttribute('aria-controls')?.includes('chart')) {
            // Check if it's the tab trigger
            if (tab.getAttribute('role') === 'tab' && tab.getAttribute('data-state') === 'active') {
              // Click on orderbook or trades tab instead
              const orderbookTab = Array.from(document.querySelectorAll('button[role="tab"]')).find(
                (btn) => {
                  const btnText = btn.textContent || '';
                  return (btnText.includes('Orderbook') || btnText.includes('Order Book')) && 
                         btn !== tab;
                }
              ) as HTMLElement;
              
              if (orderbookTab) {
                orderbookTab.click();
              } else {
                // Try trades tab
                const tradesTab = Array.from(document.querySelectorAll('button[role="tab"]')).find(
                  (btn) => {
                    const btnText = btn.textContent || '';
                    return (btnText.includes('Trades') || btnText.includes('Trade')) && 
                           btn !== tab;
                  }
                ) as HTMLElement;
                
                if (tradesTab) {
                  tradesTab.click();
                }
              }
            }
          }
        });

        // Hide chart content panel
        const chartPanels = document.querySelectorAll('[id*="chart"][role="tabpanel"], [aria-labelledby*="chart"]');
        chartPanels.forEach((panel) => {
          (panel as HTMLElement).style.display = 'none';
          (panel as HTMLElement).style.visibility = 'hidden';
          (panel as HTMLElement).style.opacity = '0';
          (panel as HTMLElement).style.height = '0';
          (panel as HTMLElement).style.overflow = 'hidden';
          (panel as HTMLElement).style.pointerEvents = 'none';
        });

        // Hide chart component itself (ForwardRef with chartRef)
        const allDivs = document.querySelectorAll('div');
        allDivs.forEach((div) => {
          // Check if it contains chart-related content
          const hasChartRef = div.querySelector('[class*="chart"], [id*="chart"]');
          const parent = div.parentElement;
          if (parent && parent.getAttribute('chartRef')) {
            (div as HTMLElement).style.display = 'none';
            (div as HTMLElement).style.visibility = 'hidden';
            (div as HTMLElement).style.opacity = '0';
            (div as HTMLElement).style.height = '0';
            (div as HTMLElement).style.overflow = 'hidden';
            (div as HTMLElement).style.pointerEvents = 'none';
          }
        });
      };

      // Run immediately
      checkAndHide();

      // Also run after delays to catch dynamically rendered content
      setTimeout(checkAndHide, 100);
      setTimeout(checkAndHide, 500);
      setTimeout(checkAndHide, 1000);
      setTimeout(checkAndHide, 2000);
      setTimeout(checkAndHide, 3000);

      // Use MutationObserver to catch dynamically added content
      const observer = new MutationObserver(checkAndHide);
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-state', 'aria-selected', 'aria-controls'],
      });

      return () => observer.disconnect();
    };

    const cleanup = hideChartAndSetDefaultTab();
    return cleanup;
  }, []);

  useEffect(() => {
    let currentLocale = parseI18nLang(i18n?.language);
    const pathname = location.pathname;
    // Remove /dex prefix before checking locale
    const pathWithoutDex = pathname.replace(/^\/dex/, '');
    let localePath = getLocalePathFromPathname(pathWithoutDex);

    if (localePath && localePath !== currentLocale) {
      currentLocale = localePath;
      i18n.changeLanguage(localePath);
    } else if (currentLocale !== i18n?.language) {
      i18n.changeLanguage(currentLocale);
    }
  }, [location.pathname]);

  return (
    <DexThemeProvider>
      <ZKPFCreditProvider>
        <NetworkProvider>
          <NearProvider defaultNetwork="testnet">
            <Routes>
        <Route element={<OrderlyProvider />}>
        <Route
          index
          element={
            <Navigate
              to={`/dex/en/perp/${getSymbol()}${location.search}`}
              replace
            />
          }
        />
        <Route path=":lang">
          <Route
            index
            element={
              <Navigate
                to={`perp/${getSymbol()}${location.search}`}
                replace
              />
            }
          />
          <Route path="perp">
            <Route
              index
              element={
                <Navigate
                  to={`${getSymbol()}${location.search}`}
                  replace
                />
              }
            />
            <Route path=":symbol" element={<PerpPage />} />
          </Route>
          <Route path="portfolio" element={<PortfolioLayout />}>
            <Route index element={<PortfolioPage />} />
            <Route path="positions" element={<PositionsPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="assets" element={<AssetsPage />} />
            <Route path="near" element={<NearAssetsPage />} />
            <Route path="fee" element={<FeeTierPage />} />
            <Route path="api-key" element={<APIKeyPage />} />
            <Route path="setting" element={<SettingsPage />} />
            <Route path="history" element={<HistoryPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
          </Route>
          <Route path="login" element={<LoginPage />} />
          <Route path="markets" element={<MarketsPage />} />
          <Route path="leaderboard" element={<LeaderboardPage />} />
          <Route path="rewards" element={<TradingRewardsLayout />}>
            <Route
              index
              element={
                <Navigate to={`affiliate${location.search}`} replace />
              }
            />
            <Route path="trading" element={<TradingRewardsPage />} />
            <Route path="affiliate" element={<AffiliatePage />} />
          </Route>
        </Route>
        {/* Routes without locale prefix for direct access */}
        <Route path="perp">
          <Route
            index
            element={
              <Navigate
                to={`${getSymbol()}${location.search}`}
                replace
              />
            }
          />
          <Route path=":symbol" element={<PerpPage />} />
        </Route>
        <Route path="portfolio" element={<PortfolioLayout />}>
          <Route index element={<PortfolioPage />} />
          <Route path="positions" element={<PositionsPage />} />
          <Route path="orders" element={<OrdersPage />} />
          <Route path="assets" element={<AssetsPage />} />
          <Route path="near" element={<NearAssetsPage />} />
          <Route path="fee" element={<FeeTierPage />} />
          <Route path="api-key" element={<APIKeyPage />} />
          <Route path="setting" element={<SettingsPage />} />
          <Route path="history" element={<HistoryPage />} />
          <Route path="analytics" element={<AnalyticsPage />} />
        </Route>
        <Route path="markets" element={<MarketsPage />} />
        <Route path="leaderboard" element={<LeaderboardPage />} />
        <Route path="rewards" element={<TradingRewardsLayout />}>
          <Route
            index
            element={<Navigate to={`affiliate${location.search}`} replace />}
          />
          <Route path="trading" element={<TradingRewardsPage />} />
          <Route path="affiliate" element={<AffiliatePage />} />
        </Route>
      </Route>
    </Routes>
          </NearProvider>
        </NetworkProvider>
      </ZKPFCreditProvider>
    </DexThemeProvider>
  );
};

export function DexApp() {
  return <DexAppRoutes />;
}
