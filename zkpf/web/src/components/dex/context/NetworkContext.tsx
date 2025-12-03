import { createContext, useContext, useState, useEffect, ReactNode } from "react";
import { getNetwork, setNetwork, type OrderlyNetwork } from "../storage";

interface NetworkContextType {
  network: OrderlyNetwork;
  setNetwork: (network: OrderlyNetwork) => void;
  isMainnet: boolean;
  isTestnet: boolean;
}

const NetworkContext = createContext<NetworkContextType | undefined>(undefined);

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetworkState] = useState<OrderlyNetwork>(() => getNetwork());

  const handleSetNetwork = (newNetwork: OrderlyNetwork) => {
    setNetworkState(newNetwork);
    setNetwork(newNetwork);
    // Reload the page to reinitialize Orderly with new network
    window.location.reload();
  };

  return (
    <NetworkContext.Provider
      value={{
        network,
        setNetwork: handleSetNetwork,
        isMainnet: network === "mainnet",
        isTestnet: network === "testnet",
      }}
    >
      {children}
    </NetworkContext.Provider>
  );
}

export function useNetwork() {
  const context = useContext(NetworkContext);
  if (context === undefined) {
    throw new Error("useNetwork must be used within a NetworkProvider");
  }
  return context;
}

