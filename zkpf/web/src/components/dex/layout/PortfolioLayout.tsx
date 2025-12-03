import { useMemo } from "react";
import { Outlet } from "react-router-dom";
import {
  PortfolioLayoutWidget,
  PortfolioLeftSidebarPath,
} from "@orderly.network/portfolio";
import { PathEnum } from "../constant";
import { useNav } from "../hooks/useNav";
import { useOrderlyConfig } from "../hooks/useOrderlyConfig";
import { usePathWithoutLang } from "../hooks/usePathWithoutLang";
import { NetworkToggle } from "../NetworkToggle";

export const PortfolioLayout = () => {
  const config = useOrderlyConfig();
  const path = usePathWithoutLang();

  const { onRouteChange } = useNav();

  const currentPath = useMemo(() => {
    if (path.endsWith(PathEnum.FeeTier))
      return PortfolioLeftSidebarPath.FeeTier;

    if (path.endsWith(PathEnum.ApiKey)) return PortfolioLeftSidebarPath.ApiKey;

    return path;
  }, [path]);

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
      <PortfolioLayoutWidget
        footerProps={config.scaffold.footerProps}
        mainNavProps={{
          ...config.scaffold.mainNavProps,
          initialMenu: PathEnum.Portfolio,
        }}
        routerAdapter={{
          onRouteChange,
        }}
        leftSideProps={{
          current: currentPath,
        }}
      >
        {/* because the portfolio layout is used in route layout, we need to render the outlet */}
        <Outlet />
      </PortfolioLayoutWidget>
    </div>
  );
};

