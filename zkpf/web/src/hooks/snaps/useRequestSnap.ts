import { defaultSnapOrigin } from '../../config/snap';
import type { Snap } from '../../types/snap';
import { useMetaMaskContext } from '../MetaMaskContext';
import { useRequest } from './useRequest';

export const useRequestSnap = (snapId = defaultSnapOrigin, version?: string) => {
  const request = useRequest();
  const { setInstalledSnap } = useMetaMaskContext();

  const requestSnap = async () => {
    const snaps = (await request({
      method: 'wallet_requestSnaps',
      params: {
        [snapId]: version ? { version } : {},
      },
    })) as Record<string, Snap>;

    setInstalledSnap(snaps?.[snapId] ?? null);
  };

  return requestSnap;
};


