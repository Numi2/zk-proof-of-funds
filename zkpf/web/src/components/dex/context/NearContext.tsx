/**
 * NEAR Context Provider
 * 
 * Manages NEAR wallet connection state and provides access to the
 * NearOrderlyService throughout the DEX application.
 */

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import {
  NearOrderlyService,
  getNearOrderlyService,
  resetNearOrderlyService,
  type NetworkId,
  type TokenBalance,
  type StorageBalance,
} from '../../../services/near-orderly';
import type { AccountBalance } from 'near-api-js/lib/account';

export interface NearContextValue {
  // Connection state
  isConnected: boolean;
  isInitializing: boolean;
  accountId: string | null;
  
  // Service instance
  service: NearOrderlyService | null;
  
  // Account data
  nearBalance: AccountBalance | null;
  tokenBalances: Record<string, TokenBalance>;
  storageBalance: StorageBalance | null;
  
  // Network
  networkId: NetworkId;
  
  // Actions
  connect: (walletId?: string) => Promise<void>;
  disconnect: () => void;
  switchNetwork: (network: NetworkId) => Promise<void>;
  refreshBalances: () => Promise<void>;
  refreshStorageBalance: () => Promise<void>;
  
  // NEAR Connect features
  getAvailableWallets: () => Array<{ id: string; name: string; icon?: string; iconUrl?: string }>;
  
  // Error state
  error: string | null;
  clearError: () => void;
}

export const NearContext = createContext<NearContextValue | null>(null);

export interface NearProviderProps {
  children: React.ReactNode;
  defaultNetwork?: NetworkId;
}

export const NearProvider: React.FC<NearProviderProps> = ({
  children,
  defaultNetwork = 'testnet',
}) => {
  const [service, setService] = useState<NearOrderlyService | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isInitializing, setIsInitializing] = useState(true);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [networkId, setNetworkId] = useState<NetworkId>(defaultNetwork);
  const [nearBalance, setNearBalance] = useState<AccountBalance | null>(null);
  const [tokenBalances, setTokenBalances] = useState<Record<string, TokenBalance>>({});
  const [storageBalance, setStorageBalance] = useState<StorageBalance | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Initialize NEAR service
  const initializeService = useCallback(async (network: NetworkId) => {
    try {
      setIsInitializing(true);
      setError(null);
      
      const nearService = await getNearOrderlyService(network);
      setService(nearService);
      
      // Set up event listeners for NEAR Connect
      const connector = nearService.getConnector();
      if (connector) {
        // Listen for sign in events
        connector.on('wallet:signIn', async () => {
          const connected = nearService.isConnected();
          setIsConnected(connected);
          
          if (connected) {
            const accId = nearService.getAccountId();
            setAccountId(accId);
            
            // Load initial balances
            await refreshBalances(nearService);
            await refreshStorageBalance(nearService);
          }
        });
        
        // Listen for sign out events
        connector.on('wallet:signOut', () => {
          setIsConnected(false);
          setAccountId(null);
          setNearBalance(null);
          setTokenBalances({});
          setStorageBalance(null);
        });
      }
      
      const connected = nearService.isConnected();
      setIsConnected(connected);
      
      if (connected) {
        const accId = nearService.getAccountId();
        setAccountId(accId);
        
        // Load initial balances
        await refreshBalances(nearService);
        await refreshStorageBalance(nearService);
      }
    } catch (err) {
      console.error('Failed to initialize NEAR service:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize NEAR');
    } finally {
      setIsInitializing(false);
    }
  }, []);

  // Initialize on mount
  useEffect(() => {
    initializeService(networkId);
  }, [initializeService, networkId]);

  // Refresh balances
  const refreshBalances = useCallback(async (svc?: NearOrderlyService) => {
    const activeService = svc || service;
    if (!activeService || !activeService.isConnected()) return;

    try {
      const [balance, tokens] = await Promise.all([
        activeService.getAccountBalance(),
        activeService.getUserTokenBalances().catch(() => ({})),
      ]);
      
      setNearBalance(balance);
      setTokenBalances(tokens);
    } catch (err) {
      console.error('Failed to refresh balances:', err);
    }
  }, [service]);

  // Refresh storage balance
  const refreshStorageBalance = useCallback(async (svc?: NearOrderlyService) => {
    const activeService = svc || service;
    if (!activeService || !activeService.isConnected()) return;

    try {
      const storage = await activeService.getStorageBalance();
      setStorageBalance(storage);
    } catch (err) {
      console.error('Failed to refresh storage balance:', err);
    }
  }, [service]);

  // Connect wallet (optionally with specific wallet ID)
  const connect = useCallback(async (walletId?: string) => {
    if (!service) {
      setError('NEAR service not initialized');
      return;
    }

    try {
      setError(null);
      setIsInitializing(true);
      
      await service.requestSignIn(walletId);
      
      // Update connection state after sign in
      const connected = service.isConnected();
      setIsConnected(connected);
      
      if (connected) {
        const accId = service.getAccountId();
        setAccountId(accId);
        
        // Load initial balances
        await refreshBalances(service);
        await refreshStorageBalance(service);
      }
    } catch (err) {
      console.error('Failed to connect wallet:', err);
      setError(err instanceof Error ? err.message : 'Failed to connect wallet');
    } finally {
      setIsInitializing(false);
    }
  }, [service, refreshBalances, refreshStorageBalance]);
  
  // Get available wallets from NEAR Connect
  const getAvailableWallets = useCallback(() => {
    if (!service) {
      return [];
    }
    
    const connector = service.getConnector();
    if (!connector) {
      return [];
    }
    
    try {
      const wallets = connector.availableWallets || [];
      return wallets.map((w: any) => ({
        id: w.manifest?.id || w.id,
        name: w.manifest?.name || w.name,
        icon: w.manifest?.icon || w.icon,
        iconUrl: w.manifest?.iconUrl || w.iconUrl,
      }));
    } catch (err) {
      console.error('Failed to get available wallets:', err);
      return [];
    }
  }, [service]);

  // Disconnect wallet
  const disconnect = useCallback(() => {
    if (!service) return;

    try {
      service.signOut();
      setIsConnected(false);
      setAccountId(null);
      setNearBalance(null);
      setTokenBalances({});
      setStorageBalance(null);
    } catch (err) {
      console.error('Failed to disconnect wallet:', err);
      setError(err instanceof Error ? err.message : 'Failed to disconnect wallet');
    }
  }, [service]);

  // Switch network
  const switchNetwork = useCallback(async (network: NetworkId) => {
    try {
      setError(null);
      
      // Sign out if connected
      if (service?.isConnected()) {
        service.signOut();
      }
      
      // Reset service and reinitialize with new network
      resetNearOrderlyService();
      setNetworkId(network);
      
      await initializeService(network);
    } catch (err) {
      console.error('Failed to switch network:', err);
      setError(err instanceof Error ? err.message : 'Failed to switch network');
    }
  }, [service, initializeService]);

  // Clear error
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Auto-refresh balances when connected
  useEffect(() => {
    if (!isConnected || !service) return;

    const interval = setInterval(() => {
      refreshBalances();
    }, 30000); // Refresh every 30 seconds

    return () => clearInterval(interval);
  }, [isConnected, service, refreshBalances]);

  const value: NearContextValue = {
    isConnected,
    isInitializing,
    accountId,
    service,
    nearBalance,
    tokenBalances,
    storageBalance,
    networkId,
    connect,
    disconnect,
    switchNetwork,
    refreshBalances: () => refreshBalances(),
    refreshStorageBalance: () => refreshStorageBalance(),
    getAvailableWallets,
    error,
    clearError,
  };

  return <NearContext.Provider value={value}>{children}</NearContext.Provider>;
};

/**
 * Hook to access NEAR context
 */
export function useNear(): NearContextValue {
  const context = useContext(NearContext);
  if (!context) {
    throw new Error('useNear must be used within NearProvider');
  }
  return context;
}

