/**
 * usePersonhood Hook
 * 
 * Production-grade React hook for wallet-bound personhood verification.
 * 
 * Supports multiple wallet types:
 * - Zcash (via UFVK from localStorage)
 * - Solana (via Phantom/Solflare/Backpack)
 * - NEAR (via near-connect or Meteor)
 * - Passkey (via WebAuthn)
 * 
 * Features:
 * - Automatic status loading on mount
 * - Full ZKPassport flow integration
 * - Real signatures from connected wallets
 * - Clear error handling with user-friendly messages
 * - Cancel support for cleanup
 * 
 * NO MOCK DATA. NO DEMO MODE. All operations are real.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useWebZjsContext } from '../context/WebzjsContext';
import { useAuth } from '../context/AuthContext';
import type {
  PersonhoodState,
  PersonhoodFlowStatus,
  PersonhoodFlowError,
  PersonhoodId,
  WalletBindingId,
} from '../types/personhood';
import {
  computeWalletBindingId,
  computeWalletBindingIdFromPublicKey,
  getPersonhoodStatus,
  runZkPassportForWalletBinding,
  completeWalletBinding,
  createWalletCoreFromUfvk,
  createWalletCoreFromAuthContext,
  clearPersonhoodCache,
  type ZKPassportError,
  type WalletCore,
} from '../utils/personhood';

// ============================================================================
// Constants
// ============================================================================

/** localStorage key for storing UFVK (Zcash) */
import { hasUfvk, getUfvkSecurely } from '../utils/secureUfvkStorage';

/** API base URL (empty string uses relative paths) */
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

// ============================================================================
// Hook Result Type
// ============================================================================

export interface UsePersonhoodResult {
  /** Current flow status */
  status: PersonhoodFlowStatus;
  /** Computed wallet binding ID */
  walletBindingId: WalletBindingId | null;
  /** Personhood ID (after verification) */
  personhoodId: PersonhoodId | null;
  /** Number of wallets bound to this personhood */
  bindingsCount: number | null;
  /** Current error, if any */
  error: PersonhoodFlowError | null;
  /** ZKPassport URL for QR code display */
  zkPassportUrl: string | null;
  /** Whether the wallet is ready for verification */
  isWalletReady: boolean;
  /** Whether verification is in progress */
  isLoading: boolean;
  /** Current wallet type being used */
  activeWalletType: 'zcash' | 'solana' | 'near' | 'passkey' | null;
  /** Start the verification flow */
  startVerification: () => Promise<void>;
  /** Cancel the current verification flow */
  cancelVerification: () => void;
  /** Refresh status from backend */
  refreshStatus: () => Promise<void>;
  /** Clear local state and cache */
  reset: () => void;
}

// ============================================================================
// Initial State
// ============================================================================

const initialState: PersonhoodState = {
  status: 'loading_status',
  walletBindingId: null,
  personhoodId: null,
  bindingsCount: null,
  error: null,
  result: null,
  zkPassportUrl: null,
};

// ============================================================================
// Hook Implementation
// ============================================================================

export function usePersonhood(): UsePersonhoodResult {
  // Zcash wallet context
  const { state: walletState } = useWebZjsContext();
  
  // Multi-wallet auth context (Solana, NEAR, Passkey)
  const auth = useAuth();
  
  const [state, setState] = useState<PersonhoodState>(initialState);
  const cancelRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(true);

  // ========================================
  // Determine Active Wallet
  // ========================================

  // Check which wallet type is ready
  const activeWalletInfo = useMemo(() => {
    // Priority 1: Check Zcash UFVK (if webWallet is active)
    if (walletState.webWallet && 
        walletState.activeAccount !== null && 
        walletState.activeAccount !== undefined) {
      if (hasUfvk()) {
        return { type: 'zcash' as const, ready: true };
      }
    }

    // Priority 2: Check AuthContext for other wallets
    if (auth.status === 'connected' && auth.account) {
      const walletType = auth.account.type;
      if (walletType === 'solana') {
        return { type: 'solana' as const, ready: true };
      }
      if (walletType === 'near' || walletType === 'near-connect') {
        return { type: 'near' as const, ready: true };
      }
      if (walletType === 'passkey') {
        return { type: 'passkey' as const, ready: true };
      }
    }

    return { type: null, ready: false };
  }, [
    walletState.webWallet, 
    walletState.activeAccount, 
    auth.status, 
    auth.account
  ]);

  const isWalletReady = activeWalletInfo.ready;
  const activeWalletType = activeWalletInfo.type;

  // ========================================
  // Get Wallet Core for Signing
  // ========================================

  const getWalletCore = useCallback(async (): Promise<{ 
    core: WalletCore; 
    bindingId: WalletBindingId 
  } | null> => {
    if (activeWalletType === 'zcash') {
      const ufvk = await getUfvkSecurely();
      if (!ufvk) return null;
      
      const core = createWalletCoreFromUfvk(ufvk);
      const bindingId = computeWalletBindingId(ufvk);
      return { core, bindingId };
    }

    if (activeWalletType === 'solana' || 
        activeWalletType === 'near' || 
        activeWalletType === 'passkey') {
      if (!auth.account?.publicKey && !auth.account?.address) {
        return null;
      }
      
      // Compute binding ID from public key or address
      let bindingId: WalletBindingId;
      if (auth.account.publicKey) {
        bindingId = computeWalletBindingIdFromPublicKey(
          auth.account.publicKey,
          activeWalletType
        );
      } else {
        // Fallback to address-based binding ID
        bindingId = computeWalletBindingId(
          `${activeWalletType}:${auth.account.address}`
        );
      }

      const core = createWalletCoreFromAuthContext(auth, activeWalletType);
      return { core, bindingId };
    }

    return null;
  }, [activeWalletType, auth]);

  // ========================================
  // Status Loading
  // ========================================

  const refreshStatus = useCallback(async () => {
    if (!mountedRef.current) return;

    const walletInfo = await getWalletCore();
    if (!walletInfo) {
      setState(prev => ({
        ...prev,
        status: 'not_verified',
        walletBindingId: null,
        personhoodId: null,
        bindingsCount: null,
        error: null,
      }));
      return;
    }

    setState(prev => ({ ...prev, status: 'loading_status', error: null }));

    try {
      const { bindingId } = walletInfo;
      const statusResponse = await getPersonhoodStatus(bindingId, API_BASE_URL);

      if (!mountedRef.current) return;

      if (statusResponse.personhood_verified) {
        setState(prev => ({
          ...prev,
          status: 'verified',
          walletBindingId: bindingId,
          personhoodId: statusResponse.personhood_id,
          bindingsCount: statusResponse.bindings_count_for_person,
          error: null,
        }));
      } else {
        setState(prev => ({
          ...prev,
          status: 'not_verified',
          walletBindingId: bindingId,
          personhoodId: null,
          bindingsCount: null,
          error: null,
        }));
      }
    } catch (err) {
      if (!mountedRef.current) return;

      // On error, just show not verified - don't block the user
      const walletInfoNow = await getWalletCore();
      setState(prev => ({
        ...prev,
        status: 'not_verified',
        walletBindingId: walletInfoNow?.bindingId ?? null,
        error: null, // Don't show network errors on status check
      }));
    }
  }, [getWalletCore]);

  // Load status on mount and when wallet changes
  useEffect(() => {
    mountedRef.current = true;
    
    if (isWalletReady) {
      void refreshStatus();
    } else {
      setState(prev => ({
        ...prev,
        status: 'not_verified',
        walletBindingId: null,
        personhoodId: null,
        bindingsCount: null,
      }));
    }

    return () => {
      mountedRef.current = false;
    };
  }, [isWalletReady, activeWalletType, refreshStatus]);

  // ========================================
  // Verification Flow
  // ========================================

  const cancelVerification = useCallback(() => {
    if (cancelRef.current) {
      cancelRef.current();
      cancelRef.current = null;
    }

    if (!mountedRef.current) return;

    // Only reset to not_verified if we were in a transitional state
    setState(prev => {
      if (prev.status === 'awaiting_passport' || 
          prev.status === 'signing' || 
          prev.status === 'submitting') {
        return {
          ...prev,
          status: prev.personhoodId ? 'verified' : 'not_verified',
          error: null,
          zkPassportUrl: null,
        };
      }
      return prev;
    });
  }, []);

  const startVerification = useCallback(async () => {
    if (!mountedRef.current) return;

    // Step 1: Get wallet core and binding ID
    const walletInfo = await getWalletCore();
    if (!walletInfo) {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: {
          type: 'wallet_unavailable',
          message: 'Please connect a wallet first before verifying.',
        },
      }));
      return;
    }

    const { core: walletCore, bindingId: walletBindingId } = walletInfo;

    setState(prev => ({
      ...prev,
      status: 'awaiting_passport',
      walletBindingId,
      error: null,
      zkPassportUrl: null,
    }));

    // Step 2: Run ZKPassport flow
    let personhoodId: PersonhoodId;
    try {
      const { promise, cancel } = runZkPassportForWalletBinding({
        onUrlReady: (url) => {
          if (!mountedRef.current) return;
          setState(prev => ({ ...prev, zkPassportUrl: url }));
        },
        onBridgeConnect: () => {
          // Could update UI to show "App connected..."
        },
        onRequestReceived: () => {
          // Could update UI to show "Scanning passport..."
        },
        onGeneratingProof: () => {
          // Could update UI to show "Generating proof..."
        },
      });

      cancelRef.current = cancel;
      const result = await promise;
      cancelRef.current = null;

      if (!mountedRef.current) return;

      personhoodId = result.personhoodId;
      setState(prev => ({
        ...prev,
        personhoodId,
        zkPassportUrl: null,
      }));

    } catch (err) {
      if (!mountedRef.current) return;
      cancelRef.current = null;

      const zkError = err as ZKPassportError;
      let flowError: PersonhoodFlowError;

      switch (zkError.type) {
        case 'user_cancelled':
          flowError = {
            type: 'user_cancelled',
            message: 'You cancelled the passport verification. Your wallet is still fully usable.',
          };
          // Don't show as error state, just go back to not_verified
          setState(prev => ({
            ...prev,
            status: 'not_verified',
            zkPassportUrl: null,
            error: null,
          }));
          return;

        case 'timeout':
          flowError = {
            type: 'timeout',
            message: 'The passport scan timed out. Please try again when ready.',
          };
          break;

        case 'sdk_error':
        default:
          flowError = {
            type: 'sdk_error',
            message: zkError.message || 'Passport verification failed. Please try again.',
          };
          break;
      }

      setState(prev => ({
        ...prev,
        status: 'error',
        error: flowError,
        zkPassportUrl: null,
      }));
      return;
    }

    // Step 3: Sign and submit
    setState(prev => ({ ...prev, status: 'signing' }));

    setState(prev => ({ ...prev, status: 'submitting' }));

    const bindingResult = await completeWalletBinding(
      walletCore,
      personhoodId,
      walletBindingId,
      API_BASE_URL
    );

    if (!mountedRef.current) return;

    if (bindingResult.success) {
      setState(prev => ({
        ...prev,
        status: 'verified',
        personhoodId: bindingResult.result.personhood_id,
        walletBindingId: bindingResult.result.wallet_binding_id,
        bindingsCount: bindingResult.result.active_bindings_count,
        error: null,
        result: bindingResult.result,
      }));
    } else {
      setState(prev => ({
        ...prev,
        status: 'error',
        error: 'error' in bindingResult ? bindingResult.error : undefined,
      }));
    }

  }, [getWalletCore]);

  // ========================================
  // Reset
  // ========================================

  const reset = useCallback(() => {
    cancelVerification();
    clearPersonhoodCache();
    setState(initialState);
    
    if (isWalletReady) {
      void refreshStatus();
    }
  }, [cancelVerification, isWalletReady, refreshStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (cancelRef.current) {
        cancelRef.current();
      }
    };
  }, []);

  // ========================================
  // Return
  // ========================================

  const isLoading = 
    state.status === 'loading_status' ||
    state.status === 'awaiting_passport' ||
    state.status === 'signing' ||
    state.status === 'submitting';

  return {
    status: state.status,
    walletBindingId: state.walletBindingId,
    personhoodId: state.personhoodId,
    bindingsCount: state.bindingsCount,
    error: state.error,
    zkPassportUrl: state.zkPassportUrl,
    isWalletReady,
    isLoading,
    activeWalletType,
    startVerification,
    cancelVerification,
    refreshStatus,
    reset,
  };
}

// Re-export types
export type { PersonhoodFlowStatus, PersonhoodFlowError };
