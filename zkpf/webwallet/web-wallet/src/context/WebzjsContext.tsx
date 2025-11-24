import React, {
  createContext,
  useContext,
  useReducer,
  useEffect,
  useCallback,
} from 'react';
import { get } from 'idb-keyval';

import initWebzJSWallet, {
  initThreadPool,
  WalletSummary,
  WebWallet,
} from '@chainsafe/webzjs-wallet';
import initWebzJSKeys from '@chainsafe/webzjs-keys';
import { MAINNET_LIGHTWALLETD_PROXY } from '../config/constants';
import { Snap } from '../types';
import toast, { Toaster } from 'react-hot-toast';

// Check if SharedArrayBuffer is properly supported
const isSharedMemorySupported = () => {
  try {
    // Check if we have cross-origin isolation
    if (typeof crossOriginIsolated !== 'undefined' && !crossOriginIsolated) {
      return false;
    }
    // Try to create a SharedArrayBuffer
    const sab = new SharedArrayBuffer(1);
    // Try to use Atomics
    const ta = new Int32Array(sab);
    Atomics.load(ta, 0);
    return true;
  } catch {
    return false;
  }
};

export interface WebZjsState {
  webWallet: WebWallet | null;
  installedSnap: Snap | null;
  error: Error | null | string;
  summary?: WalletSummary;
  chainHeight?: bigint;
  activeAccount?: number | null;
  syncInProgress: boolean;
  loading: boolean;
}

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
  installedSnap: null,
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

interface WebZjsContextType {
  state: WebZjsState;
  dispatch: React.Dispatch<Action>;
}

const WebZjsContext = createContext<WebZjsContextType>({
  state: initialState,
  dispatch: () => {},
});

export function useWebZjsContext(): WebZjsContextType {
  return useContext(WebZjsContext);
}

export const WebZjsProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  const initAll = useCallback(async () => {
    try {
      await initWebzJSWallet();
      await initWebzJSKeys();

      // Check if shared memory is supported before attempting thread pool init
      const sharedMemSupported = isSharedMemorySupported();
      if (sharedMemSupported) {
        try {
          const concurrency = navigator.hardwareConcurrency || 4;
          await initThreadPool(concurrency);
          console.info('Thread pool initialized with', concurrency, 'threads');
        } catch (err) {
          // Thread pool initialization failed despite SharedArrayBuffer being available.
          // This typically means the WASM wasn't compiled with shared memory support.
          console.warn('Thread pool initialization failed:', err);
          console.warn('The WASM module may not have been compiled with shared memory support.');
          console.warn('Continuing without multi-threading - operations will be slower.');
        }
      } else {
        console.info('SharedArrayBuffer not available - running in single-threaded mode');
        console.info('For multi-threading support, ensure:');
        console.info('  1. The page is served with COOP/COEP headers');
        console.info('  2. The WASM is compiled with shared memory support');
      }

      const bytes = await get('wallet');
      let wallet: WebWallet;

      if (bytes) {
        console.info('Saved wallet detected. Restoring wallet from storage');
        wallet = new WebWallet('main', MAINNET_LIGHTWALLETD_PROXY, 1, bytes);
      } else {
        console.info('No saved wallet detected. Creating new wallet');
        wallet = new WebWallet('main', MAINNET_LIGHTWALLETD_PROXY, 1);
      }

      dispatch({ type: 'set-web-wallet', payload: wallet });

      // Retrieve summary (accounts, balances, etc.)
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
      if (chainHeight) {
        dispatch({ type: 'set-chain-height', payload: chainHeight });
      }

      dispatch({ type: 'set-loading', payload: false });
    } catch (err) {
      console.error('Initialization error:', err);
      dispatch({ type: 'set-error', payload: Error(String(err)) });
      dispatch({ type: 'set-loading', payload: false });
    }
  }, []);

  useEffect(() => {
    initAll().catch(console.error);
  }, [initAll]);

  useEffect(() => {
    if (state.error) {
      toast.error(state.error.toString());
    }
  }, [state.error, dispatch]);


  return (
    <WebZjsContext.Provider value={{ state, dispatch }}>
      <Toaster />
      {children}
    </WebZjsContext.Provider>
  );
};
