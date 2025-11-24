import React, { createContext, useCallback, useContext, useEffect, useReducer } from 'react';
import { del, get, set } from 'idb-keyval';
import initWebzjsWallet, {
  type WalletSummary,
  WebWallet,
  initThreadPool,
} from '@chainsafe/webzjs-wallet';
import initWebzjsKeys from '@chainsafe/webzjs-keys';

type WebZjsState = {
  webWallet: WebWallet | null;
  error: Error | null | string;
  summary?: WalletSummary;
  chainHeight?: bigint;
  activeAccount?: number | null;
  syncInProgress: boolean;
  loading: boolean;
};

type Action =
  | { type: 'set-web-wallet'; payload: WebWallet }
  | { type: 'set-error'; payload: Error | null | string }
  | { type: 'set-summary'; payload: WalletSummary }
  | { type: 'set-chain-height'; payload: bigint }
  | { type: 'set-active-account'; payload: number }
  | { type: 'set-sync-in-progress'; payload: boolean }
  | { type: 'set-loading'; payload: boolean };

const initialState: WebZjsState = {
  webWallet: null,
  error: null,
  summary: undefined,
  chainHeight: undefined,
  activeAccount: null,
  syncInProgress: false,
  loading: true,
};

function reducer(state: WebZjsState, action: Action): WebZjsState {
  switch (action.type) {
    case 'set-web-wallet':
      return { ...state, webWallet: action.payload };
    case 'set-error':
      return { ...state, error: action.payload };
    case 'set-summary':
      return { ...state, summary: action.payload };
    case 'set-chain-height':
      return { ...state, chainHeight: action.payload };
    case 'set-active-account':
      return { ...state, activeAccount: action.payload };
    case 'set-sync-in-progress':
      return { ...state, syncInProgress: action.payload };
    case 'set-loading':
      return { ...state, loading: action.payload };
    default:
      return state;
  }
}

type WebZjsContextType = {
  state: WebZjsState;
  dispatch: React.Dispatch<Action>;
};

const WebZjsContext = createContext<WebZjsContextType>({
  state: initialState,
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  dispatch: () => {},
});

export function useWebZjsContext(): WebZjsContextType {
  return useContext(WebZjsContext);
}

type ProviderProps = {
  children: React.ReactNode;
};

// Lightwalletd endpoint configuration:
// - In development: Use local Vite proxy to avoid CORS issues with cross-origin isolation
// - In production: Use Vercel serverless proxy or direct URL with credentialless COEP
const getLightwalletdUrl = (): string => {
  // Check for explicit override from environment
  const envUrl = import.meta.env.VITE_LIGHTWALLETD_URL;
  if (envUrl) {
    return envUrl;
  }

  // In development, use the Vite proxy
  if (import.meta.env.DEV) {
    return `${window.location.origin}/lightwalletd`;
  }

  // In production on Vercel, use the serverless proxy
  // This avoids CORS issues while maintaining cross-origin isolation
  if (window.location.hostname.includes('vercel.app') || 
      window.location.hostname.includes('.now.sh')) {
    return `${window.location.origin}/lightwalletd`;
  }

  // Fallback: direct connection (works with credentialless COEP)
  return 'https://zcash-mainnet.chainsafe.dev';
};

// Check if SharedArrayBuffer is fully available for WASM atomics
// This requires both the API to exist AND cross-origin isolation headers to be set
const isSharedArrayBufferAvailable = (): boolean => {
  try {
    // Check if SharedArrayBuffer exists
    if (typeof SharedArrayBuffer === 'undefined') {
      console.warn('SharedArrayBuffer is undefined');
      return false;
    }

    // Check if we're in a cross-origin isolated context
    // This is required for SharedArrayBuffer to work with WASM atomics
    if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
      console.warn('Not in a cross-origin isolated context (crossOriginIsolated=false)');
      return false;
    }

    // Try to create a SharedArrayBuffer and use Atomics on it
    // This tests actual usability, not just API presence
    const sab = new SharedArrayBuffer(4);
    const view = new Int32Array(sab);
    // Use Atomics.store/load which are required by wasm-bindgen-rayon
    Atomics.store(view, 0, 42);
    const result = Atomics.load(view, 0);
    if (result !== 42) {
      console.warn('Atomics operations failed');
      return false;
    }

    return true;
  } catch (err) {
    console.warn('SharedArrayBuffer check failed:', err);
    return false;
  }
};

export function WebZjsProvider({ children }: ProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const initAll = useCallback(async () => {
    try {
      if (typeof window === 'undefined') {
        dispatch({ type: 'set-loading', payload: false });
        return;
      }

      // Check for SharedArrayBuffer support - required by the WASM library
      // which uses wasm-bindgen-rayon for Rust's Mutex/RwLock primitives
      const hasSharedArrayBuffer = isSharedArrayBufferAvailable();
      if (!hasSharedArrayBuffer) {
        console.warn(
          'SharedArrayBuffer not available. WebWallet requires cross-origin isolation.\n' +
          'Ensure your server sends these headers:\n' +
          '  Cross-Origin-Opener-Policy: same-origin\n' +
          '  Cross-Origin-Embedder-Policy: credentialless\n' +
          'WebWallet features will be disabled.'
        );
        dispatch({ type: 'set-loading', payload: false });
        // Don't set an error - manual attestation mode still works
        return;
      }

      await initWebzjsWallet();
      await initWebzjsKeys();

      // Initialize thread pool for parallel sync (optional but recommended)
      try {
        const concurrency = navigator.hardwareConcurrency || 4;
        await initThreadPool(concurrency);
        console.info(`WebWallet thread pool initialized with ${concurrency} workers`);
      } catch (err) {
        // Thread pool is optional - sync will be slower but still work
        console.warn('Thread pool unavailable, using single-threaded mode:', err);
      }

      const lightwalletdUrl = getLightwalletdUrl();
      console.info(`Using lightwalletd endpoint: ${lightwalletdUrl}`);

      const bytes = await get('zkpf-webwallet-db');
      let wallet: WebWallet;

      if (bytes) {
        try {
          // Try to restore wallet from saved state
          wallet = new WebWallet('main', lightwalletdUrl, 1, bytes as Uint8Array);
          console.info('Restored wallet from saved state');
        } catch (restoreErr) {
          // Deserialization may fail if the saved state was created with
          // SharedArrayBuffer support but current env doesn't have it.
          // Clear the incompatible data and create a fresh wallet.
          console.warn(
            'Failed to restore wallet from saved state (likely SharedArrayBuffer mismatch). Creating fresh wallet.',
            restoreErr
          );
          await del('zkpf-webwallet-db');
          wallet = new WebWallet('main', lightwalletdUrl, 1);
        }
      } else {
        wallet = new WebWallet('main', lightwalletdUrl, 1);
        console.info('Created new wallet (no saved state found)');
      }

      dispatch({ type: 'set-web-wallet', payload: wallet });

      // These operations may fail if WASM wasn't compiled with shared memory
      // In that case, the wallet object exists but isn't fully functional
      try {
        const summary = await wallet.get_wallet_summary();
        if (summary) {
          dispatch({ type: 'set-summary', payload: summary });
          if (summary.account_balances.length > 0) {
            dispatch({
              type: 'set-active-account',
              payload: summary.account_balances[0][0],
            });
          }
        }

        const chainHeight = await wallet.get_latest_block();
        if (chainHeight != null) {
          dispatch({ type: 'set-chain-height', payload: BigInt(chainHeight) });
        }
      } catch (walletErr) {
        // Check if this is a SharedArrayBuffer-related error
        const errMsg = String(walletErr);
        if (errMsg.includes('shared') || errMsg.includes('SharedArrayBuffer')) {
          console.warn(
            'WebWallet requires SharedArrayBuffer support in WASM.\n' +
            'The WASM module may need to be rebuilt with shared memory support.\n' +
            'Falling back to manual attestation mode.'
          );
          // Clear the non-functional wallet
          dispatch({ type: 'set-web-wallet', payload: null });
        } else {
          // Re-throw non-SharedArrayBuffer errors
          throw walletErr;
        }
      }

      dispatch({ type: 'set-loading', payload: false });
    } catch (err) {
      // Check for SharedArrayBuffer-related errors
      const errMsg = String(err);
      if (errMsg.includes('shared') || errMsg.includes('SharedArrayBuffer') || 
          errMsg.includes('Atomics')) {
        console.warn(
          'WebWallet initialization failed due to SharedArrayBuffer limitations.\n' +
          'Manual attestation mode is still available.',
          err
        );
        dispatch({ type: 'set-loading', payload: false });
        // Don't set error - manual mode works
        return;
      }
      
      console.error('WebWallet initialization error:', err);
      dispatch({
        type: 'set-error',
        payload: err instanceof Error ? err : new Error(String(err)),
      });
      dispatch({ type: 'set-loading', payload: false });
    }
  }, []);

  useEffect(() => {
    void initAll();
  }, [initAll]);

  useEffect(() => {
    async function persistDb() {
      if (!state.webWallet) return;
      try {
        const bytes = await state.webWallet.db_to_bytes();
        await set('zkpf-webwallet-db', bytes);
      } catch (err) {
        console.error('Error persisting WebWallet DB:', err);
      }
    }

    if (state.webWallet) {
      void persistDb();
    }
  }, [state.webWallet]);

  return <WebZjsContext.Provider value={{ state, dispatch }}>{children}</WebZjsContext.Provider>;
}


