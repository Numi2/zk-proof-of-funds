export const DEFAULT_SYMBOL = "PERP_ETH_USDC";
export const ORDERLY_SYMBOL_KEY = "orderly-current-symbol";
export const ORDERLY_NETWORK_KEY = "orderly-network";

export type OrderlyNetwork = "testnet" | "mainnet";

export function getSymbol() {
  return localStorage.getItem(ORDERLY_SYMBOL_KEY) || DEFAULT_SYMBOL;
}

export function updateSymbol(symbol: string) {
  localStorage.setItem(ORDERLY_SYMBOL_KEY, symbol || DEFAULT_SYMBOL);
}

export function getNetwork(): OrderlyNetwork {
  const stored = localStorage.getItem(ORDERLY_NETWORK_KEY);
  return (stored === "mainnet" || stored === "testnet") ? stored : "testnet";
}

export function setNetwork(network: OrderlyNetwork) {
  localStorage.setItem(ORDERLY_NETWORK_KEY, network);
}
