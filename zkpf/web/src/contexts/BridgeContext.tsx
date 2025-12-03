/**
 * BridgeContext - Global state management for Omni Bridge
 * 
 * Manages wallet connections across multiple chains, balances,
 * active transfers, and bridge configuration.
 */

import React, { createContext, useContext, useReducer, useCallback, useEffect, type ReactNode } from 'react';
import { omniBridgeApi, type ChainInfo, type TokenInfo, type TransferStatus as ApiTransferStatus } from '../services/omni-bridge-api';

// ============================================================================
// Types
// ============================================================================

export type ChainId = 'near' | 'ethereum' | 'arbitrum' | 'base' | 'solana';
export type WalletType = 'metamask' | 'near-wallet' | 'phantom' | 'wallet-connect';

export interface WalletConnection {
  chainId: ChainId;
  address: string;
  walletType: WalletType;
  isConnected: boolean;
}

export interface TokenBalance {
  symbol: string;
  balance: string;
  balanceUsd?: string;
  chainId: ChainId;
}

export interface TransferProgress {
  transferId: string;
  status: 'pending' | 'sourceSubmitted' | 'sourceConfirmed' | 'waitingFinality' | 'proofGenerated' | 'destinationSubmitted' | 'completed' | 'failed';
  sourceChain: ChainId;
  destinationChain: ChainId;
  amount: string;
  token: string;
  sourceTxHash?: string;
  destinationTxHash?: string;
  estimatedCompletion?: number;
  error?: string;
  createdAt: number;
}

export interface BridgeState {
  // Configuration
  supportedChains: ChainInfo[];
  supportedTokens: TokenInfo[];
  isConfigLoaded: boolean;
  
  // Wallet connections
  connections: Map<ChainId, WalletConnection>;
  balances: Map<string, TokenBalance>; // key: `${chainId}:${symbol}`
  
  // Transfer state
  activeTransfers: TransferProgress[];
  transferHistory: TransferProgress[];
  
  // UI state
  isLoading: boolean;
  error: string | null;
  
  // Network
  network: 'mainnet' | 'testnet';
}

type BridgeAction =
  | { type: 'SET_CONFIG'; chains: ChainInfo[]; tokens: TokenInfo[] }
  | { type: 'SET_CONNECTION'; chainId: ChainId; connection: WalletConnection | null }
  | { type: 'SET_BALANCE'; chainId: ChainId; symbol: string; balance: TokenBalance }
  | { type: 'SET_BALANCES'; balances: TokenBalance[] }
  | { type: 'ADD_TRANSFER'; transfer: TransferProgress }
  | { type: 'UPDATE_TRANSFER'; transferId: string; updates: Partial<TransferProgress> }
  | { type: 'SET_TRANSFER_HISTORY'; transfers: TransferProgress[] }
  | { type: 'SET_LOADING'; isLoading: boolean }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_NETWORK'; network: 'mainnet' | 'testnet' }
  | { type: 'DISCONNECT_ALL' };

interface BridgeContextValue {
  state: BridgeState;
  
  // Connection actions
  connectWallet: (chainId: ChainId, walletType?: WalletType) => Promise<void>;
  disconnectWallet: (chainId: ChainId) => void;
  disconnectAll: () => void;
  
  // Balance actions
  refreshBalances: (chainId?: ChainId) => Promise<void>;
  getBalance: (chainId: ChainId, symbol: string) => TokenBalance | undefined;
  
  // Transfer actions
  initiateTransfer: (params: InitiateTransferParams) => Promise<string>;
  cancelTransfer: (transferId: string) => Promise<void>;
  refreshTransferStatus: (transferId: string) => Promise<void>;
  
  // Utility
  getOmniAddress: (chainId: ChainId, address: string) => string;
  parseOmniAddress: (omniAddress: string) => { chainId: ChainId; address: string } | null;
  isChainConnected: (chainId: ChainId) => boolean;
  getConnectedAddress: (chainId: ChainId) => string | null;
  setNetwork: (network: 'mainnet' | 'testnet') => void;
}

interface InitiateTransferParams {
  sourceChain: ChainId;
  destinationChain: ChainId;
  token: string;
  amount: string;
  recipient: string;
  fastMode?: boolean;
}

// ============================================================================
// Initial State & Reducer
// ============================================================================

const initialState: BridgeState = {
  supportedChains: [],
  supportedTokens: [],
  isConfigLoaded: false,
  connections: new Map(),
  balances: new Map(),
  activeTransfers: [],
  transferHistory: [],
  isLoading: false,
  error: null,
  network: 'mainnet',
};

function bridgeReducer(state: BridgeState, action: BridgeAction): BridgeState {
  switch (action.type) {
    case 'SET_CONFIG':
      return {
        ...state,
        supportedChains: action.chains,
        supportedTokens: action.tokens,
        isConfigLoaded: true,
      };
      
    case 'SET_CONNECTION': {
      const newConnections = new Map(state.connections);
      if (action.connection) {
        newConnections.set(action.chainId, action.connection);
      } else {
        newConnections.delete(action.chainId);
      }
      return { ...state, connections: newConnections };
    }
    
    case 'SET_BALANCE': {
      const key = `${action.chainId}:${action.symbol}`;
      const newBalances = new Map(state.balances);
      newBalances.set(key, action.balance);
      return { ...state, balances: newBalances };
    }
    
    case 'SET_BALANCES': {
      const newBalances = new Map(state.balances);
      action.balances.forEach(balance => {
        const key = `${balance.chainId}:${balance.symbol}`;
        newBalances.set(key, balance);
      });
      return { ...state, balances: newBalances };
    }
    
    case 'ADD_TRANSFER':
      return {
        ...state,
        activeTransfers: [...state.activeTransfers, action.transfer],
      };
      
    case 'UPDATE_TRANSFER': {
      const updateTransfer = (transfers: TransferProgress[]) =>
        transfers.map(t =>
          t.transferId === action.transferId ? { ...t, ...action.updates } : t
        );
      
      const updatedActive = updateTransfer(state.activeTransfers);
      const completedTransfer = updatedActive.find(
        t => t.transferId === action.transferId && 
        (t.status === 'completed' || t.status === 'failed')
      );
      
      return {
        ...state,
        activeTransfers: completedTransfer 
          ? updatedActive.filter(t => t.transferId !== action.transferId)
          : updatedActive,
        transferHistory: completedTransfer 
          ? [completedTransfer, ...state.transferHistory]
          : state.transferHistory,
      };
    }
    
    case 'SET_TRANSFER_HISTORY':
      return { ...state, transferHistory: action.transfers };
      
    case 'SET_LOADING':
      return { ...state, isLoading: action.isLoading };
      
    case 'SET_ERROR':
      return { ...state, error: action.error };
      
    case 'SET_NETWORK':
      return { ...state, network: action.network };
      
    case 'DISCONNECT_ALL':
      return {
        ...state,
        connections: new Map(),
        balances: new Map(),
      };
      
    default:
      return state;
  }
}

// ============================================================================
// Context
// ============================================================================

const BridgeContext = createContext<BridgeContextValue | null>(null);

export function useBridge() {
  const context = useContext(BridgeContext);
  if (!context) {
    throw new Error('useBridge must be used within a BridgeProvider');
  }
  return context;
}

// ============================================================================
// Provider
// ============================================================================

interface BridgeProviderProps {
  children: ReactNode;
}

export function BridgeProvider({ children }: BridgeProviderProps) {
  const [state, dispatch] = useReducer(bridgeReducer, initialState);
  
  // Load configuration on mount
  useEffect(() => {
    async function loadConfig() {
      try {
        dispatch({ type: 'SET_LOADING', isLoading: true });
        
        const [chainsResponse, tokensResponse] = await Promise.all([
          omniBridgeApi.getChains().catch(() => ({ chains: getDefaultChains() })),
          omniBridgeApi.getTokens().catch(() => ({ tokens: getDefaultTokens() })),
        ]);
        
        dispatch({
          type: 'SET_CONFIG',
          chains: chainsResponse.chains,
          tokens: tokensResponse.tokens,
        });
      } catch (err) {
        console.error('Failed to load bridge config:', err);
        // Use defaults on error
        dispatch({
          type: 'SET_CONFIG',
          chains: getDefaultChains(),
          tokens: getDefaultTokens(),
        });
      } finally {
        dispatch({ type: 'SET_LOADING', isLoading: false });
      }
    }
    
    loadConfig();
  }, []);
  
  // ============================================================================
  // Wallet Connection
  // ============================================================================
  
  const connectWallet = useCallback(async (chainId: ChainId, walletType?: WalletType) => {
    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_LOADING', isLoading: true });
    
    try {
      let address: string;
      let resolvedWalletType: WalletType;
      
      if (chainId === 'solana') {
        // Phantom wallet for Solana
        const phantom = (window as WindowWithWallets).phantom?.solana;
        if (!phantom) {
          throw new Error('Phantom wallet not detected. Please install Phantom.');
        }
        const response = await phantom.connect();
        address = response.publicKey.toString();
        resolvedWalletType = 'phantom';
      } else if (chainId === 'near') {
        // NEAR Wallet - simplified connection
        // In production, use @near-wallet-selector
        const nearProvider = (window as WindowWithWallets).near;
        if (nearProvider) {
          address = nearProvider.accountId || '';
          resolvedWalletType = 'near-wallet';
        } else {
          // Fallback: prompt for NEAR account ID
          const accountId = prompt('Enter your NEAR account ID (e.g., user.near):');
          if (!accountId) throw new Error('NEAR account ID required');
          address = accountId;
          resolvedWalletType = 'near-wallet';
        }
      } else {
        // EVM chains - use MetaMask/Ethereum provider
        const ethereum = (window as WindowWithWallets).ethereum;
        if (!ethereum) {
          throw new Error('MetaMask not detected. Please install MetaMask.');
        }
        
        const accounts = await ethereum.request({ 
          method: 'eth_requestAccounts' 
        }) as string[];
        
        if (!accounts.length) {
          throw new Error('No accounts returned from wallet');
        }
        
        address = accounts[0];
        resolvedWalletType = walletType || 'metamask';
        
        // Switch to correct chain if needed
        await switchToChain(ethereum, chainId, state.network);
      }
      
      dispatch({
        type: 'SET_CONNECTION',
        chainId,
        connection: {
          chainId,
          address,
          walletType: resolvedWalletType,
          isConnected: true,
        },
      });
      
      // Fetch balances after connection
      // Note: This would be enhanced with actual balance fetching in production
      
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to connect wallet';
      dispatch({ type: 'SET_ERROR', error: message });
      throw err;
    } finally {
      dispatch({ type: 'SET_LOADING', isLoading: false });
    }
  }, [state.network]);
  
  const disconnectWallet = useCallback((chainId: ChainId) => {
    dispatch({ type: 'SET_CONNECTION', chainId, connection: null });
    
    // Clear balances for this chain
    const balancesToRemove = Array.from(state.balances.entries())
      .filter(([key]) => key.startsWith(`${chainId}:`))
      .map(([key]) => key);
    
    balancesToRemove.forEach(key => {
      const [, symbol] = key.split(':');
      dispatch({
        type: 'SET_BALANCE',
        chainId,
        symbol,
        balance: { symbol, balance: '0', chainId },
      });
    });
  }, [state.balances]);
  
  const disconnectAll = useCallback(() => {
    dispatch({ type: 'DISCONNECT_ALL' });
  }, []);
  
  // ============================================================================
  // Balances
  // ============================================================================
  
  const refreshBalances = useCallback(async (_chainId?: ChainId) => {
    // This would fetch actual balances from the chains
    // For now, we'll simulate with mock data
    console.log('Refreshing balances for chain:', _chainId);
  }, []);
  
  const getBalance = useCallback((chainId: ChainId, symbol: string) => {
    const key = `${chainId}:${symbol}`;
    return state.balances.get(key);
  }, [state.balances]);
  
  // ============================================================================
  // Transfers
  // ============================================================================
  
  const initiateTransfer = useCallback(async (params: InitiateTransferParams): Promise<string> => {
    dispatch({ type: 'SET_ERROR', error: null });
    dispatch({ type: 'SET_LOADING', isLoading: true });
    
    try {
      const senderConnection = state.connections.get(params.sourceChain);
      if (!senderConnection) {
        throw new Error(`Please connect your ${params.sourceChain} wallet first`);
      }
      
      const result = await omniBridgeApi.initiateTransfer({
        sourceChain: params.sourceChain,
        destinationChain: params.destinationChain,
        sender: senderConnection.address,
        recipient: params.recipient,
        token: params.token,
        amount: params.amount,
        fastMode: params.fastMode,
      });
      
      const transfer: TransferProgress = {
        transferId: result.transferId,
        status: 'pending',
        sourceChain: params.sourceChain,
        destinationChain: params.destinationChain,
        amount: params.amount,
        token: params.token,
        estimatedCompletion: result.estimatedCompletion,
        createdAt: Math.floor(Date.now() / 1000),
      };
      
      dispatch({ type: 'ADD_TRANSFER', transfer });
      
      return result.transferId;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to initiate transfer';
      dispatch({ type: 'SET_ERROR', error: message });
      throw err;
    } finally {
      dispatch({ type: 'SET_LOADING', isLoading: false });
    }
  }, [state.connections]);
  
  const cancelTransfer = useCallback(async (transferId: string) => {
    // Cancel transfer logic - may not be possible for all stages
    dispatch({
      type: 'UPDATE_TRANSFER',
      transferId,
      updates: { status: 'failed', error: 'Transfer cancelled by user' },
    });
  }, []);
  
  const refreshTransferStatus = useCallback(async (transferId: string) => {
    try {
      const status = await omniBridgeApi.getTransfer(transferId);
      dispatch({
        type: 'UPDATE_TRANSFER',
        transferId,
        updates: mapApiStatusToProgress(status),
      });
    } catch (err) {
      console.error('Failed to refresh transfer status:', err);
    }
  }, []);
  
  // ============================================================================
  // Utility Functions
  // ============================================================================
  
  const getOmniAddress = useCallback((chainId: ChainId, address: string): string => {
    const chainPrefix = {
      near: 'near',
      ethereum: 'eth',
      arbitrum: 'arb',
      base: 'base',
      solana: 'sol',
    }[chainId];
    
    return `${chainPrefix}:${address}`;
  }, []);
  
  const parseOmniAddress = useCallback((omniAddress: string): { chainId: ChainId; address: string } | null => {
    const match = omniAddress.match(/^(near|eth|arb|base|sol):(.+)$/);
    if (!match) return null;
    
    const prefixToChain: Record<string, ChainId> = {
      near: 'near',
      eth: 'ethereum',
      arb: 'arbitrum',
      base: 'base',
      sol: 'solana',
    };
    
    return {
      chainId: prefixToChain[match[1]],
      address: match[2],
    };
  }, []);
  
  const isChainConnected = useCallback((chainId: ChainId): boolean => {
    return state.connections.has(chainId) && state.connections.get(chainId)!.isConnected;
  }, [state.connections]);
  
  const getConnectedAddress = useCallback((chainId: ChainId): string | null => {
    const connection = state.connections.get(chainId);
    return connection?.address || null;
  }, [state.connections]);
  
  const setNetwork = useCallback((network: 'mainnet' | 'testnet') => {
    dispatch({ type: 'SET_NETWORK', network });
    // Optionally disconnect all wallets when switching networks
  }, []);
  
  // ============================================================================
  // Context Value
  // ============================================================================
  
  const value: BridgeContextValue = {
    state,
    connectWallet,
    disconnectWallet,
    disconnectAll,
    refreshBalances,
    getBalance,
    initiateTransfer,
    cancelTransfer,
    refreshTransferStatus,
    getOmniAddress,
    parseOmniAddress,
    isChainConnected,
    getConnectedAddress,
    setNetwork,
  };
  
  return (
    <BridgeContext.Provider value={value}>
      {children}
    </BridgeContext.Provider>
  );
}

// ============================================================================
// Helpers
// ============================================================================

interface WindowWithWallets extends Window {
  ethereum?: {
    request(args: { method: string; params?: unknown[] }): Promise<unknown>;
    on?(event: string, listener: (...args: unknown[]) => void): void;
  };
  phantom?: {
    solana?: {
      connect(): Promise<{ publicKey: { toString(): string } }>;
      disconnect(): Promise<void>;
    };
  };
  near?: {
    accountId?: string;
  };
}

async function switchToChain(
  ethereum: NonNullable<WindowWithWallets['ethereum']>,
  chainId: ChainId,
  network: 'mainnet' | 'testnet'
) {
  const chainIds: Record<string, Record<string, string>> = {
    mainnet: {
      ethereum: '0x1',
      arbitrum: '0xa4b1',
      base: '0x2105',
    },
    testnet: {
      ethereum: '0xaa36a7', // Sepolia
      arbitrum: '0x66eee', // Arbitrum Sepolia
      base: '0x14a34', // Base Sepolia
    },
  };
  
  const targetChainId = chainIds[network][chainId];
  if (!targetChainId) return;
  
  try {
    await ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: targetChainId }],
    });
  } catch (switchError: unknown) {
    // Chain not added, try to add it
    if ((switchError as { code: number }).code === 4902) {
      // Would add chain config here
      console.log('Chain not found, would add chain');
    }
  }
}

function mapApiStatusToProgress(status: ApiTransferStatus): Partial<TransferProgress> {
  const statusMap: Record<string, TransferProgress['status']> = {
    'Pending': 'pending',
    'SourceSubmitted': 'sourceSubmitted',
    'SourceConfirmed': 'sourceConfirmed',
    'WaitingFinality': 'waitingFinality',
    'ProofGenerated': 'proofGenerated',
    'DestinationSubmitted': 'destinationSubmitted',
    'Completed': 'completed',
    'Failed': 'failed',
  };
  
  return {
    status: statusMap[status.status] || 'pending',
    sourceTxHash: status.sourceTxHash,
    destinationTxHash: status.destinationTxHash,
    error: status.error,
  };
}

function getDefaultChains(): ChainInfo[] {
  return [
    { chainId: 'near', name: 'NEAR Protocol', symbol: 'NEAR', nativeCurrency: 'NEAR', productionReady: true, finalitySecs: 2 },
    { chainId: 'ethereum', name: 'Ethereum', symbol: 'ETH', nativeCurrency: 'ETH', productionReady: true, finalitySecs: 900 },
    { chainId: 'arbitrum', name: 'Arbitrum One', symbol: 'ARB', nativeCurrency: 'ETH', productionReady: true, finalitySecs: 900 },
    { chainId: 'base', name: 'Base', symbol: 'BASE', nativeCurrency: 'ETH', productionReady: true, finalitySecs: 900 },
    { chainId: 'solana', name: 'Solana', symbol: 'SOL', nativeCurrency: 'SOL', productionReady: true, finalitySecs: 0.4 },
  ];
}

function getDefaultTokens(): TokenInfo[] {
  return [
    { symbol: 'USDC', name: 'USD Coin', decimals: 6, isStablecoin: true, availableChains: ['near', 'ethereum', 'arbitrum', 'base', 'solana'] },
    { symbol: 'USDT', name: 'Tether USD', decimals: 6, isStablecoin: true, availableChains: ['near', 'ethereum', 'arbitrum', 'base', 'solana'] },
    { symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, isStablecoin: false, availableChains: ['near', 'ethereum', 'arbitrum', 'base'] },
    { symbol: 'NEAR', name: 'NEAR Protocol', decimals: 24, isStablecoin: false, availableChains: ['near', 'ethereum', 'arbitrum', 'base'] },
    { symbol: 'DAI', name: 'Dai Stablecoin', decimals: 18, isStablecoin: true, availableChains: ['near', 'ethereum', 'arbitrum', 'base'] },
    { symbol: 'SOL', name: 'Solana', decimals: 9, isStablecoin: false, availableChains: ['solana', 'near'] },
  ];
}

export default BridgeProvider;

