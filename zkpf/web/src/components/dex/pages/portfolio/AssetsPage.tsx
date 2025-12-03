import { AssetsModule } from "@orderly.network/portfolio";
import { UsdcFaucet } from "../../components/faucet";
import "./AssetsPage.css";

export default function AssetsPage() {
  return (
    <div className="assets-page-container">
      {/* USDC Faucet - Only visible on testnet */}
      <UsdcFaucet />
      
      {/* Orderly Assets Module */}
      <AssetsModule.AssetsPage />
    </div>
  );
}

