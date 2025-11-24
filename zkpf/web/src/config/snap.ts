// MetaMask Snap origin configuration:
// - Production: Uses the published npm package (npm:@chainsafe/webzjs-zcash-snap)
// - Development: Uses local snap server (local:http://localhost:8080)
// - Override: Set VITE_ZKPF_SNAP_ORIGIN env variable
const getDefaultSnapOrigin = (): string => {
  // Allow explicit override via environment variable
  const envOrigin = import.meta.env.VITE_ZKPF_SNAP_ORIGIN;
  if (envOrigin) {
    return envOrigin;
  }

  // In development mode, use local snap server
  if (import.meta.env.DEV) {
    return 'local:http://localhost:8080';
  }

  // Production: use published npm snap
  return 'npm:@chainsafe/webzjs-zcash-snap';
};

export const defaultSnapOrigin = getDefaultSnapOrigin();
