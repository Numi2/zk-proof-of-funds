import React, { createContext, useCallback, useContext, useEffect, useReducer } from 'react';
import { get, set } from 'idb-keyval';
import initWebzjsWallet, {
  WalletSummary,
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

const MAINNET_LIGHTWALLETD_PROXY = 'https://zcash-mainnet.chainsafe.dev';

export function WebZjsProvider({ children }: ProviderProps) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const initAll = useCallback(async () => {
    try {
      if (typeof window === 'undefined') {
        dispatch({ type: 'set-loading', payload: false });
        return;
      }

      await initWebzjsWallet();
      await initWebzjsKeys();

      try {
        const concurrency = navigator.hardwareConcurrency || 4;
        await initThreadPool(concurrency);
      } catch (err) {
        console.error('Unable to initialize WebWallet thread pool:', err);
        dispatch({
          type: 'set-error',
          payload: new Error('Unable to initialize WebWallet thread pool'),
        });
        dispatch({ type: 'set-loading', payload: false });
        return;
      }

      const bytes = await get('zkpf-webwallet-db');
      let wallet: WebWallet;

      if (bytes) {
        wallet = new WebWallet('main', MAINNET_LIGHTWALLETD_PROXY, 1, bytes as Uint8Array);
      } else {
        wallet = new WebWallet('main', MAINNET_LIGHTWALLETD_PROXY, 1);
      }

      dispatch({ type: 'set-web-wallet', payload: wallet });

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

      dispatch({ type: 'set-loading', payload: false });
    } catch (err) {
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


