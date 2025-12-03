import { Outlet } from "react-router-dom";
import { TradingRewardsLayoutWidget } from "@orderly.network/trading-rewards";
import { PathEnum } from "../constant";
import { useNav } from "../hooks/useNav";
import { useOrderlyConfig } from "../hooks/useOrderlyConfig";
import { usePathWithoutLang } from "../hooks/usePathWithoutLang";
import { NetworkToggle } from "../NetworkToggle";

export const TradingRewardsLayout = () => {
  const config = useOrderlyConfig();
  const path = usePathWithoutLang();

  const { onRouteChange } = useNav();

  return (
    <div style={{ position: "relative" }}>
      <div
        style={{
          position: "absolute",
          top: "1rem",
          right: "1rem",
          zIndex: 1000,
        }}
      >
        <NetworkToggle />
      </div>
      <TradingRewardsLayoutWidget
        footerProps={config.scaffold.footerProps}
        mainNavProps={{
          ...config.scaffold.mainNavProps,
          initialMenu: PathEnum.Rewards,
        }}
        routerAdapter={{
          onRouteChange,
        }}
        leftSideProps={{
          current: path,
        }}
      >
        <Outlet />
      </TradingRewardsLayoutWidget>
    </div>
  );
};

