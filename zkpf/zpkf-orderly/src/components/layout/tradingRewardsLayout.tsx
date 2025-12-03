import { Outlet } from "react-router";
import { TradingRewardsLayoutWidget } from "@orderly.network/trading-rewards";
import { PathEnum } from "../../constant";
import { useNav } from "../../hooks/useNav";
import { useOrderlyConfig } from "../../hooks/useOrderlyConfig";
import { usePathWithoutLang } from "../../hooks/usePathWithoutLang";

export const TradingRewardsLayout = () => {
  const config = useOrderlyConfig();
  const path = usePathWithoutLang();

  const { onRouteChange } = useNav();

  return (
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
  );
};
