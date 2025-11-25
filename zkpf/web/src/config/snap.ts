// MetaMask Snap origin configuration:
// - Production: Uses npm-published snap (npm:@zkpf/proof-of-funds-snap)
// - Development: Uses local snap server (local:http://localhost:8080)
// - Override: Set VITE_ZKPF_SNAP_ORIGIN env variable
//
// IMPORTANT: The `local:` protocol ONLY works with localhost addresses.
// MetaMask enforces this as a security restriction. For production,
// the snap must be published to npm.
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

  // Production: use npm-published snap
  // NOTE: The snap must be published to npm for this to work.
  // Until then, run locally with: VITE_ZKPF_SNAP_ORIGIN=local:http://localhost:8080
  return 'npm:@zkpf/proof-of-funds-snap';
};

export const defaultSnapOrigin = getDefaultSnapOrigin();
