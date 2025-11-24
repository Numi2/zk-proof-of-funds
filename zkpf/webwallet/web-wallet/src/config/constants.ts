// Direct lightwalletd URL (ChainSafe public proxy)
export const MAINNET_LIGHTWALLETD_DIRECT = 'https://zcash-mainnet.chainsafe.dev';

// Get the appropriate lightwalletd URL based on environment
export const getLightwalletdUrl = (): string => {
  // Check for explicit override
  const envUrl = typeof import.meta !== 'undefined' 
    ? (import.meta.env?.VITE_LIGHTWALLETD_URL as string | undefined)
    : undefined;
  if (envUrl) return envUrl;

  // In development, use proxy if available
  if (typeof window !== 'undefined' && 
      typeof import.meta !== 'undefined' && 
      import.meta.env?.DEV) {
    return `${window.location.origin}/lightwalletd`;
  }

  // Default: direct connection
  return MAINNET_LIGHTWALLETD_DIRECT;
};

// Legacy export for backward compatibility
export const MAINNET_LIGHTWALLETD_PROXY = MAINNET_LIGHTWALLETD_DIRECT;

export const ZATOSHI_PER_ZEC = 1e8;
export const RESCAN_INTERVAL = 35000;
export const NU5_ACTIVATION = 1687104;
