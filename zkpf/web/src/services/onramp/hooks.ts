/**
 * On-Ramp React Hooks
 * 
 * Custom hooks for integrating on-ramp functionality into React components.
 */

import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  type OnRampProvider,
  type OnRampSession,
  type OnRampQuote,
  type OnRampStatus,
  type StartOnRampRequest,
  type GetQuoteRequest,
  PROVIDER_CAPABILITIES,
  DEFAULT_ONRAMP_CONFIG,
} from './types';
import {
  USDC_CHAINS,
  getChainByKey,
  getBestProviderForChain,
  type UsdcChainConfig,
} from '../../config/usdc-chains';
import { createCoinbaseAdapter, type CoinbaseOnrampConfig } from './providers/coinbase';

// Get config from environment
const COINBASE_APP_ID = import.meta.env.VITE_COINBASE_ONRAMP_APP_ID || '';
const TRANSAK_API_KEY = import.meta.env.VITE_TRANSAK_API_KEY || '';

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
      return !!TRANSAK_API_KEY;
    }
    return false;
  }, [coinbaseAdapter]);

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
      } else if (state.provider === 'transak') {
        // Transak quote (simplified - would need actual API call)
        quote = {
          provider: 'transak',
          fiatAmountCents: Math.round(amountUsd * 100),
          fiatCurrency: 'USD',
          cryptoAmount: amountUsd * 0.99 * 1_000_000, // 1% fee
          cryptoAsset: 'USDC',
          exchangeRate: 0.99,
          fees: {
            provider: Math.round(amountUsd * 0.01 * 100),
            network: 0,
            total: Math.round(amountUsd * 0.01 * 100),
          },
          estimatedTimeSeconds: 600,
          expiresAt: Date.now() + 300_000,
          isZeroFee: false,
        };
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
  }, [state.provider, state.chain, coinbaseAdapter]);

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

      // Transak quote (if available)
      if (TRANSAK_API_KEY) {
        const transakCapabilities = PROVIDER_CAPABILITIES.transak;
        if (transakCapabilities.supportedChains.includes(state.chain)) {
          quotePromises.push(
            Promise.resolve({
              provider: 'transak' as const,
              fiatAmountCents: Math.round(amountUsd * 100),
              fiatCurrency: 'USD',
              cryptoAmount: amountUsd * 0.99 * 1_000_000,
              cryptoAsset: 'USDC',
              exchangeRate: 0.99,
              fees: {
                provider: Math.round(amountUsd * 0.01 * 100),
                network: 0,
                total: Math.round(amountUsd * 0.01 * 100),
              },
              estimatedTimeSeconds: 600,
              expiresAt: Date.now() + 300_000,
              isZeroFee: false,
            })
          );
        }
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
  }, [state.chain, coinbaseAdapter]);

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
      } else if (state.provider === 'transak') {
        // Transak widget integration
        const sessionId = `tr_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
        session = {
          id: sessionId,
          provider: 'transak',
          status: 'pending',
          fiatAmountCents: Math.round(request.amountUsd * 100),
          fiatCurrency: 'USD',
          cryptoAsset: 'USDC',
          targetChain: state.chain,
          targetAddress: request.address,
          createdAt: Date.now(),
        };

        // Would open Transak widget here
        // openTransakWidget({ apiKey: TRANSAK_API_KEY, ... });
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
  }, [state.provider, state.chain, coinbaseAdapter]);

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
 */
export function useOnRampSession(sessionId: string | null) {
  const [session, setSession] = useState<OnRampSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Poll for session status updates
  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      
      setLoading(true);
      try {
        // In production, this would call the backend API
        // const response = await fetch(`/api/onramp/session/${sessionId}`);
        // const data = await response.json();
        // setSession(data);
        
        // For now, just maintain current state
        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch session');
          setLoading(false);
        }
      }
    };

    poll();
    const interval = setInterval(poll, 5000); // Poll every 5 seconds

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [sessionId]);

  return { session, loading, error };
}

/**
 * Hook to get USDC balance across multiple chains.
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

      // Fetch balances from each supported chain
      for (const [chainKey, config] of Object.entries(USDC_CHAINS)) {
        try {
          // Skip Starknet for now (different RPC approach)
          if (chainKey === 'starknet') continue;

          const balance = await fetchErc20Balance(
            config.rpcUrl,
            config.usdcAddress,
            address
          );
          newBalances.set(chainKey, balance);
          total += Number(balance) / 1e6; // USDC has 6 decimals
        } catch {
          // Ignore individual chain errors
          newBalances.set(chainKey, 0n);
        }
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
 * Fetch ERC-20 balance using JSON-RPC.
 */
async function fetchErc20Balance(
  rpcUrl: string,
  tokenAddress: string,
  walletAddress: string
): Promise<bigint> {
  // balanceOf(address) selector: 0x70a08231
  const data = `0x70a08231000000000000000000000000${walletAddress.slice(2).toLowerCase()}`;

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

