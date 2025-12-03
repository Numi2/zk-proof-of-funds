import { AssetsModule } from "@orderly.network/portfolio";
import { Flex } from "@orderly.network/ui";
import { AccountMetricsCard } from "../../../components/perp";

export default function AssetsPage() {
  return (
    <Flex direction="column" gap={6} p={6}>
      {/* Account Metrics with Perp SDK Calculations */}
      <AccountMetricsCard />
      
      {/* Assets Table */}
      <AssetsModule.AssetsPage />
    </Flex>
  );
}
