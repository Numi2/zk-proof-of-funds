import { useMemo } from "react";
import { type RestrictedInfoOptions } from "@orderly.network/hooks";
import { useTranslation } from "@orderly.network/i18n";
import { AppLogos } from "@orderly.network/react-app";
import { TradingPageProps } from "@orderly.network/trading";
import { FooterProps, MainNavWidgetProps } from "@orderly.network/ui-scaffold";
import { OrderlyActiveIcon, OrderlyIcon } from "../components/icons/orderly";
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
            { name: t("common.trading"), href: PathEnum.Root },
            { name: t("common.portfolio"), href: PathEnum.Portfolio },
            { name: t("common.markets"), href: PathEnum.Markets },
            {
              name: t("tradingLeaderboard.leaderboard"),
              href: PathEnum.Leaderboard,
            },
            {
              name: t("tradingRewards.rewards"),
              href: PathEnum.Rewards,
              children: [
                {
                  name: t("common.tradingRewards"),
                  href: PathEnum.RewardsTrading,
                  description: t("extend.tradingRewards.description"),
                },
                {
                  name: t("common.affiliate"),
                  href: PathEnum.RewardsAffiliate,
                  tag: t("extend.affiliate.tag"),
                  description: t("extend.affiliate.description"),
                },
                {
                  name: t("extend.staking"),
                  href: "https://app.orderly.network/staking",
                  description: t("extend.staking.description"),
                  target: "_blank",
                  icon: <OrderlyIcon size={14} />,
                  activeIcon: <OrderlyActiveIcon size={14} />,
                },
              ],
            },
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
              <span
                style={{
                  fontSize: 24,
                  fontWeight: "bold",
                  color: "inherit",
                  letterSpacing: "0.5px",
                }}
              >
                ZKPF
              </span>
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
    };
  }, [t]);
};
