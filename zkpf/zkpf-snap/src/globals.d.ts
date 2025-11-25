/**
 * Global type declarations for MetaMask Snap environment
 */

/**
 * Ethereum provider injected by MetaMask
 */
declare const ethereum: {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

/**
 * Snap global object for snap-specific APIs
 */
declare const snap: {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
};

