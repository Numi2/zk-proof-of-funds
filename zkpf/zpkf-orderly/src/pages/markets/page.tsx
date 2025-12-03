import { MarketsHomePage } from "@orderly.network/markets";
import { BaseLayout } from "../../components/layout";
import { PathEnum } from "../../constant";
import "./markets.css";

export default function MarketsPage() {
  return (
    <BaseLayout initialMenu={PathEnum.Markets}>
      <div className="markets-page-container">
        <MarketsHomePage className="markets-home-page" />
      </div>
    </BaseLayout>
  );
}
