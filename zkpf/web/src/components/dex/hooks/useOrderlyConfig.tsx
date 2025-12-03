import { useMemo } from "react";
import { type RestrictedInfoOptions } from "@orderly.network/hooks";
import { useTranslation } from "@orderly.network/i18n";
import { AppLogos } from "@orderly.network/react-app";
import { TradingPageProps } from "@orderly.network/trading";
import { FooterProps, MainNavWidgetProps } from "@orderly.network/ui-scaffold";
import { PathEnum } from "../constant";

export type OrderlyConfig = {
  orderlyAppProvider: {
    appIcons: AppLogos;
    restrictedInfo?: RestrictedInfoOptions;
  };
  scaffold: {
    mainNavProps: MainNavWidgetProps;
    footerProps: FooterProps;
  };
  tradingPage: {
    tradingViewConfig: TradingPageProps["tradingViewConfig"];
    sharePnLConfig: TradingPageProps["sharePnLConfig"];
    referral?: any;
  };
};

export const useOrderlyConfig = () => {
  const { t } = useTranslation();

  return useMemo<OrderlyConfig>(() => {
    return {
      scaffold: {
        mainNavProps: {
          mainMenus: [
            { name: "ZKPF", href: PathEnum.Root },
            { name: (t as any)("common.portfolio"), href: PathEnum.Portfolio },
            { name: (t as any)("common.markets"), href: PathEnum.Markets },
          ],
          initialMenu: PathEnum.Root,
        },
        footerProps: {
          telegramUrl: "https://orderly.network",
          discordUrl: "https://discord.com/invite/orderlynetwork",
          twitterUrl: "https://twitter.com/OrderlyNetwork",
        },
      },
      orderlyAppProvider: {
        appIcons: {
          main: {
            component: (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                }}
              >
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = "/";
                  }}
                  style={{
                    fontSize: 24,
                    fontWeight: "bold",
                    color: "inherit",
                    letterSpacing: "0.5px",
                    cursor: "pointer",
                  }}
                >
                  ZKPF
                </span>
                <span
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    window.location.href = "/p2p";
                  }}
                  style={{
                    fontSize: 14,
                    color: "inherit",
                    opacity: 0.7,
                    cursor: "pointer",
                    textDecoration: "none",
                  }}
                >
                  p2p
                </span>
              </div>
            ),
          },
          secondary: {
            img: "/images/orderly-logo-secondary.svg",
          },
        },
        restrictedInfo: {
          enableDefault: true,
          customRestrictedIps: [],
          customRestrictedRegions: [],
        },
      },
      tradingPage: {
        tradingViewConfig: {
          // scriptSRC: "/tradingview/charting_library/charting_library.js",
          // library_path: "/tradingview/charting_library/",
          // customCssUrl: "/tradingview/chart.css",
        },
        sharePnLConfig: {
          backgroundImages: [
            "/images/pnl/poster_bg_1.png",
            "/images/pnl/poster_bg_2.png",
            "/images/pnl/poster_bg_3.png",
            "/images/pnl/poster_bg_4.png",
          ],

          color: "rgba(255, 255, 255, 0.98)",
          profitColor: "rgba(41, 223, 169, 1)",
          lossColor: "rgba(245, 97, 139, 1)",
          brandColor: "rgba(255, 255, 255, 0.98)",

          // ref
          refLink: "https://orderly.network",
          refSlogan: "Orderly referral",
        },
      },
    } as any;
  }, [t]);
};

