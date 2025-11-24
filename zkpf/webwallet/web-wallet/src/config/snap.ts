// MetaMask Snap origin configuration:
// - Production: Uses the published npm package (npm:@chainsafe/webzjs-zcash-snap)
// - Development: Uses local snap server (local:http://localhost:8080)
// - Override: Set SNAP_ORIGIN env variable
const getDefaultSnapOrigin = (): string => {
  // Allow explicit override via environment variable
  if (process.env.SNAP_ORIGIN) {
    return process.env.SNAP_ORIGIN;
  }

  // In development mode, use local snap server
  if (process.env.NODE_ENV === 'development') {
    return 'local:http://localhost:8080';
  }

  // Production: use published npm snap
  return 'npm:@chainsafe/webzjs-zcash-snap';
};

export const defaultSnapOrigin = getDefaultSnapOrigin();
