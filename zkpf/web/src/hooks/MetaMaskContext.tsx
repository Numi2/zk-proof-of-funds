import type { MetaMaskInpageProvider } from '@metamask/providers';
import type { ReactNode } from 'react';
import { createContext, useContext, useEffect, useState } from 'react';
import type { Snap } from '../types/snap';
import { getSnapsProvider } from '../utils/metamask';

type MetaMaskContextType = {
  provider: MetaMaskInpageProvider | null;
  installedSnap: Snap | null;
  error: Error | null;
  setInstalledSnap: (snap: Snap | null) => void;
  setError: (error: Error | null) => void;
};

const MetaMaskContext = createContext<MetaMaskContextType>({
  provider: null,
  installedSnap: null,
  error: null,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setInstalledSnap: () => {},
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setError: () => {},
});

export function MetaMaskProvider({ children }: { children: ReactNode }) {
  const [provider, setProvider] = useState<MetaMaskInpageProvider | null>(null);
  const [installedSnap, setInstalledSnap] = useState<Snap | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    getSnapsProvider().then(setProvider).catch(console.error);
  }, []);

  useEffect(() => {
    if (!error) return;
    const timeout = setTimeout(() => {
      setError(null);
    }, 10_000);
    return () => clearTimeout(timeout);
  }, [error]);

  return (
    <MetaMaskContext.Provider
      value={{
        provider,
        installedSnap,
        error,
        setInstalledSnap,
        setError,
      }}
    >
      {children}
    </MetaMaskContext.Provider>
  );
}

export function useMetaMaskContext() {
  const ctx = useContext(MetaMaskContext);
  if (!ctx) {
    throw new Error('useMetaMaskContext must be used within MetaMaskProvider');
  }
  return ctx;
}


