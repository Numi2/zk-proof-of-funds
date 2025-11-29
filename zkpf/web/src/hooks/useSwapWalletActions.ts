/**
 * useSwapWalletActions Hook
 * 
 * Wallet integration for cross-chain swap operations.
 * Follows the same patterns as useWebzjsActions.ts for consistency.
 * 
 * Provides:
 * - Fresh address generation for swaps
 * - Shield/unshield transaction creation
 * - Balance queries
 * - Swap session persistence
 */

import { useCallback, useMemo } from 'react';
import { get, set } from 'idb-keyval';
import { useWebZjsContext } from '../context/WebzjsContext';
import type { SwapSession, FreshAddress } from '../services/swap';

// Storage keys
const SWAP_SESSIONS_KEY = 'zkpf-swap-sessions';
const USED_ADDRESSES_KEY = 'zkpf-used-swap-addresses';

/**
 * Extract error message from various error types.
 */
function extractErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const errObj = err as Record<string, unknown>;
    if (typeof errObj.message === 'string') return errObj.message;
  }
  return 'Unknown error';
}

/**
 * Convert zatoshis to ZEC string for display.
 */
export function zatsToZec(zats: number | bigint): string {
  const zatsNum = typeof zats === 'bigint' ? Number(zats) : zats;
  return (zatsNum / 100_000_000).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });
}

/**
 * Convert ZEC to zatoshis.
 */
export function zecToZats(zec: number): bigint {
  return BigInt(Math.floor(zec * 100_000_000));
}

export interface SwapWalletState {
  /** Whether wallet is connected */
  isConnected: boolean;
  /** Whether wallet is loading */
  isLoading: boolean;
  /** Orchard (shielded) balance in zatoshis */
  orchardBalanceZats: bigint;
  /** Sapling balance in zatoshis */
  saplingBalanceZats: bigint;
  /** Transparent balance in zatoshis */
  transparentBalanceZats: bigint;
  /** Total shielded balance (orchard + sapling) */
  totalShieldedZats: bigint;
  /** Current unified address */
  unifiedAddress: string | null;
  /** Current transparent address */
  transparentAddress: string | null;
}

export interface SwapWalletActions {
  /** Get current wallet state for swaps */
  getSwapWalletState: () => Promise<SwapWalletState>;
  /** Get a fresh transparent address (for receiving swap deposits) */
  getFreshTransparentAddress: (purpose: string) => Promise<FreshAddress>;
  /** Get a fresh unified/Orchard address (for shielding destination) */
  getFreshOrchardAddress: (purpose: string) => Promise<FreshAddress>;
  /** Create an unshield transaction (Orchard → transparent) */
  createUnshieldTransaction: (amountZats: bigint, toTransparentAddress: string) => Promise<{ txid: string; status: 'pending' | 'broadcast' }>;
  /** Create a shield transaction (transparent → Orchard) */
  createShieldTransaction: (fromTransparentAddress: string, toOrchardAddress: string) => Promise<{ txid: string; status: 'pending' | 'broadcast' }>;
  /** Save a swap session to local storage */
  saveSwapSession: (session: SwapSession) => Promise<void>;
  /** Load swap sessions from local storage */
  loadSwapSessions: () => Promise<SwapSession[]>;
  /** Delete a swap session */
  deleteSwapSession: (sessionId: string) => Promise<void>;
  /** Mark an address as used (for privacy tracking) */
  markAddressUsed: (address: string) => Promise<void>;
  /** Check if an address has been used */
  isAddressUsed: (address: string) => Promise<boolean>;
}

export interface UseSwapWalletReturn extends SwapWalletActions {
  walletState: SwapWalletState;
}

/**
 * Hook for swap-related wallet operations.
 */
export function useSwapWalletActions(): UseSwapWalletReturn {
  const { state, dispatch } = useWebZjsContext();

  // Compute wallet state from context
  const walletState = useMemo<SwapWalletState>(() => {
    const isConnected = state.webWallet !== null && state.activeAccount != null;
    const isLoading = state.loading;

    let orchardBalanceZats = BigInt(0);
    let saplingBalanceZats = BigInt(0);
    let transparentBalanceZats = BigInt(0);

    if (state.summary && state.activeAccount != null) {
      const accountBalance = state.summary.account_balances.find(
        ([accountId]) => accountId === state.activeAccount
      );
      if (accountBalance) {
        orchardBalanceZats = BigInt(accountBalance[1].orchard_balance);
        saplingBalanceZats = BigInt(accountBalance[1].sapling_balance);
        transparentBalanceZats = BigInt(accountBalance[1].unshielded_balance || 0);
      }
    }

    return {
      isConnected,
      isLoading,
      orchardBalanceZats,
      saplingBalanceZats,
      transparentBalanceZats,
      totalShieldedZats: orchardBalanceZats + saplingBalanceZats,
      unifiedAddress: null, // Populated by getSwapWalletState
      transparentAddress: null,
    };
  }, [state.webWallet, state.activeAccount, state.summary, state.loading]);

  /**
   * Get detailed wallet state including addresses.
   */
  const getSwapWalletState = useCallback(async (): Promise<SwapWalletState> => {
    const baseState = { ...walletState };

    if (!state.webWallet || state.activeAccount == null) {
      return baseState;
    }

    try {
      const unifiedAddress = await state.webWallet.get_current_address(state.activeAccount);
      const transparentAddress = await state.webWallet.get_current_address_transparent(state.activeAccount);

      return {
        ...baseState,
        unifiedAddress,
        transparentAddress,
      };
    } catch (err) {
      console.error('Failed to get wallet addresses:', err);
      return baseState;
    }
  }, [walletState, state.webWallet, state.activeAccount]);

  /**
   * Get a fresh transparent address for swap deposits.
   * 
   * CRITICAL for privacy: Each swap MUST use a new address.
   * - Prevents linking multiple swaps to same identity
   * - Fresh address = fresh diversifier index
   * 
   * Current limitation: WebWallet API may return same address.
   * Production implementation should:
   * 1. Track last used diversifier index in local storage
   * 2. Increment and derive new address for each swap
   * 3. Never reuse addresses even if swap fails
   */
  const getFreshTransparentAddress = useCallback(async (purpose: string): Promise<FreshAddress> => {
    if (!state.webWallet || state.activeAccount == null) {
      throw new Error('Wallet not connected');
    }

    try {
      // Try to get a truly fresh address if the API supports it
      let address: string;
      let diversifierIndex: bigint;

      // Check if WebWallet supports address derivation at specific index
      // @ts-expect-error - Method may not be in type definitions yet
      if (typeof state.webWallet.derive_transparent_address === 'function') {
        // Get next diversifier index from storage
        const lastIndex = await get('zkpf-last-taddr-diversifier') as string || '0';
        diversifierIndex = BigInt(lastIndex) + BigInt(1);
        
        // Derive address at new index
        // @ts-expect-error - Using dynamic method
        address = await state.webWallet.derive_transparent_address(
          state.activeAccount,
          Number(diversifierIndex)
        );
        
        // Save new index
        await set('zkpf-last-taddr-diversifier', diversifierIndex.toString());
      } else {
        // Fallback: use current address (not ideal for privacy)
        address = await state.webWallet.get_current_address_transparent(state.activeAccount);
        diversifierIndex = BigInt(Date.now()); // Placeholder index
        
        console.warn('[Swap] Using current t-addr - fresh derivation not available');
      }

      const freshAddress: FreshAddress = {
        address,
        type: 'transparent',
        accountIndex: state.activeAccount,
        diversifierIndex,
        used: false,
        createdAt: Date.now(),
      };

      // Track this address for privacy auditing
      await markAddressUsed(address);

      console.log(`[Swap] Fresh t-addr for ${purpose}:`, address.slice(0, 10) + '...');
      console.log(`[Swap]   Diversifier index: ${diversifierIndex}`);

      return freshAddress;
    } catch (err) {
      const message = extractErrorMessage(err);
      dispatch({
        type: 'set-error',
        payload: new Error(`Failed to generate transparent address: ${message}`),
      });
      throw err;
    }
  }, [state.webWallet, state.activeAccount, dispatch]);

  // Called internally when marking address as used - wrapper to avoid circular dependency
  const markAddressUsed = useCallback(async (address: string): Promise<void> => {
    try {
      const usedAddresses: string[] = (await get(USED_ADDRESSES_KEY)) || [];
      if (!usedAddresses.includes(address)) {
        usedAddresses.push(address);
        await set(USED_ADDRESSES_KEY, usedAddresses);
      }
    } catch (err) {
      console.error('Failed to mark address as used:', err);
    }
  }, []);

  /**
   * Get a fresh Orchard address for shielding destination.
   * 
   * CRITICAL for privacy: Auto-shield MUST go to a NEW address.
   * - Different from the address that initiated the swap request
   * - Prevents linking swap initiation to received funds
   * - Fresh diversifier index for each shield operation
   * 
   * Uses unified address format which includes:
   * - Orchard receiver (primary)
   * - Sapling receiver (fallback)
   * - Optional transparent component
   */
  const toOrchardAddress = useCallback(async (purpose: string): Promise<FreshAddress> => {
    if (!state.webWallet || state.activeAccount == null) {
      throw new Error('Wallet not connected');
    }

    try {
      let address: string;
      let diversifierIndex: bigint;

      // Check if WebWallet supports address derivation at specific diversifier
      // @ts-expect-error - Method may not be in type definitions yet
      if (typeof state.webWallet.derive_unified_address === 'function') {
        // Get next diversifier index from storage
        const lastIndex = await get('zkpf-last-orchard-diversifier') as string || '0';
        diversifierIndex = BigInt(lastIndex) + BigInt(1);
        
        // Derive unified address at new diversifier
        // @ts-expect-error - Using dynamic method
        address = await state.webWallet.derive_unified_address(
          state.activeAccount,
          Number(diversifierIndex)
        );
        
        // Save new index
        await set('zkpf-last-orchard-diversifier', diversifierIndex.toString());
      } else {
        // Fallback: use current unified address
        address = await state.webWallet.get_current_address(state.activeAccount);
        diversifierIndex = BigInt(Date.now());
        
        console.warn('[Swap] Using current unified addr - fresh derivation not available');
      }

      const freshAddress: FreshAddress = {
        address,
        type: 'orchard',
        accountIndex: state.activeAccount,
        diversifierIndex,
        used: false,
        createdAt: Date.now(),
      };

      console.log(`[Swap] Fresh Orchard addr for ${purpose}:`, address.slice(0, 12) + '...');
      console.log(`[Swap]   Diversifier index: ${diversifierIndex}`);

      return freshAddress;
    } catch (err) {
      const message = extractErrorMessage(err);
      dispatch({
        type: 'set-error',
        payload: new Error(`Failed to generate Orchard address: ${message}`),
      });
      throw err;
    }
  }, [state.webWallet, state.activeAccount, dispatch]);

  // getFreshOrchardAddress is the public API name
  const getFreshOrchardAddress = toOrchardAddress;

  /**
   * Create an unshield transaction (Orchard → transparent).
   * 
   * For cross-chain swaps FROM shielded ZEC:
   * 1. User confirms swap → this function creates unshield tx
   * 2. ZEC moves from Orchard to fresh t-addr
   * 3. Swap service sends t-ZEC to provider deposit address
   * 4. Provider delivers destination asset
   * 
   * Production implementation requires:
   * - Transaction building API (PCZT or direct Orchard spend)
   * - Proper fee estimation (network fee + swap provider fee)
   * - Dust threshold handling
   * 
   * Note: Current WebWallet exposes `send_to_address` but may need
   * extension for explicit pool selection (Orchard vs Sapling).
   */
  const createUnshieldTransaction = useCallback(async (
    amountZats: bigint,
    toTransparentAddress: string
  ): Promise<{ txid: string; status: 'pending' | 'broadcast' }> => {
    if (!state.webWallet || state.activeAccount == null) {
      throw new Error('Wallet not connected');
    }

    // Validate amount against balance
    if (amountZats > walletState.totalShieldedZats) {
      throw new Error(`Insufficient shielded balance: ${zatsToZec(walletState.totalShieldedZats)} ZEC available`);
    }

    // Minimum amount check (dust threshold)
    const MIN_AMOUNT_ZATS = BigInt(100000); // 0.001 ZEC
    if (amountZats < MIN_AMOUNT_ZATS) {
      throw new Error(`Amount below minimum: ${zatsToZec(amountZats)} ZEC (min: ${zatsToZec(MIN_AMOUNT_ZATS)} ZEC)`);
    }

    console.log(`[Swap] Creating unshield tx: ${zatsToZec(amountZats)} ZEC → ${toTransparentAddress.slice(0, 10)}...`);

    // Try to use the WebWallet's send API if available
    try {
      // Check if WebWallet has send_to_address method
      // @ts-expect-error - Method may not be in type definitions yet
      if (typeof state.webWallet.send_to_address === 'function') {
        // Convert BigInt to number for the API (zatoshis)
        const amountNum = Number(amountZats);
        // @ts-expect-error - Using dynamic method
        const txid = await state.webWallet.send_to_address(
          state.activeAccount,
          toTransparentAddress,
          amountNum
        );
        console.log(`[Swap] Unshield tx broadcast: ${txid}`);
        return { txid, status: 'broadcast' };
      }
    } catch (err) {
      console.warn('[Swap] WebWallet send failed, falling back to manual:', err);
    }

    // Fallback: return placeholder indicating manual action needed
    // The UI will prompt user to complete the unshield from their wallet
    const placeholderTxid = `unshield-pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`[Swap] Manual unshield required - placeholder txid: ${placeholderTxid}`);
    console.log(`[Swap] User should send ${zatsToZec(amountZats)} ZEC to: ${toTransparentAddress}`);

    return {
      txid: placeholderTxid,
      status: 'pending',
    };
  }, [state.webWallet, state.activeAccount, walletState.totalShieldedZats]);

  /**
   * Create a shield transaction (transparent → Orchard).
   * 
   * For cross-chain swaps TO shielded ZEC:
   * 1. External swap deposits ZEC to fresh t-addr
   * 2. This function auto-shields to fresh Orchard address
   * 3. ZEC is now private in Orchard pool
   * 
   * Privacy considerations:
   * - Shield to NEW Orchard address (never the one that requested the swap)
   * - Apply random timing delay to break correlation
   * - Shield full balance to avoid change outputs
   * 
   * Production implementation requires:
   * - Transparent balance query at specific t-addr
   * - Shielding transaction building
   * - Optional: Watch for incoming deposits and auto-trigger
   */
  const createShieldTransaction = useCallback(async (
    fromTransparentAddress: string,
    _targetOrchardAddress: string
  ): Promise<{ txid: string; status: 'pending' | 'broadcast' }> => {
    if (!state.webWallet || state.activeAccount == null) {
      throw new Error('Wallet not connected');
    }

    console.log(`[Swap] Creating shield tx: ${fromTransparentAddress.slice(0, 10)}... → Orchard`);

    // Try to use the WebWallet's shield API if available
    try {
      // Check if WebWallet has shield_funds method
      // @ts-expect-error - Method may not be in type definitions yet
      if (typeof state.webWallet.shield_funds === 'function') {
        // @ts-expect-error - Using dynamic method
        const txid = await state.webWallet.shield_funds(
          state.activeAccount,
          fromTransparentAddress
        );
        console.log(`[Swap] Shield tx broadcast: ${txid}`);
        return { txid, status: 'broadcast' };
      }
    } catch (err) {
      console.warn('[Swap] WebWallet shield failed, falling back to manual:', err);
    }

    // Fallback: return placeholder indicating the shield is pending
    // The wallet will detect the transparent balance and can shield manually
    const placeholderTxid = `shield-pending-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    console.log(`[Swap] Manual shield may be required from: ${fromTransparentAddress}`);

    return {
      txid: placeholderTxid,
      status: 'pending',
    };
  }, [state.webWallet, state.activeAccount]);

  /**
   * Save a swap session to IndexedDB.
   */
  const saveSwapSession = useCallback(async (session: SwapSession): Promise<void> => {
    try {
      const sessions = await loadSwapSessions();
      const existingIndex = sessions.findIndex(s => s.sessionId === session.sessionId);

      if (existingIndex >= 0) {
        sessions[existingIndex] = session;
      } else {
        sessions.push(session);
      }

      // Serialize BigInts to strings for storage
      const serializable = sessions.map(s => ({
        ...s,
        amountIn: s.amountIn.toString(),
        expectedAmountOut: s.expectedAmountOut.toString(),
        actualAmountOut: s.actualAmountOut?.toString(),
        route: {
          ...s.route,
          amountIn: s.route.amountIn.toString(),
          expectedAmountOut: s.route.expectedAmountOut.toString(),
          minimumAmountOut: s.route.minimumAmountOut.toString(),
          fees: {
            ...s.route.fees,
            protocolFee: s.route.fees.protocolFee.toString(),
            networkFee: s.route.fees.networkFee.toString(),
            affiliateFee: s.route.fees.affiliateFee.toString(),
            totalFee: s.route.fees.totalFee.toString(),
          },
        },
      }));

      await set(SWAP_SESSIONS_KEY, serializable);
    } catch (err) {
      console.error('Failed to save swap session:', err);
    }
  }, []);

  /**
   * Load swap sessions from IndexedDB.
   */
  const loadSwapSessions = useCallback(async (): Promise<SwapSession[]> => {
    try {
      const stored = await get(SWAP_SESSIONS_KEY);
      if (!stored || !Array.isArray(stored)) {
        return [];
      }

      // Deserialize strings back to BigInts
      return stored.map((s: Record<string, unknown>) => ({
        ...s,
        amountIn: BigInt(s.amountIn as string || '0'),
        expectedAmountOut: BigInt(s.expectedAmountOut as string || '0'),
        actualAmountOut: s.actualAmountOut ? BigInt(s.actualAmountOut as string) : undefined,
        route: {
          ...(s.route as Record<string, unknown>),
          amountIn: BigInt((s.route as Record<string, unknown>).amountIn as string || '0'),
          expectedAmountOut: BigInt((s.route as Record<string, unknown>).expectedAmountOut as string || '0'),
          minimumAmountOut: BigInt((s.route as Record<string, unknown>).minimumAmountOut as string || '0'),
          fees: {
            ...((s.route as Record<string, unknown>).fees as Record<string, unknown>),
            protocolFee: BigInt(((s.route as Record<string, unknown>).fees as Record<string, unknown>).protocolFee as string || '0'),
            networkFee: BigInt(((s.route as Record<string, unknown>).fees as Record<string, unknown>).networkFee as string || '0'),
            affiliateFee: BigInt(((s.route as Record<string, unknown>).fees as Record<string, unknown>).affiliateFee as string || '0'),
            totalFee: BigInt(((s.route as Record<string, unknown>).fees as Record<string, unknown>).totalFee as string || '0'),
          },
        },
      })) as SwapSession[];
    } catch (err) {
      console.error('Failed to load swap sessions:', err);
      return [];
    }
  }, []);

  /**
   * Delete a swap session.
   */
  const deleteSwapSession = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const sessions = await loadSwapSessions();
      const filtered = sessions.filter(s => s.sessionId !== sessionId);
      
      // Use same serialization as saveSwapSession
      const serializable = filtered.map(s => ({
        ...s,
        amountIn: s.amountIn.toString(),
        expectedAmountOut: s.expectedAmountOut.toString(),
        actualAmountOut: s.actualAmountOut?.toString(),
        route: {
          ...s.route,
          amountIn: s.route.amountIn.toString(),
          expectedAmountOut: s.route.expectedAmountOut.toString(),
          minimumAmountOut: s.route.minimumAmountOut.toString(),
          fees: {
            ...s.route.fees,
            protocolFee: s.route.fees.protocolFee.toString(),
            networkFee: s.route.fees.networkFee.toString(),
            affiliateFee: s.route.fees.affiliateFee.toString(),
            totalFee: s.route.fees.totalFee.toString(),
          },
        },
      }));

      await set(SWAP_SESSIONS_KEY, serializable);
    } catch (err) {
      console.error('Failed to delete swap session:', err);
    }
  }, [loadSwapSessions]);

  /**
   * Check if an address has been used.
   */
  const isAddressUsed = useCallback(async (address: string): Promise<boolean> => {
    try {
      const usedAddresses: string[] = (await get(USED_ADDRESSES_KEY)) || [];
      return usedAddresses.includes(address);
    } catch {
      return false;
    }
  }, []);

  return {
    walletState,
    getSwapWalletState,
    getFreshTransparentAddress,
    getFreshOrchardAddress,
    createUnshieldTransaction,
    createShieldTransaction,
    saveSwapSession,
    loadSwapSessions,
    deleteSwapSession,
    markAddressUsed,
    isAddressUsed,
  };
}

