/**
 * useSwap Hook
 * 
 * React hook for cross-chain swaps to/from shielded ZEC.
 * Provides a simple interface to the swap service with proper state management.
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import {
  getSwapService,
  type SwapQuoteResponse,
  type SwapRoute,
  type SwapSession,
  type ChainAsset,
  type SwapServiceEvent,
  type AddressGeneratorCallback,
} from '../services/swap';

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface UseSwapState {
  /** Current quotes from all providers */
  quotes: SwapQuoteResponse | null;
  /** Whether quote is being fetched */
  loadingQuotes: boolean;
  /** Active swap sessions */
  sessions: SwapSession[];
  /** Currently selected session */
  activeSession: SwapSession | null;
  /** Error message */
  error: string | null;
}

export interface UseSwapActions {
  /** Get quotes for swapping TO shielded ZEC */
  getQuotesToZec: (
    source: ChainAsset,
    amountIn: bigint,
    sourceAddress: string,
    zcashAddress: string
  ) => Promise<SwapQuoteResponse>;
  
  /** Get quotes for swapping FROM shielded ZEC */
  getQuotesFromZec: (
    destination: ChainAsset,
    amountIn: bigint,
    destinationAddress: string
  ) => Promise<SwapQuoteResponse>;
  
  /** Execute swap TO shielded ZEC */
  executeSwapToZec: (
    route: SwapRoute,
    sourceAddress: string
  ) => Promise<SwapSession>;
  
  /** Execute swap FROM shielded ZEC */
  executeSwapFromZec: (
    route: SwapRoute,
    destinationAddress: string,
    orchardBalance: bigint
  ) => Promise<SwapSession>;
  
  /** Continue outbound swap after unshielding */
  continueOutbound: (
    sessionId: string,
    unshieldTxHash: string
  ) => Promise<SwapSession>;
  
  /** Select a session to view */
  selectSession: (sessionId: string | null) => void;
  
  /** Clear error */
  clearError: () => void;
  
  /** Refresh quotes */
  refreshQuotes: () => Promise<void>;
  
  /** Set custom address generator (for wallet integration) */
  setAddressGenerator: (generator: AddressGeneratorCallback) => void;
}

export interface UseSwapReturn extends UseSwapState, UseSwapActions {}

// ═══════════════════════════════════════════════════════════════════════════════
// HOOK
// ═══════════════════════════════════════════════════════════════════════════════

export function useSwap(): UseSwapReturn {
  const [quotes, setQuotes] = useState<SwapQuoteResponse | null>(null);
  const [loadingQuotes, setLoadingQuotes] = useState(false);
  const [sessions, setSessions] = useState<SwapSession[]>([]);
  const [activeSession, setActiveSession] = useState<SwapSession | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Track last quote request for refresh
  const lastQuoteRequest = useRef<{
    type: 'to_zec' | 'from_zec';
    source?: ChainAsset;
    destination?: ChainAsset;
    amountIn: bigint;
    sourceAddress?: string;
    destinationAddress?: string;
    zcashAddress?: string;
  } | null>(null);

  const service = getSwapService();

  // Subscribe to service events
  useEffect(() => {
    const unsubscribe = service.subscribe((event: SwapServiceEvent) => {
      switch (event.type) {
        case 'QUOTE_FETCHED':
          setQuotes(event.quotes);
          setLoadingQuotes(false);
          break;
        
        case 'SWAP_INITIATED':
        case 'SWAP_STATUS_UPDATED':
        case 'AUTO_SHIELD_COMPLETE':
        case 'SWAP_COMPLETED':
          setSessions(service.getAllSessions());
          if (activeSession?.sessionId === event.session.sessionId) {
            setActiveSession(event.session);
          }
          break;
        
        case 'SWAP_FAILED':
          setSessions(service.getAllSessions());
          if (activeSession?.sessionId === event.session.sessionId) {
            setActiveSession(event.session);
          }
          setError(event.error);
          break;
        
        case 'ERROR':
          setError(event.error);
          break;
      }
    });

    // Load existing sessions
    setSessions(service.getAllSessions());

    return unsubscribe;
  }, [service, activeSession?.sessionId]);

  // ═══════════════════════════════════════════════════════════════════════════
  // ACTIONS
  // ═══════════════════════════════════════════════════════════════════════════

  const getQuotesToZec = useCallback(async (
    source: ChainAsset,
    amountIn: bigint,
    sourceAddress: string,
    zcashAddress: string
  ): Promise<SwapQuoteResponse> => {
    setLoadingQuotes(true);
    setError(null);

    lastQuoteRequest.current = {
      type: 'to_zec',
      source,
      amountIn,
      sourceAddress,
      zcashAddress,
    };

    try {
      const result = await service.getQuotesToShieldedZec(
        source,
        amountIn,
        sourceAddress,
        zcashAddress
      );
      setQuotes(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get quotes';
      setError(message);
      throw err;
    } finally {
      setLoadingQuotes(false);
    }
  }, [service]);

  const getQuotesFromZec = useCallback(async (
    destination: ChainAsset,
    amountIn: bigint,
    destinationAddress: string
  ): Promise<SwapQuoteResponse> => {
    setLoadingQuotes(true);
    setError(null);

    lastQuoteRequest.current = {
      type: 'from_zec',
      destination,
      amountIn,
      destinationAddress,
    };

    try {
      const result = await service.getQuotesFromShieldedZec(
        destination,
        amountIn,
        destinationAddress
      );
      setQuotes(result);
      return result;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to get quotes';
      setError(message);
      throw err;
    } finally {
      setLoadingQuotes(false);
    }
  }, [service]);

  const executeSwapToZec = useCallback(async (
    route: SwapRoute,
    sourceAddress: string
  ): Promise<SwapSession> => {
    setError(null);
    try {
      const session = await service.executeSwapToShieldedZec(route, sourceAddress);
      setActiveSession(session);
      setSessions(service.getAllSessions());
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Swap failed';
      setError(message);
      throw err;
    }
  }, [service]);

  const executeSwapFromZec = useCallback(async (
    route: SwapRoute,
    destinationAddress: string,
    orchardBalance: bigint
  ): Promise<SwapSession> => {
    setError(null);
    try {
      const session = await service.executeSwapFromShieldedZec(
        route,
        destinationAddress,
        orchardBalance
      );
      setActiveSession(session);
      setSessions(service.getAllSessions());
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Swap failed';
      setError(message);
      throw err;
    }
  }, [service]);

  const continueOutbound = useCallback(async (
    sessionId: string,
    unshieldTxHash: string
  ): Promise<SwapSession> => {
    setError(null);
    try {
      const session = await service.continueOutboundSwap(sessionId, unshieldTxHash);
      setActiveSession(session);
      setSessions(service.getAllSessions());
      return session;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to continue swap';
      setError(message);
      throw err;
    }
  }, [service]);

  const selectSession = useCallback((sessionId: string | null) => {
    if (sessionId === null) {
      setActiveSession(null);
    } else {
      const session = service.getSession(sessionId);
      setActiveSession(session || null);
    }
  }, [service]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const refreshQuotes = useCallback(async () => {
    if (!lastQuoteRequest.current) return;

    const req = lastQuoteRequest.current;
    if (req.type === 'to_zec' && req.source && req.sourceAddress && req.zcashAddress) {
      await getQuotesToZec(req.source, req.amountIn, req.sourceAddress, req.zcashAddress);
    } else if (req.type === 'from_zec' && req.destination && req.destinationAddress) {
      await getQuotesFromZec(req.destination, req.amountIn, req.destinationAddress);
    }
  }, [getQuotesToZec, getQuotesFromZec]);

  const setAddressGenerator = useCallback((generator: AddressGeneratorCallback) => {
    service.setAddressGenerator(generator);
  }, [service]);

  return {
    // State
    quotes,
    loadingQuotes,
    sessions,
    activeSession,
    error,
    // Actions
    getQuotesToZec,
    getQuotesFromZec,
    executeSwapToZec,
    executeSwapFromZec,
    continueOutbound,
    selectSession,
    clearError,
    refreshQuotes,
    setAddressGenerator,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER HOOKS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Hook for tracking a specific swap session.
 */
export function useSwapSession(sessionId: string | null) {
  const [session, setSession] = useState<SwapSession | null>(null);
  const service = getSwapService();

  useEffect(() => {
    if (!sessionId) {
      setSession(null);
      return;
    }

    // Initial load
    setSession(service.getSession(sessionId) || null);

    // Subscribe to updates
    const unsubscribe = service.subscribe((event) => {
      if ('session' in event && event.session.sessionId === sessionId) {
        setSession(event.session);
      }
    });

    return unsubscribe;
  }, [sessionId, service]);

  return session;
}

/**
 * Hook for auto-refreshing quotes.
 */
export function useAutoRefreshQuotes(
  getQuotes: () => Promise<void>,
  intervalMs: number = 15000,
  enabled: boolean = true
) {
  useEffect(() => {
    if (!enabled) return;

    const interval = setInterval(() => {
      getQuotes().catch(console.error);
    }, intervalMs);

    return () => clearInterval(interval);
  }, [getQuotes, intervalMs, enabled]);
}

