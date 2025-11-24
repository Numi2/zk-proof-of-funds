import { useCallback } from 'react';
import { set } from 'idb-keyval';
import { useWebZjsContext } from '../context/WebzjsContext';
import { useMetaMask } from './snaps/useMetaMask';
import { useInvokeSnap } from './snaps/useInvokeSnap';
import { useRequestSnap } from './snaps/useRequestSnap';
import { SeedFingerprint } from '@chainsafe/webzjs-wallet';

type AccountData = {
  unifiedAddress: string;
  transparentAddress: string;
};

export function useWebzjsActions() {
  const { state, dispatch } = useWebZjsContext();
  const { installedSnap } = useMetaMask();
  const invokeSnap = useInvokeSnap();
  const requestSnap = useRequestSnap();

  const getAccountData = useCallback(async (): Promise<AccountData | undefined> => {
    try {
      if (
        state.activeAccount === null ||
        state.activeAccount === undefined ||
        !state.webWallet
      ) {
        return;
      }

      const accountIndex = state.activeAccount;
      const unifiedAddress = await state.webWallet.get_current_address(accountIndex);
      const transparentAddress =
        await state.webWallet.get_current_address_transparent(accountIndex);

      return { unifiedAddress, transparentAddress };
    } catch (error) {
      console.error('Cannot get active account data', error);
      dispatch({
        type: 'set-error',
        payload: new Error('Cannot get active account data'),
      });
      return;
    }
  }, [dispatch, state.activeAccount, state.webWallet]);

  const syncStateWithWallet = useCallback(async () => {
    if (!state.webWallet) {
      return;
    }
    try {
      const summary = await state.webWallet.get_wallet_summary();
      if (summary) {
        dispatch({ type: 'set-summary', payload: summary });
      }
      const chainHeight = await state.webWallet.get_latest_block();
      if (chainHeight != null) {
        dispatch({ type: 'set-chain-height', payload: BigInt(chainHeight) });
      }
    } catch (error) {
      console.error('Error syncing state with WebWallet:', error);
      dispatch({
        type: 'set-error',
        payload: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, [state.webWallet, dispatch]);

  const flushDbToStore = useCallback(async () => {
    if (!state.webWallet) {
      return;
    }
    try {
      const bytes = await state.webWallet.db_to_bytes();
      await set('zkpf-webwallet-db', bytes);
    } catch (error) {
      console.error('Error flushing WebWallet DB to store:', error);
      dispatch({
        type: 'set-error',
        payload: error instanceof Error ? error : new Error(String(error)),
      });
    }
  }, [state.webWallet, dispatch]);

  const connectWebZjsSnap = useCallback(async () => {
    try {
      await requestSnap();

      if (!state.webWallet) {
        return;
      }

      const latestBlockBigInt = await state.webWallet.get_latest_block();
      const latestBlock = Number(latestBlockBigInt);

      let birthdayBlock = (await invokeSnap({
        method: 'setBirthdayBlock',
        params: { latestBlock },
      })) as number | null;

      if (birthdayBlock === null) {
        await invokeSnap({
          method: 'setSnapState',
          params: { webWalletSyncStartBlock: latestBlock },
        });
        birthdayBlock = latestBlock;
      }

      const viewingKey = (await invokeSnap({
        method: 'getViewingKey',
      })) as string;

      const seedFingerprintHexString = (await invokeSnap({
        method: 'getSeedFingerprint',
      })) as string;

      const cleanHex = seedFingerprintHexString.trim().replace(/^0x/, '');
      const seedFingerprintBytes = new Uint8Array(cleanHex.length / 2);
      for (let i = 0; i < seedFingerprintBytes.length; i += 1) {
        seedFingerprintBytes[i] = Number.parseInt(cleanHex.slice(i * 2, i * 2 + 2), 16);
      }
      const seedFingerprint = SeedFingerprint.from_bytes(seedFingerprintBytes);

      const accountId = await state.webWallet.create_account_ufvk(
        'account-0',
        viewingKey,
        seedFingerprint,
        0,
        birthdayBlock,
      );

      dispatch({ type: 'set-active-account', payload: accountId });
      await syncStateWithWallet();
      await flushDbToStore();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({
        type: 'set-error',
        payload: new Error(
          `Failed to connect MetaMask Snap and create Zcash wallet account: ${message}`,
        ),
      });
      throw error;
    }
  }, [state.webWallet, requestSnap, invokeSnap, syncStateWithWallet, flushDbToStore, dispatch]);

  const triggerRescan = useCallback(async () => {
    if (!installedSnap) {
      return;
    }

    if (state.loading) {
      dispatch({
        type: 'set-error',
        payload: new Error('App not yet loaded'),
      });
      return;
    }
    if (!state.webWallet) {
      return;
    }
    if (state.activeAccount === undefined || state.activeAccount === null) {
      dispatch({
        type: 'set-error',
        payload: new Error('No active Zcash account'),
      });
      return;
    }
    if (state.syncInProgress) {
      return;
    }

    dispatch({ type: 'set-sync-in-progress', payload: true });

    try {
      await state.webWallet.sync();
      await syncStateWithWallet();
      await flushDbToStore();
    } catch (err) {
      console.error('Error during Zcash rescan:', err);
      dispatch({
        type: 'set-error',
        payload: err instanceof Error ? err : new Error(String(err)),
      });
    } finally {
      dispatch({ type: 'set-sync-in-progress', payload: false });
    }
  }, [
    installedSnap,
    state.loading,
    state.webWallet,
    state.activeAccount,
    state.syncInProgress,
    dispatch,
    syncStateWithWallet,
    flushDbToStore,
  ]);

  const createAccountFromSeed = useCallback(
    async (seedPhrase: string, birthdayHeight?: number | null) => {
      if (!state.webWallet) {
        dispatch({
          type: 'set-error',
          payload: new Error('Zcash WebWallet is not initialized'),
        });
        return;
      }
      try {
        const accountId = await state.webWallet.create_account(
          'account-0',
          seedPhrase,
          0,
          birthdayHeight ?? undefined,
        );
        dispatch({ type: 'set-active-account', payload: accountId });
        await syncStateWithWallet();
        await flushDbToStore();
      } catch (error) {
        console.error('Error creating account from seed phrase:', error);
        dispatch({
          type: 'set-error',
          payload: error instanceof Error ? error : new Error(String(error)),
        });
        throw error;
      }
    },
    [state.webWallet, dispatch, syncStateWithWallet, flushDbToStore],
  );

  return {
    getAccountData,
    triggerRescan,
    flushDbToStore,
    syncStateWithWallet,
    connectWebZjsSnap,
    createAccountFromSeed,
  };
}


