import React, { createContext, useCallback, useContext, useEffect, useReducer } from 'react';
import { del, get, set } from 'idb-keyval';
import type { WalletSummary, WebWallet } from '@chainsafe/webzjs-wallet';
import initWebzjsKeys from '@chainsafe/webzjs-keys';
import { detectBrowser, getWalletModeMessage } from '../utils/browserCompat';
import { 
  loadWalletWasm, 
  createWebWallet, 
  getWasmEnvironmentInfo,
  isThreadedMode,
} from '../wasm/wallet-loader';

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
  | { type: 'set-web-wallet'; payload: WebWallet | null }
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

// Log environment diagnostics for debugging
const logEnvironmentInfo = (): void => {
  const browser = detectBrowser();
  const modeInfo = getWalletModeMessage();
  const wasmEnv = getWasmEnvironmentInfo();
  
  console.info('[Wallet Environment]');
  console.info(`  Browser: ${browser.name} ${browser.version}`);
  console.info(`  Mobile: ${browser.isMobile}`);
  console.info(`  crossOriginIsolated: ${wasmEnv.isCrossOriginIsolated}`);
  console.info(`  SharedArrayBuffer: ${wasmEnv.hasSAB}`);
  console.info(`  Supports Threads: ${wasmEnv.supportsThreads}`);
  console.info(`  Hardware Concurrency: ${wasmEnv.hardwareConcurrency}`);
  console.info(`  Wallet Mode: ${modeInfo.mode} - ${modeInfo.title}`);
  
  if (browser.technicalReason) {
    console.info(`  Technical: ${browser.technicalReason}`);
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

      // Log environment info for debugging
      logEnvironmentInfo();

      // Wait for service worker if needed (for non-Safari browsers that use the COI workaround)
      const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
      if (!isSafari && 'serviceWorker' in navigator && window.isSecureContext) {
        const registration = await navigator.serviceWorker.getRegistration();
        if (registration?.active && !navigator.serviceWorker.controller) {
          console.info('🔄 Service worker active but not controlling, waiting for reload...');
          await new Promise(resolve => setTimeout(resolve, 500));
        }
      }

      // Load the WASM module - the loader will automatically pick the right variant
      // (threaded if SharedArrayBuffer available, single-threaded otherwise)
      console.info('📦 Loading wallet WASM module...');
      await loadWalletWasm();
      await initWebzjsKeys();
      
      const wasmEnv = getWasmEnvironmentInfo();
      console.info(`✅ WASM loaded: ${wasmEnv.loadedVariant} variant`);
      if (wasmEnv.loadedVariant === 'single') {
        console.info('   Note: Running in single-threaded mode. Sync will be slower but works everywhere.');
      } else {
        console.info(`   Thread pool: ${wasmEnv.hardwareConcurrency} workers available`);
      }

      const lightwalletdUrl = getLightwalletdUrl();
      console.info(`Using lightwalletd endpoint: ${lightwalletdUrl}`);

      const bytes = await get('zkpf-webwallet-db');
      let wallet: WebWallet;

      if (bytes) {
        try {
          // Try to restore wallet from saved state
          wallet = await createWebWallet('main', lightwalletdUrl, 1, bytes as Uint8Array);
          console.info('Restored wallet from saved state');
        } catch (restoreErr) {
          // Deserialization may fail if the saved state was created with
          // a different WASM variant (threaded vs single-threaded).
          // Clear the incompatible data and create a fresh wallet.
          console.warn(
            'Failed to restore wallet from saved state. Creating fresh wallet.',
            restoreErr
          );
          await del('zkpf-webwallet-db');
          wallet = await createWebWallet('main', lightwalletdUrl, 1);
        }
      } else {
        wallet = await createWebWallet('main', lightwalletdUrl, 1);
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
      const errMsg = String(err);
      
      // Check if this is a WASM loading error that might be recoverable
      if (errMsg.includes('shared') || errMsg.includes('SharedArrayBuffer') || 
          errMsg.includes('Atomics') || errMsg.includes('WebAssembly.Memory')) {
        // This shouldn't happen with the dual-build approach, but handle gracefully
        console.warn(
          '⚠️ WASM initialization failed - both threaded and single-threaded variants failed.\n' +
          'This is unexpected. Please report this issue.',
          err
        );
        // Try to provide useful diagnostic info
        const wasmEnv = getWasmEnvironmentInfo();
        console.warn('Environment info:', wasmEnv);
        
        dispatch({ type: 'set-loading', payload: false });
        // Don't set blocking error - P2P and verification features still work
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


