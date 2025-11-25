/**
 * On-Ramp React Hooks
 * 
 * Custom hooks for integrating on-ramp functionality into React components.
 * Provides real integration with Coinbase and Transak providers.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import {
  type OnRampProvider,
  type OnRampSession,
  type OnRampQuote,
  type StartOnRampRequest,
  type GetQuoteRequest,
  PROVIDER_CAPABILITIES,
  DEFAULT_ONRAMP_CONFIG,
} from './types';
import {
  USDC_CHAINS,
  getChainByKey,
  type UsdcChainConfig,
} from '../../config/usdc-chains';
import { createCoinbaseAdapter } from './providers/coinbase';
import { createTransakAdapter } from './providers/transak';

// Get config from environment
const COINBASE_APP_ID = import.meta.env.VITE_COINBASE_ONRAMP_APP_ID || '';
const TRANSAK_API_KEY = import.meta.env.VITE_TRANSAK_API_KEY || '';
const TRANSAK_ENVIRONMENT = (import.meta.env.VITE_TRANSAK_ENVIRONMENT || 'STAGING') as 'STAGING' | 'PRODUCTION';
const ONRAMP_API_BASE = import.meta.env.VITE_ONRAMP_API_BASE || '/api/onramp';

/**
 * Hook state for on-ramp operations.
 */
interface UseOnRampState {
  /** Current session if active */
  session: OnRampSession | null;
  /** Current quote */
  quote: OnRampQuote | null;
  /** All available quotes */
  quotes: OnRampQuote[];
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;
  /** Selected provider */
  provider: OnRampProvider;
  /** Selected chain */
  chain: string;
}

/**
 * Hook return type for on-ramp operations.
 */
interface UseOnRampReturn extends UseOnRampState {
  /** Start an on-ramp session */
  startOnRamp: (request: Omit<StartOnRampRequest, 'provider' | 'chain'>) => Promise<OnRampSession>;
  /** Get a quote without starting a session */
  getQuote: (amountUsd: number) => Promise<OnRampQuote>;
  /** Get quotes from all available providers */
  getAllQuotes: (amountUsd: number) => Promise<OnRampQuote[]>;
  /** Set the preferred provider */
  setProvider: (provider: OnRampProvider) => void;
  /** Set the target chain */
  setChain: (chain: string) => void;
  /** Reset state */
  reset: () => void;
  /** Available chains for current provider */
  availableChains: UsdcChainConfig[];
  /** Check if provider is available */
  isProviderAvailable: (provider: OnRampProvider) => boolean;
}

/**
 * Main hook for on-ramp functionality.
 */
export function useOnRamp(initialChain?: string): UseOnRampReturn {
  const [state, setState] = useState<UseOnRampState>({
    session: null,
    quote: null,
    quotes: [],
    loading: false,
    error: null,
    provider: DEFAULT_ONRAMP_CONFIG.defaultProvider,
    chain: initialChain || DEFAULT_ONRAMP_CONFIG.defaultChain,
  });

  // Create provider adapters
  const coinbaseAdapter = useMemo(() => {
    if (!COINBASE_APP_ID) return null;
    return createCoinbaseAdapter({
      appId: COINBASE_APP_ID,
      appName: 'zkpf Wallet',
    });
  }, []);

  const transakAdapter = useMemo(() => {
    if (!TRANSAK_API_KEY) return null;
    return createTransakAdapter({
      apiKey: TRANSAK_API_KEY,
      environment: TRANSAK_ENVIRONMENT,
    });
  }, []);

  // Get available chains for current provider
  const availableChains = useMemo(() => {
    const capabilities = PROVIDER_CAPABILITIES[state.provider];
    return capabilities.supportedChains
      .map(chainKey => getChainByKey(chainKey))
      .filter((c): c is UsdcChainConfig => c !== undefined);
  }, [state.provider]);

  // Check provider availability
  const isProviderAvailable = useCallback((provider: OnRampProvider): boolean => {
    if (provider === 'coinbase') {
      return !!COINBASE_APP_ID && coinbaseAdapter !== null;
    }
    if (provider === 'transak') {
      return !!TRANSAK_API_KEY && transakAdapter !== null;
    }
    return false;
  }, [coinbaseAdapter, transakAdapter]);

  // Set provider
  const setProvider = useCallback((provider: OnRampProvider) => {
    setState(prev => {
      // If current chain isn't supported by new provider, switch to default
      const capabilities = PROVIDER_CAPABILITIES[provider];
      const chainSupported = capabilities.supportedChains.includes(prev.chain);
      
      return {
        ...prev,
        provider,
        chain: chainSupported ? prev.chain : capabilities.supportedChains[0] || 'base',
        quote: null,
        quotes: [],
      };
    });
  }, []);

  // Set chain
  const setChain = useCallback((chain: string) => {
    setState(prev => ({
      ...prev,
      chain,
      quote: null,
      quotes: [],
    }));
  }, []);

  // Get quote from current provider
  const getQuote = useCallback(async (amountUsd: number): Promise<OnRampQuote> => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      let quote: OnRampQuote;

      if (state.provider === 'coinbase' && coinbaseAdapter) {
        quote = await coinbaseAdapter.getQuote({
          chain: state.chain,
          amountUsd,
        });
      } else if (state.provider === 'transak' && transakAdapter) {
        // Real Transak quote via adapter
        quote = await transakAdapter.getQuote({
          chain: state.chain,
          amountUsd,
        });
      } else {
        throw new Error(`Provider ${state.provider} not available`);
      }

      setState(prev => ({ ...prev, quote, loading: false }));
      return quote;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to get quote';
      setState(prev => ({ ...prev, error, loading: false }));
      throw err;
    }
  }, [state.provider, state.chain, coinbaseAdapter, transakAdapter]);

  // Get quotes from all available providers
  const getAllQuotes = useCallback(async (amountUsd: number): Promise<OnRampQuote[]> => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      const quotePromises: Promise<OnRampQuote | null>[] = [];

      // Coinbase quote
      if (coinbaseAdapter && coinbaseAdapter.isAvailable(state.chain)) {
        quotePromises.push(
          coinbaseAdapter.getQuote({ chain: state.chain, amountUsd }).catch(() => null)
        );
      }

      // Transak quote via real adapter
      if (transakAdapter && transakAdapter.isAvailable(state.chain)) {
        quotePromises.push(
          transakAdapter.getQuote({ chain: state.chain, amountUsd }).catch(() => null)
        );
      }

      const results = await Promise.all(quotePromises);
      const quotes = results.filter((q): q is OnRampQuote => q !== null);

      // Sort by best value (highest crypto amount)
      quotes.sort((a, b) => b.cryptoAmount - a.cryptoAmount);

      setState(prev => ({
        ...prev,
        quotes,
        quote: quotes[0] || null,
        loading: false,
      }));

      return quotes;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to get quotes';
      setState(prev => ({ ...prev, error, loading: false }));
      throw err;
    }
  }, [state.chain, coinbaseAdapter, transakAdapter]);

  // Start on-ramp session
  const startOnRamp = useCallback(async (
    request: Omit<StartOnRampRequest, 'provider' | 'chain'>
  ): Promise<OnRampSession> => {
    setState(prev => ({ ...prev, loading: true, error: null }));

    try {
      let session: OnRampSession;

      if (state.provider === 'coinbase' && coinbaseAdapter) {
        const response = await coinbaseAdapter.startSession({
          ...request,
          provider: 'coinbase',
          chain: state.chain,
        });
        session = response.session;

        // Open Coinbase widget in new window
        window.open(response.redirectUrl, '_blank', 'width=450,height=700');
      } else if (state.provider === 'transak' && transakAdapter) {
        // Real Transak session
        const response = await transakAdapter.startSession({
          ...request,
          provider: 'transak',
          chain: state.chain,
        });
        session = response.session;

        // Open Transak widget in new window
        window.open(response.redirectUrl, '_blank', 'width=500,height=700');
      } else {
        throw new Error(`Provider ${state.provider} not available`);
      }

      setState(prev => ({ ...prev, session, loading: false }));
      return session;
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Failed to start on-ramp';
      setState(prev => ({ ...prev, error, loading: false }));
      throw err;
    }
  }, [state.provider, state.chain, coinbaseAdapter, transakAdapter]);

  // Reset state
  const reset = useCallback(() => {
    setState({
      session: null,
      quote: null,
      quotes: [],
      loading: false,
      error: null,
      provider: DEFAULT_ONRAMP_CONFIG.defaultProvider,
      chain: DEFAULT_ONRAMP_CONFIG.defaultChain,
    });
  }, []);

  return {
    ...state,
    startOnRamp,
    getQuote,
    getAllQuotes,
    setProvider,
    setChain,
    reset,
    availableChains,
    isProviderAvailable,
  };
}

/**
 * Hook to track an active on-ramp session status.
 * Polls the backend API or provider directly for status updates.
 */
export function useOnRampSession(sessionId: string | null, provider?: OnRampProvider) {
  const [session, setSession] = useState<OnRampSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Poll for session status updates
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }

    let cancelled = false;
    abortControllerRef.current = new AbortController();

    const poll = async () => {
      if (cancelled) return;
      
      setLoading(true);
      try {
        // Try backend API first
        const response = await fetch(`${ONRAMP_API_BASE}/session/${sessionId}`, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
          },
          signal: abortControllerRef.current?.signal,
        });

        if (response.ok) {
          const data = await response.json();
          if (!cancelled) {
            setSession(data);
            setError(null);
            
            // Stop polling if session is complete or failed
            if (['completed', 'failed', 'expired'].includes(data.status)) {
              setLoading(false);
              return;
            }
          }
        } else if (response.status === 404) {
          // Session not found in backend, might be local-only
          setError(null);
        } else {
          throw new Error(`API returned ${response.status}`);
        }
        
        setLoading(false);
        
        // Continue polling every 5 seconds
        if (!cancelled) {
          setTimeout(poll, 5000);
        }
      } catch (err) {
        if (!cancelled && err instanceof Error && err.name !== 'AbortError') {
          console.warn('Session poll error:', err);
          setError(err.message);
          setLoading(false);
          // Retry after longer delay on error
          setTimeout(poll, 10000);
        }
      }
    };

    poll();

    return () => {
      cancelled = true;
      abortControllerRef.current?.abort();
    };
  }, [sessionId, provider]);

  return { session, loading, error };
}

/**
 * Hook to get USDC balance across multiple chains.
 * Includes real Starknet balance fetching.
 */
export function useUsdcBalance(address: string | null) {
  const [balances, setBalances] = useState<Map<string, bigint>>(new Map());
  const [totalUsd, setTotalUsd] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchBalances = useCallback(async () => {
    if (!address) {
      setBalances(new Map());
      setTotalUsd(0);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const newBalances = new Map<string, bigint>();
      let total = 0;

      // Fetch balances from each supported chain in parallel
      const fetchPromises = Object.entries(USDC_CHAINS).map(async ([chainKey, config]) => {
        try {
          let balance: bigint;
          
          if (chainKey === 'starknet') {
            // Starknet uses different address format and RPC
            balance = await fetchStarknetUsdcBalance(config.rpcUrl, config.usdcAddress, address);
          } else {
            // EVM chains use standard ERC20 balanceOf
            balance = await fetchErc20Balance(config.rpcUrl, config.usdcAddress, address);
          }
          
          return { chainKey, balance };
        } catch (err) {
          console.warn(`Failed to fetch balance for ${chainKey}:`, err);
          return { chainKey, balance: 0n };
        }
      });

      const results = await Promise.all(fetchPromises);
      
      for (const { chainKey, balance } of results) {
        newBalances.set(chainKey, balance);
        total += Number(balance) / 1e6; // USDC has 6 decimals
      }

      setBalances(newBalances);
      setTotalUsd(total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch balances');
    } finally {
      setLoading(false);
    }
  }, [address]);

  // Fetch on mount and when address changes
  useEffect(() => {
    fetchBalances();
    // Refresh every 30 seconds
    const interval = setInterval(fetchBalances, 30000);
    return () => clearInterval(interval);
  }, [fetchBalances]);

  return {
    balances,
    totalUsd,
    loading,
    error,
    refresh: fetchBalances,
  };
}

/**
 * Fetch ERC-20 balance using JSON-RPC (for EVM chains).
 */
async function fetchErc20Balance(
  rpcUrl: string,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  // balanceOf(address) selector: 0x70a08231
  const data = `0x70a08231000000000000000000000000${walletAddress.slice(2).toLowerCase().padStart(40, '0')}`;

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_call',
      params: [
        { to: tokenAddress, data },
        'latest',
      ],
      id: 1,
    }),
  });

  const result = await response.json();
  if (result.error) {
    throw new Error(result.error.message);
  }

  return BigInt(result.result || '0x0');
}

/**
 * Fetch USDC balance from Starknet using Starknet JSON-RPC.
 * Uses the ERC20 balance_of function.
 */
async function fetchStarknetUsdcBalance(
  rpcUrl: string,
  usdcAddress: string,
  walletAddress: string
): Promise<bigint> {
  // Validate Starknet address format
  if (!walletAddress.startsWith('0x') || walletAddress.length < 50) {
    // Not a valid Starknet address, return 0
    return 0n;
  }

  // balance_of entry point selector (starknet keccak of "balance_of")
  const balanceOfSelector = '0x02e4263afad30923c891518314c3c95dbe830a16874e8abc5777a9a20b54c76e';
  
  // Normalize addresses - Starknet expects addresses without leading zeros
  const normalizedUsdcAddress = normalizeStarknetAddress(usdcAddress);
  const normalizedWalletAddress = normalizeStarknetAddress(walletAddress);

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'starknet_call',
      params: [
        {
          contract_address: normalizedUsdcAddress,
          entry_point_selector: balanceOfSelector,
          calldata: [normalizedWalletAddress],
        },
        'latest',
      ],
      id: 1,
    }),
  });

  const result = await response.json();
  
  if (result.error) {
    throw new Error(result.error.message || 'Starknet RPC error');
  }

  // Starknet returns u256 as two felts [low, high]
  // For USDC balances, high is typically 0
  const resultArray = result.result || [];
  if (resultArray.length >= 1) {
    const low = BigInt(resultArray[0] || '0x0');
    const high = resultArray.length >= 2 ? BigInt(resultArray[1] || '0x0') : 0n;
    // u256 = low + high * 2^128
    return low + (high << 128n);
  }

  return 0n;
}

/**
 * Normalize a Starknet address to the expected format.
 * Removes leading zeros and ensures 0x prefix.
 */
function normalizeStarknetAddress(address: string): string {
  if (!address.startsWith('0x')) {
    address = '0x' + address;
  }
  // Remove leading zeros after 0x, but keep at least one character
  const withoutPrefix = address.slice(2);
  const normalized = withoutPrefix.replace(/^0+/, '') || '0';
  return '0x' + normalized;
}

/**
 * Hook for fetching the backend API URL for on-ramp operations.
 */
export function useOnRampApi() {
  return {
    baseUrl: ONRAMP_API_BASE,
    
    // Quote endpoint
    async getQuote(request: GetQuoteRequest): Promise<OnRampQuote[]> {
      const response = await fetch(`${ONRAMP_API_BASE}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error(`Quote request failed: ${response.status}`);
      }
      return response.json();
    },
    
    // Create session endpoint
    async createSession(request: StartOnRampRequest): Promise<OnRampSession> {
      const response = await fetch(`${ONRAMP_API_BASE}/session`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      });
      if (!response.ok) {
        throw new Error(`Session creation failed: ${response.status}`);
      }
      return response.json();
    },
    
    // Get session status
    async getSessionStatus(sessionId: string): Promise<OnRampSession> {
      const response = await fetch(`${ONRAMP_API_BASE}/session/${sessionId}`);
      if (!response.ok) {
        throw new Error(`Session fetch failed: ${response.status}`);
      }
      return response.json();
    },
  };
}
