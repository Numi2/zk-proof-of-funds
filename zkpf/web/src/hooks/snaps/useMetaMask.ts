import { useEffect, useState } from 'react';
import { useMetaMaskContext } from '../MetaMaskContext';
import { useRequest } from './useRequest';
import type { GetSnapsResponse } from '../../types/snap';
import { defaultSnapOrigin } from '../../config/snap';

export const useMetaMask = () => {
  const { provider, installedSnap, setInstalledSnap } = useMetaMaskContext();
  const request = useRequest();
  const [isFlask, setIsFlask] = useState(false);

  const snapsDetected = provider !== null;

  const detectFlask = async () => {
    const clientVersion = await request({
      method: 'web3_clientVersion',
    });
    const versionStr = Array.isArray(clientVersion)
      ? (clientVersion[0] as string)
      : (clientVersion as string | null);
    const isFlaskDetected = !!versionStr && versionStr.includes('flask');
    setIsFlask(isFlaskDetected);
  };

  const getSnap = async () => {
    const snaps = (await request({
      method: 'wallet_getSnaps',
    })) as GetSnapsResponse;
    setInstalledSnap(snaps[defaultSnapOrigin] ?? null);
  };

  useEffect(() => {
    const run = async () => {
      if (!provider) return;
      await detectFlask();
      await getSnap();
    };
    void run();
  }, [provider]);

  return { isFlask, snapsDetected, installedSnap, getSnap };
}


