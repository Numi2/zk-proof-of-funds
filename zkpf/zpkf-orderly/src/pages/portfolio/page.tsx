import { OverviewModule } from "@orderly.network/portfolio";
import { Flex } from "@orderly.network/ui";
import { TradingOverviewCard } from "../../components/perp";

export default function PortfolioPage() {
  return (
    <Flex direction="column" gap={6} p={6}>
      {/* Enhanced Trading Overview with Perp SDK Calculations */}
      <TradingOverviewCard />
      
      {/* Original Orderly Portfolio Overview */}
      <OverviewModule.OverviewPage />
    </Flex>
  );
}
